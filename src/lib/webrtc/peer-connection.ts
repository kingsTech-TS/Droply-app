// One WebRTC link to one remote device: an RTCPeerConnection plus one DataChannel.
//
// Negotiation follows MDN's "perfect negotiation" with the backend's `polite` flag. The
// DataChannel is pre-negotiated (id 0) so both sides own the same channel no matter who
// offered first. `connection_id` identifies each RTCPeerConnection:
//   - an offer with our id        → normal (re)negotiation
//   - a new id, ours established  → the peer restarted: replace our connection
//   - a new id, both still fresh  → creation glare: the polite side adopts the other's
//
// Recovery: ICE "disconnected" for 5 s → restartIce(); "failed", or no recovery in 15 s →
// a new RTCPeerConnection. The impolite side drives recovery (the polite side waits longer),
// so both don't restart at once. After 3 failed attempts the link reports "failed".
import { Emitter, Store } from "@/lib/utils/emitter";
import { logger } from "@/lib/utils/logger";
import { randomId } from "@/lib/utils/id";
import type {
  ClientMessage,
  ConnectionPath,
  IceCandidatePayload,
  RelayedAnswer,
  RelayedIceCandidate,
  RelayedOffer,
} from "@/types/signaling";
import { parseStats, qualityFromStats, type ConnectionQuality, type LinkStats } from "./connection-monitor";
import { DataChannelTransport, type DataChannelLike } from "./data-channel";
import type { IceServerProvider } from "./ice";
import { PROTOCOL_VERSION } from "./protocol";
import {
  createNativePeerConnection,
  maxMessageSizeFromSdp,
  type RTCConfiguration,
  type RTCDataChannelState,
  type RTCIceConnectionState,
  type RTCPeerConnection,
  type RTCPeerConnectionState,
  type RTCSessionDescriptionInit,
} from "./rtc";
import { securityCode } from "./security-code";

export type LinkStatus = "idle" | "connecting" | "connected" | "recovering" | "failed" | "closed";

export interface LinkInfo {
  peerId: string;
  status: LinkStatus;
  connectionId: string | null;
  path: ConnectionPath;
  quality: ConnectionQuality | null;
  rttMs: number | null;
  connectionState: RTCPeerConnectionState | "none";
  iceConnectionState: RTCIceConnectionState | "none";
  channelState: RTCDataChannelState | "none";
  localCandidateType: string | null;
  remoteCandidateType: string | null;
  attempts: number;
  /** Bytes per frame agreed with the peer (min of both sides). */
  frameSize: number;
  /** Four emoji both people can compare (derived from both DTLS fingerprints). */
  securityCode: string | null;
  /** The user asked to force a TURN relay for this link. */
  relayOnly: boolean;
}

type Events = {
  /** A usable DataChannel transport (also fires again after a reconnect). */
  transport: DataChannelTransport;
  /** The transport went away (not necessarily for good). */
  transportLost: void;
  /** Recovery gave up; transfers over this link should be marked failed. */
  failed: void;
  /** The peer closed the link on purpose. */
  closedByPeer: void;
};

export interface PeerLinkOptions {
  selfId: string;
  peerId: string;
  polite: boolean;
  send: (message: ClientMessage) => void;
  ice: IceServerProvider;
  localMaxFrame: number;
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
}

const DISCONNECT_GRACE_MS = 5_000;
const RECOVERY_TIMEOUT_MS = 15_000;
const POLITE_EXTRA_WAIT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const MAX_BUFFERED_CANDIDATES = 64;

export class PeerLink {
  readonly events = new Emitter<Events>();
  readonly info: Store<LinkInfo>;
  transport: DataChannelTransport | null = null;

  private pc: RTCPeerConnection | null = null;
  private channel: DataChannelLike | null = null;
  private connectionId: string | null = null;
  private connectionSeq = 0;
  private makingOffer = false;
  private ignoreOffer = false;
  private pendingCandidates = new Map<string, IceCandidatePayload[]>();
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private closed = false;
  private remoteMaxFrame: number | null = null;
  private relayOnly = false;
  private lastStats: LinkStats | null = null;

  constructor(private readonly options: PeerLinkOptions) {
    this.info = new Store<LinkInfo>({
      peerId: options.peerId,
      status: "idle",
      connectionId: null,
      path: "unknown",
      quality: null,
      rttMs: null,
      connectionState: "none",
      iceConnectionState: "none",
      channelState: "none",
      localCandidateType: null,
      remoteCandidateType: null,
      attempts: 0,
      frameSize: options.localMaxFrame,
      securityCode: null,
      relayOnly: false,
    });
  }

  get peerId(): string {
    return this.options.peerId;
  }

  get isConnected(): boolean {
    return this.transport?.isOpen ?? false;
  }

  get stats(): LinkStats | null {
    return this.lastStats;
  }

  /** Bytes per binary frame: what both peers accept, within the negotiated SCTP limit. */
  get frameSize(): number {
    const local = this.options.localMaxFrame;
    // Unknown max message size (older Safari): stay with the interop-safe 16 KiB.
    const sctpLimit = this.maxMessageSize ?? 16 * 1024;
    return Math.max(1024, Math.min(local, this.remoteMaxFrame ?? local, sctpLimit));
  }

  /**
   * The SCTP max message size negotiated for this connection, if known: `pc.sctp` where the
   * implementation has it (browsers), otherwise the remote SDP's `a=max-message-size`
   * (react-native-webrtc), which is the value browsers derive `sctp.maxMessageSize` from.
   */
  get maxMessageSize(): number | null {
    const size = this.pc?.sctp?.maxMessageSize ?? maxMessageSizeFromSdp(this.pc?.remoteDescription?.sdp);
    return typeof size === "number" && size > 0 && Number.isFinite(size) ? size : null;
  }

  /** Starts a connection if there is none. Safe to call repeatedly. */
  async ensure(): Promise<void> {
    if (this.closed) return;
    if (this.pc && this.pc.connectionState !== "failed" && this.pc.connectionState !== "closed") return;
    await this.createConnection(this.nextConnectionId());
  }

  async handleOffer(message: RelayedOffer): Promise<void> {
    if (this.closed) return;
    const incoming = message.connection_id;
    if (this.connectionId !== incoming) {
      const established = this.pc?.remoteDescription !== null && this.pc !== null;
      if (this.pc && !established && !this.options.polite) {
        // Creation glare and we are impolite: keep ours; the polite peer adopts it.
        logger.debug("peer", `ignoring competing connection ${incoming}`);
        return;
      }
      await this.createConnection(incoming);
    }
    await this.applyDescription({ type: "offer", sdp: message.payload.sdp });
  }

  async handleAnswer(message: RelayedAnswer): Promise<void> {
    if (this.closed || message.connection_id !== this.connectionId) return;
    await this.applyDescription({ type: "answer", sdp: message.payload.sdp });
  }

  async handleCandidate(message: RelayedIceCandidate): Promise<void> {
    if (this.closed) return;
    const pc = this.pc;
    if (!pc || message.connection_id !== this.connectionId || !pc.remoteDescription) {
      const list = this.pendingCandidates.get(message.connection_id) ?? [];
      if (list.length < MAX_BUFFERED_CANDIDATES) list.push(message.payload);
      this.pendingCandidates.set(message.connection_id, list);
      return;
    }
    await this.addCandidate(pc, message.payload);
  }

  /** Polls getStats once and updates path, RTT and quality. */
  async refreshStats(stalled = false): Promise<LinkStats | null> {
    const pc = this.pc;
    if (!pc || pc.connectionState !== "connected") return null;
    try {
      const stats = parseStats(await pc.getStats());
      const previousPath = this.lastStats?.path;
      this.lastStats = stats;
      this.patch({
        path: stats.path,
        rttMs: stats.rttMs,
        quality: qualityFromStats(stats.rttMs, stalled),
        localCandidateType: stats.localCandidateType,
        remoteCandidateType: stats.remoteCandidateType,
      });
      if (stats.path !== previousPath && stats.path !== "unknown") this.reportState();
      return stats;
    } catch (error) {
      logger.debug("peer", "getStats failed", String(error));
      return null;
    }
  }

  /** Closes the link on purpose and tells the peer not to recover it. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.transport?.close();
    this.teardownConnection();
    this.patch({ status: "closed", channelState: "closed" });
    this.events.clear();
  }

  // --- connection lifecycle ----------------------------------------------------

  private nextConnectionId(): string {
    this.connectionSeq += 1;
    // [A-Za-z0-9_.:-]{1,64}, unique per connection and per page load.
    return `pc-${this.options.selfId.slice(-12)}-${randomId().slice(0, 6)}-${this.connectionSeq}`;
  }

  private async createConnection(connectionId: string): Promise<void> {
    this.teardownConnection();
    const base = await this.options.ice.getConfiguration();
    const config: RTCConfiguration = this.relayOnly ? { ...base, iceTransportPolicy: "relay" } : base;
    if (this.closed) return;
    const create = this.options.createPeerConnection ?? createNativePeerConnection;
    const pc = create(config);
    this.pc = pc;
    this.connectionId = connectionId;
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.patch({ status: this.attempts > 0 ? "recovering" : "connecting", connectionId });

    pc.onnegotiationneeded = async () => {
      if (this.pc !== pc) return;
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        const sdp = pc.localDescription?.sdp;
        if (sdp && this.pc === pc) {
          this.options.send({
            type: "offer",
            target_id: this.options.peerId,
            connection_id: connectionId,
            payload: { type: "offer", sdp },
          });
        }
      } catch (error) {
        logger.warn("peer", "creating offer failed", String(error));
      } finally {
        this.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (this.pc !== pc) return;
      // `null` marks the end of candidates.
      const init = candidate ? (candidate.toJSON?.() ?? candidate) : undefined;
      const payload: IceCandidatePayload = {
        candidate: init?.candidate ?? null,
        sdpMid: init?.sdpMid ?? null,
        sdpMLineIndex: init?.sdpMLineIndex ?? null,
        usernameFragment: init?.usernameFragment ?? null,
      };
      this.options.send({
        type: "ice_candidate",
        target_id: this.options.peerId,
        connection_id: connectionId,
        payload,
      });
    };
    pc.oniceconnectionstatechange = () => this.onIceState(pc);
    pc.onconnectionstatechange = () => this.onConnectionState(pc);

    const channel = pc.createDataChannel("droply", { negotiated: true, id: 0, ordered: true });
    this.channel = channel;
    this.attachChannel(channel);
  }

  private attachChannel(channel: DataChannelLike): void {
    const transport = new DataChannelTransport(channel);
    const onOpen = () => {
      if (this.channel !== channel) return;
      this.transport = transport;
      transport.sendCtl({ t: "hello", v: PROTOCOL_VERSION, maxFrame: this.options.localMaxFrame });
      this.attempts = 0;
      this.clearRecoveryTimers();
      this.patch({ status: "connected", channelState: "open", attempts: 0 });
      this.events.emit("transport", transport);
      void this.computeSecurityCode();
      void this.refreshStats();
    };
    transport.events.on("open", onOpen);
    if (channel.readyState === "open") onOpen();
    transport.events.on("ctl", (ctl) => {
      if (ctl.t === "hello") {
        this.remoteMaxFrame = ctl.maxFrame;
        this.patch({ frameSize: this.frameSize });
      } else if (ctl.t === "bye") {
        logger.debug("peer", `${this.options.peerId} closed the link`);
        this.events.emit("closedByPeer", undefined);
        this.close();
      }
    });
    transport.events.on("close", () => {
      if (this.transport === transport) this.transport = null;
      if (this.channel === channel) this.patch({ channelState: "closed" });
      if (!this.closed) this.events.emit("transportLost", undefined);
    });
  }

  private async applyDescription(description: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    const offerCollision =
      description.type === "offer" && (this.makingOffer || pc.signalingState !== "stable");
    this.ignoreOffer = !this.options.polite && offerCollision;
    if (this.ignoreOffer) return;
    try {
      await pc.setRemoteDescription(description);
      await this.flushCandidates(pc);
      if (description.type === "offer") {
        await pc.setLocalDescription();
        const sdp = pc.localDescription?.sdp;
        if (sdp && this.pc === pc && this.connectionId) {
          this.options.send({
            type: "answer",
            target_id: this.options.peerId,
            connection_id: this.connectionId,
            payload: { type: "answer", sdp },
          });
        }
      }
    } catch (error) {
      logger.warn("peer", `applying ${description.type} failed`, String(error));
    }
  }

  private async flushCandidates(pc: RTCPeerConnection): Promise<void> {
    if (!this.connectionId) return;
    const pending = this.pendingCandidates.get(this.connectionId) ?? [];
    this.pendingCandidates.clear();
    for (const candidate of pending) await this.addCandidate(pc, candidate);
  }

  private async addCandidate(pc: RTCPeerConnection, payload: IceCandidatePayload): Promise<void> {
    try {
      if (payload.candidate === null) {
        await pc.addIceCandidate();
      } else {
        await pc.addIceCandidate({
          candidate: payload.candidate,
          sdpMid: payload.sdpMid ?? null,
          sdpMLineIndex: payload.sdpMLineIndex ?? null,
          usernameFragment: payload.usernameFragment ?? null,
        });
      }
    } catch (error) {
      if (!this.ignoreOffer) logger.debug("peer", "addIceCandidate failed", String(error));
    }
  }

  private onIceState(pc: RTCPeerConnection): void {
    if (this.pc !== pc) return;
    const state = pc.iceConnectionState as RTCIceConnectionState;
    this.patch({ iceConnectionState: state });
    if (state === "disconnected") {
      this.disconnectTimer ??= setTimeout(() => {
        this.disconnectTimer = null;
        if (this.pc === pc && pc.iceConnectionState === "disconnected") this.recover("ice disconnected");
      }, DISCONNECT_GRACE_MS);
    } else if (state === "connected" || state === "completed") {
      if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    } else if (state === "failed") {
      this.recover("ice failed");
    }
  }

  private onConnectionState(pc: RTCPeerConnection): void {
    if (this.pc !== pc) return;
    const state = pc.connectionState as RTCPeerConnectionState;
    this.patch({ connectionState: state });
    this.reportState();
    if (state === "connected") {
      this.attempts = 0;
      this.clearRecoveryTimers();
      if (this.isConnected) this.patch({ status: "connected", attempts: 0 });
      void this.refreshStats();
    } else if (state === "failed") {
      this.recover("connection failed");
    }
  }

  private recover(reason: string): void {
    if (this.closed || this.recoveryTimer) return;
    const pc = this.pc;
    this.patch({ status: "recovering" });
    logger.debug("peer", `recovering link to ${this.options.peerId}: ${reason}`);
    // First try an ICE restart on the existing connection (impolite side only).
    if (pc && !this.options.polite && pc.connectionState !== "closed") {
      try {
        pc.restartIce();
      } catch {
        // Older browsers: fall through to a new connection after the timeout.
      }
    }
    const wait = RECOVERY_TIMEOUT_MS + (this.options.polite ? POLITE_EXTRA_WAIT_MS : 0);
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      if (this.closed || this.pc?.connectionState === "connected") return;
      this.attempts += 1;
      this.patch({ attempts: this.attempts });
      if (this.attempts > MAX_ATTEMPTS) {
        this.patch({ status: "failed" });
        this.teardownConnection();
        this.events.emit("failed", undefined);
        return;
      }
      void this.createConnection(this.nextConnectionId());
    }, wait);
  }

  private async computeSecurityCode(): Promise<void> {
    const local = this.pc?.localDescription?.sdp;
    const remote = this.pc?.remoteDescription?.sdp;
    if (!local || !remote) return;
    try {
      this.patch({ securityCode: await securityCode(local, remote) });
    } catch {
      // Web Crypto unavailable: no code, the connection is still encrypted.
    }
  }

  /**
   * Lets the link try again after it reported "failed" (the user pressed Retry).
   * `relayOnly` forces a TURN relay, for networks where direct attempts keep failing.
   */
  async retry(relayOnly = false): Promise<void> {
    if (this.closed) return;
    this.relayOnly = relayOnly;
    this.patch({ relayOnly });
    this.attempts = 0;
    this.clearRecoveryTimers();
    await this.createConnection(this.nextConnectionId());
  }

  private reportState(): void {
    const pc = this.pc;
    if (!pc || !this.connectionId) return;
    const state = pc.connectionState as RTCPeerConnectionState;
    const path = this.lastStats?.path;
    this.options.send({
      type: "connection_state",
      target_id: this.options.peerId,
      connection_id: this.connectionId,
      state,
      ...(state === "connected" && path && path !== "unknown" ? { path } : {}),
    });
  }

  private teardownConnection(): void {
    this.clearRecoveryTimers();
    const transport = this.transport;
    this.transport = null;
    transport?.detach();
    if (transport) this.events.emit("transportLost", undefined);
    if (this.channel) {
      try {
        this.channel.close();
      } catch {
        // ignore
      }
    }
    this.channel = null;
    const pc = this.pc;
    this.pc = null;
    if (pc) {
      pc.onnegotiationneeded = null;
      pc.onicecandidate = null;
      pc.oniceconnectionstatechange = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        // ignore
      }
    }
    this.lastStats = null;
    this.patch({ connectionState: "none", iceConnectionState: "none", channelState: "none", path: "unknown", quality: null, rttMs: null });
  }

  private clearRecoveryTimers(): void {
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.disconnectTimer = null;
    this.recoveryTimer = null;
  }

  private patch(partial: Partial<LinkInfo>): void {
    this.info.update((current) => ({ ...current, ...partial }));
  }
}
