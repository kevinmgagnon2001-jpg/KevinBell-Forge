/**
 * Where downloaded model weights are kept. wllama stores them in the Origin Private File System,
 * which some WebViews do not offer (the Linux desktop app's WebKitGTK serves the page from tauri://
 * and has no navigator.storage.getDirectory). There wllama refused to start at all ("No supported
 * storage backend found"). This keeps wllama's own storage where it exists. Otherwise, inside the
 * desktop app, the weights go to files in the app's data directory through the model_store_*
 * commands (src-tauri/src/model_store.rs), so they survive a restart; anywhere else they are held
 * in memory for the session.
 */

/** The shape of a wllama storage backend (StorageBackend in @wllama/wllama/esm/storage). */
type Backend = {
  isSupported(): boolean;
  read(key: string): Promise<Blob | null>;
  write(key: string, stream: ReadableStream<Uint8Array>): Promise<void>;
  getSize(key: string): Promise<number>;
  list(): Promise<Array<{ key: string; size: number }>>;
  delete(key: string): Promise<void>;
};

export class MemoryBackend implements Backend {
  private files = new Map<string, Blob>();
  isSupported() {
    return true;
  }
  async read(key: string) {
    return this.files.get(key) ?? null;
  }
  async write(key: string, stream: ReadableStream<Uint8Array>) {
    const parts: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    this.files.set(key, new Blob(parts as BlobPart[]));
  }
  async getSize(key: string) {
    return this.files.get(key)?.size ?? -1;
  }
  async list() {
    return [...this.files].map(([key, blob]) => ({ key, size: blob.size }));
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}

type Invoke = (cmd: string, args?: Record<string, unknown> | Uint8Array, options?: { headers?: Record<string, string> }) => Promise<unknown>;

/** Bytes per write sent to the desktop host, and per read asked of it. */
const WRITE_PIECE = 8 * 1024 * 1024;
const READ_PIECE = 32 * 1024 * 1024;

const hex = (text: string) => Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("");

/** Model files on disk in the desktop app, through the host's model_store_* commands. */
export class DesktopBackend implements Backend {
  private invoke: Invoke;
  constructor(invoke: Invoke) {
    this.invoke = invoke;
  }
  isSupported() {
    return true;
  }
  async read(key: string) {
    const size = await this.getSize(key);
    if (size < 0) return null;
    const parts: ArrayBuffer[] = [];
    for (let offset = 0; offset < size; ) {
      const got = (await this.invoke("model_store_read", { key, offset, len: READ_PIECE })) as ArrayBuffer | number[];
      const piece = got instanceof ArrayBuffer ? got : Uint8Array.from(got).buffer;
      if (!piece.byteLength) break;
      parts.push(piece);
      offset += piece.byteLength;
    }
    return new Blob(parts);
  }
  async write(key: string, stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    let offset = 0;
    let buf = new Uint8Array(WRITE_PIECE);
    let used = 0;
    const flush = async () => {
      if (!used && offset) return;
      await this.invoke("model_store_write", buf.slice(0, used), { headers: { "forge-key": hex(key), "forge-offset": String(offset) } });
      offset += used;
      used = 0;
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (let at = 0; at < value.length; ) {
        const n = Math.min(value.length - at, buf.length - used);
        buf.set(value.subarray(at, at + n), used);
        used += n;
        at += n;
        if (used === buf.length) {
          await flush();
          buf = new Uint8Array(WRITE_PIECE);
        }
      }
    }
    await flush();
    await this.invoke("model_store_commit", { key });
  }
  async getSize(key: string) {
    return (await this.invoke("model_store_size", { key })) as number;
  }
  async list() {
    const rows = (await this.invoke("model_store_list")) as [string, number][];
    return rows.map(([key, size]) => ({ key, size }));
  }
  async delete(key: string) {
    await this.invoke("model_store_delete", { key });
  }
}

function desktopInvoke(): Invoke | null {
  const internals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__;
  return internals && typeof internals.invoke === "function" ? internals.invoke.bind(internals) : null;
}

let shared: unknown = null;

/**
 * One cache manager for every model in the page (the resident and the critic share downloads).
 * Pass wllama's CacheManager class; it is loaded lazily with the rest of wllama.
 */
export function modelCacheManager<T>(CacheManager: new (backends?: never[]) => T): T {
  if (shared) return shared as T;
  try {
    shared = new CacheManager();
  } catch {
    const invoke = desktopInvoke();
    shared = new CacheManager([(invoke ? new DesktopBackend(invoke) : new MemoryBackend()) as never]);
  }
  return shared as T;
}
