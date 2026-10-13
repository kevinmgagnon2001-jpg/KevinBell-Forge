/**
 * A guest program's files (work item N7): a private, in-memory tree the host hands over, plus the
 * table of open descriptors. Only paths in the tree exist; there is no way to name anything outside
 * it. The Linux shim (linux.ts) maps open/read/write/lseek/fstat/unlink onto this, and the Rust shim
 * (src-tauri/src/guest.rs, GuestFiles) does the same; keep the two in step.
 *
 * Results are Linux return values: a count or descriptor, or a negative errno.
 */

export const O_ACCMODE = 3;
export const O_WRONLY = 1;
export const O_RDWR = 2;
export const O_CREAT = 0x40;
export const O_EXCL = 0x80;
export const O_TRUNC = 0x200;
export const O_APPEND = 0x400;

const EBADF = -9n;
const ENOENT = -2n;
const EEXIST = -17n;
const EISDIR = -21n;
const EINVAL = -22n;
const EMFILE = -24n;
const ENOSPC = -28n;

/** Largest total size of a tree, and most descriptors open at once. */
export const MAX_TREE_BYTES = 64 * 1024 * 1024;
export const MAX_OPEN = 256;
export const MAX_FILES = 4096;

/** "/a/./b/../c" and "a//c" both become "/a/c". ".." never climbs above the root. */
export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return "/" + parts.join("/");
}

class Node {
  buf: Uint8Array;
  size: number;
  constructor(data: Uint8Array) {
    this.buf = data.slice();
    this.size = data.length;
  }
  bytes(): Uint8Array {
    return this.buf.slice(0, this.size);
  }
  /** Make room for `end` bytes, zero-filling any hole. */
  grow(end: number) {
    if (end > this.buf.length) {
      const next = new Uint8Array(Math.max(end, this.buf.length * 2, 64));
      next.set(this.buf.subarray(0, this.size));
      this.buf = next;
    }
    if (end > this.size) {
      this.buf.fill(0, this.size, end);
      this.size = end;
    }
  }
}

type Open = { node: Node; pos: number; read: boolean; write: boolean; append: boolean };

export type Stat = { dir: boolean; size: number };

export class GuestFiles {
  private tree = new Map<string, Node>();
  private fds = new Map<number, Open>();
  private total = 0;

  constructor(files: Record<string, Uint8Array | string> = {}) {
    const enc = new TextEncoder();
    for (const [path, data] of Object.entries(files)) {
      const node = new Node(typeof data === "string" ? enc.encode(data) : data);
      const key = normalizePath(path);
      if (key === "/") continue;
      this.total += node.size - (this.tree.get(key)?.size ?? 0);
      this.tree.set(key, node);
    }
  }

  /** A path is a directory when it is the root or some file lives under it. */
  private isDir(path: string): boolean {
    if (path === "/") return true;
    const prefix = path + "/";
    for (const key of this.tree.keys()) if (key.startsWith(prefix)) return true;
    return false;
  }

  private lowestFreeFd(): number {
    for (let fd = 3; fd < 3 + MAX_OPEN; fd += 1) if (!this.fds.has(fd)) return fd;
    return -1;
  }

  open(rawPath: string, flags: number): bigint {
    const path = normalizePath(rawPath);
    if (this.isDir(path)) return EISDIR;
    const acc = flags & O_ACCMODE;
    if (acc === O_ACCMODE) return EINVAL;
    let node = this.tree.get(path);
    if (node && flags & O_CREAT && flags & O_EXCL) return EEXIST;
    if (!node) {
      if (!(flags & O_CREAT)) return ENOENT;
      if (this.tree.size >= MAX_FILES) return ENOSPC;
      node = new Node(new Uint8Array());
      this.tree.set(path, node);
    }
    const write = acc === O_WRONLY || acc === O_RDWR;
    const fd = this.lowestFreeFd();
    if (fd < 0) return EMFILE;
    if (flags & O_TRUNC && write) {
      this.total -= node.size;
      node.size = 0;
    }
    this.fds.set(fd, { node, pos: 0, read: acc !== O_WRONLY, write, append: Boolean(flags & O_APPEND) });
    return BigInt(fd);
  }

  has(fd: number): boolean {
    return this.fds.has(fd);
  }

  close(fd: number): bigint {
    return this.fds.delete(fd) ? 0n : EBADF;
  }

  read(fd: number, max: number): Uint8Array | bigint {
    const f = this.fds.get(fd);
    if (!f || !f.read) return EBADF;
    const n = Math.max(0, Math.min(max, f.node.size - f.pos));
    const out = f.node.buf.slice(f.pos, f.pos + n);
    f.pos += n;
    return out;
  }

  write(fd: number, data: Uint8Array): bigint {
    const f = this.fds.get(fd);
    if (!f || !f.write) return EBADF;
    if (f.append) f.pos = f.node.size;
    const end = f.pos + data.length;
    const added = Math.max(0, end - f.node.size);
    if (this.total + added > MAX_TREE_BYTES) return ENOSPC;
    f.node.grow(end);
    this.total += added;
    f.node.buf.set(data, f.pos);
    f.pos = end;
    return BigInt(data.length);
  }

  lseek(fd: number, offset: bigint, whence: number): bigint {
    const f = this.fds.get(fd);
    if (!f) return EBADF;
    const base = whence === 0 ? 0n : whence === 1 ? BigInt(f.pos) : whence === 2 ? BigInt(f.node.size) : null;
    if (base === null) return EINVAL;
    const at = base + offset;
    if (at < 0n || at > BigInt(MAX_TREE_BYTES)) return EINVAL;
    f.pos = Number(at);
    return at;
  }

  statFd(fd: number): Stat | bigint {
    const f = this.fds.get(fd);
    return f ? { dir: false, size: f.node.size } : EBADF;
  }

  statPath(rawPath: string): Stat | bigint {
    const path = normalizePath(rawPath);
    const node = this.tree.get(path);
    if (node) return { dir: false, size: node.size };
    return this.isDir(path) ? { dir: true, size: 4096 } : ENOENT;
  }

  unlink(rawPath: string): bigint {
    const path = normalizePath(rawPath);
    const node = this.tree.get(path);
    if (!node) return this.isDir(path) ? EISDIR : ENOENT;
    // Like Linux, descriptors already open keep the file's contents; it just leaves the tree.
    this.tree.delete(path);
    this.total -= node.size;
    return 0n;
  }

  /** The tree as it stands, path -> contents, sorted by path. */
  snapshot(): Record<string, Uint8Array> {
    const out: Record<string, Uint8Array> = {};
    for (const key of [...this.tree.keys()].sort()) out[key] = this.tree.get(key)!.bytes();
    return out;
  }
}
