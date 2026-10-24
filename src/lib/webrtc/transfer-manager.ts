// Central transfer orchestration for one room.
//
// - Mirrors the server's state for every transfer leg (server events always win).
// - Creates server transfers lazily, staying under the backend's per-device limit.
// - Starts FileSenders for accepted legs within the scheduler's concurrency limits.
// - Runs FileReceivers for accepted incoming transfers and reports checkpoints/completion.
// - Recovers from link loss: pause, wait for the peer, resume from the receiver's gaps.
//
// File objects, buffers and channels live here, never in React state. The UI reads
// `store`, an immutable snapshot published at most every 200 ms for progress changes
// (immediately for status changes).
import type { MemoryBudget } from "@/lib/device/memory";
import { env } from "@/config/env";
import { isApiError, userMessage } from "@/lib/api/errors";
import type { TransferAction } from "@/lib/api/transfers";
import type { DirectoryHandleLike } from "@/lib/storage/sinks/fs-access-sink";
import type { SinkFactory } from "@/lib/storage/sinks/factory";
import type { ChunkSink, SinkKind } from "@/lib/storage/sinks/sink";
import { saveFile } from "@/lib/storage/save";
import { DiscardSink } from "@/lib/storage/sinks/discard-sink";
import { writeZipFile } from "@/lib/storage/zip-file";
import { deleteQuietly, localFileFromUri, readRange, type LocalFile } from "@/lib/files/local-file";
import { cleanOrphanedSandboxFiles } from "@/lib/storage/sinks/sandbox-sink";
import { Emitter, Store } from "@/lib/utils/emitter";
import { sha256Hex } from "@/lib/utils/hash";
import { randomId } from "@/lib/utils/id";
import { logger } from "@/lib/utils/logger";
import { capRanges, contiguousPrefixEnd, rangesFromIndexes } from "@/lib/utils/ranges";
import { dedupeFileName, sanitizeFileName, sanitizeFolderPath } from "@/lib/utils/sanitize-filename";
import type { ClientMessage, TransferEvent } from "@/types/signaling";
import type { ChunkRange, TransferConfigView, TransferCreate, TransferView } from "@/types/transfer";
import { AdaptiveController, chooseChunkSize, defaultTuning } from "./adaptive-controller";
import { chunkBounds, FileSource, SyntheticSource, totalChunks, type ByteSource } from "./chunk-manager";
import type { DataChannelTransport } from "./data-channel";
import { FileReceiver } from "./file-receiver";
import { FileSender } from "./file-sender";
import { SpeedMeter } from "./progress";
import { MAX_SLOT, type Ctl, type Frame, type Reaction } from "./protocol";
import { legKey, type LegRecord, type ResumeStore } from "./resume-manager";
import { creationSlots, pickStartable, schedulerLimits, type Candidate } from "./scheduler";
import { isTerminal, isUnfinishedOnServer, type LegStatus } from "./transfer-state";

// --- public snapshot types -----------------------------------------------------

export type Verification = "pending" | "verifying" | "verified" | "failed";
export type SaveState = "none" | "preparing" | "ready" | "saving" | "saved";

export interface LegSnapshot {
  deviceId: string;
  status: LegStatus;
  verifiedBytes: number;
  speed: number | null;
  averageSpeed: number | null;
  etaSeconds: number | null;
  failureReason: string | null;
  /** The connection dropped and the transfer will resume on its own when possible. */
  autoResume: boolean;
  /** Highest speed measured over a full window (bytes/s), for "top speed". */
  peakSpeed: number | null;
  /** About one sample per second of the current speed, for the live graph. */
  speedHistory: readonly number[];
  /** Seconds spent actively transferring (paused time excluded). */
  activeSeconds: number;
}

export interface TransferSnapshot {
  localId: string;
  transferId: string | null;
  direction: "outgoing" | "incoming";
  batchId: string;
  /** Outgoing: the recipients; incoming: the sender. */
  peerIds: string[];
  fileName: string;
  fileSize: number;
  mimeType: string;
  createdAt: number;
  legs: LegSnapshot[];
  verification: Verification;
  save: SaveState;
  /** Outgoing after a reload: the user must select the same file again to resume. */
  needsReselect: boolean;
  error: string | null;
  /** Folder path inside a sent folder ("photos/2026"), sanitized; null for single files. */
  relativePath: string | null;
  /** Outgoing: reactions recipients sent back. Incoming: the reaction this device sent. */
  reactions: Reaction[];
  /** Outgoing in this session: the File is still available to send again. */
  canResend: boolean;
}

/** Emitted once per finished leg (sent to one device, or received). */
export interface Completion {
  direction: "outgoing" | "incoming";
  batchId: string;
  localId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  peerId: string;
  averageSpeed: number | null;
  peakSpeed: number | null;
  seconds: number;
}

export interface SpeedTestResult {
  ok: boolean;
  bytes: number;
  seconds: number;
  averageSpeed: number | null;
  peakSpeed: number | null;
}

export interface IncomingRequest {
  key: string;
  senderId: string;
  transferIds: string[];
  totalBytes: number;
  createdAt: number;
}

export interface TransfersSnapshot {
  items: TransferSnapshot[];
  requests: IncomingRequest[];
  trustedSenders: string[];
}

export type Notice =
  | { kind: "success"; message: string }
  | { kind: "info"; message: string }
  | { kind: "warning"; message: string }
  | { kind: "error"; message: string };

// --- dependencies ----------------------------------------------------------------

export interface TransferApi {
  create(body: TransferCreate): Promise<TransferView>;
  act(transferId: string, action: TransferAction, body?: { device_id?: string; reason?: string }): Promise<TransferView>;
  get(transferId: string): Promise<TransferView>;
}

export interface PeerAccess {
  acquire(peerId: string): unknown;
  retain(peerId: string): void;
  release(peerId: string): void;
  transportFor(peerId: string): DataChannelTransport | null;
  frameSizeFor(peerId: string): number;
  rttFor(peerId: string): number | null;
  events: Emitter<{
    transport: { peerId: string; transport: DataChannelTransport };
    transportLost: { peerId: string };
    failed: { peerId: string };
  }>;
}

export interface TransferManagerOptions {
  selfId: string;
  roomId: string;
  config: TransferConfigView;
  api: TransferApi;
  peers: PeerAccess;
  send: (message: ClientMessage) => void;
  resume: ResumeStore;
  sinks: SinkFactory;
  mobile: boolean;
  /** Memory limits for this device (smaller buffers and chunks on phones). */
  memory?: MemoryBudget;
  deviceName: (deviceId: string) => string;
  maxActiveTransfers?: number;
  /** Auto-accept from everyone (a "My devices" room: only paired devices can be in it). */
  trustAll?: boolean;
  /** Auto-accept a sender's batch this device asked for (event rooms: files a guest picked). */
  autoAcceptBatch?: (senderId: string, batchId: string) => boolean;
}

// --- internal records ---------------------------------------------------------------

interface OutLeg {
  deviceId: string;
  status: LegStatus;
  verifiedBytes: number;
  meter: SpeedMeter;
  failureReason: string | null;
  sender: FileSender | null;
  held: boolean;
  autoResume: boolean;
  /** An action request for this leg is in flight (avoid duplicates). */
  busy: boolean;
  /**
   * The receiver verified the whole file; the leg stays "transferring" until the receiver's
   * "complete" reaches the server. It must not be sent again in that gap.
   */
  delivered?: boolean;
}

interface OutgoingRecord {
  kind: "outgoing";
  localId: string;
  transferId: string | null;
  batchId: string;
  order: number;
  source: ByteSource | null;
  lastModified: number | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  chunkSize: number;
  totalChunks: number;
  legs: Map<string, OutLeg>;
  digests: Map<number, string>;
  createdAt: number;
  error: string | null;
  relativePath: string | null;
  reactions: Reaction[];
  /** The original File, kept (by reference) so it can be sent again this session. */
  file: LocalFile | null;
}

interface IncomingRecord {
  kind: "incoming";
  /** Finishing (assembling) has started; it runs once. */
  completing?: boolean;
  transferId: string;
  senderId: string;
  batchId: string;
  view: TransferView;
  status: LegStatus;
  fileName: string;
  sink: ChunkSink | null;
  sinkKind: SinkKind | null;
  directory: DirectoryHandleLike | null;
  receiver: FileReceiver | null;
  digests: Map<number, string> | null;
  verifiedBytes: number;
  ranges: ChunkRange[];
  meter: SpeedMeter;
  failureReason: string | null;
  verification: Verification;
  save: SaveState;
  finalFile: LocalFile | null;
  held: boolean;
  createdAt: number;
  lastCheckpointAt: number;
  checkpointTimer: ReturnType<typeof setTimeout> | null;
  dismissed: boolean;
  relativePath: string | null;
  reaction: Reaction | null;
}

const PUBLISH_INTERVAL_MS = 200;
const TUNE_INTERVAL_MS = 1000;
const CHECKPOINT_INTERVAL_MS = 2000;
// Without a batch id (older servers), requests from one sender this close together are one
// card. Transfers are created one after another, so this has to cover a server round trip.
const REQUEST_GROUP_WINDOW_MS = 2000;
const MIME_PATTERN = /^[A-Za-z0-9][\w.+-]*\/[\w.+-]+$/;
const SENDABLE: ReadonlySet<LegStatus> = new Set(["accepted", "connecting", "retrying", "transferring"]);
/** Speed tests are synthetic; cap them so a peer can't be flooded. */
export const MAX_SPEED_TEST_BYTES = 256 * 1024 * 1024;

/** The folder part of a file picked inside a folder ("photos/2026"), or null. */
function folderPathOf(file: LocalFile): string | null {
  return file.relativePath || null;
}

function existingLocalFile(uri: string, name: string): LocalFile | null {
  try {
    const file = localFileFromUri(uri, name);
    return file.size > 0 ? file : null;
  } catch {
    return null;
  }
}

export class TransferManager {
  readonly store = new Store<TransfersSnapshot>({ items: [], requests: [], trustedSenders: [] });
  readonly notices = new Emitter<{ notice: Notice }>();
  /** Finished legs (for history, records and celebrations). */
  readonly completions = new Emitter<{ completion: Completion }>();

  private readonly outgoing = new Map<string, OutgoingRecord>();
  private readonly outgoingByTransfer = new Map<string, OutgoingRecord>();
  private readonly incoming = new Map<string, IncomingRecord>();
  private readonly earlyViews = new Map<string, TransferView>();
  private readonly requests = new Map<string, IncomingRequest>();
  private readonly lastRequestKey = new Map<string, { key: string; at: number }>();
  /** The user's answer per incoming batch, applied to files of it that arrive later. */
  private readonly batchDecisions = new Map<string, { accepted: boolean; directory: DirectoryHandleLike | null }>();
  /** The server rejected `batch_id` (older backend): stop sending it. */
  private batchIdUnsupported = false;
  private readonly trusted = new Set<string>();
  private readonly outSlots = new Map<string, Map<number, FileSender>>();
  private readonly inSlots = new Map<string, Map<number, FileReceiver>>();
  private readonly nextSlot = new Map<string, number>();
  private readonly transportSubs = new Map<DataChannelTransport, Array<() => void>>();
  /** Per-transport send-buffer tuning (see AdaptiveController). */
  private readonly controllers = new Map<DataChannelTransport, { peerId: string; controller: AdaptiveController }>();
  private tuneTimer: ReturnType<typeof setInterval> | null = null;
  private readonly peerThroughput = new Map<string, number>();
  private readonly notifiedBatches = new Set<string>();
  private readonly subs: Array<() => void> = [];
  private order = 0;
  private creating = false;
  private createRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private publishTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;
  private disposed = false;
  private config: TransferConfigView;
  private readonly tuning: ReturnType<typeof defaultTuning>;

  constructor(private readonly options: TransferManagerOptions) {
    this.config = options.config;
    this.tuning = defaultTuning(null, options.mobile, options.memory?.maxHighWater);
    const { peers } = options;
    this.subs.push(
      peers.events.on("transport", ({ peerId, transport }) => this.onTransport(peerId, transport)),
      peers.events.on("transportLost", ({ peerId }) => this.onTransportLost(peerId)),
      peers.events.on("failed", ({ peerId }) => this.onLinkFailed(peerId)),
    );
    this.publishTimer = setInterval(() => {
      if (this.dirty) this.publish();
    }, PUBLISH_INTERVAL_MS);
    this.tuneTimer = setInterval(() => this.tune(), TUNE_INTERVAL_MS);
  }

  /** Adjusts each active link's send buffer from measured throughput and RTT. */
  private tune(): void {
    const sending = new Set<string>();
    for (const record of this.outgoing.values()) {
      for (const leg of record.legs.values()) if (leg.sender) sending.add(leg.deviceId);
    }
    const now = performance.now();
    for (const [transport, { peerId, controller }] of this.controllers) {
      if (!sending.has(peerId) || !transport.isOpen) continue;
      controller.setRtt(this.options.peers.rttFor(peerId));
      const highWater = controller.sample({
        bytesQueued: transport.bytesQueued,
        bufferedAmount: transport.bufferedAmount,
        senderBlocked: transport.takeBlocked(),
        now,
      });
      if (highWater !== transport.currentHighWater) transport.setHighWater(highWater);
      // Remembered to pick a chunk size for the next transfer to this peer.
      if (controller.throughput) this.peerThroughput.set(peerId, controller.throughput);
    }
  }

  setConfig(config: TransferConfigView): void {
    this.config = config;
  }

  // --- sending ----------------------------------------------------------------------

  /**
   * Queues files for the given recipients. Returns how many files were accepted. `batchId`
   * groups them as the recipient sees them (event rooms: the id of the guest's request).
   */
  send(files: readonly LocalFile[], recipientIds: readonly string[], options: { batchId?: string } = {}): number {
    const recipients = [...new Set(recipientIds)];
    if (recipients.length === 0 || files.length === 0) return 0;
    const empty = files.filter((f) => f.size === 0).length;
    if (empty > 0) {
      this.notify({ kind: "warning", message: empty === 1 ? "Empty files can't be sent." : `${empty} empty files were skipped.` });
    }
    // The backend allows `max_recipients` per transfer; larger audiences (event rooms)
    // get one transfer per group, all in the same batch.
    const groupSize = Math.max(1, this.config.max_recipients);
    const groups: string[][] = [];
    for (let i = 0; i < recipients.length; i += groupSize) groups.push(recipients.slice(i, i + groupSize));
    const batchId = options.batchId ?? randomId("b_");
    let count = 0;
    for (const file of files) {
      if (file.size === 0) continue;
      count += 1;
      for (const group of groups) {
        const chunkSize = chooseChunkSize(this.slowestThroughput(group), {
          recommended: this.config.recommended_chunk_size,
          min: this.config.min_chunk_size,
          max: Math.max(this.config.min_chunk_size, Math.min(this.config.max_chunk_size, this.options.memory?.maxChunkSize ?? Infinity)),
        });
        const record: OutgoingRecord = {
          kind: "outgoing",
          localId: randomId("f_"),
          transferId: null,
          batchId,
          order: this.order++,
          source: new FileSource(file),
          lastModified: file.lastModified,
          fileName: file.name || "file",
          fileSize: file.size,
          mimeType: MIME_PATTERN.test(file.type) ? file.type.toLowerCase() : "application/octet-stream",
          chunkSize,
          totalChunks: totalChunks(file.size, chunkSize),
          legs: new Map(group.map((id) => [id, this.newOutLeg(id, "queued")])),
          digests: new Map(),
          createdAt: Date.now(),
          error: null,
          relativePath: folderPathOf(file),
          reactions: [],
          file,
        };
        this.outgoing.set(record.localId, record);
      }
    }
    this.publish();
    void this.pumpCreate();
    return count;
  }

  /** App: the finished received file (for Save to Photos / Save to folder), or null. */
  receivedFile(transferId: string): LocalFile | null {
    const record = this.incoming.get(transferId);
    return record && !record.dismissed ? record.finalFile : null;
  }

  /** The original File of an item sent this session (for "Send again"), or null. */
  fileFor(localId: string): LocalFile | null {
    return this.outgoing.get(localId)?.file ?? null;
  }

  /** Rough time to send `bytes` to these peers, from speeds measured earlier this session. */
  estimateSeconds(bytes: number, peerIds: readonly string[]): number | null {
    const speed = this.slowestThroughput(peerIds);
    return speed && speed > 0 ? bytes / speed : null;
  }

  /** A recipient reacted to a file we sent. */
  addReaction(transferId: string, fromPeerId: string, emoji: Reaction): void {
    const record = this.outgoingByTransfer.get(transferId);
    if (!record || !record.legs.has(fromPeerId)) return;
    record.reactions = [...record.reactions, emoji].slice(-20);
    this.publish();
  }

  /** Records the reaction this device sent for a received file. */
  markReacted(transferId: string, emoji: Reaction): string | null {
    const record = this.incoming.get(transferId);
    if (!record) return null;
    record.reaction = emoji;
    this.publish();
    return record.senderId;
  }

  /**
   * Measures the link to a peer with synthetic data (nothing is saved, no server transfer).
   * The receiver discards the bytes after verifying them.
   */
  async runSpeedTest(
    peerId: string,
    bytes: number,
    onProgress?: (verifiedBytes: number, speed: number | null) => void,
  ): Promise<SpeedTestResult> {
    const size = Math.min(Math.max(1, Math.floor(bytes)), MAX_SPEED_TEST_BYTES);
    this.options.peers.acquire(peerId);
    try {
      const transport = await this.waitForTransport(peerId);
      if (!transport) return { ok: false, bytes: 0, seconds: 0, averageSpeed: null, peakSpeed: null };
      const chunkSize = 4 * 1024 * 1024;
      const meter = new SpeedMeter();
      meter.setActive(true);
      const slot = this.allocateSlot(peerId);
      const sender = new FileSender({
        transport,
        slot,
        transferId: randomId("st_"),
        source: new SyntheticSource(size, Date.now() & 0xffff),
        chunkSize,
        totalChunks: totalChunks(size, chunkSize),
        frameSize: this.options.peers.frameSizeFor(peerId),
        window: this.tuning.window,
        test: true,
        onProgress: (verified) => {
          meter.update(verified);
          onProgress?.(verified, meter.current);
        },
      });
      this.slotsFor(this.outSlots, peerId).set(slot, sender);
      const result = await sender.run();
      this.outSlots.get(peerId)?.delete(slot);
      meter.setActive(false);
      const seconds = meter.activeSeconds;
      const ok = result.kind === "done";
      if (ok && seconds > 0) this.peerThroughput.set(peerId, size / seconds);
      return { ok, bytes: sender.verifiedBytes, seconds, averageSpeed: meter.average, peakSpeed: meter.peak };
    } finally {
      this.options.peers.release(peerId);
    }
  }

  private waitForTransport(peerId: string, timeoutMs = 20_000): Promise<DataChannelTransport | null> {
    const ready = this.options.peers.transportFor(peerId);
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(null), timeoutMs);
      const off = this.options.peers.events.on("transport", ({ peerId: id, transport }) => {
        if (id === peerId) finish(transport);
      });
      const finish = (transport: DataChannelTransport | null) => {
        clearTimeout(timer);
        off();
        resolve(transport);
      };
    });
  }

  /** Re-selects the file for a transfer restored after a reload. Returns false on mismatch. */
  async provideFile(localId: string, file: LocalFile): Promise<boolean> {
    const record = this.outgoing.get(localId);
    if (!record) return false;
    if (file.size !== record.fileSize || file.name !== record.fileName) return false;
    if (record.lastModified !== null && file.lastModified !== record.lastModified) return false;
    const first = record.digests.get(0);
    if (first) {
      const [start, end] = chunkBounds(0, file.size, record.chunkSize);
      const digest = await sha256Hex(await readRange(file, start, end));
      if (digest !== first) return false;
    }
    record.source = new FileSource(file);
    record.error = null;
    for (const leg of record.legs.values()) {
      if (leg.status === "paused") leg.autoResume = true;
      if (leg.status === "failed" && record.transferId) void this.act(record, leg, "retry");
    }
    this.publish();
    this.pumpStarts();
    return true;
  }

  // --- incoming ----------------------------------------------------------------------

  isTrusted(senderId: string): boolean {
    return this.trusted.has(senderId);
  }

  setTrusted(senderId: string, trusted: boolean): void {
    if (trusted) this.trusted.add(senderId);
    else this.trusted.delete(senderId);
    this.publish();
  }

  /** Whether the group's files fit in temporary browser storage (null = unknown). */
  async storageFits(key: string): Promise<boolean | null> {
    const request = this.requests.get(key);
    if (!request) return true;
    return this.options.sinks.fits(request.totalBytes);
  }

  /** Accepts every pending transfer in an incoming group. Call from the Accept click. */
  async accept(key: string, options: { directory?: DirectoryHandleLike | null; trust?: boolean } = {}): Promise<void> {
    const request = this.requests.get(key);
    if (!request) return;
    this.requests.delete(key);
    this.batchDecisions.set(key, { accepted: true, directory: options.directory ?? null });
    if (options.trust) this.trusted.add(request.senderId);
    this.publish();
    await Promise.all(
      request.transferIds.map((id) => {
        const record = this.incoming.get(id);
        return record ? this.acceptIncoming(record, options.directory ?? null) : undefined;
      }),
    );
  }

  async decline(key: string): Promise<void> {
    const request = this.requests.get(key);
    if (!request) return;
    this.requests.delete(key);
    this.batchDecisions.set(key, { accepted: false, directory: null });
    this.publish();
    await Promise.all(
      request.transferIds.map(async (id) => {
        const record = this.incoming.get(id);
        if (record?.status === "pending") await this.actIncoming(record, "reject");
      }),
    );
  }

  /** Declines one file of a pending group. */
  async declineOne(transferId: string): Promise<void> {
    const record = this.incoming.get(transferId);
    if (!record || record.status !== "pending") return;
    for (const [key, request] of this.requests) {
      request.transferIds = request.transferIds.filter((id) => id !== transferId);
      request.totalBytes = request.transferIds.reduce((sum, id) => sum + (this.incoming.get(id)?.view.file.file_size ?? 0), 0);
      if (request.transferIds.length === 0) this.requests.delete(key);
    }
    await this.actIncoming(record, "reject");
  }

  /** Saves a received file. Must be called from a click (it may open a save dialog). */
  async save(transferId: string): Promise<void> {
    const record = this.incoming.get(transferId);
    if (!record?.finalFile || record.save === "saving") return;
    record.save = "saving";
    this.publish();
    try {
      const result = await saveFile(record.finalFile, record.fileName);
      record.save = result === "saved" ? "saved" : "ready";
      if (result === "saved") {
        // Give the browser time to read the file for the download before deleting it.
        setTimeout(() => void this.cleanupIncoming(record), 120_000);
      }
    } catch (error) {
      logger.error("transfer", "save failed", String(error));
      record.save = "ready";
      this.notify({ kind: "error", message: "Couldn't save the file. Please try again." });
    }
    this.publish();
  }

  /** Received files that are ready to save, optionally from one batch. */
  readyFiles(batchId?: string): Array<{ localId: string; path: string; file: LocalFile; batchId: string }> {
    const out: Array<{ localId: string; path: string; file: LocalFile; batchId: string }> = [];
    for (const record of this.incoming.values()) {
      if (!record.finalFile || record.dismissed || (batchId && record.batchId !== batchId)) continue;
      const path = record.relativePath ? `${record.relativePath}/${record.fileName}` : record.fileName;
      out.push({ localId: record.transferId, path, file: record.finalFile, batchId: record.batchId });
    }
    return out;
  }

  /** Saves several received files as one .zip (keeps folder structure). Call from a click. */
  async saveAsZip(batchId: string | undefined, onProgress?: (done: number, total: number) => void): Promise<boolean> {
    const files = this.readyFiles(batchId);
    if (files.length === 0) return false;
    const taken = new Set<string>();
    const entries = files.map((f) => {
      const path = dedupeFileName(f.path, taken);
      taken.add(path.toLowerCase());
      return { path, file: f.file };
    });
    const zip = await writeZipFile(entries, `droply-${new Date().toISOString().slice(0, 10)}.zip`, onProgress);
    try {
      const result = await saveFile(zip, zip.name);
      return result === "saved";
    } finally {
      // The share sheet has copied it (or was dismissed); the archive was only a temporary file.
      setTimeout(() => deleteQuietly(zip.uri), 120_000);
    }
  }

  /** Files in this room that may be images or videos, for the album (sniffed by the UI). */
  mediaCandidates(): Array<{ localId: string; direction: "outgoing" | "incoming"; name: string; file: LocalFile; peerId: string }> {
    const out: Array<{ localId: string; direction: "outgoing" | "incoming"; name: string; file: LocalFile; peerId: string }> = [];
    const seen = new Set<LocalFile>();
    for (const record of this.outgoing.values()) {
      if (!record.file || seen.has(record.file)) continue;
      seen.add(record.file);
      out.push({ localId: record.localId, direction: "outgoing", name: record.fileName, file: record.file, peerId: [...record.legs.keys()][0] ?? "" });
    }
    for (const record of this.incoming.values()) {
      if (record.finalFile && !record.dismissed) {
        out.push({ localId: record.transferId, direction: "incoming", name: record.fileName, file: record.finalFile, peerId: record.senderId });
      }
    }
    return out;
  }

  // --- controls (both directions) ---------------------------------------------------

  async pause(localId: string): Promise<void> {
    const out = this.outgoing.get(localId);
    if (out?.transferId) {
      for (const leg of out.legs.values()) {
        if (leg.status !== "transferring") continue;
        leg.autoResume = false;
        leg.sender?.stop("paused");
      }
      await this.actAll(out, "pause");
      return;
    }
    const inc = this.incoming.get(localId);
    if (inc && inc.status === "transferring") {
      inc.receiver?.stop("paused");
      this.flushCheckpoint(inc);
      await this.actIncoming(inc, "pause");
    }
  }

  async resume(localId: string): Promise<void> {
    const out = this.outgoing.get(localId);
    if (out?.transferId) {
      if (!out.source) {
        this.notify({ kind: "info", message: `Select ${out.fileName} again to resume.` });
        return;
      }
      await this.actAll(out, "resume");
      this.pumpStarts();
      return;
    }
    const inc = this.incoming.get(localId);
    if (inc?.status === "paused") await this.actIncoming(inc, "resume");
  }

  async retry(localId: string): Promise<void> {
    const out = this.outgoing.get(localId);
    if (out?.transferId) {
      if (!out.source) {
        this.notify({ kind: "info", message: `Select ${out.fileName} again to resume.` });
        return;
      }
      for (const leg of out.legs.values()) {
        if (leg.status === "failed") await this.act(out, leg, "retry");
      }
      this.pumpStarts();
      return;
    }
    const inc = this.incoming.get(localId);
    if (inc?.status === "failed") await this.actIncoming(inc, "retry");
  }

  async cancel(localId: string): Promise<void> {
    const out = this.outgoing.get(localId);
    if (out) {
      for (const leg of out.legs.values()) {
        leg.sender?.stop("cancelled");
        if (leg.status === "queued" || leg.status === "requesting") leg.status = "cancelled";
      }
      if (out.transferId) await this.actAll(out, "cancel");
      this.finishOutgoingIfDone(out);
      this.publish();
      void this.pumpCreate();
      return;
    }
    const inc = this.incoming.get(localId);
    if (inc && !isTerminal(inc.status)) {
      inc.receiver?.stop("cancelled");
      await this.actIncoming(inc, "cancel");
    }
  }

  /** Removes a finished item from the list (and its temporary data). */
  dismiss(localId: string): void {
    const out = this.outgoing.get(localId);
    if (out && [...out.legs.values()].every((l) => isTerminal(l.status) || l.status === "failed")) {
      this.outgoing.delete(localId);
      if (out.transferId) this.outgoingByTransfer.delete(out.transferId);
      this.publish();
      return;
    }
    const inc = this.incoming.get(localId);
    if (inc && (isTerminal(inc.status) || inc.status === "failed")) {
      inc.dismissed = true;
      void this.cleanupIncoming(inc);
      this.incoming.delete(localId);
      this.publish();
    }
  }

  /** Deletes temporary data of every finished incoming transfer. */
  async clearTemporaryData(): Promise<void> {
    for (const record of [...this.incoming.values()]) {
      if (isTerminal(record.status) || record.status === "failed") {
        await this.cleanupIncoming(record);
        this.incoming.delete(record.transferId);
      }
    }
    const keep = new Set([...this.incoming.keys()]);
    await cleanOrphanedSandboxFiles(keep);
    for (const leg of await this.options.resume.allLegs()) {
      if (leg.role === "receive" && !keep.has(leg.transferId)) await this.options.resume.deleteLeg("receive", leg.transferId);
    }
    this.publish();
  }

  /** Bytes held in temporary browser storage by unfinished or unsaved incoming files. */
  temporaryBytes(): number {
    let total = 0;
    for (const record of this.incoming.values()) {
      if (record.sinkKind && record.sinkKind !== "fs-access" && record.save !== "saved") total += record.verifiedBytes;
    }
    return total;
  }

  // --- server events --------------------------------------------------------------------

  handleEvent(event: TransferEvent): void {
    if (this.disposed) return;
    const view = event.transfer;
    if (view.sender_id === this.options.selfId) {
      const record = this.outgoingByTransfer.get(view.transfer_id);
      if (!record) {
        this.earlyViews.set(view.transfer_id, view);
        return;
      }
      this.applyOutgoingView(record, view, event);
    } else if (view.recipient_ids.includes(this.options.selfId)) {
      let record = this.incoming.get(view.transfer_id);
      if (!record) {
        const leg = view.recipients.find((l) => l.device_id === this.options.selfId);
        if (!leg || isTerminal(leg.status)) return;
        record = this.createIncoming(view);
      }
      this.applyIncomingView(record, view, event);
    }
  }

  /** A device came (back) into the room: resume legs that were waiting for it. */
  onPeerPresent(peerId: string): void {
    for (const record of this.outgoing.values()) {
      const leg = record.legs.get(peerId);
      // The device came back: if its "complete" never reached the server, let it finish now
      // (the receiver answers a repeat without assembling the file again).
      if (leg?.delivered) leg.delivered = false;
      if (leg && leg.autoResume && (leg.status === "paused" || SENDABLE.has(leg.status))) this.holdLeg(leg);
    }
    this.pumpStarts();
  }

  /** Restores transfers from IndexedDB after a reload. */
  async restore(): Promise<void> {
    const { resume, roomId } = this.options;
    const legs = await resume.legsForRoom(roomId);
    for (const leg of legs) {
      let view: TransferView;
      try {
        view = await this.options.api.get(leg.transferId);
      } catch (error) {
        if (isApiError(error) && (error.status === 404 || error.status === 403 || error.status === 410)) {
          await this.discardStoredLeg(leg);
        }
        continue;
      }
      if (leg.role === "send") await this.restoreOutgoing(leg, view);
      else await this.restoreIncoming(leg, view);
    }
    const keep = new Set([...this.incoming.keys()]);
    void cleanOrphanedSandboxFiles(keep);
    this.publish();
    this.pumpStarts();
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.subs.splice(0)) off();
    for (const offs of this.transportSubs.values()) for (const off of offs) off();
    this.transportSubs.clear();
    for (const record of this.outgoing.values()) {
      for (const leg of record.legs.values()) leg.sender?.stop("paused");
    }
    for (const record of this.incoming.values()) {
      if (record.checkpointTimer) clearTimeout(record.checkpointTimer);
      void record.sink?.close();
    }
    if (this.publishTimer) clearInterval(this.publishTimer);
    if (this.tuneTimer) clearInterval(this.tuneTimer);
    if (this.createRetryTimer) clearTimeout(this.createRetryTimer);
    this.controllers.clear();
    this.notices.clear();
  }

  // --- outgoing internals -----------------------------------------------------------------

  private newOutLeg(deviceId: string, status: LegStatus): OutLeg {
    return {
      deviceId,
      status,
      verifiedBytes: 0,
      meter: new SpeedMeter(),
      failureReason: null,
      sender: null,
      held: false,
      autoResume: false,
      busy: false,
    };
  }

  private unfinishedOutgoingOnServer(): number {
    let count = 0;
    for (const record of this.outgoing.values()) {
      if (!record.transferId) continue;
      if ([...record.legs.values()].some((l) => isUnfinishedOnServer(l.status))) count += 1;
    }
    return count;
  }

  private async pumpCreate(): Promise<void> {
    if (this.creating || this.disposed) return;
    this.creating = true;
    try {
      const max = this.options.maxActiveTransfers ?? env.maxActiveTransfers;
      while (!this.disposed && creationSlots(this.unfinishedOutgoingOnServer(), max) > 0) {
        const next = [...this.outgoing.values()]
          .filter((r) => !r.transferId && [...r.legs.values()].every((l) => l.status === "queued"))
          .sort((a, b) => a.order - b.order)[0];
        if (!next) break;
        for (const leg of next.legs.values()) leg.status = "requesting";
        this.publish();
        const created = await this.createOnServer(next);
        if (!created) break;
      }
    } finally {
      this.creating = false;
    }
  }

  private async createOnServer(record: OutgoingRecord): Promise<boolean> {
    try {
      const body: TransferCreate = {
        recipient_ids: [...record.legs.keys()],
        file: {
          file_name: record.fileName,
          file_size: record.fileSize,
          mime_type: record.mimeType,
          chunk_size: record.chunkSize,
          total_chunks: record.totalChunks,
        },
      };
      let view: TransferView;
      if (this.batchIdUnsupported) {
        view = await this.options.api.create(body);
      } else {
        try {
          view = await this.options.api.create({ ...body, batch_id: record.batchId });
        } catch (error) {
          if (!(isApiError(error) && error.status === 422)) throw error;
          this.batchIdUnsupported = true;
          view = await this.options.api.create(body);
        }
      }
      // Cancelled while the request was in flight.
      if ([...record.legs.values()].every((l) => l.status === "cancelled")) {
        record.transferId = view.transfer_id;
        this.outgoingByTransfer.set(view.transfer_id, record);
        await this.actAll(record, "cancel");
        return true;
      }
      record.transferId = view.transfer_id;
      this.outgoingByTransfer.set(view.transfer_id, record);
      await this.options.resume.saveLeg(this.sendRecord(record, view));
      const early = this.earlyViews.get(view.transfer_id);
      this.earlyViews.delete(view.transfer_id);
      this.applyOutgoingView(record, early && Date.parse(early.created_at) >= 0 ? newest(view, early) : view, null);
      return true;
    } catch (error) {
      const code = isApiError(error) ? error.code : null;
      if (code === "TRANSFER_LIMIT_REACHED" || code === "RATE_LIMITED" || code === "NETWORK_ERROR") {
        for (const leg of record.legs.values()) if (leg.status === "requesting") leg.status = "queued";
        const wait = isApiError(error) && error.retryAfter ? error.retryAfter * 1000 : 5000;
        this.createRetryTimer ??= setTimeout(() => {
          this.createRetryTimer = null;
          void this.pumpCreate();
        }, wait);
      } else {
        for (const leg of record.legs.values()) {
          leg.status = "failed";
          leg.failureReason = userMessage(error);
        }
        record.error = userMessage(error);
      }
      this.publish();
      return false;
    }
  }

  private sendRecord(record: OutgoingRecord, view: TransferView): LegRecord {
    const now = Date.now();
    return {
      key: legKey("send", view.transfer_id),
      role: "send",
      transferId: view.transfer_id,
      roomId: this.options.roomId,
      peerId: view.recipient_ids.join(","),
      fileName: record.fileName,
      fileSize: record.fileSize,
      mimeType: record.mimeType,
      chunkSize: view.file.chunk_size,
      totalChunks: view.file.total_chunks,
      sinkKind: null,
      lastModified: record.lastModified,
      createdAt: now,
      updatedAt: now,
    };
  }

  private applyOutgoingView(record: OutgoingRecord, view: TransferView, event: TransferEvent | null): void {
    // The server may have adjusted the chunk size; it is authoritative.
    record.chunkSize = view.file.chunk_size;
    record.totalChunks = view.file.total_chunks;
    for (const legView of view.recipients) {
      let leg = record.legs.get(legView.device_id);
      if (!leg) {
        leg = this.newOutLeg(legView.device_id, legView.status);
        record.legs.set(legView.device_id, leg);
      }
      const previous = leg.status;
      leg.status = legView.status;
      // Anything but "transferring" (completed, or a retry after a problem) ends the wait.
      if (leg.status !== "transferring") leg.delivered = false;
      leg.failureReason = legView.failure_reason;
      const affected = !event || event.device_ids.length === 0 || event.device_ids.includes(leg.deviceId);
      if (affected && event?.type === "transfer_paused") {
        // Paused by the server (disconnect) or by our own connection-loss report: resume
        // automatically. Paused by a person: wait for them.
        leg.autoResume = event.actor_id === null || event.reason === "connection_lost";
      }
      if (previous !== leg.status) this.onOutgoingLegStatus(record, leg, previous);
    }
    this.finishOutgoingIfDone(record);
    this.publish();
    this.pumpStarts();
  }

  private onOutgoingLegStatus(record: OutgoingRecord, leg: OutLeg, previous: LegStatus): void {
    const status = leg.status;
    if (status === "paused" || status === "failed" || isTerminal(status)) {
      leg.sender?.stop(status === "cancelled" ? "cancelled" : "paused");
    }
    if (isTerminal(status) || (status === "failed" && !leg.autoResume)) {
      this.releaseLeg(leg);
    }
    if (status === "accepted" && previous === "pending") {
      this.holdLeg(leg);
    }
    if (status === "completed") {
      const average = leg.meter.average;
      if (average) this.peerThroughput.set(leg.deviceId, average);
      leg.verifiedBytes = record.fileSize;
      this.completions.emit("completion", {
        direction: "outgoing",
        batchId: record.batchId,
        localId: record.localId,
        fileName: record.fileName,
        fileSize: record.fileSize,
        mimeType: record.mimeType,
        peerId: leg.deviceId,
        averageSpeed: average,
        peakSpeed: leg.meter.peak,
        seconds: leg.meter.activeSeconds,
      });
    }
    if (status === "rejected" && previous === "pending") {
      this.notify({ kind: "info", message: `${this.options.deviceName(leg.deviceId)} declined ${record.fileName}.` });
    }
  }

  private finishOutgoingIfDone(record: OutgoingRecord): void {
    const legs = [...record.legs.values()];
    if (!legs.every((l) => isTerminal(l.status))) return;
    if (record.transferId) void this.options.resume.deleteLeg("send", record.transferId);
    record.source = legs.some((l) => l.status === "completed") ? record.source : null;
    this.maybeNotifyBatch(record.batchId);
    void this.pumpCreate();
  }

  private maybeNotifyBatch(batchId: string): void {
    if (this.notifiedBatches.has(batchId)) return;
    const records = [...this.outgoing.values()].filter((r) => r.batchId === batchId);
    const legs = records.flatMap((r) => [...r.legs.values()]);
    if (legs.length === 0 || !legs.every((l) => isTerminal(l.status))) return;
    this.notifiedBatches.add(batchId);
    const sent = records.filter((r) => [...r.legs.values()].some((l) => l.status === "completed")).length;
    if (sent > 0) {
      this.notify({ kind: "success", message: sent === 1 ? `Sent ${records.find((r) => [...r.legs.values()].some((l) => l.status === "completed"))?.fileName}` : `Sent ${sent} files` });
    }
  }

  private holdLeg(leg: OutLeg): void {
    if (leg.held) return;
    leg.held = true;
    this.options.peers.acquire(leg.deviceId);
  }

  private releaseLeg(leg: OutLeg): void {
    if (!leg.held) return;
    leg.held = false;
    this.options.peers.release(leg.deviceId);
  }

  /** Starts senders for legs that are ready, within the concurrency limits. */
  private pumpStarts(): void {
    if (this.disposed) return;
    const limits = schedulerLimits(this.options.mobile, this.options.memory?.maxActiveTransfers);
    const running: { peerId: string }[] = [];
    const waiting: Candidate[] = [];
    const lookup = new Map<string, [OutgoingRecord, OutLeg]>();
    for (const record of this.outgoing.values()) {
      if (!record.transferId || !record.source) continue;
      for (const leg of record.legs.values()) {
        if (leg.sender) {
          running.push({ peerId: leg.deviceId });
          continue;
        }
        const wants = SENDABLE.has(leg.status) || (leg.status === "paused" && leg.autoResume);
        if (!wants || leg.busy || leg.delivered) continue;
        this.holdLeg(leg);
        if (!this.options.peers.transportFor(leg.deviceId)) {
          if (leg.status === "accepted") void this.act(record, leg, "connect");
          continue;
        }
        const key = `${record.localId}:${leg.deviceId}`;
        lookup.set(key, [record, leg]);
        waiting.push({ key, peerId: leg.deviceId, order: record.order });
      }
    }
    for (const candidate of pickStartable(waiting, running, limits)) {
      const entry = lookup.get(candidate.key);
      if (entry) void this.startSender(entry[0], entry[1]);
    }
  }

  private async startSender(record: OutgoingRecord, leg: OutLeg): Promise<void> {
    const transport = this.options.peers.transportFor(leg.deviceId);
    const source = record.source;
    const transferId = record.transferId;
    if (!transport || !source || !transferId || leg.sender) return;

    if (leg.status === "paused") {
      // Connection is back: resume first (paused → transferring), then send the gaps.
      const ok = await this.act(record, leg, "resume");
      // act() applied the server's view, which changed leg.status.
      if (!ok || statusOf(leg) !== "transferring") return;
      if (leg.sender || !this.options.peers.transportFor(leg.deviceId)) return;
    }

    const slot = this.allocateSlot(leg.deviceId);
    let started = false;
    const sender = new FileSender({
      transport,
      slot,
      transferId,
      source,
      chunkSize: record.chunkSize,
      totalChunks: record.totalChunks,
      frameSize: this.options.peers.frameSizeFor(leg.deviceId),
      window: this.tuning.window,
      path: record.relativePath,
      knownDigests: record.digests,
      onDigest: (index, digest) => {
        if (record.digests.get(index) === digest) return;
        record.digests.set(index, digest);
        void this.options.resume.putDigest("send", transferId, index, digest).catch(() => undefined);
      },
      onProgress: (bytes) => {
        leg.verifiedBytes = bytes;
        leg.meter.update(bytes);
        this.dirty = true;
      },
      onStart: () => {
        if (started) return;
        started = true;
        if (leg.status === "accepted" || leg.status === "connecting" || leg.status === "retrying") {
          void this.act(record, leg, "start");
        }
      },
    });
    leg.sender = sender;
    leg.autoResume = false;
    leg.meter.setActive(true);
    this.slotsFor(this.outSlots, leg.deviceId).set(slot, sender);
    this.publish();

    const result = await sender.run();

    this.outSlots.get(leg.deviceId)?.delete(slot);
    leg.sender = null;
    leg.meter.setActive(false);
    if (this.disposed) return;
    switch (result.kind) {
      case "done":
        // Wait for the receiver's "complete" instead of starting the file over.
        leg.delivered = true;
        break;
      case "interrupted":
        // The link dropped. Pause on the server so the leg can resume from the gaps.
        if (leg.status === "transferring") {
          leg.autoResume = true;
          await this.act(record, leg, "pause", "connection_lost");
        } else if (SENDABLE.has(leg.status)) {
          leg.autoResume = true;
        }
        break;
      case "failed": {
        const reason = result.reason === "integrity" ? "integrity" : result.reason === "read_error" ? "read_error" : "protocol";
        if (result.reason === "read_error") {
          record.source = null;
          record.error = "The file could not be read. It may have been moved or changed.";
        }
        await this.act(record, leg, "fail", reason);
        break;
      }
      default:
        break;
    }
    this.publish();
    this.pumpStarts();
  }

  /** Sends a transfer action for one leg. Returns false if the server refused it. */
  private async act(record: OutgoingRecord, leg: OutLeg, action: TransferAction, reason?: string): Promise<boolean> {
    if (!record.transferId) return false;
    // While a request for this leg is in flight the scheduler leaves it alone.
    leg.busy = true;
    try {
      const body: { device_id: string; reason?: string } = { device_id: leg.deviceId };
      if (reason) body.reason = reason;
      const view = await this.options.api.act(record.transferId, action, body);
      leg.busy = false;
      this.applyOutgoingView(record, view, null);
      return true;
    } catch (error) {
      leg.busy = false;
      await this.handleActionError(record.transferId, action, error);
      return false;
    }
  }

  private async actAll(record: OutgoingRecord, action: TransferAction): Promise<void> {
    if (!record.transferId) return;
    try {
      const view = await this.options.api.act(record.transferId, action, {});
      this.applyOutgoingView(record, view, null);
    } catch (error) {
      await this.handleActionError(record.transferId, action, error);
    }
  }

  private async handleActionError(transferId: string, action: TransferAction, error: unknown): Promise<void> {
    // INVALID_STATE usually means the other side acted first: refresh from the server.
    if (isApiError(error) && (error.code === "INVALID_STATE" || error.code === "CONFLICT")) {
      logger.debug("transfer", `${action} not applicable; refreshing`, { transferId });
      try {
        const view = await this.options.api.get(transferId);
        const record = this.outgoingByTransfer.get(transferId);
        if (record) this.applyOutgoingView(record, view, null);
        const incoming = this.incoming.get(transferId);
        if (incoming) this.applyIncomingView(incoming, view, null);
      } catch {
        // ignore
      }
      return;
    }
    logger.warn("transfer", `${action} failed`, { transferId, error: String(error) });
    if (action === "accept" || action === "cancel" || action === "resume" || action === "retry") {
      this.notify({ kind: "error", message: userMessage(error) });
    }
  }

  private async restoreOutgoing(stored: LegRecord, view: TransferView): Promise<void> {
    if (view.recipients.every((l) => isTerminal(l.status))) {
      await this.options.resume.deleteLeg("send", stored.transferId);
      return;
    }
    if (this.outgoingByTransfer.has(view.transfer_id)) return;
    const record: OutgoingRecord = {
      kind: "outgoing",
      localId: randomId("f_"),
      transferId: view.transfer_id,
      batchId: `restored:${view.transfer_id}`,
      order: this.order++,
      source: null,
      lastModified: stored.lastModified,
      fileName: stored.fileName,
      fileSize: stored.fileSize,
      mimeType: stored.mimeType,
      chunkSize: view.file.chunk_size,
      totalChunks: view.file.total_chunks,
      legs: new Map(),
      digests: await this.options.resume.getDigests("send", view.transfer_id),
      createdAt: stored.createdAt,
      error: null,
      relativePath: null,
      reactions: [],
      file: null,
    };
    for (const legView of view.recipients) {
      const leg = this.newOutLeg(legView.device_id, legView.status);
      leg.verifiedBytes = this.bytesForRanges(legView.received_ranges, record.chunkSize, record.totalChunks, record.fileSize);
      leg.autoResume = legView.status === "paused" || SENDABLE.has(legView.status);
      record.legs.set(legView.device_id, leg);
    }
    this.outgoing.set(record.localId, record);
    this.outgoingByTransfer.set(view.transfer_id, record);
  }

  // --- incoming internals -------------------------------------------------------------------

  private createIncoming(view: TransferView): IncomingRecord {
    const taken = new Set([...this.incoming.values()].map((r) => r.fileName.toLowerCase()));
    const leg = view.recipients.find((l) => l.device_id === this.options.selfId);
    const record: IncomingRecord = {
      kind: "incoming",
      transferId: view.transfer_id,
      senderId: view.sender_id,
      batchId: view.transfer_id,
      view,
      status: leg?.status ?? "pending",
      fileName: dedupeFileName(sanitizeFileName(view.file.file_name), taken),
      sink: null,
      sinkKind: null,
      directory: null,
      receiver: null,
      digests: null,
      verifiedBytes: 0,
      ranges: [],
      meter: new SpeedMeter(),
      failureReason: null,
      verification: "pending",
      save: "none",
      finalFile: null,
      held: false,
      createdAt: Date.now(),
      lastCheckpointAt: 0,
      checkpointTimer: null,
      dismissed: false,
      relativePath: null,
      reaction: null,
    };
    this.incoming.set(view.transfer_id, record);
    if (record.status === "pending") this.addToRequestGroup(record);
    return record;
  }

  private addToRequestGroup(record: IncomingRecord): void {
    // Files the sender sent together form one batch (one card): by the sender's batch id,
    // or, from servers without it, by arriving close together.
    const now = Date.now();
    let key: string;
    const batch = record.view.batch_id;
    if (batch) {
      key = `rq_${record.senderId}_${batch}`;
    } else {
      const last = this.lastRequestKey.get(record.senderId);
      key = last && now - last.at < REQUEST_GROUP_WINDOW_MS ? last.key : randomId("rq_");
      this.lastRequestKey.set(record.senderId, { key, at: now });
    }
    record.batchId = key;
    const requested = batch !== null && batch !== undefined && this.options.autoAcceptBatch?.(record.senderId, batch) === true;
    if (requested || this.trusted.has(record.senderId) || this.options.trustAll) {
      void this.acceptIncoming(record, null);
      return;
    }
    // Later files of a batch the user already answered (the sender creates transfers a
    // few at a time) follow that answer instead of asking again.
    const decision = this.batchDecisions.get(key);
    if (decision) {
      if (decision.accepted) void this.acceptIncoming(record, decision.directory);
      else void this.actIncoming(record, "reject");
      return;
    }
    let request = this.requests.get(key);
    if (!request) {
      request = { key, senderId: record.senderId, transferIds: [], totalBytes: 0, createdAt: now };
      this.requests.set(key, request);
    }
    request.transferIds = [...request.transferIds, record.transferId];
    request.totalBytes += record.view.file.file_size;
  }

  private async acceptIncoming(record: IncomingRecord, directory: DirectoryHandleLike | null): Promise<void> {
    if (record.status !== "pending") return;
    record.directory = directory;
    record.sinkKind = directory ? "fs-access" : null;
    const now = Date.now();
    const file = record.view.file;
    await this.options.resume.saveLeg({
      key: legKey("receive", record.transferId),
      role: "receive",
      transferId: record.transferId,
      roomId: this.options.roomId,
      peerId: record.senderId,
      fileName: record.fileName,
      fileSize: file.file_size,
      mimeType: file.mime_type,
      chunkSize: file.chunk_size,
      totalChunks: file.total_chunks,
      sinkKind: record.sinkKind,
      lastModified: null,
      createdAt: now,
      updatedAt: now,
    });
    this.holdIncoming(record);
    await this.actIncoming(record, "accept");
  }

  private holdIncoming(record: IncomingRecord): void {
    if (record.held) return;
    record.held = true;
    this.options.peers.retain(record.senderId);
  }

  private releaseIncoming(record: IncomingRecord): void {
    if (!record.held) return;
    record.held = false;
    this.options.peers.release(record.senderId);
  }

  private async actIncoming(record: IncomingRecord, action: TransferAction, reason?: string): Promise<void> {
    try {
      const view = await this.options.api.act(record.transferId, action, reason ? { reason } : {});
      this.applyIncomingView(record, view, null);
    } catch (error) {
      await this.handleActionError(record.transferId, action, error);
    }
  }

  private applyIncomingView(record: IncomingRecord, view: TransferView, _event: TransferEvent | null): void {
    record.view = view;
    const leg = view.recipients.find((l) => l.device_id === this.options.selfId);
    if (!leg) return;
    const previous = record.status;
    record.status = leg.status;
    record.failureReason = leg.failure_reason;
    if (previous !== record.status) {
      if (record.status !== "pending") this.removeFromRequests(record.transferId);
      if (record.status === "paused" || record.status === "failed" || isTerminal(record.status)) {
        if (record.receiver && record.status !== "completed") record.receiver.stop(record.status === "cancelled" ? "cancelled" : "paused");
      }
      if (record.status === "accepted" || record.status === "connecting" || record.status === "transferring") {
        this.holdIncoming(record);
      }
      if (isTerminal(record.status)) this.releaseIncoming(record);
      if (record.status === "cancelled" || record.status === "expired" || record.status === "rejected") {
        if (previous === "transferring" || previous === "paused") {
          this.notify({ kind: "warning", message: `${record.fileName} was cancelled.` });
        }
        void this.cleanupIncoming(record);
      }
    }
    this.publish();
  }

  private removeFromRequests(transferId: string): void {
    for (const [key, request] of this.requests) {
      if (!request.transferIds.includes(transferId)) continue;
      const remaining = request.transferIds.filter((id) => this.incoming.get(id)?.status === "pending");
      if (remaining.length === 0) this.requests.delete(key);
      else this.requests.set(key, { ...request, transferIds: remaining });
    }
  }

  private async onIncomingOpen(peerId: string, transport: DataChannelTransport, ctl: Extract<Ctl, { t: "file_open" }>): Promise<void> {
    if (ctl.test) {
      this.receiveSpeedTest(peerId, transport, ctl);
      return;
    }
    const record = this.incoming.get(ctl.transferId);
    const file = record?.view.file;
    const valid =
      record &&
      file &&
      record.senderId === peerId &&
      file.file_size === ctl.size &&
      file.chunk_size === ctl.chunkSize &&
      file.total_chunks === ctl.totalChunks;
    if (!valid || !record) {
      transport.sendCtl({ t: "file_close", slot: ctl.slot, role: "receiver", reason: "error" });
      return;
    }
    if (!SENDABLE.has(record.status)) {
      // The sender's file_open can overtake the WebSocket event (e.g. its resume), so check
      // the server's view before refusing.
      try {
        this.applyIncomingView(record, await this.options.api.get(record.transferId), null);
      } catch {
        // keep the local view
      }
    }
    if (record.status === "paused") {
      transport.sendCtl({ t: "file_close", slot: ctl.slot, role: "receiver", reason: "paused" });
      return;
    }
    if (!SENDABLE.has(record.status)) {
      transport.sendCtl({ t: "file_close", slot: ctl.slot, role: "receiver", reason: "error" });
      return;
    }
    record.receiver?.stop("paused");
    record.relativePath = sanitizeFolderPath(ctl.path);

    try {
      if (!record.sink) {
        const sink = await this.options.sinks.create({
          transferId: record.transferId,
          fileName: record.fileName,
          size: ctl.size,
          totalChunks: ctl.totalChunks,
          directory: record.directory,
          preferredKind: record.sinkKind,
          folderPath: record.relativePath,
        });
        if (record.sinkKind && record.sinkKind !== sink.kind) {
          // A different storage tier than before (e.g. after a reload): start over.
          record.digests = new Map();
          await this.options.resume.deleteLeg("receive", record.transferId);
        }
        record.sink = sink;
        record.sinkKind = sink.kind;
        await this.saveReceiveLeg(record);
      }
      record.digests ??= await this.options.resume.getDigests("receive", record.transferId);
    } catch (error) {
      logger.error("transfer", "no storage for incoming file", String(error));
      transport.sendCtl({ t: "file_close", slot: ctl.slot, role: "receiver", reason: "error" });
      this.notify({ kind: "error", message: `Not enough storage to receive ${record.fileName}.` });
      await this.actIncoming(record, "fail", "storage");
      return;
    }

    const transferId = record.transferId;
    const receiver = new FileReceiver({
      transport,
      slot: ctl.slot,
      transferId,
      size: ctl.size,
      chunkSize: ctl.chunkSize,
      totalChunks: ctl.totalChunks,
      window: this.tuning.window,
      sink: record.sink,
      digests: record.digests,
      persistDigest: async (index, digest) => {
        record.digests?.set(index, digest);
        await this.options.resume.putDigest("receive", transferId, index, digest);
      },
      onProgress: (bytes, ranges) => {
        record.verifiedBytes = bytes;
        record.ranges = ranges;
        record.meter.update(bytes);
        this.dirty = true;
        this.scheduleCheckpoint(record);
      },
      onVerified: () => {
        record.verification = "verified";
      },
    });
    record.receiver = receiver;
    record.meter.setActive(true);
    this.slotsFor(this.inSlots, peerId).set(ctl.slot, receiver);
    this.publish();

    const result = await receiver.start();

    this.inSlots.get(peerId)?.delete(ctl.slot);
    if (record.receiver === receiver) record.receiver = null;
    record.meter.setActive(false);
    this.flushCheckpoint(record);
    if (this.disposed) return;

    if (result.kind === "done") {
      await this.completeIncoming(record);
    } else if (result.kind === "failed") {
      record.verification = result.reason === "integrity" ? "failed" : record.verification;
      if (result.reason === "integrity") this.notify({ kind: "error", message: `${record.fileName} failed verification.` });
      await this.actIncoming(record, "fail", result.reason);
    }
    this.publish();
  }

  /** Receives a peer's speed test: verified like a real file, then discarded. */
  private receiveSpeedTest(peerId: string, transport: DataChannelTransport, ctl: Extract<Ctl, { t: "file_open" }>): void {
    const busy = [...(this.inSlots.get(peerId)?.values() ?? [])].some((r) => r.isSpeedTest);
    if (ctl.size > MAX_SPEED_TEST_BYTES || busy) {
      transport.sendCtl({ t: "file_close", slot: ctl.slot, role: "receiver", reason: "error" });
      return;
    }
    const receiver = new FileReceiver({
      transport,
      slot: ctl.slot,
      transferId: ctl.transferId,
      size: ctl.size,
      chunkSize: ctl.chunkSize,
      totalChunks: ctl.totalChunks,
      window: this.tuning.window,
      sink: new DiscardSink(),
      digests: new Map(),
      persistDigest: async () => {},
      isSpeedTest: true,
    });
    this.slotsFor(this.inSlots, peerId).set(ctl.slot, receiver);
    this.notify({ kind: "info", message: `Speed test with ${this.options.deviceName(peerId)}…` });
    void receiver.start().finally(() => this.inSlots.get(peerId)?.delete(ctl.slot));
  }

  private async completeIncoming(record: IncomingRecord): Promise<void> {
    // Once per file: a duplicate run (the sender started the finished file again) would
    // assemble it a second time, fail, and wrongly mark it as failed.
    if (record.completing) return;
    record.completing = true;
    record.verification = "verified";
    record.save = "preparing";
    this.publish();
    await this.actIncoming(record, "complete");
    try {
      const file = await record.sink?.finalize();
      record.finalFile = file ?? null;
      if (file) {
        const stored = await this.options.resume.getLeg("receive", record.transferId);
        if (stored) await this.options.resume.saveLeg({ ...stored, finalUri: file.uri, updatedAt: Date.now() });
      }
      record.save = file ? "ready" : "saved";
      this.completions.emit("completion", {
        direction: "incoming",
        batchId: record.batchId,
        localId: record.transferId,
        fileName: record.fileName,
        fileSize: record.view.file.file_size,
        mimeType: record.view.file.mime_type,
        peerId: record.senderId,
        averageSpeed: record.meter.average,
        peakSpeed: record.meter.peak,
        seconds: record.meter.activeSeconds,
      });
    } catch (error) {
      logger.error("transfer", "finalizing file failed", String(error));
      record.save = "none";
      record.verification = "failed";
      this.notify({ kind: "error", message: `Couldn't assemble ${record.fileName}.` });
    }
    this.releaseIncoming(record);
    this.notifyIncomingBatch(record.batchId);
    this.publish();
  }

  private notifyIncomingBatch(batchId: string): void {
    if (this.notifiedBatches.has(batchId)) return;
    const records = [...this.incoming.values()].filter((r) => r.batchId === batchId);
    if (!records.every((r) => isTerminal(r.status) || r.save === "ready" || r.save === "saved")) return;
    this.notifiedBatches.add(batchId);
    const received = records.filter((r) => r.save === "ready" || r.save === "saved").length;
    if (received === 0) return;
    this.notify({
      kind: "success",
      message: received === 1 ? `Received ${records.find((r) => r.save !== "none")?.fileName}` : `${received} files received`,
    });
  }

  private async saveReceiveLeg(record: IncomingRecord): Promise<void> {
    const file = record.view.file;
    const now = Date.now();
    await this.options.resume.saveLeg({
      key: legKey("receive", record.transferId),
      role: "receive",
      transferId: record.transferId,
      roomId: this.options.roomId,
      peerId: record.senderId,
      fileName: record.fileName,
      fileSize: file.file_size,
      mimeType: file.mime_type,
      chunkSize: file.chunk_size,
      totalChunks: file.total_chunks,
      sinkKind: record.sinkKind,
      lastModified: null,
      createdAt: record.createdAt,
      updatedAt: now,
    });
  }

  private scheduleCheckpoint(record: IncomingRecord): void {
    if (record.checkpointTimer) return;
    const wait = Math.max(0, record.lastCheckpointAt + CHECKPOINT_INTERVAL_MS - Date.now());
    record.checkpointTimer = setTimeout(() => {
      record.checkpointTimer = null;
      this.sendCheckpoint(record);
    }, wait);
  }

  private flushCheckpoint(record: IncomingRecord): void {
    if (record.checkpointTimer) clearTimeout(record.checkpointTimer);
    record.checkpointTimer = null;
    this.sendCheckpoint(record);
  }

  private sendCheckpoint(record: IncomingRecord): void {
    if (record.ranges.length === 0 || isTerminal(record.status)) return;
    record.lastCheckpointAt = Date.now();
    this.options.send({
      type: "transfer_checkpoint",
      transfer_id: record.transferId,
      received_ranges: capRanges(record.ranges),
      last_verified_chunk: contiguousPrefixEnd(record.ranges),
    });
  }

  private async cleanupIncoming(record: IncomingRecord): Promise<void> {
    if (record.checkpointTimer) clearTimeout(record.checkpointTimer);
    record.checkpointTimer = null;
    const sink = record.sink;
    record.sink = null;
    record.finalFile = record.save === "saved" ? null : record.finalFile;
    if (sink && sink.kind !== "fs-access") await sink.discard().catch(() => undefined);
    else if (sink && record.status !== "completed") await sink.discard().catch(() => undefined);
    await this.options.resume.deleteLeg("receive", record.transferId);
  }

  private async restoreIncoming(stored: LegRecord, view: TransferView): Promise<void> {
    const leg = view.recipients.find((l) => l.device_id === this.options.selfId);
    if (!leg || this.incoming.has(view.transfer_id)) return;
    const record = this.createIncoming(view);
    record.fileName = stored.fileName;
    record.sinkKind = stored.sinkKind;
    record.digests = await this.options.resume.getDigests("receive", view.transfer_id);
    record.ranges = rangesFromIndexes(record.digests.keys());
    record.verifiedBytes = this.bytesForRanges(record.ranges, view.file.chunk_size, view.file.total_chunks, view.file.file_size);

    if (leg.status === "completed" && stored.sinkKind && stored.sinkKind !== "fs-access") {
      // Received before the restart but not saved yet: the finished file is in Received/.
      const finalFile = stored.finalUri ? existingLocalFile(stored.finalUri, record.fileName) : null;
      if (finalFile) {
        record.finalFile = finalFile;
        record.verification = "verified";
        record.save = "ready";
      } else {
        await this.discardStoredLeg(stored);
        this.incoming.delete(view.transfer_id);
      }
      return;
    }
    if (isTerminal(leg.status)) {
      await this.discardStoredLeg(stored);
      this.incoming.delete(view.transfer_id);
      return;
    }
    if (stored.sinkKind === "fs-access") {
      // Folder access doesn't survive a reload: chunks start over in browser storage.
      record.sinkKind = null;
      record.digests = new Map();
      record.ranges = [];
      record.verifiedBytes = 0;
    }
    this.holdIncoming(record);
  }

  private async discardStoredLeg(stored: LegRecord): Promise<void> {
    if (stored.role === "receive" && stored.sinkKind && stored.sinkKind !== "fs-access") {
      try {
        const sink = await this.options.sinks.create({
          transferId: stored.transferId,
          fileName: stored.fileName,
          size: stored.fileSize,
          totalChunks: stored.totalChunks,
          preferredKind: stored.sinkKind,
        });
        await sink.discard();
      } catch {
        // ignore
      }
    }
    await this.options.resume.deleteLeg(stored.role, stored.transferId);
  }

  // --- transports -----------------------------------------------------------------------------

  private onTransport(peerId: string, transport: DataChannelTransport): void {
    if (this.transportSubs.has(transport)) return;
    this.controllers.set(transport, {
      peerId,
      controller: new AdaptiveController({ ...this.tuning, initialHighWater: transport.currentHighWater }),
    });
    const offs = [
      transport.events.on("ctl", (ctl) => this.routeCtl(peerId, transport, ctl)),
      transport.events.on("frame", (frame) => this.routeFrame(peerId, frame)),
      transport.events.on("close", () => {
        for (const off of this.transportSubs.get(transport) ?? []) off();
        this.transportSubs.delete(transport);
        this.controllers.delete(transport);
      }),
    ];
    this.transportSubs.set(transport, offs);
    this.pumpStarts();
  }

  private onTransportLost(peerId: string): void {
    this.outSlots.delete(peerId);
    this.inSlots.delete(peerId);
    this.publish();
  }

  private onLinkFailed(peerId: string): void {
    for (const record of this.outgoing.values()) {
      const leg = record.legs.get(peerId);
      if (!leg) continue;
      if (SENDABLE.has(leg.status) || (leg.status === "paused" && leg.autoResume)) {
        leg.autoResume = false;
        this.releaseLeg(leg);
        void (async () => {
          // The backend only allows `fail` from connecting/transferring/paused/retrying.
          if (leg.status === "accepted") await this.act(record, leg, "connect");
          await this.act(record, leg, "fail", "no_route");
        })();
      }
    }
    this.notify({
      kind: "error",
      message: `We couldn't establish a connection to ${this.options.deviceName(peerId)}. Try reconnecting.`,
    });
  }

  private routeCtl(peerId: string, transport: DataChannelTransport, ctl: Ctl): void {
    switch (ctl.t) {
      case "file_open":
        void this.onIncomingOpen(peerId, transport, ctl);
        return;
      case "chunk_end":
      case "file_end":
        this.inSlots.get(peerId)?.get(ctl.slot)?.handleCtl(ctl);
        return;
      case "file_ready":
      case "chunk_ack":
      case "chunk_nack":
      case "file_done":
        this.outSlots.get(peerId)?.get(ctl.slot)?.handleCtl(ctl);
        return;
      case "file_close":
        // `role` is the side that closed, so it addresses the other side's slot table.
        if (ctl.role === "sender") this.inSlots.get(peerId)?.get(ctl.slot)?.handleCtl(ctl);
        else this.outSlots.get(peerId)?.get(ctl.slot)?.handleCtl(ctl);
        return;
      default:
        return;
    }
  }

  private routeFrame(peerId: string, frame: Frame): void {
    this.inSlots.get(peerId)?.get(frame.slot)?.handleFrame(frame);
  }

  private allocateSlot(peerId: string): number {
    const used = this.outSlots.get(peerId);
    let slot = this.nextSlot.get(peerId) ?? 1;
    for (let i = 0; i < MAX_SLOT; i += 1) {
      if (!used?.has(slot)) break;
      slot = (slot % MAX_SLOT) + 1;
    }
    this.nextSlot.set(peerId, (slot % MAX_SLOT) + 1);
    return slot;
  }

  private slotsFor<T>(table: Map<string, Map<number, T>>, peerId: string): Map<number, T> {
    let map = table.get(peerId);
    if (!map) {
      map = new Map();
      table.set(peerId, map);
    }
    return map;
  }

  // --- helpers ---------------------------------------------------------------------------------

  private slowestThroughput(peerIds: readonly string[]): number | null {
    const known = peerIds.map((id) => this.peerThroughput.get(id)).filter((v): v is number => v !== undefined);
    return known.length ? Math.min(...known) : null;
  }

  private bytesForRanges(ranges: readonly ChunkRange[], chunkSize: number, total: number, size: number): number {
    let bytes = 0;
    for (const [a, b] of ranges) {
      for (let i = a; i <= b && i < total; i += 1) bytes += Math.min(chunkSize, size - i * chunkSize);
    }
    return Math.max(0, Math.min(size, bytes));
  }

  private notify(notice: Notice): void {
    this.notices.emit("notice", notice);
  }

  private publish(): void {
    this.dirty = false;
    const items: TransferSnapshot[] = [];
    for (const record of this.outgoing.values()) {
      items.push({
        localId: record.localId,
        transferId: record.transferId,
        direction: "outgoing",
        batchId: record.batchId,
        peerIds: [...record.legs.keys()],
        fileName: record.fileName,
        fileSize: record.fileSize,
        mimeType: record.mimeType,
        createdAt: record.createdAt,
        legs: [...record.legs.values()].map((leg) => ({
          deviceId: leg.deviceId,
          status: leg.status,
          verifiedBytes: leg.verifiedBytes,
          speed: leg.meter.current,
          averageSpeed: leg.meter.average,
          etaSeconds: leg.meter.eta(record.fileSize),
          failureReason: leg.failureReason,
          autoResume: leg.autoResume,
          peakSpeed: leg.meter.peak,
          speedHistory: leg.meter.history,
          activeSeconds: leg.meter.activeSeconds,
        })),
        verification: "pending",
        save: "none",
        needsReselect: record.source === null && [...record.legs.values()].some((l) => !isTerminal(l.status)),
        error: record.error,
        relativePath: record.relativePath,
        reactions: record.reactions,
        canResend: record.file !== null,
      });
    }
    for (const record of this.incoming.values()) {
      if (record.dismissed) continue;
      const file = record.view.file;
      items.push({
        localId: record.transferId,
        transferId: record.transferId,
        direction: "incoming",
        batchId: record.batchId,
        peerIds: [record.senderId],
        fileName: record.fileName,
        fileSize: file.file_size,
        mimeType: file.mime_type,
        createdAt: record.createdAt,
        legs: [
          {
            deviceId: this.options.selfId,
            status: record.status,
            verifiedBytes: record.status === "completed" ? file.file_size : record.verifiedBytes,
            speed: record.meter.current,
            averageSpeed: record.meter.average,
            etaSeconds: record.meter.eta(file.file_size),
            failureReason: record.failureReason,
            autoResume: false,
            peakSpeed: record.meter.peak,
            speedHistory: record.meter.history,
            activeSeconds: record.meter.activeSeconds,
          },
        ],
        verification: record.verification,
        save: record.save,
        needsReselect: false,
        error: null,
        relativePath: record.relativePath,
        reactions: record.reaction ? [record.reaction] : [],
        canResend: false,
      });
    }
    items.sort((a, b) => b.createdAt - a.createdAt);
    this.store.set({
      items,
      requests: [...this.requests.values()].map((r) => ({ ...r, transferIds: [...r.transferIds] })),
      trustedSenders: [...this.trusted],
    });
  }
}

function statusOf(leg: { status: LegStatus }): LegStatus {
  return leg.status;
}

function newest(a: TransferView, b: TransferView): TransferView {
  const latest = (v: TransferView) => Math.max(...v.recipients.map((l) => Date.parse(l.updated_at) || 0));
  return latest(b) > latest(a) ? b : a;
}
