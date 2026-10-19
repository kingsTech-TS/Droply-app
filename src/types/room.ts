// Mirrors app/schemas/room.py and app/schemas/turn.py in the backend.
import type { DeviceInfoIn, DeviceView } from "./device";
import type { TransferConfigView } from "./transfer";

export type RoomStatus = "open" | "closed" | "expired";
/** `event` rooms hold more devices (parties, classes). */
export const ROOM_KINDS = ["standard", "event"] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];
export const ROOM_THEMES = ["default", "party", "birthday", "wedding", "gaming", "study", "ocean", "sunset"] as const;
export type RoomTheme = (typeof ROOM_THEMES)[number];

export interface IceServer {
  urls: string[];
  username: string | null;
  credential: string | null;
}

export interface IceConfig {
  ice_servers: IceServer[];
  ttl_seconds: number | null;
  expires_at: string | null;
}

export interface RoomCreateRequest {
  device: DeviceInfoIn;
  kind?: RoomKind;
  theme?: RoomTheme;
}

/** Host-only settings; omitted fields are unchanged. */
export interface RoomSettingsUpdate {
  discoverable?: boolean;
  theme?: RoomTheme;
}

export interface RendezvousRequest {
  key: string;
  device: DeviceInfoIn;
}

/** A discoverable room created from the same network as this device. */
export interface NearbyRoom {
  room_id: string;
  room_code: string;
  host_name: string;
  host_device_type: DeviceView["device_type"];
  device_count: number;
  kind: RoomKind;
  theme: RoomTheme;
  expires_at: string;
}

export interface RoomJoinRequest {
  room_code: string;
  device: DeviceInfoIn;
  host_key?: string;
}

export interface RoomRef {
  room_id: string;
  room_code: string;
}

/** Whether a room is still open (details only when it is). */
export interface RoomStatusView {
  room_id: string;
  active: boolean;
  expires_at: string | null;
  device_count: number | null;
  kind: RoomKind | null;
  theme: RoomTheme | null;
}

export interface RoomView {
  room_id: string;
  room_code: string;
  join_url: string;
  created_at: string;
  expires_at: string;
  max_expires_at: string;
  status: RoomStatus;
  max_devices: number;
  host_device_id: string;
  devices: DeviceView[];
  kind: RoomKind;
  discoverable: boolean;
  theme: RoomTheme;
}

/** Returned on room create/join. Holds the device token: keep it private. */
export interface RoomSession {
  room_id: string;
  room_code: string;
  join_url: string;
  expires_at: string;
  device: DeviceView;
  device_token: string;
  token_expires_at: string;
  room: RoomView;
  ice_servers: IceServer[];
  transfer_config: TransferConfigView;
  /** Only when creating a room: proves "I created it" when rejoining (host again). Private. */
  host_key?: string | null;
}

export interface RendezvousSession extends RoomSession {
  /** True if this call opened a new room for the key. */
  created: boolean;
}
