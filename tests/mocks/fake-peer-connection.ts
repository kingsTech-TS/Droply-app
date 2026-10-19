// A minimal RTCPeerConnection model, enough to exercise perfect negotiation:
// signaling states with implicit rollback, ICE candidates, pre-negotiated DataChannels that
// open when both sides have applied the offer/answer pair, getStats() and close().
import { FakeDataChannel } from "./rtc";

const registry = new Map<string, FakeRTCPeerConnection>();
let nextId = 1;

export function resetFakePeerConnections(): void {
  registry.clear();
  nextId = 1;
}

type Desc = { type: "offer" | "answer"; sdp: string };

export class FakeRTCPeerConnection {
  readonly id = `pc${nextId++}`;
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  localDescription: Desc | null = null;
  remoteDescription: Desc | null = null;
  readonly sctp = { maxMessageSize: 262_144 };
  addedCandidates: Array<RTCIceCandidateInit | undefined> = [];
  candidateErrors = 0;
  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((event: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  private channels = new Map<number, FakeDataChannel>();
  private offerCount = 0;
  private remotePcId: string | null = null;
  private negotiationPending = false;
  private needsNegotiation = false;

  constructor(readonly config: RTCConfiguration) {
    registry.set(this.id, this);
  }

  createDataChannel(_label: string, init: RTCDataChannelInit): FakeDataChannel {
    const channel = new FakeDataChannel();
    this.channels.set(init.id ?? 0, channel);
    this.scheduleNegotiation();
    return channel;
  }

  async setLocalDescription(desc?: Desc): Promise<void> {
    await Promise.resolve();
    const type = desc?.type ?? (this.signalingState === "have-remote-offer" ? "answer" : "offer");
    if (type === "offer") {
      if (this.signalingState !== "stable") throw new Error("InvalidStateError: offer in " + this.signalingState);
      this.offerCount += 1;
      this.localDescription = { type, sdp: `offer:${this.id}:${this.offerCount}` };
      this.signalingState = "have-local-offer";
      this.needsNegotiation = false;
    } else {
      if (this.signalingState !== "have-remote-offer") throw new Error("InvalidStateError: answer in " + this.signalingState);
      this.localDescription = { type, sdp: `answer:${this.id}` };
      this.signalingState = "stable";
      this.tryConnect();
    }
    this.emitCandidates();
  }

  async setRemoteDescription(desc: Desc): Promise<void> {
    await Promise.resolve();
    if (desc.type === "offer") {
      // Implicit rollback of our own offer (what a polite peer relies on).
      if (this.signalingState === "have-local-offer") this.localDescription = null;
      this.remoteDescription = desc;
      this.remotePcId = desc.sdp.split(":")[1] ?? null;
      this.signalingState = "have-remote-offer";
      // The remote offer already contains the pre-negotiated data channel.
      this.needsNegotiation = false;
    } else {
      if (this.signalingState !== "have-local-offer") throw new Error("InvalidStateError: answer in " + this.signalingState);
      this.remoteDescription = desc;
      this.remotePcId = desc.sdp.split(":")[1] ?? null;
      this.signalingState = "stable";
      this.tryConnect();
    }
  }

  async addIceCandidate(candidate?: RTCIceCandidateInit): Promise<void> {
    await Promise.resolve();
    if (!this.remoteDescription) {
      this.candidateErrors += 1;
      throw new Error("InvalidStateError: no remote description");
    }
    this.addedCandidates.push(candidate);
  }

  restartIce(): void {
    this.scheduleNegotiation();
  }

  async getStats(): Promise<Map<string, Record<string, unknown>>> {
    return new Map<string, Record<string, unknown>>([
      ["T1", { id: "T1", type: "transport", selectedCandidatePairId: "CP1" }],
      ["CP1", { id: "CP1", type: "candidate-pair", localCandidateId: "L1", remoteCandidateId: "R1", currentRoundTripTime: 0.012, state: "succeeded", nominated: true }],
      ["L1", { id: "L1", type: "local-candidate", candidateType: "host", address: "192.168.1.10" }],
      ["R1", { id: "R1", type: "remote-candidate", candidateType: "host", address: "192.168.1.11" }],
    ]);
  }

  close(): void {
    if (this.connectionState === "closed") return;
    this.signalingState = "closed";
    this.connectionState = "closed";
    for (const channel of this.channels.values()) channel.close();
    registry.delete(this.id);
  }

  /** Test control: simulate the network path dying. */
  failConnection(): void {
    this.iceConnectionState = "failed";
    this.connectionState = "failed";
    this.oniceconnectionstatechange?.();
    this.onconnectionstatechange?.();
  }

  private scheduleNegotiation(): void {
    this.needsNegotiation = true;
    if (this.negotiationPending) return;
    this.negotiationPending = true;
    setTimeout(() => {
      this.negotiationPending = false;
      // Like a browser: only if a negotiation since the change hasn't already covered it.
      if (this.needsNegotiation && this.signalingState === "stable" && this.connectionState !== "closed") {
        this.onnegotiationneeded?.();
      }
    }, 0);
  }

  private emitCandidates(): void {
    setTimeout(() => {
      if (this.connectionState === "closed") return;
      this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: `candidate:${this.id} 1 udp 1 192.168.1.10 5000 typ host`, sdpMid: "0", sdpMLineIndex: 0 }) } });
      this.onicecandidate?.({ candidate: null });
    }, 0);
  }

  private tryConnect(): void {
    const remote = this.remotePcId ? registry.get(this.remotePcId) : undefined;
    if (!remote || remote.remotePcId !== this.id) return;
    const bothStable = this.signalingState === "stable" && remote.signalingState === "stable";
    if (!bothStable || !this.localDescription || !remote.localDescription) return;
    if (this.connectionState === "connected") return;
    for (const pc of [this, remote]) {
      pc.connectionState = "connected";
      pc.iceConnectionState = "connected";
    }
    for (const [id, channel] of this.channels) {
      const other = remote.channels.get(id);
      if (!other || channel.readyState === "open") continue;
      channel.peer = other;
      other.peer = channel;
      setTimeout(() => {
        channel.open();
        other.open();
      }, 0);
    }
    for (const pc of [this, remote]) {
      pc.oniceconnectionstatechange?.();
      pc.onconnectionstatechange?.();
    }
  }
}
