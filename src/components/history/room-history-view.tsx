// Rooms this device was in, newest first, with what moved in each (website:
// room-history-view.tsx). Kept on this device only.
import { ArrowDown, ArrowUp, DoorOpen, MessagesSquare, Timer, Users } from "lucide-react-native";
import { useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInDown, LinearTransition } from "react-native-reanimated";
import { THEME_STYLES } from "@/lib/fun/themes";
import { clearRoomHistory, roomHistory, type RoomEndReason, type RoomHistoryEntry } from "@/lib/history/rooms";
import { formatBytes, formatDuration, formatRoomCode } from "@/lib/utils/format";
import { useLocalStore } from "@/hooks/use-local-store";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { confirm } from "@/components/ui/confirm";
import { Divider } from "@/components/ui/list-row";
import { EmptyState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";

const ENDED: Record<RoomEndReason, { label: string; variant: BadgeVariant }> = {
  expired: { label: "Time ran out", variant: "secondary" },
  closed: { label: "Closed", variant: "secondary" },
  removed: { label: "Removed", variant: "warning" },
  left: { label: "Left", variant: "secondary" },
};

const when = (ms: number) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function spentSeconds(entry: RoomHistoryEntry): number {
  return Math.max(0, ((entry.endedAt ?? entry.lastSeenAt) - entry.joinedAt) / 1000);
}

function Meta({ icon: Icon, children }: { icon?: typeof Timer; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.meta}>
      {Icon ? <Icon size={12} color={colors.mutedForeground} /> : null}
      <Text variant="caption" tone="muted">
        {children}
      </Text>
    </View>
  );
}

function Row({ entry: e, index }: { entry: RoomHistoryEntry; index: number }) {
  const { colors } = useTheme();
  const theme = THEME_STYLES[e.theme];
  const ended = e.endReason ? ENDED[e.endReason] : null;
  const moved = e.sentFiles + e.receivedFiles > 0;
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 10) * 30).springify().damping(18)} layout={LinearTransition} style={styles.row}>
      <View style={[styles.emoji, { backgroundColor: colors.muted }]}>
        <Text style={{ fontSize: 20 }}>{theme.emoji}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={styles.wrap}>
          <Text variant="mono" style={{ fontSize: 14, fontWeight: "700", letterSpacing: 1 }}>
            {formatRoomCode(e.roomCode)}
          </Text>
          <Badge label={e.host ? "Host" : "Joined"} variant={e.host ? "default" : "secondary"} />
          {e.kind === "event" ? <Badge label="Event" variant="electric" /> : null}
          {e.mode === "my-devices" ? <Badge label="My devices" /> : null}
          {e.mode === "room-link" ? <Badge label="Personal room" /> : null}
          {ended ? <Badge label={ended.label} variant={ended.variant} /> : null}
        </View>
        <View style={styles.wrap}>
          <Meta>
            {when(e.joinedAt)} · {formatDuration(spentSeconds(e))} in the room
          </Meta>
          {e.durationSeconds !== null ? (
            <Meta icon={Timer}>
              {Math.round(e.durationSeconds / 60)} min room{e.timeExtended ? " (time added)" : ""}
            </Meta>
          ) : null}
        </View>
        <View style={styles.wrap}>
          {moved ? (
            <>
              <Meta icon={ArrowUp}>
                {e.sentFiles} sent{e.sentBytes ? ` (${formatBytes(e.sentBytes)})` : ""}
              </Meta>
              <Meta icon={ArrowDown}>
                {e.receivedFiles} received{e.receivedBytes ? ` (${formatBytes(e.receivedBytes)})` : ""}
              </Meta>
            </>
          ) : (
            <Meta>No files</Meta>
          )}
          {e.chatMessages > 0 ? (
            <Meta icon={MessagesSquare}>
              {e.chatMessages} {e.chatMessages === 1 ? "message" : "messages"}
            </Meta>
          ) : null}
          <Meta icon={Users}>
            {e.peakDevices} {e.peakDevices === 1 ? "device" : "devices"}
          </Meta>
        </View>
      </View>
    </Animated.View>
  );
}

export function RoomHistoryView() {
  const entries = useLocalStore(roomHistory);
  const list = useMemo(() => entries.slice().sort((a, b) => b.joinedAt - a.joinedAt), [entries]);
  const totals = useMemo(
    () => ({
      rooms: entries.length,
      hosted: entries.filter((e) => e.host).length,
      seconds: entries.reduce((sum, e) => sum + spentSeconds(e), 0),
      files: entries.reduce((sum, e) => sum + e.sentFiles + e.receivedFiles, 0),
    }),
    [entries],
  );

  const clear = async () => {
    const ok = await confirm({
      title: "Clear your room history?",
      message: "Removes the list of rooms you were in from this device. Your transfer history and saved files are not affected.",
      confirmLabel: "Clear",
      cancelLabel: "Keep",
      destructive: true,
    });
    if (ok) clearRoomHistory();
  };

  if (list.length === 0) {
    return <EmptyState icon={DoorOpen} title="No rooms yet" body="Rooms you create or join show up here, on this device only." />;
  }

  return (
    <View style={{ gap: space.lg, marginTop: space.lg }}>
      <Text variant="footnote" tone="muted">
        <Text variant="footnote" style={{ fontWeight: "700" }}>{totals.rooms}</Text> {totals.rooms === 1 ? "room" : "rooms"} ·{" "}
        <Text variant="footnote" style={{ fontWeight: "700" }}>{totals.hosted}</Text> hosted ·{" "}
        <Text variant="footnote" style={{ fontWeight: "700" }}>{formatDuration(totals.seconds)}</Text> in rooms ·{" "}
        <Text variant="footnote" style={{ fontWeight: "700" }}>{totals.files}</Text> {totals.files === 1 ? "file" : "files"}
      </Text>
      <Card style={{ paddingVertical: space.xs }}>
        {list.map((e, i) => (
          <View key={e.roomId}>
            {i > 0 ? <Divider inset={52} /> : null}
            <Row entry={e} index={i} />
          </View>
        ))}
      </Card>
      <Button label="Clear rooms" variant="ghost" onPress={() => void clear()} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.md, paddingVertical: space.md },
  emoji: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.sm, rowGap: 4 },
  meta: { flexDirection: "row", alignItems: "center", gap: 4 },
});
