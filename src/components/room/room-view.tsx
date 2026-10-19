// The room (website: components/room/room-view.tsx), as a native screen. Same state and
// rules: recipient preselection, pending files, auto-send to paired devices, speed-test
// mode, incoming requests, transfers, text drop, chat, album, pairing and host controls.
import { router, useFocusEffect } from "expo-router";
import { ChevronDown, DoorOpen, Ellipsis, FileUp, Images, MessageSquareText, MessagesSquare, Power, Share2 } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, FadeInDown, LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { env } from "@/config/env";
import { userMessage } from "@/lib/api/errors";
import { applyRoomTheme, THEME_STYLES } from "@/lib/fun/themes";
import { preferences } from "@/lib/fun/prefs";
import type { LocalFile } from "@/lib/files/local-file";
import { pickDocuments } from "@/lib/files/pick";
import { compressPhotos } from "@/lib/media/compress";
import { pairing } from "@/lib/pairing/pairing";
import { takePendingFiles, takePendingText } from "@/lib/session/pending-files";
import { closeSession, leaveSession } from "@/lib/session/registry";
import { formatBytes, formatRoomCode, formatSpeed } from "@/lib/utils/format";
import { randomId } from "@/lib/utils/id";
import { joinUrlFor } from "@/lib/utils/join-url";
import { LocalStore } from "@/lib/utils/local-store";
import type { TransferSnapshot } from "@/lib/webrtc/transfer-manager";
import { isActive, totalSpeed } from "@/lib/webrtc/transfer-view";
import { useInbox, usePairRequests, usePeerLinks, useRoom, useRoomSession, useTransfers, useUnreadChat } from "@/hooks/use-room-session";
import { useDevice } from "@/hooks/use-device";
import { useLocalStore } from "@/hooks/use-local-store";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
import { RadarPulse } from "@/components/motion/radar-pulse";
import { useFlightAnchor } from "@/components/motion/effects-overlay";
import { TRANSFERS_ANCHOR } from "@/components/session-effects";
import { AddFilesSheet } from "@/components/transfer/add-files-sheet";
import { IncomingCard } from "@/components/transfer/incoming-card";
import { SaveSheet } from "@/components/transfer/save-sheet";
import { SendPanel, type SelectedFileMeta } from "@/components/transfer/send-panel";
import { TransferCard, type TransferCardActions } from "@/components/transfer/transfer-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { confirm } from "@/components/ui/confirm";
import { IconButton } from "@/components/ui/icon-button";
import { Divider, ListRow } from "@/components/ui/list-row";
import { PressableScale } from "@/components/ui/pressable-scale";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Sheet } from "@/components/ui/sheet";
import { SectionHeader } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { toast } from "@/components/ui/toast";
import { AlbumSheet, MediaViewer, type AlbumItem } from "./album-sheet";
import { ChatSheet } from "./chat-sheet";
import { DeviceAvatar } from "./device-avatar";
import { DeviceCard } from "./device-card";
import { DiagnosticsPanel } from "./diagnostics-panel";
import { PairRequestSheet } from "./pair-request-sheet";
import { ConnectionBanner, ExpiryPrompt, KeepAppOpenBanner } from "./room-banners";
import { RoomEnded } from "./room-ended";
import { RoomSettings, RoomShareCard } from "./room-share-card";
import { SpeedTestSheet } from "./speed-test-sheet";
import { TextDropSheet, TextInbox } from "./text-drop";

/** Names of the devices last sent to, so they can be preselected next time. */
const lastRecipients = new LocalStore<string[]>("droply:last-recipients", [], (raw) =>
  Array.isArray(raw) ? raw.filter((n): n is string => typeof n === "string").slice(0, 20) : null,
);

function AddFilesCard({ onPress, compact }: { onPress: () => void; compact?: boolean }) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} scaleTo={0.97} accessibilityLabel={compact ? "Add more files" : "Add files to send"} style={[styles.drop, { borderColor: colors.primary, backgroundColor: colors.primarySoft, minHeight: compact ? 64 : 132 }]}>
      <View style={[styles.dropIcon, { backgroundColor: colors.card }]}>
        <FileUp size={compact ? 20 : 26} color={colors.primary} strokeWidth={2.3} />
      </View>
      <View style={{ flex: compact ? 1 : undefined, alignItems: compact ? "flex-start" : "center", gap: 2 }}>
        <Text variant={compact ? "bodyStrong" : "subhead"} tone="primary">
          {compact ? "Add more files" : "Add files to send"}
        </Text>
        {!compact ? (
          <Text variant="footnote" tone="muted" center>
            Photos, videos, documents — any type, any size
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

function WaitingForDevices({ name, type }: { name: string; type: Parameters<typeof DeviceAvatar>[0]["type"] }) {
  return (
    <Animated.View entering={FadeIn.duration(400)} style={{ alignItems: "center" }}>
      <RadarPulse size={72}>
        <DeviceAvatar name={name} type={type} size={72} />
      </RadarPulse>
      <Text variant="subhead" center style={{ marginTop: -space.lg }}>
        Waiting for another device…
      </Text>
      <Text variant="footnote" tone="muted" center>
        Scan the QR code or enter the room code on it.
      </Text>
    </Animated.View>
  );
}

export function RoomView({ speedTest = false }: { speedTest?: boolean }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const session = useRoomSession();
  const room = useRoom();
  const transfers = useTransfers();
  const links = usePeerLinks();
  const inbox = useInbox();
  const unreadChat = useUnreadChat();
  const pairRequests = usePairRequests();
  const pairState = useLocalStore(pairing);
  const prefs = useLocalStore(preferences);
  const { name: selfName, device } = useDevice();
  const transfersAnchor = useFlightAnchor(TRANSFERS_ANCHOR);

  // Selected files live in a ref; React state only holds their metadata.
  const filesRef = useRef(new Map<string, LocalFile>());
  const [selection, setSelection] = useState<SelectedFileMeta[]>([]);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [shareChoice, setShareChoice] = useState<{ open: boolean; alone: boolean } | null>(null);
  const [textSheet, setTextSheet] = useState<{ open: boolean; text: string; recipients: Set<string> }>({ open: false, text: "", recipients: new Set() });
  const [chatOpen, setChatOpen] = useState(false);
  const [albumOpen, setAlbumOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [speedTestPeer, setSpeedTestPeer] = useState<string | null>(null);
  const [zipProgress, setZipProgress] = useState<number | null>(null);
  const [saving, setSaving] = useState<TransferSnapshot | null>(null);
  const [viewing, setViewing] = useState<{ file: LocalFile; name: string; localId: string; incoming: boolean } | null>(null);

  const others = useMemo(() => room.devices.filter((d) => d.device_id !== room.selfId), [room.devices, room.selfId]);
  const online = useMemo(() => others.filter((d) => d.connection_state === "connected"), [others]);
  const remembered = useLocalStore(lastRecipients);
  const recipients = useMemo(() => {
    const ids = new Set(online.map((d) => d.device_id));
    if (chosen === null) {
      if (online.length === 1) return ids;
      return new Set(online.filter((d) => remembered.includes(d.device_name)).map((d) => d.device_id));
    }
    return new Set([...chosen].filter((id) => ids.has(id)));
  }, [chosen, online, remembered]);
  const alone = others.length === 0;
  const shareOpen = shareChoice && shareChoice.alone === alone ? shareChoice.open : alone;
  const pairedNames = useMemo(() => new Set(pairState.devices.map((d) => d.name)), [pairState.devices]);
  const deviceName = useCallback((id: string) => room.devices.find((d) => d.device_id === id)?.device_name ?? "Unknown device", [room.devices]);
  const anyActive = transfers.items.some(isActive);
  const isHost = room.hostDeviceId === room.selfId;
  const theme = THEME_STYLES[room.theme];
  const themed = room.theme !== "default";
  const wide = width >= 900;

  // The room's theme colors the whole app while this screen is in front (website parity).
  useFocusEffect(
    useCallback(() => {
      applyRoomTheme(room.status === "ended" ? null : room.theme);
      return () => applyRoomTheme(null);
    }, [room.theme, room.status]),
  );
  useEffect(() => session.setChatOpen(chatOpen), [session, chatOpen]);

  const addFiles = useCallback((files: LocalFile[]) => {
    if (files.length === 0) return;
    const metas = files.map((file) => {
      const id = randomId("sel_");
      filesRef.current.set(id, file);
      return { id, name: file.name, size: file.size, type: file.type, folder: file.relativePath ?? null };
    });
    setSelection((current) => [...current, ...metas]);
  }, []);

  // Files and text picked before the room existed (Home or another app's share sheet).
  useEffect(() => {
    addFiles(takePendingFiles());
    const text = takePendingText();
    // A one-time hand-off from a module-level store (same as the website).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (text) setTextSheet({ open: true, text, recipients: new Set() });
  }, [addFiles]);

  // Speed-test mode: open the test as soon as a device is online.
  const [speedTestOffered, setSpeedTestOffered] = useState(false);
  if (speedTest && !speedTestOffered && online.length > 0) {
    setSpeedTestOffered(true);
    setSpeedTestPeer(online[0]!.device_id);
  }

  const removeFile = (id: string) => {
    filesRef.current.delete(id);
    setSelection((current) => current.filter((f) => f.id !== id));
  };
  const clearFiles = () => {
    filesRef.current.clear();
    setSelection([]);
  };

  const sendFiles = useCallback(
    async (files: LocalFile[], to: string[]) => {
      if (files.length === 0 || to.length === 0) return 0;
      let prepared = files;
      if (prefs.sendSmallerPhotos) {
        setPreparing(true);
        prepared = await compressPhotos(files);
        setPreparing(false);
      }
      const count = session.transfers.send(prepared, to);
      if (count > 0) lastRecipients.set(to.map(deviceName));
      return count;
    },
    [deviceName, prefs.sendSmallerPhotos, session],
  );

  const send = async (to: readonly string[] = [...recipients]) => {
    const files = selection.map((meta) => filesRef.current.get(meta.id)).filter((f): f is LocalFile => f !== undefined);
    const count = await sendFiles(files, [...to]);
    if (count > 0) clearFiles();
  };

  // Scheduled send between paired devices: the files wait until one of the user's own
  // devices joins, then go to every device online at that moment.
  const [autoSend, setAutoSend] = useState(false);
  const autoSendTo = autoSend && room.mode === "my-devices" && selection.length > 0 ? online.map((d) => d.device_id) : [];
  const autoSendKey = autoSendTo.join(",");
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    if (!autoSendKey) return;
    void (async () => {
      await sendRef.current(autoSendKey.split(","));
      setAutoSend(false);
      toast.success("Your device connected. Sending now.");
    })();
  }, [autoSendKey]);

  const sendTo = (deviceId: string) => {
    setChosen(new Set([deviceId]));
    if (selection.length === 0) setAdding(true);
  };

  const selectionBytes = selection.reduce((s, f) => s + f.size, 0);
  const estimate = recipients.size > 0 ? session.transfers.estimateSeconds(selectionBytes, [...recipients]) : null;

  const itemCount = transfers.items.length;
  const savedCount = transfers.items.filter((i) => i.save === "ready" || i.save === "saved").length;
  const mediaCandidates = useMemo(
    () => session.transfers.mediaCandidates(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, itemCount, savedCount],
  );
  const mediaMap = useMemo(() => new Map(mediaCandidates.map((m) => [m.localId, m.file])), [mediaCandidates]);

  const actionsFor = useCallback(
    (item: TransferSnapshot): TransferCardActions => {
      const t = session.transfers;
      const guard = (fn: () => Promise<unknown>) => () => void fn().catch((error: unknown) => toast.error(userMessage(error)));
      return {
        pause: guard(() => t.pause(item.localId)),
        resume: guard(() => t.resume(item.localId)),
        cancel: guard(() => t.cancel(item.localId)),
        retry: guard(() => t.retry(item.localId)),
        save: () => setSaving(item),
        dismiss: () => t.dismiss(item.localId),
        reselect: () =>
          void pickDocuments().then((files) => {
            const file = files[0];
            if (!file) return;
            void t.provideFile(item.localId, file).then((ok) => {
              if (!ok) toast.error("That's not the same file. Select the original file to resume.");
            });
          }),
        react: (emoji) => void session.react(item.localId, emoji),
        sendAgain: () => {
          const file = t.fileFor(item.localId);
          if (file) {
            addFiles([file]);
            toast("Added back to “Files ready to send”. Pick who gets it.");
          }
        },
        openMedia: () => {
          const file = mediaMap.get(item.localId);
          if (file) setViewing({ file, name: item.fileName, localId: item.localId, incoming: item.direction === "incoming" });
        },
      };
    },
    [addFiles, session, mediaMap],
  );

  const saveAllZip = async () => {
    setZipProgress(0);
    try {
      await session.transfers.saveAsZip(undefined, (done, total) => setZipProgress(total ? done / total : 1));
    } catch (error) {
      toast.error(userMessage(error));
    } finally {
      setZipProgress(null);
    }
  };

  const leave = async () => {
    setMenuOpen(false);
    if (anyActive) {
      const ok = await confirm({ title: "Leave the room?", message: "Transfers in progress will stop.", confirmLabel: "Leave", destructive: true });
      if (!ok) return;
    }
    leaveSession();
    router.replace("/");
  };

  const closeRoom = async () => {
    setMenuOpen(false);
    const ok = await confirm({ title: "Close the room for everyone?", message: "Every device is disconnected and the room code stops working.", confirmLabel: "Close room", destructive: true });
    if (!ok) return;
    try {
      await session.closeForEveryone();
      closeSession();
      router.replace("/");
    } catch (error) {
      toast.error(userMessage(error));
    }
  };

  const removeDevice = async (id: string) => {
    const name = deviceName(id);
    const ok = await confirm({
      title: `Remove ${name}?`,
      message: "They leave the room right away and any transfers with them stop. They can only come back by entering the room code again.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) void session.removeDevice(id).catch((error: unknown) => toast.error(userMessage(error)));
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
      <View style={styles.headerRow}>
        <IconButton icon={ChevronDown} label="Back to Home (stay in the room)" size={26} onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text variant="subhead" numberOfLines={1}>
            {themed ? `${theme.emoji} ` : ""}Room {formatRoomCode(room.roomCode)}
          </Text>
          <Text variant="caption" tone="muted">
            {alone ? "Waiting for devices" : online.length === 1 ? "1 device connected" : `${online.length} devices connected`}
          </Text>
        </View>
        {room.status !== "ended" ? <IconButton icon={Ellipsis} label="Room menu" onPress={() => setMenuOpen(true)} /> : <View style={{ width: 48 }} />}
      </View>
    </View>
  );

  if (room.status === "ended") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <View style={{ flex: 1, paddingTop: insets.top + 64 }}>
          <RoomEnded reason={room.endReason} />
        </View>
      </View>
    );
  }

  const transferItems = transfers.items;
  const readyReceived = transferItems.filter((i) => i.direction === "incoming" && (i.save === "ready" || i.save === "saved")).length;
  const speedNow = totalSpeed(transferItems);
  const joinUrl = joinUrlFor(room.roomCode, room.joinUrl);
  const speedPeer = speedTestPeer ? room.devices.find((d) => d.device_id === speedTestPeer) : undefined;
  const temporary = session.transfers.temporaryBytes();

  const requestCards = transfers.requests.map((request) => (
    <IncomingCard
      key={request.key}
      request={request}
      senderName={deviceName(request.senderId)}
      files={transferItems.filter((item) => request.transferIds.includes(item.localId))}
      checkStorage={() => session.transfers.storageFits(request.key)}
      onAccept={({ directory, trust }) => void session.transfers.accept(request.key, { directory: directory ?? null, trust }).catch((error: unknown) => toast.error(userMessage(error)))}
      onDecline={() => void session.transfers.decline(request.key)}
    />
  ));

  const share = (
    <RoomShareCard
      code={room.roomCode}
      joinUrl={joinUrl}
      expiresAt={room.expiresAt}
      open={shareOpen}
      onOpenChange={(open) => setShareChoice({ open, alone })}
      settings={isHost ? <RoomSettings theme={room.theme} discoverable={room.discoverable} onTheme={(t) => session.setTheme(t)} onDiscoverable={(v) => session.setDiscoverable(v)} /> : undefined}
    />
  );

  const devices = alone ? (
    <WaitingForDevices name={selfName} type={device.type} />
  ) : (
    <View style={{ gap: space.md }}>
      <SectionHeader title={online.length === 1 ? "1 device connected" : `${online.length} devices connected`} />
      {room.devices.map((d) => {
        const self = d.device_id === room.selfId;
        return (
          <DeviceCard
            key={d.device_id}
            device={d}
            isSelf={self}
            link={links[d.device_id]}
            paired={pairedNames.has(d.device_name)}
            onSend={self ? undefined : () => sendTo(d.device_id)}
            onSendText={self ? undefined : () => setTextSheet({ open: true, text: "", recipients: new Set([d.device_id]) })}
            onSpeedTest={self ? undefined : () => setSpeedTestPeer(d.device_id)}
            onPair={self ? undefined : () => void session.requestPairing(d.device_id)}
            onRetry={self ? undefined : (relayOnly) => session.retryPeer(d.device_id, relayOnly)}
            onRemove={!self && isHost ? () => void removeDevice(d.device_id) : undefined}
          />
        );
      })}
    </View>
  );

  const main = (
    <View style={{ gap: space.lg }}>
      {!alone ? (
        <View style={styles.quick}>
          <Button label="Send text" icon={MessageSquareText} size="sm" variant="outline" onPress={() => setTextSheet({ open: true, text: "", recipients: new Set(recipients) })} disabled={online.length === 0} />
          <Button label={unreadChat ? `Chat (${unreadChat})` : "Chat"} icon={MessagesSquare} size="sm" variant={unreadChat ? "tinted" : "outline"} onPress={() => setChatOpen(true)} accessibilityLabel={unreadChat ? `Chat, ${unreadChat} unread` : "Chat"} />
          <Button label="Album" icon={Images} size="sm" variant="outline" onPress={() => setAlbumOpen(true)} />
        </View>
      ) : null}
      {selection.length > 0 ? (
        <SendPanel
          files={selection}
          recipients={online}
          selected={recipients}
          onSelectedChange={setChosen}
          onRemove={removeFile}
          onClear={clearFiles}
          onAddMore={() => setAdding(true)}
          onSend={() => void send()}
          autoSend={autoSend}
          onAutoSendChange={room.mode === "my-devices" ? setAutoSend : undefined}
          estimateSeconds={estimate}
          sendSmaller={prefs.sendSmallerPhotos}
          onSendSmallerChange={(value) => preferences.set({ ...prefs, sendSmallerPhotos: value })}
          preparing={preparing}
        />
      ) : (
        <AddFilesCard onPress={() => setAdding(true)} />
      )}
      <TextInbox messages={inbox} deviceName={deviceName} />
      {transferItems.length > 0 ? (
        <View style={{ gap: space.md }}>
          <View ref={transfersAnchor} collapsable={false}>
            <SectionHeader
              title={speedNow ? `Transfers · ${formatSpeed(speedNow)}` : "Transfers"}
              action={readyReceived >= 2 ? <Button label={zipProgress !== null ? "Zipping…" : "Save all as .zip"} size="sm" variant="ghost" onPress={() => void saveAllZip()} disabled={zipProgress !== null} /> : undefined}
            />
          </View>
          {zipProgress !== null ? <ProgressBar value={zipProgress} active accessibilityLabel="Creating zip" /> : null}
          {transferItems.map((item) => (
            <TransferCard key={item.localId} item={item} deviceName={deviceName} link={links[item.peerIds[0] ?? ""]} actions={actionsFor(item)} media={mediaMap.get(item.localId) ?? null} />
          ))}
        </View>
      ) : (
        <View ref={transfersAnchor} collapsable={false} />
      )}
      {temporary > 0 ? (
        <Card tone="muted" level={0} style={styles.storage}>
          <Text variant="footnote" tone="muted" style={{ flex: 1 }}>
            {formatBytes(temporary)} of unfinished transfers stored on this device.
          </Text>
          <Button label="Clear" size="sm" variant="ghost" onPress={() => void session.transfers.clearTemporaryData()} />
        </Card>
      ) : null}
      {env.debug ? <DiagnosticsPanel /> : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Animated.ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + 64, paddingBottom: insets.bottom + space.huge, paddingHorizontal: space.lg, gap: space.lg, maxWidth: wide ? 1200 : 720, width: "100%", alignSelf: "center" }}
      >
        {themed ? (
          <Animated.View entering={FadeInDown.springify().damping(16)} style={[styles.themeBanner, { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft }]}>
            <Text style={{ fontSize: 40, lineHeight: 48 }}>{theme.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text variant="headline" tone="primary">
                {theme.label} room
              </Text>
              <Text variant="footnote" tone="muted">
                {theme.tagline}
              </Text>
            </View>
          </Animated.View>
        ) : null}
        {room.kind === "event" || room.mode !== "standard" ? (
          <View style={styles.badges}>
            {room.mode === "my-devices" ? <Badge label="My devices" variant="default" /> : null}
            {room.mode === "room-link" ? <Badge label="Personal room" variant="default" /> : null}
            {room.kind === "event" ? <Badge label={`Event room · up to ${room.maxDevices} devices`} variant="electric" /> : null}
          </View>
        ) : null}
        <ConnectionBanner room={room} onRetry={() => session.retryConnection()} />
        <ExpiryPrompt expiresAt={alone ? room.expiresAt : null} onKeepOpen={() => session.keepAlive()} />
        <KeepAppOpenBanner show={anyActive} />
        {requestCards.length > 0 ? <View style={{ gap: space.md }}>{requestCards}</View> : null}
        {wide ? (
          <View style={styles.columns}>
            <View style={styles.side}>
              {share}
              {devices}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>{main}</View>
          </View>
        ) : (
          <Animated.View layout={LinearTransition.springify().damping(20)} style={{ gap: space.lg }}>
            {alone ? (
              <>
                {share}
                {devices}
                {main}
              </>
            ) : (
              <>
                {main}
                {devices}
                {share}
              </>
            )}
          </Animated.View>
        )}
      </Animated.ScrollView>
      {header}

      <AddFilesSheet visible={adding} onClose={() => setAdding(false)} onFiles={addFiles} onPasteText={online.length > 0 ? () => setTextSheet({ open: true, text: "", recipients: new Set(recipients) }) : undefined} />
      <TextDropSheet
        visible={textSheet.open}
        onClose={() => setTextSheet((c) => ({ ...c, open: false }))}
        devices={online}
        initialRecipients={textSheet.recipients}
        initialText={textSheet.text}
        onSend={(peerIds, text) => session.sendText(peerIds, text)}
      />
      <ChatSheet visible={chatOpen} onClose={() => setChatOpen(false)} messages={inbox} deviceName={deviceName} onSend={(text) => session.sendChat(text)} peersOnline={online.length} />
      <AlbumSheet
        visible={albumOpen}
        onClose={() => setAlbumOpen(false)}
        candidates={mediaCandidates as AlbumItem[]}
        deviceName={deviceName}
        onAddPhotos={(files) => void sendFiles(files, online.map((d) => d.device_id))}
        onSave={(item) => {
          const snapshot = transferItems.find((i) => i.localId === item.localId);
          if (snapshot) setSaving(snapshot);
        }}
        onSaveAll={() => void saveAllZip()}
      />
      <PairRequestSheet request={pairRequests[0] ?? null} onRespond={(peerId, accept) => void session.respondToPairing(peerId, accept)} />
      {speedPeer ? (
        <SpeedTestSheet
          visible={speedTestPeer !== null}
          onClose={() => setSpeedTestPeer(null)}
          peerName={speedPeer.device_name}
          link={links[speedPeer.device_id]}
          run={(bytes, onProgress) => session.runSpeedTest(speedPeer.device_id, bytes, onProgress)}
        />
      ) : null}
      <SaveSheet
        visible={saving !== null}
        onClose={() => setSaving(null)}
        file={saving ? session.transfers.receivedFile(saving.localId) : null}
        name={saving?.fileName ?? ""}
        onShare={() => saving && void session.transfers.save(saving.localId)}
      />
      <MediaViewer
        file={viewing?.file ?? null}
        name={viewing?.name ?? ""}
        onClose={() => setViewing(null)}
        onSave={
          viewing?.incoming
            ? () => {
                const snapshot = transferItems.find((i) => i.localId === viewing.localId);
                setViewing(null);
                if (snapshot) setSaving(snapshot);
              }
            : undefined
        }
      />
      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={`Room ${formatRoomCode(room.roomCode)}`} subtitle={isHost ? "You're the host" : undefined}>
        <ListRow icon={Share2} title="Invite another device" subtitle="Room code, link and QR code" onPress={() => {
          setMenuOpen(false);
          setShareChoice({ open: true, alone });
        }} />
        <Divider inset={46} />
        <ListRow icon={DoorOpen} title="Leave room" subtitle="You can rejoin from Home while it's open" onPress={() => void leave()} />
        {isHost ? (
          <>
            <Divider inset={46} />
            <ListRow icon={Power} title="Close room for everyone" destructive onPress={() => void closeRoom()} />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { position: "absolute", top: 0, left: 0, right: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  headerRow: { height: 60, flexDirection: "row", alignItems: "center", paddingHorizontal: space.xs },
  quick: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  drop: { borderWidth: 2, borderStyle: "dashed", borderRadius: radius.xl, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.lg, flexDirection: "row", flexWrap: "wrap" },
  dropIcon: { width: 52, height: 52, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  themeBanner: { flexDirection: "row", alignItems: "center", gap: space.lg, padding: space.lg, borderRadius: radius.xl, borderWidth: 1 },
  badges: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  columns: { flexDirection: "row", gap: space.xl, alignItems: "flex-start" },
  side: { width: 380, gap: space.lg },
  storage: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm },
});
