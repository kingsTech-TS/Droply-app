// Persists what is needed to resume a transfer after a disconnect or a reload: leg
// metadata and the digest of every verified chunk. A digest is written only after its chunk
// is stored, so "digest present" means "chunk verified and on disk". Payloads are never
// stored here. Kept in SQLite (the website uses IndexedDB).
import { openDb } from "@/lib/storage/db";
import { logger } from "@/lib/utils/logger";
import type { SinkKind } from "@/lib/storage/sinks/sink";

export type LegRole = "send" | "receive";

export interface LegRecord {
  key: string;
  role: LegRole;
  transferId: string;
  roomId: string;
  peerId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  chunkSize: number;
  totalChunks: number;
  /** Receiver only: where the chunks are stored. */
  sinkKind: SinkKind | null;
  /** Sender only: used to check that a re-selected file is the same one. */
  lastModified: number | null;
  /** Receiver only (app): where the finished file was stored, so a restart can still offer Save. */
  finalUri?: string | null;
  createdAt: number;
  updatedAt: number;
}

export function legKey(role: LegRole, transferId: string): string {
  return `${role}:${transferId}`;
}

export interface ResumeStore {
  saveLeg(record: LegRecord): Promise<void>;
  getLeg(role: LegRole, transferId: string): Promise<LegRecord | null>;
  legsForRoom(roomId: string): Promise<LegRecord[]>;
  allLegs(): Promise<LegRecord[]>;
  putDigest(role: LegRole, transferId: string, index: number, digest: string): Promise<void>;
  getDigests(role: LegRole, transferId: string): Promise<Map<number, string>>;
  deleteLeg(role: LegRole, transferId: string): Promise<void>;
}

/** Used in tests and when IndexedDB is unavailable: resume works within the page only. */
export class MemoryResumeStore implements ResumeStore {
  private readonly legs = new Map<string, LegRecord>();
  private readonly digests = new Map<string, Map<number, string>>();

  async saveLeg(record: LegRecord): Promise<void> {
    this.legs.set(record.key, { ...record });
  }
  async getLeg(role: LegRole, transferId: string): Promise<LegRecord | null> {
    return this.legs.get(legKey(role, transferId)) ?? null;
  }
  async legsForRoom(roomId: string): Promise<LegRecord[]> {
    return [...this.legs.values()].filter((l) => l.roomId === roomId);
  }
  async allLegs(): Promise<LegRecord[]> {
    return [...this.legs.values()];
  }
  async putDigest(role: LegRole, transferId: string, index: number, digest: string): Promise<void> {
    const key = legKey(role, transferId);
    let map = this.digests.get(key);
    if (!map) {
      map = new Map();
      this.digests.set(key, map);
    }
    map.set(index, digest);
  }
  async getDigests(role: LegRole, transferId: string): Promise<Map<number, string>> {
    return new Map(this.digests.get(legKey(role, transferId)) ?? []);
  }
  async deleteLeg(role: LegRole, transferId: string): Promise<void> {
    this.legs.delete(legKey(role, transferId));
    this.digests.delete(legKey(role, transferId));
  }
}

export class SqliteResumeStore implements ResumeStore {
  private readonly fallback = new MemoryResumeStore();

  async saveLeg(record: LegRecord): Promise<void> {
    const db = await openDb();
    if (!db) return this.fallback.saveLeg(record);
    try {
      await db.runAsync(
        "INSERT OR REPLACE INTO legs (key, room_id, record) VALUES (?, ?, ?)",
        record.key,
        record.roomId,
        JSON.stringify(record),
      );
    } catch (error) {
      logger.warn("resume", "saveLeg failed", String(error));
    }
  }

  async getLeg(role: LegRole, transferId: string): Promise<LegRecord | null> {
    const db = await openDb();
    if (!db) return this.fallback.getLeg(role, transferId);
    try {
      const row = await db.getFirstAsync<{ record: string }>("SELECT record FROM legs WHERE key = ?", legKey(role, transferId));
      return row ? parseLeg(row.record) : null;
    } catch {
      return null;
    }
  }

  async legsForRoom(roomId: string): Promise<LegRecord[]> {
    const db = await openDb();
    if (!db) return this.fallback.legsForRoom(roomId);
    try {
      const rows = await db.getAllAsync<{ record: string }>("SELECT record FROM legs WHERE room_id = ?", roomId);
      return rows.map((r) => parseLeg(r.record)).filter((l): l is LegRecord => l !== null);
    } catch {
      return [];
    }
  }

  async allLegs(): Promise<LegRecord[]> {
    const db = await openDb();
    if (!db) return this.fallback.allLegs();
    try {
      const rows = await db.getAllAsync<{ record: string }>("SELECT record FROM legs");
      return rows.map((r) => parseLeg(r.record)).filter((l): l is LegRecord => l !== null);
    } catch {
      return [];
    }
  }

  async putDigest(role: LegRole, transferId: string, index: number, digest: string): Promise<void> {
    const db = await openDb();
    if (!db) return this.fallback.putDigest(role, transferId, index, digest);
    await db.runAsync(
      "INSERT OR REPLACE INTO digests (role, transfer_id, chunk, digest) VALUES (?, ?, ?, ?)",
      role,
      transferId,
      index,
      digest,
    );
  }

  async getDigests(role: LegRole, transferId: string): Promise<Map<number, string>> {
    const db = await openDb();
    if (!db) return this.fallback.getDigests(role, transferId);
    const out = new Map<number, string>();
    try {
      const rows = await db.getAllAsync<{ chunk: number; digest: string }>(
        "SELECT chunk, digest FROM digests WHERE role = ? AND transfer_id = ?",
        role,
        transferId,
      );
      for (const row of rows) {
        if (typeof row.chunk === "number" && typeof row.digest === "string") out.set(row.chunk, row.digest);
      }
    } catch (error) {
      logger.warn("resume", "getDigests failed", String(error));
    }
    return out;
  }

  async deleteLeg(role: LegRole, transferId: string): Promise<void> {
    const db = await openDb();
    if (!db) return this.fallback.deleteLeg(role, transferId);
    try {
      await db.withTransactionAsync(async () => {
        await db.runAsync("DELETE FROM legs WHERE key = ?", legKey(role, transferId));
        await db.runAsync("DELETE FROM digests WHERE role = ? AND transfer_id = ?", role, transferId);
      });
    } catch (error) {
      logger.warn("resume", "deleteLeg failed", String(error));
    }
  }
}

function parseLeg(raw: string): LegRecord | null {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && typeof (value as LegRecord).key === "string" ? (value as LegRecord) : null;
  } catch {
    return null;
  }
}

export function createResumeStore(): ResumeStore {
  return new SqliteResumeStore();
}
