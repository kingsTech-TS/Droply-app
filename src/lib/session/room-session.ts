// Owns every service for one room: signaling, peer links, transfers, peer messages.
// Kept alive by the RoomSessionRegistry while the user moves around the app; disposed on
// leave or room end. React reads its stores; it never imports React.
import NetInfo from "@react-native-community/netinfo";
import { AppState, type AppStateStatus } from "react-native";
import { env } from "@/config/env";
import { leaveRoom } from "@/lib/api/devices";
import { closeRoom, getRoom, updateRoomSettings } from "@/lib/api/rooms";
import { isApiError, userMessage } from "@/lib/api/errors";
import { createTransfer, getTransfer, transferAction } from "@/lib/api/transfers";
import { detectDevice } from "@/lib/device/detection";
import { addToHistory } from "@/lib/history/history";
import { recordRoomEnded, recordRoomEntered, updateRoomHistory, type RoomEndReason } from "@/lib/history/rooms";
import { addPairedDevice, ensurePairingKey, pairing } from "@/lib/pairing/pairing";
import { nativeSinkFactory } from "@/lib/storage/sinks/factory";
import { requestPersistence } from "@/lib/storage/quota";
import { Emitter, Store } from "@/lib/utils/emitter";
import { randomId } from "@/lib/utils/id";
import { logger } from "@/lib/utils/logger";
import { defaultTuning } from "@/lib/webrtc/adaptive-controller";
import { IceServerProvider } from "@/lib/webrtc/ice";
import { PeerMessenger } from "@/lib/webrtc/messaging";
import { PeerManager } from "@/lib/webrtc/peer-manager";
import {
  MAX_CHAT_MESSAGE,
  MAX_REPLY_QUOTE,
  MAX_TEXT_MESSAGE,
  type AppMessage,
  type ChatReply,
  type Reaction,
} from "@/lib/webrtc/protocol";
import { createResumeStore } from "@/lib/webrtc/resume-manager";
import { SignalingClient, type EndReason, type SignalingStatus } from "@/lib/webrtc/signaling-client";
import {
  TransferManager,
  type Completion,
  type Notice,
  type SpeedTestResult,
} from "@/lib/webrtc/transfer-manager";
import type { DeviceView } from "@/types/device";
import type { RoomKind, RoomTheme, RoomView } from "@/types/room";
import type { DeviceUpdate, RoomStateEvent, TransferEventType } from "@/types/signaling";
import type { TransferConfigView } from "@/types/transfer";
import { memoryBudget } from "@/lib/device/memory";
import { forgetRooms, updateRememberedTheme } from "./my-rooms";
import { EventShare } from "./event-share";
import { clearSession, type SessionMode, type StoredSession } from "./session-store";

export type RoomStatus = "connecting" | "live" | "reconnecting" | "ended";

export interface RoomSnapshot {
  roomId: string;
  roomCode: string;
  joinUrl: string;
  selfId: string;
  hostDeviceId: string | null;
  /**
   * When an idle room closes (ms since epoch). Rooms have no time limit: the server moves this
   * forward while devices are active.
   */
  expiresAt: number | null;
  status: RoomStatus;
  signaling: SignalingStatus;
  reconnectAttempts: number;
  endReason: EndReason | "expired" | null;
  /** Every device in the room, this one included. */
  devices: DeviceView[];
  online: boolean;
  kind: RoomKind;
  maxDevices: number;
  discoverable: boolean;
  theme: RoomTheme;
  mode: SessionMode;
}

/** Text drops and chat messages, kept in memory for this room only. */
export interface InboxMessage {
  id: string;
  kind: "text" | "chat";
  direction: "in" | "out";
  /** Sender for incoming; recipients for outgoing. */
  peerIds: string[];
  text: string;
  at: number;
  /** Chat: the message this one answers. */
  replyTo?: ChatReply;
  /** Chat: devices tagged with @name. */
  mentions?: string[];
  /** Chat: who reacted with what (device ids, this device included). */
  reactions?: Partial<Record<Reaction, string[]>>;
}

/** Chat replies, @mentions and reactions are for group rooms: more than 3 devices. */
export const CHAT_GROUP_MIN_DEVICES = 4;

export interface ChatSendOptions {
  replyTo?: InboxMessage | null;
  mentions?: readonly string[];
}

export interface PairRequest {
  peerId: string;
  name: string;
  key: string;
}

/** One celebration per finished batch (several files merged). */
export interface Celebration {
  direction: "outgoing" | "incoming";
  files: number;
  bytes: number;
  fileNames: string[];
  peerIds: string[];
  averageSpeed: number | null;
  peakSpeed: number | null;
  seconds: number;
  newRecord: boolean;
}

export const DEFAULT_TRANSFER_CONFIG: TransferConfigView = {
  recommended_chunk_size: 4 * 1024 * 1024,
  min_chunk_size: 16 * 1024,
  max_chunk_size: 64 * 1024 * 1024,
  max_recipients: 19,
  max_transfer_duration_seconds: 86_400,
  resume_window_seconds: 3600,
  require_recipient_acceptance: true,
  cloud_fallback_enabled: false,
};

const TRANSFER_EVENT_TYPES: readonly TransferEventType[] = [
  "transfer_request",
  "transfer_created",
  "transfer_accepted",
  "transfer_rejected",
  "transfer_connecting",
  "transfer_started",
  "transfer_paused",
  "transfer_resumed",
  "transfer_completed",
  "transfer_failed",
  "transfer_retrying",
  "transfer_cancelled",
  "transfer_expired",
  "transfer_checkpoint",
  "transfer_fallback_ready",
];

const MAX_INBOX = 200;
const CELEBRATION_MERGE_MS = 1500;

export class RoomSession {
  readonly room: Store<RoomSnapshot>;
  readonly notices = new Emitter<{ notice: Notice }>();
  /** Batch-level "it's done" moments, for sounds, confetti and result cards. */
  readonly celebrations = new Emitter<{ celebration: Celebration }>();
  readonly inbox = new Store<InboxMessage[]>([]);
  readonly unreadChat = new Store<number>(0);
  readonly pairRequests = new Store<PairRequest[]>([]);
  readonly signaling: SignalingClient;
  readonly peers: PeerManager;
  readonly transfers: TransferManager;
  readonly messenger: PeerMessenger;
  /** Event rooms: the host's shared files and this device's downloads. */
  readonly event: EventShare;
  readonly mobile: boolean;

  private readonly ice: IceServerProvider;
  private readonly subs: Array<() => void> = [];
  private readonly connectedOnce = new Set<string>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setTimeout> | null = null;
  private restored = false;
  private disposed = false;
  private wasLive = false;
  private chatOpen = false;
  private pendingCelebration: { celebration: Celebration; timer: ReturnType<typeof setTimeout> } | null = null;
  private readonly detected = detectDevice();

  constructor(
    readonly session: StoredSession,
    device: DeviceUpdate | undefined,
  ) {
    this.mobile = this.detected.type === "phone" || this.detected.type === "tablet";
    this.room = new Store<RoomSnapshot>({
      roomId: session.roomId,
      roomCode: session.roomCode,
      joinUrl: session.joinUrl,
      selfId: session.deviceId,
      hostDeviceId: null,
      expiresAt: null,
      status: "connecting",
      signaling: "idle",
      reconnectAttempts: 0,
      endReason: null,
      devices: [],
      online: true,
      kind: "standard",
      maxDevices: 20,
      discoverable: false,
      theme: "default",
      mode: session.mode,
    });

    this.signaling = new SignalingClient({
      wsUrl: env.wsUrl,
      roomId: session.roomId,
      token: session.token,
      origin: env.wsOrigin,
      device,
    });
    this.ice = new IceServerProvider([], session.token);
    this.peers = new PeerManager({
      selfId: session.deviceId,
      send: (message) => this.signaling.send(message),
      ice: this.ice,
      // Each link lowers this to what both peers and the negotiated SCTP limit allow.
      localMaxFrame: defaultTuning(256 * 1024, this.mobile).frameSize,
    });
    const token = session.token;
    this.transfers = new TransferManager({
      selfId: session.deviceId,
      roomId: session.roomId,
      config: DEFAULT_TRANSFER_CONFIG,
      api: {
        create: (body) => createTransfer(body, token),
        act: (id, action, body) => transferAction(id, action, token, body ?? {}),
        get: (id) => getTransfer(id, token),
      },
      peers: this.peers,
      send: (message) => this.signaling.send(message),
      resume: createResumeStore(),
      sinks: nativeSinkFactory,
      mobile: this.mobile,
      memory: memoryBudget(),
      deviceName: (id) => this.deviceName(id),
      // Only devices holding the pairing key can enter a "My devices" room.
      trustAll: session.mode === "my-devices",
      // Event guests accept the files they picked without being asked again.
      autoAcceptBatch: (senderId, batchId) => this.event.isRequested(senderId, batchId),
    });
    this.messenger = new PeerMessenger(this.peers);
    this.event = new EventShare({
      selfId: session.deviceId,
      hostId: () => this.room.getSnapshot().hostDeviceId,
      messenger: this.messenger,
      notify: (notice) => this.notices.emit("notice", notice),
    });
    this.subs.push(
      this.transfers.notices.on("notice", (notice) => this.notices.emit("notice", notice)),
      this.transfers.completions.on("completion", (c) => this.onCompletion(c)),
      this.messenger.events.on("message", ({ peerId, message }) => this.onAppMessage(peerId, message)),
    );
  }

  start(): void {
    const s = this.signaling;
    this.subs.push(
      s.state.subscribe(() => this.onSignalingState()),
      s.events.on("roomState", (event) => this.onRoomState(event)),
      s.events.on("ended", (reason) => this.onEnded(reason)),
      s.on("peer_joined", ({ device }) => this.upsertDevice(device, true)),
      s.on("peer_updated", ({ device }) => this.upsertDevice(device, false)),
      s.on("peer_left", ({ device_id, reason }) => this.onPeerLeft(device_id, reason)),
      s.on("offer", (m) => void this.peers.handleOffer(m)),
      s.on("answer", (m) => void this.peers.handleAnswer(m)),
      s.on("ice_candidate", (m) => void this.peers.handleCandidate(m)),
      s.on("room_updated", ({ room }) => this.applyRoomView(room)),
      s.on("catalog_updated", ({ items }) => this.event.setCatalog(items)),
      s.on("room_expired", () => this.endRoom("expired")),
      s.on("room_closed", () => this.endRoom("room_ended")),
      this.peers.links.subscribe(() => this.onLinksChanged()),
    );
    for (const type of TRANSFER_EVENT_TYPES) {
      this.subs.push(s.on(type, (event) => this.transfers.handleEvent(event)));
    }
    // The app's equivalents of the browser's online/offline and visibility events.
    const appState = AppState.addEventListener("change", this.onAppState);
    const netInfo = NetInfo.addEventListener((state) => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      if (online === this.room.getSnapshot().online) return;
      if (online) this.onOnline();
      else this.onOffline();
    });
    this.subs.push(() => appState.remove(), netInfo);
    s.connect();
    this.refreshTimer = setInterval(() => void this.refreshRoom(), 60_000);
    this.scheduleStats();
  }

  deviceName(deviceId: string): string {
    return this.room.getSnapshot().devices.find((d) => d.device_id === deviceId)?.device_name ?? "a device";
  }

  get isHost(): boolean {
    const room = this.room.getSnapshot();
    return room.hostDeviceId === room.selfId;
  }

  /** Online devices other than this one. */
  onlinePeerIds(): string[] {
    const room = this.room.getSnapshot();
    return room.devices
      .filter((d) => d.device_id !== room.selfId && d.connection_state === "connected")
      .map((d) => d.device_id);
  }

  // --- host settings ---------------------------------------------------------------------

  async setTheme(theme: RoomTheme): Promise<void> {
    this.applyRoomView(await updateRoomSettings(this.session.roomId, { theme }, this.session.token));
  }

  async setDiscoverable(discoverable: boolean): Promise<void> {
    this.applyRoomView(await updateRoomSettings(this.session.roomId, { discoverable }, this.session.token));
  }

  // --- peer messages -------------------------------------------------------------------------

  /** Sends a text (link, note, password…) privately to the chosen devices. */
  async sendText(peerIds: readonly string[], text: string): Promise<number> {
    const trimmed = text.slice(0, MAX_TEXT_MESSAGE);
    if (!trimmed.trim() || peerIds.length === 0) return 0;
    if (this.refuseEventGuest()) return 0;
    const id = randomId("t");
    const delivered = await this.messenger.broadcast(peerIds, { kind: "text", id, text: trimmed });
    this.pushInbox({ id, kind: "text", direction: "out", peerIds: delivered, text: trimmed, at: Date.now() });
    if (delivered.length < peerIds.length) {
      this.notices.emit("notice", { kind: "warning", message: "Some devices couldn't be reached." });
    }
    return delivered.length;
  }

  /**
   * Room chat: sent to every online device over the encrypted peer-to-peer channel. In group
   * rooms a message can answer another one and tag devices (@name).
   */
  async sendChat(text: string, options: ChatSendOptions = {}): Promise<void> {
    const trimmed = text.trim().slice(0, MAX_CHAT_MESSAGE);
    if (!trimmed || this.refuseEventGuest()) return;
    const id = randomId("c");
    const peers = this.onlinePeerIds();
    const group = this.room.getSnapshot().devices.length >= CHAT_GROUP_MIN_DEVICES;
    const known = new Set(this.room.getSnapshot().devices.map((d) => d.device_id));
    const mentions = group ? [...new Set(options.mentions ?? [])].filter((m) => known.has(m) && m !== this.session.deviceId) : [];
    const original = group ? options.replyTo : null;
    const replyTo: ChatReply | undefined = original
      ? {
          id: original.id,
          author: original.direction === "out" ? this.session.deviceId : (original.peerIds[0] ?? ""),
          text: original.text.slice(0, MAX_REPLY_QUOTE),
        }
      : undefined;
    const message: AppMessage = { kind: "chat", id, text: trimmed };
    if (replyTo && replyTo.author) message.replyTo = replyTo;
    if (mentions.length > 0) message.mentions = mentions;
    this.pushInbox({
      id,
      kind: "chat",
      direction: "out",
      peerIds: peers,
      text: trimmed,
      at: Date.now(),
      replyTo: message.replyTo,
      mentions: message.mentions,
    });
    this.countChat();
    const delivered = await this.messenger.broadcast(peers, message);
    if (delivered.length < peers.length) {
      this.notices.emit("notice", { kind: "warning", message: "Your message didn't reach every device." });
    }
  }

  /** Adds or removes this device's reaction on a chat message, for everyone in the room. */
  async reactToChat(messageId: string, emoji: Reaction): Promise<void> {
    if (this.refuseEventGuest()) return;
    const message = this.inbox.getSnapshot().find((m) => m.id === messageId && m.kind === "chat");
    if (!message) return;
    const on = !(message.reactions?.[emoji] ?? []).includes(this.session.deviceId);
    this.applyChatReaction(messageId, this.session.deviceId, emoji, on);
    await this.messenger.broadcast(this.onlinePeerIds(), { kind: "chat_reaction", messageId, emoji, on });
  }

  setChatOpen(open: boolean): void {
    this.chatOpen = open;
    if (open) this.unreadChat.set(0);
  }

  /** Reacts to a received file; the sender sees it on their transfer card. */
  async react(transferId: string, emoji: Reaction): Promise<void> {
    const senderId = this.transfers.markReacted(transferId, emoji);
    if (senderId) await this.messenger.send(senderId, { kind: "reaction", transferId, emoji });
  }

  /** Asks a device to join this device's "My devices" group. */
  async requestPairing(peerId: string): Promise<boolean> {
    const key = ensurePairingKey();
    const ok = await this.messenger.send(peerId, { kind: "pair_request", key, name: this.selfName() });
    if (ok) this.notices.emit("notice", { kind: "info", message: `Waiting for ${this.deviceName(peerId)} to accept…` });
    return ok;
  }

  async respondToPairing(peerId: string, accept: boolean): Promise<void> {
    const request = this.pairRequests.getSnapshot().find((r) => r.peerId === peerId);
    this.pairRequests.update((list) => list.filter((r) => r.peerId !== peerId));
    if (!request) return;
    if (!accept) {
      await this.messenger.send(peerId, { kind: "pair_decline" });
      return;
    }
    const peer = this.room.getSnapshot().devices.find((d) => d.device_id === peerId);
    addPairedDevice({ name: request.name, type: peer?.device_type ?? "unknown" }, request.key);
    await this.messenger.send(peerId, { kind: "pair_accept", name: this.selfName() });
    this.notices.emit("notice", { kind: "success", message: `Paired with ${request.name}` });
  }

  /** Synthetic transfer to measure the link (nothing is saved). */
  runSpeedTest(peerId: string, bytes: number, onProgress?: (verified: number, speed: number | null) => void): Promise<SpeedTestResult> {
    return this.transfers.runSpeedTest(peerId, bytes, onProgress);
  }

  // --- lifecycle -------------------------------------------------------------------------------

  /** Leaves for good: the server removes this device and revokes the token. */
  leave(): void {
    recordRoomEnded(this.session.roomId, "left");
    this.signaling.leave();
    clearSession(this.session.roomId);
    this.dispose();
  }

  /**
   * Host only: removes another device. The server revokes its token, closes its socket,
   * cancels its unfinished transfers and tells everyone else (`peer_left`, reason `removed`).
   */
  async removeDevice(deviceId: string): Promise<void> {
    if (deviceId === this.session.deviceId) return;
    const name = this.deviceName(deviceId);
    await leaveRoom(this.session.roomId, deviceId, this.session.token);
    this.onPeerLeft(deviceId, "removed");
    this.notices.emit("notice", { kind: "info", message: `${name} was removed from the room.` });
  }

  /** Host only: ends the room for everyone. */
  async closeForEveryone(): Promise<void> {
    await closeRoom(this.session.roomId, this.session.token);
  }

  retryConnection(): void {
    this.signaling.retryNow();
  }

  /** Retries a failed link; `relayOnly` forces TURN when direct paths keep failing. */
  retryPeer(peerId: string, relayOnly = false): void {
    this.peers.retry(peerId, relayOnly);
  }

  /** Any message to the server counts as activity and extends the room. */
  keepAlive(): void {
    this.signaling.send({ type: "ping", ts: Date.now() });
    void this.refreshRoom();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.subs.splice(0)) off();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.statsTimer) clearTimeout(this.statsTimer);
    if (this.pendingCelebration) clearTimeout(this.pendingCelebration.timer);
    this.messenger.dispose();
    this.transfers.dispose();
    this.peers.dispose();
    this.signaling.dispose();
    this.notices.clear();
    this.celebrations.clear();
  }

  // --- event handlers ----------------------------------------------------------------

  private selfName(): string {
    return this.room.getSnapshot().devices.find((d) => d.device_id === this.session.deviceId)?.device_name ?? "Droply device";
  }

  private onRoomState(event: RoomStateEvent): void {
    this.ice.setStun(event.ice_servers);
    if (event.catalog) this.event.setCatalog(event.catalog);
    this.transfers.setConfig(event.transfer_config);
    for (const peer of event.peers) this.peers.setPolite(peer.device_id, peer.polite);
    const devices = event.room.devices;
    // Devices that vanished while we were disconnected.
    const present = new Set(devices.map((d) => d.device_id));
    for (const old of this.room.getSnapshot().devices) {
      if (!present.has(old.device_id)) this.peers.remove(old.device_id);
    }
    this.applyRoomView(event.room);
    this.patch({ status: "live" });
    if (!this.wasLive) {
      const room = this.room.getSnapshot();
      recordRoomEntered({
        roomId: room.roomId,
        roomCode: room.roomCode,
        host: room.hostDeviceId === room.selfId,
        kind: room.kind,
        theme: room.theme,
        mode: room.mode,
        durationSeconds: null,
        timeExtended: false,
        peakDevices: room.devices.length,
      });
    }
    if (this.wasLive) {
      this.notices.emit("notice", { kind: "success", message: "Reconnected" });
    }
    this.wasLive = true;
    for (const device of devices) {
      if (device.device_id !== this.session.deviceId && device.connection_state === "connected") {
        this.transfers.onPeerPresent(device.device_id);
      }
    }
    if (!this.restored) {
      this.restored = true;
      void this.transfers.restore();
      void requestPersistence();
    }
  }

  private applyRoomView(room: RoomView): void {
    if (this.session.mode === "standard") updateRememberedTheme(room.room_id, room.theme);
    this.patch({
      roomCode: room.room_code,
      joinUrl: room.join_url,
      hostDeviceId: room.host_device_id,
      expiresAt: Date.parse(room.expires_at) || null,
      devices: room.devices,
      kind: room.kind ?? "standard",
      maxDevices: room.max_devices,
      discoverable: room.discoverable ?? false,
      theme: room.theme ?? "default",
    });
    const after = this.room.getSnapshot();
    if (this.wasLive) {
      updateRoomHistory(after.roomId, (entry) => ({
        theme: after.theme,
        host: entry.host || after.hostDeviceId === after.selfId,
        peakDevices: Math.max(entry.peakDevices, after.devices.length),
      }));
    }
  }

  private upsertDevice(device: DeviceView, joined: boolean): void {
    const devices = this.room.getSnapshot().devices.filter((d) => d.device_id !== device.device_id);
    devices.push(device);
    this.patch({ devices, hostDeviceId: device.is_host ? device.device_id : this.room.getSnapshot().hostDeviceId });
    if (joined) {
      updateRoomHistory(this.session.roomId, (entry) => ({
        peakDevices: Math.max(entry.peakDevices, devices.length),
        host: entry.host || (device.is_host && device.device_id === this.session.deviceId),
      }));
    }
    if (device.device_id === this.session.deviceId) return;
    if (device.connection_state === "connected") this.transfers.onPeerPresent(device.device_id);
    if (joined) logger.debug("room", `${device.device_name} joined`);
  }

  private onPeerLeft(deviceId: string, reason: string): void {
    const devices = this.room.getSnapshot().devices.filter((d) => d.device_id !== deviceId);
    const name = this.deviceName(deviceId);
    this.patch({ devices });
    this.peers.remove(deviceId);
    this.connectedOnce.delete(deviceId);
    this.pairRequests.update((list) => list.filter((r) => r.peerId !== deviceId));
    if (reason === "disconnected" || reason === "timeout") {
      this.notices.emit("notice", { kind: "warning", message: `${name} disconnected.` });
    }
  }

  /** Event rooms: only the host posts (texts, chat); everyone else receives. */
  get eventGuest(): boolean {
    return this.room.getSnapshot().kind === "event" && !this.isHost;
  }

  private refuseEventGuest(): boolean {
    if (!this.eventGuest) return false;
    this.notices.emit("notice", { kind: "info", message: "Only the host can share in an event room." });
    return true;
  }

  private onAppMessage(peerId: string, message: AppMessage): void {
    if (this.event.handle(peerId, message)) return;
    const room = this.room.getSnapshot();
    // In event rooms, texts and chat only come from the host.
    if (room.kind === "event" && peerId !== room.hostDeviceId && (message.kind === "text" || message.kind === "chat" || message.kind === "chat_reaction")) {
      return;
    }
    switch (message.kind) {
      case "text":
        this.pushInbox({ id: message.id, kind: "text", direction: "in", peerIds: [peerId], text: message.text, at: Date.now() });
        this.notices.emit("notice", { kind: "info", message: `${this.deviceName(peerId)} sent you a text` });
        break;
      case "chat": {
        this.pushInbox({
          id: message.id,
          kind: "chat",
          direction: "in",
          peerIds: [peerId],
          text: message.text,
          at: Date.now(),
          replyTo: message.replyTo,
          mentions: message.mentions,
        });
        this.countChat();
        if (!this.chatOpen) {
          this.unreadChat.update((n) => n + 1);
          const self = this.session.deviceId;
          if (message.mentions?.includes(self)) {
            this.notices.emit("notice", { kind: "info", message: `${this.deviceName(peerId)} mentioned you in the chat` });
          } else if (message.replyTo?.author === self) {
            this.notices.emit("notice", { kind: "info", message: `${this.deviceName(peerId)} replied to you in the chat` });
          }
        }
        break;
      }
      case "chat_reaction":
        this.applyChatReaction(message.messageId, peerId, message.emoji, message.on);
        break;
      case "reaction":
        this.transfers.addReaction(message.transferId, peerId, message.emoji);
        break;
      case "pair_request":
        this.pairRequests.update((list) => [
          ...list.filter((r) => r.peerId !== peerId),
          { peerId, name: message.name, key: message.key },
        ]);
        break;
      case "pair_accept": {
        const peer = this.room.getSnapshot().devices.find((d) => d.device_id === peerId);
        // Only record it if we actually asked (we hold a key).
        if (pairing.get().key) {
          addPairedDevice({ name: message.name, type: peer?.device_type ?? "unknown" });
          this.notices.emit("notice", { kind: "success", message: `Paired with ${message.name}` });
        }
        break;
      }
      case "pair_decline":
        this.notices.emit("notice", { kind: "info", message: `${this.deviceName(peerId)} declined pairing.` });
        break;
    }
  }

  private pushInbox(message: InboxMessage): void {
    this.inbox.update((list) => [...list.filter((m) => m.id !== message.id), message].slice(-MAX_INBOX));
  }

  private applyChatReaction(messageId: string, deviceId: string, emoji: Reaction, on: boolean): void {
    this.inbox.update((list) =>
      list.map((m) => {
        if (m.id !== messageId || m.kind !== "chat") return m;
        const others = (m.reactions?.[emoji] ?? []).filter((id) => id !== deviceId);
        const reactions = { ...m.reactions, [emoji]: on ? [...others, deviceId] : others };
        if (reactions[emoji]?.length === 0) delete reactions[emoji];
        return { ...m, reactions };
      }),
    );
  }

  private countChat(): void {
    updateRoomHistory(this.session.roomId, (entry) => ({ chatMessages: entry.chatMessages + 1 }));
  }

  private onCompletion(c: Completion): void {
    const record = addToHistory({
      at: Date.now(),
      direction: c.direction,
      fileName: c.fileName,
      fileSize: c.fileSize,
      mimeType: c.mimeType,
      peerName: this.deviceName(c.peerId),
      averageSpeed: c.averageSpeed,
      peakSpeed: c.peakSpeed,
      seconds: c.seconds,
      roomSize: this.room.getSnapshot().devices.length,
    });
    updateRoomHistory(this.session.roomId, (entry) =>
      c.direction === "outgoing"
        ? { sentFiles: entry.sentFiles + 1, sentBytes: entry.sentBytes + c.fileSize }
        : { receivedFiles: entry.receivedFiles + 1, receivedBytes: entry.receivedBytes + c.fileSize },
    );
    const newRecord = record.newAverageRecord || record.newPeakRecord;
    // Merge completions that land close together into one celebration.
    const pending = this.pendingCelebration;
    if (pending && pending.celebration.direction === c.direction) {
      clearTimeout(pending.timer);
      const p = pending.celebration;
      p.files += c.direction === "outgoing" && p.fileNames.includes(c.fileName) ? 0 : 1;
      p.bytes += c.fileSize;
      if (!p.fileNames.includes(c.fileName)) p.fileNames.push(c.fileName);
      if (!p.peerIds.includes(c.peerId)) p.peerIds.push(c.peerId);
      p.seconds = Math.max(p.seconds, c.seconds);
      p.peakSpeed = Math.max(p.peakSpeed ?? 0, c.peakSpeed ?? 0) || null;
      p.averageSpeed = p.seconds > 0 ? p.bytes / p.seconds : p.averageSpeed;
      p.newRecord ||= newRecord;
      pending.timer = setTimeout(() => this.flushCelebration(), CELEBRATION_MERGE_MS);
      return;
    }
    if (pending) this.flushCelebration();
    this.pendingCelebration = {
      celebration: {
        direction: c.direction,
        files: 1,
        bytes: c.fileSize,
        fileNames: [c.fileName],
        peerIds: [c.peerId],
        averageSpeed: c.averageSpeed,
        peakSpeed: c.peakSpeed,
        seconds: c.seconds,
        newRecord,
      },
      timer: setTimeout(() => this.flushCelebration(), CELEBRATION_MERGE_MS),
    };
  }

  private flushCelebration(): void {
    const pending = this.pendingCelebration;
    this.pendingCelebration = null;
    if (pending && !this.disposed) this.celebrations.emit("celebration", pending.celebration);
  }

  private onLinksChanged(): void {
    for (const [peerId, info] of Object.entries(this.peers.links.getSnapshot())) {
      if (info.status === "connected" && !this.connectedOnce.has(peerId)) {
        this.connectedOnce.add(peerId);
        this.notices.emit("notice", { kind: "success", message: `Connected to ${this.deviceName(peerId)}` });
      }
    }
  }

  private onSignalingState(): void {
    const state = this.signaling.state.getSnapshot();
    const current = this.room.getSnapshot();
    if (current.status === "ended") return;
    let status: RoomStatus = current.status;
    if (state.status === "open") status = "live";
    else if (state.status === "reconnecting") status = "reconnecting";
    else if (state.status === "connecting") status = current.status === "live" ? "reconnecting" : "connecting";
    if (status === "reconnecting" && current.status === "live") {
      this.notices.emit("notice", { kind: "warning", message: "Connection interrupted. Reconnecting…" });
    }
    this.patch({ signaling: state.status, reconnectAttempts: state.attempts, status });
  }

  private onEnded(reason: EndReason): void {
    if (reason === "gave_up") {
      this.patch({ status: "reconnecting", endReason: "gave_up" });
      return;
    }
    if (reason === "unauthorized" || reason === "removed" || reason === "room_ended" || reason === "room_not_found") {
      clearSession(this.session.roomId);
    }
    this.endRoom(reason);
  }

  private endRoom(reason: EndReason | "expired"): void {
    if (this.room.getSnapshot().status === "ended") return;
    this.patch({ status: "ended", endReason: reason });
    const ended: RoomEndReason | null =
      reason === "expired" ? "expired" : reason === "room_ended" || reason === "room_not_found" ? "closed" : reason === "removed" ? "removed" : reason === "left" ? "left" : null;
    if (ended) recordRoomEnded(this.session.roomId, ended);
    clearSession(this.session.roomId);
    // Gone for good (closed, expired, removed by the host): drop it from "your active rooms".
    // Leaving on purpose keeps it there so the room can be rejoined.
    if (reason === "room_ended" || reason === "expired" || reason === "removed" || reason === "room_not_found") {
      forgetRooms([this.session.roomId]);
    }
    this.transfers.dispose();
    this.peers.dispose();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  private async refreshRoom(): Promise<void> {
    if (this.disposed || this.room.getSnapshot().status === "ended") return;
    try {
      const room = await getRoom(this.session.roomId, this.session.token);
      this.applyRoomView(room);
    } catch (error) {
      if (isApiError(error) && (error.code === "ROOM_EXPIRED" || error.code === "ROOM_NOT_FOUND")) {
        this.endRoom("expired");
      } else {
        logger.debug("room", "refresh failed", userMessage(error));
      }
    }
  }

  private scheduleStats(): void {
    if (this.disposed) return;
    const active = this.transfers.store
      .getSnapshot()
      .items.some((item) => item.legs.some((leg) => leg.status === "transferring" || leg.status === "connecting"));
    this.statsTimer = setTimeout(async () => {
      if (AppState.currentState === "active") {
        await this.peers.refreshStats();
      }
      this.scheduleStats();
    }, active ? 2000 : 10_000);
  }

  private readonly onOnline = (): void => {
    this.patch({ online: true });
    this.signaling.retryNow();
  };

  private readonly onOffline = (): void => {
    this.patch({ online: false });
    this.notices.emit("notice", { kind: "warning", message: "You're offline. Transfers will continue when you're back." });
  };

  private hiddenAt: number | null = null;

  private readonly onAppState = (next: AppStateStatus): void => {
    if (next !== "active") {
      this.hiddenAt ??= Date.now();
      return;
    }
    const away = this.hiddenAt === null ? 0 : Date.now() - this.hiddenAt;
    this.hiddenAt = null;
    void this.refreshRoom();
    if (this.signaling.status === "ended" && this.room.getSnapshot().endReason === "gave_up") {
      this.signaling.retryNow();
      return;
    }
    // The OS suspends the app in the background (and may pause it while the file picker or
    // camera is open). Check the connection right away instead of waiting for heartbeats.
    if (away > 3000) this.onResume();
  };

  /** Coming back to the foreground after being away. */
  private readonly onResume = (): void => {
    if (this.disposed || this.room.getSnapshot().status === "ended") return;
    this.signaling.checkAlive();
    this.peers.recoverInUse();
  };

  private patch(partial: Partial<RoomSnapshot>): void {
    this.room.update((current) => ({ ...current, ...partial }));
  }
}
