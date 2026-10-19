// Mirrors app/models/device.py and app/schemas/device.py in the backend.

export type DeviceType = "phone" | "tablet" | "laptop" | "desktop" | "unknown";

// connecting   = joined over REST, WebSocket not open yet
// connected    = live WebSocket
// reconnecting = socket dropped, inside the server's reconnect grace period
// disconnected = gone; removed by the server after a few minutes
export type DeviceConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface DeviceInfoIn {
  device_name: string;
  device_type?: DeviceType;
  browser?: string | null;
  operating_system?: string | null;
}

export interface DeviceView {
  device_id: string;
  device_name: string;
  device_type: DeviceType;
  browser: string | null;
  operating_system: string | null;
  joined_at: string;
  last_seen: string;
  connection_state: DeviceConnectionState;
  is_host: boolean;
}

export interface PeerInfo extends DeviceView {
  /** Perfect-negotiation role towards this peer (the greater device_id is polite). */
  polite: boolean;
}
