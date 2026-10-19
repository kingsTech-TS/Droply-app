// WebRTC types and the native implementation (react-native-webrtc). The rest of the WebRTC
// code is written against these structural types, so tests can supply fakes and the logic
// stays identical to the website's.
import { RTCPeerConnection as NativeRTCPeerConnection } from "react-native-webrtc";
import type { DataChannelLike } from "./data-channel";

export type RTCPeerConnectionState = "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed";
export type RTCIceConnectionState = "new" | "checking" | "connected" | "completed" | "failed" | "disconnected" | "closed";
export type RTCSignalingState = "stable" | "have-local-offer" | "have-remote-offer" | "have-local-pranswer" | "have-remote-pranswer" | "closed";
export type RTCDataChannelState = "connecting" | "open" | "closing" | "closed";

export interface RTCIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface RTCConfiguration {
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: "all" | "relay";
  iceCandidatePoolSize?: number;
  bundlePolicy?: "balanced" | "max-compat" | "max-bundle";
}

export interface RTCSessionDescriptionInit {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp?: string;
}

export interface RTCIceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface RTCIceCandidateLike {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
  toJSON?: () => RTCIceCandidateInit;
}

/** Anything iterable like the stats Map that getStats() resolves to. */
export interface RTCStatsReport {
  forEach(callback: (value: unknown, key: string) => void): void;
}

/** The subset of RTCPeerConnection used by PeerLink. */
export interface RTCPeerConnection {
  readonly localDescription: { type: string; sdp: string } | null;
  readonly remoteDescription: { type: string; sdp: string } | null;
  readonly signalingState: RTCSignalingState | string;
  readonly iceConnectionState: RTCIceConnectionState | string;
  readonly connectionState: RTCPeerConnectionState | string;
  /** Browsers only; react-native-webrtc has no `sctp`, see `maxMessageSizeFromSdp`. */
  readonly sctp?: { maxMessageSize?: number } | null;
  onnegotiationneeded: ((event: unknown) => void) | null;
  onicecandidate: ((event: { candidate: RTCIceCandidateLike | null }) => void) | null;
  oniceconnectionstatechange: ((event: unknown) => void) | null;
  onconnectionstatechange: ((event: unknown) => void) | null;
  setLocalDescription(description?: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate?: RTCIceCandidateInit): Promise<void>;
  createDataChannel(label: string, init: { negotiated?: boolean; id?: number; ordered?: boolean }): DataChannelLike;
  getStats(): Promise<RTCStatsReport>;
  restartIce(): void;
  close(): void;
}

export function createNativePeerConnection(config: RTCConfiguration): RTCPeerConnection {
  return new NativeRTCPeerConnection(config) as unknown as RTCPeerConnection;
}

/**
 * The largest message the remote side accepts, from its SDP (`a=max-message-size`, RFC 8841).
 * A missing attribute means 64 KiB; 0 means "no limit" (capped here at 256 KiB, our largest frame).
 */
export function maxMessageSizeFromSdp(sdp: string | null | undefined): number | null {
  if (!sdp) return null;
  if (!/^m=application /m.test(sdp)) return null;
  const match = /^a=max-message-size:(\d+)/m.exec(sdp);
  if (!match) return 64 * 1024;
  const value = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(value)) return null;
  return value === 0 ? 256 * 1024 : value;
}
