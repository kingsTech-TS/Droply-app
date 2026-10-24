// Mirrors app/schemas/signaling.py in the backend: every WebSocket message.
import type { DeviceType, DeviceView, PeerInfo } from "./device";
import type { CatalogItem, IceServer, RoomView } from "./room";
import type { ChunkRange, TransferConfigView, TransferCreate, TransferView } from "./transfer";

export type PeerConnectionStateName =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

export type ConnectionPath = "lan" | "direct" | "relay" | "unknown";

export interface OfferPayload {
  type: "offer";
  sdp: string;
}

export interface AnswerPayload {
  type: "answer";
  sdp: string;
}

/** Mirrors RTCIceCandidate.toJSON(). `candidate: null` signals end-of-candidates. */
export interface IceCandidatePayload {
  candidate: string | null;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

// --- Client -> server --------------------------------------------------------

interface ClientBase {
  ref?: string;
}

export interface DeviceUpdate {
  device_name?: string;
  device_type?: DeviceType;
  browser?: string;
  operating_system?: string;
}

export interface JoinMessage extends ClientBase {
  type: "join";
  token: string;
  device?: DeviceUpdate;
}

export interface LeaveMessage extends ClientBase {
  type: "leave";
}

export interface ClientPingMessage extends ClientBase {
  type: "ping";
  ts?: number;
}

export interface ClientPongMessage extends ClientBase {
  type: "pong";
  ts?: number;
}

interface Targeted extends ClientBase {
  target_id: string;
  connection_id: string;
}

export interface OfferMessage extends Targeted {
  type: "offer";
  payload: OfferPayload;
}

export interface AnswerMessage extends Targeted {
  type: "answer";
  payload: AnswerPayload;
}

export interface IceCandidateMessage extends Targeted {
  type: "ice_candidate";
  payload: IceCandidatePayload;
}

export interface ConnectionStateMessage extends Targeted {
  type: "connection_state";
  state: PeerConnectionStateName;
  path?: ConnectionPath;
}

export interface TransferRequestMessage extends ClientBase {
  type: "transfer_request";
  transfer: TransferCreate;
}

export type TransferActionType =
  | "transfer_accepted"
  | "transfer_rejected"
  | "transfer_connecting"
  | "transfer_started"
  | "transfer_paused"
  | "transfer_resumed"
  | "transfer_completed"
  | "transfer_failed"
  | "transfer_retrying"
  | "transfer_cancelled";

export interface TransferActionMessage extends ClientBase {
  type: TransferActionType;
  transfer_id: string;
  device_id?: string;
  reason?: string;
}

export interface TransferCheckpointMessage extends ClientBase {
  type: "transfer_checkpoint";
  transfer_id: string;
  received_ranges: ChunkRange[];
  last_verified_chunk?: number | null;
}

export type ClientMessage =
  | JoinMessage
  | LeaveMessage
  | ClientPingMessage
  | ClientPongMessage
  | OfferMessage
  | AnswerMessage
  | IceCandidateMessage
  | ConnectionStateMessage
  | TransferRequestMessage
  | TransferActionMessage
  | TransferCheckpointMessage;

// --- Server -> client --------------------------------------------------------

export interface RoomStateEvent {
  type: "room_state";
  /** Event rooms: the files the host shares (older servers omit it). */
  catalog?: CatalogItem[];
  room: RoomView;
  self_device_id: string;
  peers: PeerInfo[];
  ice_servers: IceServer[];
  transfer_config: TransferConfigView;
  heartbeat_seconds: number;
}

export interface PeerJoinedEvent {
  type: "peer_joined";
  device: DeviceView;
}

export interface PeerUpdatedEvent {
  type: "peer_updated";
  device: DeviceView;
}

export type PeerLeftReason = "left" | "disconnected" | "removed" | "timeout";

export interface PeerLeftEvent {
  type: "peer_left";
  device_id: string;
  reason: PeerLeftReason;
}

interface Relayed {
  sender_id: string;
  target_id: string;
  connection_id: string;
}

export interface RelayedOffer extends Relayed {
  type: "offer";
  payload: OfferPayload;
}

export interface RelayedAnswer extends Relayed {
  type: "answer";
  payload: AnswerPayload;
}

export interface RelayedIceCandidate extends Relayed {
  type: "ice_candidate";
  payload: IceCandidatePayload;
}

export interface RelayedConnectionState extends Relayed {
  type: "connection_state";
  state: PeerConnectionStateName;
  path: ConnectionPath | null;
}

export const TRANSFER_EVENT_TYPES = [
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
] as const;

export type TransferEventType = (typeof TRANSFER_EVENT_TYPES)[number];

export interface TransferEvent {
  type: TransferEventType;
  transfer: TransferView;
  /** Device that caused it; null = the server. */
  actor_id: string | null;
  /** Recipient legs affected. */
  device_ids: string[];
  reason: string | null;
}

export interface ServerPingEvent {
  type: "ping";
  ts: number;
}

export interface ServerPongEvent {
  type: "pong";
  ts: number | null;
}

export interface ErrorEvent {
  type: "error";
  code: string;
  message: string;
  ref: string | null;
}

/** The host changed room settings (theme, discoverability). */
export interface RoomUpdatedEvent {
  type: "room_updated";
  room: RoomView;
}

export interface RoomEndedEvent {
  type: "room_closed" | "room_expired";
  room_id: string;
}

/** Event rooms: the host shared or removed files. Holds the whole list. */
export interface CatalogUpdatedEvent {
  type: "catalog_updated";
  room_id: string;
  items: CatalogItem[];
}

export type ServerMessage =
  | CatalogUpdatedEvent
  | RoomStateEvent
  | PeerJoinedEvent
  | PeerUpdatedEvent
  | PeerLeftEvent
  | RelayedOffer
  | RelayedAnswer
  | RelayedIceCandidate
  | RelayedConnectionState
  | TransferEvent
  | ServerPingEvent
  | ServerPongEvent
  | ErrorEvent
  | RoomUpdatedEvent
  | RoomEndedEvent;

export type ServerMessageType = ServerMessage["type"];

/**
 * The message shape for one `type`. Unlike Extract<ServerMessage, { type: T }>, this also
 * works for TransferEvent, whose `type` field is itself a union.
 */
export type MessageOf<T extends ServerMessageType> = ServerMessage extends infer M
  ? M extends { type: infer U }
    ? T extends U
      ? M
      : never
    : never
  : never;
