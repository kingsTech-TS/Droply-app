// In-memory stand-ins for the native modules the services use, so the ported website tests
// run in Node. They are NOT proof of real native behaviour (see implement.md §10).
import { createHash, randomFillSync } from "node:crypto";

// --- expo-file-system ----------------------------------------------------------------------

export const memFs = new Map<string, Uint8Array>();
const dirs = new Set<string>(["file:///cache", "file:///document"]);

type Part = string | { uri: string };
const join = (parts: Part[]): string =>
  parts
    .map((p) => (typeof p === "string" ? p : p.uri))
    .reduce((acc, part) => (acc ? `${acc.replace(/\/+$/, "")}/${part.replace(/^\/+/, "")}` : part), "");

export class MockHandle {
  offset: number | null = 0;
  constructor(private readonly uri: string) {}
  get size(): number | null {
    return memFs.get(this.uri)?.byteLength ?? 0;
  }
  async readBytes(length: number): Promise<Uint8Array> {
    const data = memFs.get(this.uri) ?? new Uint8Array(0);
    const start = this.offset ?? 0;
    const out = data.slice(start, Math.min(data.byteLength, start + length));
    this.offset = start + out.byteLength;
    return out;
  }
  async writeBytes(bytes: Uint8Array): Promise<void> {
    const data = memFs.get(this.uri) ?? new Uint8Array(0);
    const start = this.offset ?? data.byteLength;
    const end = start + bytes.byteLength;
    const next = end > data.byteLength ? new Uint8Array(end) : data;
    if (next !== data) next.set(data);
    next.set(bytes, start);
    memFs.set(this.uri, next);
    this.offset = end;
  }
  close(): void {}
}

export class MockFile {
  readonly uri: string;
  type = "application/octet-stream";
  modificationTime = 1_700_000_000_000;
  lastModified = 1_700_000_000_000;
  constructor(...parts: Part[]) {
    this.uri = join(parts);
  }
  get name(): string {
    return this.uri.split("/").pop() ?? "";
  }
  get exists(): boolean {
    return memFs.has(this.uri);
  }
  get size(): number {
    return memFs.get(this.uri)?.byteLength ?? 0;
  }
  create(): void {
    if (!memFs.has(this.uri)) memFs.set(this.uri, new Uint8Array(0));
  }
  delete(): void {
    memFs.delete(this.uri);
  }
  move(destination: MockFile): void {
    const data = memFs.get(this.uri);
    if (!data) throw new Error(`no such file ${this.uri}`);
    memFs.set(destination.uri, data);
    memFs.delete(this.uri);
    (this as { uri: string }).uri = destination.uri;
  }
  async copy(destination: MockFile): Promise<void> {
    memFs.set(destination.uri, (memFs.get(this.uri) ?? new Uint8Array(0)).slice());
  }
  open(): MockHandle {
    this.create();
    return new MockHandle(this.uri);
  }
  write(content: Uint8Array): void {
    memFs.set(this.uri, content.slice());
  }
}

export class MockDirectory {
  readonly uri: string;
  constructor(...parts: Part[]) {
    this.uri = join(parts);
  }
  get name(): string {
    return this.uri.split("/").pop() ?? "";
  }
  get exists(): boolean {
    return dirs.has(this.uri);
  }
  get size(): number {
    return [...memFs.entries()].filter(([k]) => k.startsWith(`${this.uri}/`)).reduce((s, [, v]) => s + v.byteLength, 0);
  }
  create(): void {
    dirs.add(this.uri);
  }
  delete(): void {
    dirs.delete(this.uri);
    for (const key of [...memFs.keys()]) if (key.startsWith(`${this.uri}/`)) memFs.delete(key);
  }
  list(): Array<MockFile | MockDirectory> {
    const prefix = `${this.uri}/`;
    const out: Array<MockFile | MockDirectory> = [];
    for (const key of memFs.keys()) {
      if (key.startsWith(prefix) && !key.slice(prefix.length).includes("/")) out.push(new MockFile(key));
    }
    for (const dir of dirs) {
      if (dir.startsWith(prefix) && !dir.slice(prefix.length).includes("/")) out.push(new MockDirectory(dir));
    }
    return out;
  }
  createDirectory(name: string): MockDirectory {
    const dir = new MockDirectory(this, name);
    dir.create();
    return dir;
  }
  createFile(name: string): MockFile {
    const file = new MockFile(this, name);
    file.create();
    return file;
  }
  static async pickDirectoryAsync(): Promise<MockDirectory> {
    throw new Error("not available in tests");
  }
}

export const fileSystemMock = {
  File: MockFile,
  Directory: MockDirectory,
  Paths: {
    cache: new MockDirectory("file:///cache"),
    document: new MockDirectory("file:///document"),
    availableDiskSpace: 64 * 1024 ** 3,
    totalDiskSpace: 128 * 1024 ** 3,
  },
  FileMode: { ReadOnly: "r", WriteOnly: "w", ReadWrite: "rw", Append: "wa", Truncate: "wt" },
};

/** Puts bytes in the mock file system and returns a LocalFile-shaped object. */
export function memFile(name: string, bytes: Uint8Array, options: { type?: string; lastModified?: number; relativePath?: string | null } = {}) {
  const uri = `file:///picked/${Math.random().toString(36).slice(2)}/${name}`;
  memFs.set(uri, bytes);
  return {
    uri,
    name,
    size: bytes.byteLength,
    type: options.type ?? "application/octet-stream",
    lastModified: options.lastModified ?? 1_700_000_000_000,
    relativePath: options.relativePath ?? null,
  };
}

export function readMem(uri: string): Uint8Array {
  return memFs.get(uri) ?? new Uint8Array(0);
}

// --- expo-crypto ---------------------------------------------------------------------------

export const cryptoMock = {
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  async digest(_algorithm: string, data: ArrayBufferView): Promise<ArrayBuffer> {
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const hash = createHash("sha256").update(view).digest();
    return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
  },
  getRandomValues<T extends ArrayBufferView>(array: T): T {
    randomFillSync(array as unknown as Uint8Array);
    return array;
  },
};

// --- key-value stores ------------------------------------------------------------------------

export const kvData = new Map<string, string>();
export const kvMock = {
  __esModule: true,
  default: {
    getItemSync: (k: string) => kvData.get(k) ?? null,
    setItemSync: (k: string, v: string) => void kvData.set(k, v),
    removeItemSync: (k: string) => kvData.delete(k),
    getAllKeysSync: () => [...kvData.keys()],
  },
};

export const secureData = new Map<string, string>();
export const secureStoreMock = {
  getItem: (k: string) => secureData.get(k) ?? null,
  setItem: (k: string, v: string) => void secureData.set(k, v),
  deleteItemAsync: async (k: string) => void secureData.delete(k),
};
