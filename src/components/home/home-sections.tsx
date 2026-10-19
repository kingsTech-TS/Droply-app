// Home sections ported from the website's landing components: Your active rooms, Nearby
// (rooms on your network), My devices, and the "back to your room" card.
import { router, useIsFocused } from "expo-router";
import { ChevronRight, Crown, DoorOpen, Laptop, Link2, Radar, X } from "lucide-react-native";
import { useState, useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInDown, LinearTransition } from "react-native-reanimated";
import { useQuery } from "@tanstack/react-query";
import { isApiError, userMessage } from "@/lib/api/errors";
import { getNearbyRooms, getRoomStatus } from "@/lib/api/rooms";
import { THEME_STYLES } from "@/lib/fun/themes";
import { pairing } from "@/lib/pairing/pairing";
import { enterSharedRoom, rejoinRoom } from "@/lib/session/actions";
import { forgetRooms, myRooms, type MyRoom } from "@/lib/session/my-rooms";
import { activeSession } from "@/lib/session/registry";
import { formatRoomCode } from "@/lib/utils/format";
import { isActive } from "@/lib/webrtc/transfer-view";
import { useDevice } from "@/hooks/use-device";
import { useLocalStore } from "@/hooks/use-local-store";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
import { DeviceAvatar } from "@/components/room/device-avatar";
import { Button } from "@/components/ui/button";
import { Card, PressableCard } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { SectionHeader } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { toast } from "@/components/ui/toast";

const MAX_ROOM_LIFETIME_MS = 6 * 60 * 60 * 1000;

function endsIn(expiresAt: string, now: number): string | null {
  const minutes = Math.round((Date.parse(expiresAt) - now) / 60_000);
  if (!Number.isFinite(minutes)) return null;
  if (minutes <= 1) return "ends soon unless someone is active";
  return minutes < 60 ? `open for ${minutes} more min` : `open for ${Math.round(minutes / 60)} more h`;
}

export function goToRoom(roomId: string): void {
  router.push({ pathname: "/room/[roomId]", params: { roomId } });
}

/** "Back to your room": the room keeps running while you use other tabs. */
export function CurrentRoomCard() {
  const { colors } = useTheme();
  const session = useSyncExternalStore(activeSession.subscribe, activeSession.getSnapshot, activeSession.getSnapshot);
  const room = useSyncExternalStore(session?.room.subscribe ?? (() => () => undefined), session?.room.getSnapshot ?? (() => null), session?.room.getSnapshot ?? (() => null));
  const transfers = useSyncExternalStore(
    session?.transfers.store.subscribe ?? (() => () => undefined),
    session?.transfers.store.getSnapshot ?? (() => null),
    session?.transfers.store.getSnapshot ?? (() => null),
  );
  if (!session || !room || room.status === "ended") return null;
  const others = room.devices.filter((d) => d.device_id !== room.selfId && d.connection_state === "connected").length;
  const active = transfers?.items.filter(isActive).length ?? 0;
  const theme = THEME_STYLES[room.theme];
  return (
    <Animated.View entering={FadeInDown.springify().damping(18)} style={{ marginBottom: space.lg }}>
      <PressableCard onPress={() => goToRoom(room.roomId)} style={{ borderColor: colors.primary, borderWidth: 1.5 }} accessibilityLabel={`Back to room ${formatRoomCode(room.roomCode)}`}>
        <View style={styles.row}>
          <View style={[styles.emoji, { backgroundColor: colors.primarySoft }]}>
            <Text style={{ fontSize: 22 }}>{theme.emoji}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">Room {formatRoomCode(room.roomCode)}</Text>
            <Text variant="footnote" tone="muted">
              {active > 0 ? `${active} transfer${active === 1 ? "" : "s"} in progress` : others === 1 ? "1 device connected" : `${others} devices connected`}
            </Text>
          </View>
          <View style={[styles.live, { backgroundColor: colors.successSoft }]}>
            <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
            <Text variant="caption" tone="success">
              Live
            </Text>
          </View>
          <ChevronRight size={18} color={colors.mutedForeground} />
        </View>
      </PressableCard>
    </Animated.View>
  );
}

export function ActiveRooms() {
  const { colors } = useTheme();
  const focused = useIsFocused();
  const remembered = useLocalStore(myRooms);
  const { info } = useDevice();
  const [busy, setBusy] = useState<string | null>(null);
  const current = useSyncExternalStore(activeSession.subscribe, activeSession.getSnapshot, activeSession.getSnapshot);
  const status = useQuery({
    queryKey: ["room-status", remembered.map((r) => `${r.roomId}:${r.roomCode}`).join(",")],
    queryFn: async () => {
      const result = await getRoomStatus(remembered.map((r) => ({ room_id: r.roomId, room_code: r.roomCode })));
      forgetRooms(result.filter((r) => !r.active).map((r) => r.room_id));
      return { rooms: new Map(result.map((r) => [r.room_id, r])), at: Date.now() };
    },
    enabled: focused && remembered.length > 0,
    refetchInterval: 30_000,
    retry: (count, error) => !(isApiError(error) && (error.status === 404 || error.status === 405)) && count < 1,
  });
  // A server without the status endpoint: show what we remember (younger than the hard cap).
  const unknown = status.isError && isApiError(status.error) && (status.error.status === 404 || status.error.status === 405);
  if (!status.data && !unknown) return null;
  const at = status.data?.at ?? status.errorUpdatedAt;
  const visible = remembered.filter(
    (room) =>
      room.roomId !== current?.session.roomId &&
      (status.data ? status.data.rooms.get(room.roomId)?.active === true : at - room.at < MAX_ROOM_LIFETIME_MS),
  );
  if (visible.length === 0) return null;

  const rejoin = async (room: MyRoom) => {
    setBusy(room.roomId);
    try {
      goToRoom(await rejoinRoom(room, info()));
    } catch (error) {
      if (isApiError(error) && (error.code === "ROOM_EXPIRED" || error.code === "INVALID_ROOM_CODE" || error.code === "ROOM_NOT_FOUND")) {
        forgetRooms([room.roomId]);
        toast.error("That room has ended.");
      } else {
        toast.error(userMessage(error));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <View>
      <SectionHeader title="Your active rooms" icon={DoorOpen} />
      <Card padded={false}>
        {visible.map((room, index) => {
          const live = status.data?.rooms.get(room.roomId);
          const theme = THEME_STYLES[live?.theme ?? room.theme];
          const details = [
            room.created ? "You created it" : "You joined",
            live?.device_count != null ? (live.device_count === 1 ? "1 device in it" : `${live.device_count} devices in it`) : null,
            live?.expires_at ? endsIn(live.expires_at, at) : null,
          ].filter(Boolean);
          return (
            <Animated.View key={room.roomId} layout={LinearTransition} style={[styles.listRow, index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : null]}>
              <Text style={{ fontSize: 24 }}>{theme.emoji}</Text>
              <View style={{ flex: 1 }}>
                <View style={styles.inline}>
                  <Text variant="bodyStrong">Room {formatRoomCode(room.roomCode)}</Text>
                  {room.created ? <Crown size={14} color={colors.warning} accessibilityLabel="You're the host" /> : null}
                </View>
                <Text variant="footnote" tone="muted" numberOfLines={2}>
                  {details.join(" · ")}
                </Text>
              </View>
              <Button label={busy === room.roomId ? "Joining…" : "Rejoin"} size="sm" variant="tinted" onPress={() => void rejoin(room)} disabled={busy !== null} accessibilityLabel={`Rejoin room ${formatRoomCode(room.roomCode)}`} />
              <IconButton icon={X} label={`Remove room ${formatRoomCode(room.roomCode)} from this list`} size={18} onPress={() => forgetRooms([room.roomId])} />
            </Animated.View>
          );
        })}
      </Card>
    </View>
  );
}

export function NearbyRooms() {
  const { colors } = useTheme();
  const focused = useIsFocused();
  const nearby = useQuery({ queryKey: ["nearby"], queryFn: () => getNearbyRooms(), enabled: focused, refetchInterval: 8_000, retry: false });
  const rooms = nearby.data ?? [];
  if (rooms.length === 0) return null;
  return (
    <View>
      <SectionHeader title="Rooms on your network" icon={Radar} />
      <Card padded={false}>
        {rooms.map((room, index) => (
          <Animated.View key={room.room_id} entering={FadeInDown} style={[styles.listRow, index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : null]}>
            <DeviceAvatar name={room.host_name} type={room.host_device_type} size={40} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {room.theme !== "default" ? `${THEME_STYLES[room.theme].emoji} ` : ""}
                {room.host_name}&apos;s room
              </Text>
              <Text variant="footnote" tone="muted">
                {room.device_count === 1 ? "1 device" : `${room.device_count} devices`}
                {room.kind === "event" ? " · event" : ""}
              </Text>
            </View>
            <Button label="Join" size="sm" onPress={() => router.push({ pathname: "/join/[code]", params: { code: room.room_code } })} />
          </Animated.View>
        ))}
      </Card>
    </View>
  );
}

export function MyDevicesCard() {
  const { colors } = useTheme();
  const state = useLocalStore(pairing);
  const { info } = useDevice();
  const [busy, setBusy] = useState(false);
  if (!state.key || state.devices.length === 0) {
    return (
      <View style={[styles.tip, { backgroundColor: colors.muted }]}>
        <Link2 size={16} color={colors.mutedForeground} />
        <Text variant="footnote" tone="muted" style={{ flex: 1 }}>
          Tip: pair your own phone and laptop once and they&apos;ll find each other without a code. Open a room on both, then choose{" "}
          <Text variant="footnote" style={{ fontWeight: "700" }}>
            Add to My devices
          </Text>{" "}
          on the other device&apos;s card.
        </Text>
      </View>
    );
  }
  const connect = async () => {
    if (!state.key) return;
    setBusy(true);
    try {
      goToRoom(await enterSharedRoom(state.key, "my-devices", info()));
    } catch (error) {
      toast.error(userMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View>
      <SectionHeader title="My devices" icon={Laptop} action={<Button label="Manage" size="sm" variant="ghost" onPress={() => router.push("/my-devices")} />} />
      <Card>
        <View style={[styles.inline, { flexWrap: "wrap", gap: space.sm, marginBottom: space.md }]}>
          {state.devices.map((d) => (
            <View key={d.name} style={[styles.chip, { backgroundColor: colors.muted }]}>
              <DeviceAvatar name={d.name} type={d.type} size={28} />
              <Text variant="footnote" numberOfLines={1} style={{ maxWidth: 140 }}>
                {d.name}
              </Text>
            </View>
          ))}
        </View>
        <Button label={busy ? "Connecting…" : "Connect my devices"} onPress={() => void connect()} disabled={busy} fullWidth />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  inline: { flexDirection: "row", alignItems: "center", gap: space.xs },
  emoji: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  live: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  listRow: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, paddingLeft: space.lg },
  tip: { flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.lg, marginTop: space.lg },
  chip: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingRight: space.md, borderRadius: radius.pill, paddingLeft: 2, paddingVertical: 2 },
});
