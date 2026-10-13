/**
 * Where downloaded model weights are kept. wllama stores them in the Origin Private File System,
 * which some WebViews do not offer (the Linux desktop app's WebKitGTK serves the page from tauri://
 * and has no navigator.storage.getDirectory). There wllama refused to start at all ("No supported
 * storage backend found"). This keeps wllama's own storage where it exists and otherwise holds the
 * weights in memory for the session, so the model works and is downloaded again on the next launch.
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
    shared = new CacheManager([new MemoryBackend() as never]);
  }
  return shared as T;
}
