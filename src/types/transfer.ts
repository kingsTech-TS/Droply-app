// Mirrors app/models/transfer.py and app/schemas/transfer.py in the backend.

export type TransferStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "connecting"
  | "transferring"
  | "paused"
  | "completed"
  | "failed"
  | "retrying"
  | "cancelled"
  | "expired";

/** Inclusive chunk range [start, end]. */
export type ChunkRange = [number, number];

export interface FileMetadataIn {
  file_name: string;
  file_size: number;
  mime_type?: string;
  chunk_size?: number;
  total_chunks?: number;
  sha256?: string | null;
}

export interface TransferCreate {
  recipient_ids: string[];
  file: FileMetadataIn;
  /** Same for files sent together, so recipients get one request card for them. */
  batch_id?: string;
}

export interface TransferActionRequest {
  device_id?: string;
  reason?: string;
}

export interface CheckpointRequest {
  received_ranges: ChunkRange[];
  last_verified_chunk?: number | null;
}

export interface LegView {
  device_id: string;
  status: TransferStatus;
  updated_at: string;
  received_ranges: ChunkRange[];
  last_verified_chunk: number | null;
  failure_reason: string | null;
}

export interface FileMetadataView {
  file_name: string;
  file_size: number;
  mime_type: string;
  chunk_size: number;
  total_chunks: number;
  sha256: string | null;
}

export interface EncryptionView {
  scheme: string;
  public_key_fingerprint: string | null;
}

export interface TransferView {
  transfer_id: string;
  room_id: string;
  sender_id: string;
  recipient_ids: string[];
  recipients: LegView[];
  file: FileMetadataView;
  encryption: EncryptionView | null;
  mode: "p2p" | "cloud";
  batch_id?: string | null;
  status: TransferStatus;
  created_at: string;
  expires_at: string;
  finished_at: string | null;
}

export interface TransferConfigView {
  recommended_chunk_size: number;
  min_chunk_size: number;
  max_chunk_size: number;
  max_recipients: number;
  max_transfer_duration_seconds: number;
  resume_window_seconds: number;
  require_recipient_acceptance: boolean;
  cloud_fallback_enabled: boolean;
}
