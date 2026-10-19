// Every transfer of the open room in one place (an app addition: on the website they live on
// the room page). Requests can be answered here too.
import { router } from "expo-router";
import { ArrowDownUp, ChevronRight } from "lucide-react-native";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { userMessage } from "@/lib/api/errors";
import type { RoomSession } from "@/lib/session/room-session";
import { activeSession } from "@/lib/session/registry";
import { formatRoomCode, formatSpeed } from "@/lib/utils/format";
import type { TransferSnapshot } from "@/lib/webrtc/transfer-manager";
import { isActive, totalSpeed } from "@/lib/webrtc/transfer-view";
import { RoomSessionProvider, usePeerLinks, useRoom, useTransfers } from "@/hooks/use-room-session";
import { useTheme } from "@/theme/theme-provider";
import { space } from "@/theme/tokens";
import { goToRoom } from "@/components/home/home-sections";
import { TAB_BAR_SPACE } from "@/components/tab-bar";
import { IncomingCard } from "@/components/transfer/incoming-card";
import { SaveSheet } from "@/components/transfer/save-sheet";
import { TransferCard, type TransferCardActions } from "@/components/transfer/transfer-card";
import { Button } from "@/components/ui/button";
import { PressableCard } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { EmptyState, SectionHeader } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { toast } from "@/components/ui/toast";

function SessionTransfers({ session }: { session: RoomSession }) {
  const { colors } = useTheme();
  const room = useRoom();
  const transfers = useTransfers();
  const links = usePeerLinks();
  const [saving, setSaving] = useState<TransferSnapshot | null>(null);
  const deviceName = useCallback((id: string) => room.devices.find((d) => d.device_id === id)?.device_name ?? "Unknown device", [room.devices]);
  const media = useMemo(
    () => new Map(session.transfers.mediaCandidates().map((m) => [m.localId, m.file])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, transfers.items.length],
  );
  const active = transfers.items.filter(isActive);
  const rest = transfers.items.filter((i) => !isActive(i));
  const speed = totalSpeed(transfers.items);
  const actionsFor = (item: TransferSnapshot): TransferCardActions => {
    const t = session.transfers;
    const guard = (fn: () => Promise<unknown>) => () => void fn().catch((error: unknown) => toast.error(userMessage(error)));
    return {
      pause: guard(() => t.pause(item.localId)),
      resume: guard(() => t.resume(item.localId)),
      cancel: guard(() => t.cancel(item.localId)),
      retry: guard(() => t.retry(item.localId)),
      save: () => setSaving(item),
      dismiss: () => t.dismiss(item.localId),
      reselect: () => goToRoom(room.roomId),
      react: (emoji) => void session.react(item.localId, emoji),
    };
  };

  return (
    <>
      <PressableCard onPress={() => goToRoom(room.roomId)} accessibilityLabel="Open the room">
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">Room {formatRoomCode(room.roomCode)}</Text>
            <Text variant="footnote" tone="muted">
              {speed ? `Moving at ${formatSpeed(speed)}` : `${room.devices.length - 1} other device${room.devices.length === 2 ? "" : "s"}`}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.mutedForeground} />
        </View>
      </PressableCard>
      {transfers.requests.map((request) => (
        <View key={request.key} style={{ marginTop: space.lg }}>
          <IncomingCard
            request={request}
            senderName={deviceName(request.senderId)}
            files={transfers.items.filter((item) => request.transferIds.includes(item.localId))}
            checkStorage={() => session.transfers.storageFits(request.key)}
            onAccept={({ directory, trust }) => void session.transfers.accept(request.key, { directory: directory ?? null, trust }).catch((error: unknown) => toast.error(userMessage(error)))}
            onDecline={() => void session.transfers.decline(request.key)}
          />
        </View>
      ))}
      {transfers.items.length === 0 && transfers.requests.length === 0 ? (
        <EmptyState icon={ArrowDownUp} title="No transfers yet" body="Files you send or receive in this room show up here." action={<Button label="Open the room" onPress={() => goToRoom(room.roomId)} />} />
      ) : null}
      {active.length > 0 ? <SectionHeader title="In progress" /> : null}
      <View style={{ gap: space.md }}>
        {active.map((item) => (
          <TransferCard key={item.localId} item={item} deviceName={deviceName} link={links[item.peerIds[0] ?? ""]} actions={actionsFor(item)} media={media.get(item.localId) ?? null} />
        ))}
      </View>
      {rest.length > 0 ? <SectionHeader title="Done" /> : null}
      <View style={{ gap: space.md }}>
        {rest.map((item) => (
          <TransferCard key={item.localId} item={item} deviceName={deviceName} link={links[item.peerIds[0] ?? ""]} actions={actionsFor(item)} media={media.get(item.localId) ?? null} />
        ))}
      </View>
      <SaveSheet
        visible={saving !== null}
        onClose={() => setSaving(null)}
        file={saving ? session.transfers.receivedFile(saving.localId) : null}
        name={saving?.fileName ?? ""}
        onShare={() => saving && void session.transfers.save(saving.localId)}
      />
    </>
  );
}

export default function TransfersScreen() {
  const session = useSyncExternalStore(activeSession.subscribe, activeSession.getSnapshot, activeSession.getSnapshot);
  return (
    <Screen title="Transfers" bottomInset={TAB_BAR_SPACE}>
      {session ? (
        <RoomSessionProvider session={session}>
          <SessionTransfers session={session} />
        </RoomSessionProvider>
      ) : (
        <EmptyState
          icon={ArrowDownUp}
          title="No room open"
          body="Open a room to send or receive. Your past transfers are in History."
          action={<Button label="Send or receive" onPress={() => router.navigate("/")} />}
        />
      )}
    </Screen>
  );
}
