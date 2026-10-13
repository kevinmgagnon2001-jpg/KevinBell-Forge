/**
 * A guest program's files (work item N7): a private, in-memory tree the host hands over, the standard
 * streams, pipes, and the table of open descriptors. Only paths in the tree exist; there is no way to
 * name anything outside it. The Linux shim (linux.ts) maps the file system calls onto this, and the
 * Rust shim (src-tauri/src/guest.rs, GuestFiles) does the same; keep the two in step.
 *
 * Descriptors point at shared open files, as on Linux: dup'd descriptors share one offset and one set
 * of status flags, and close-on-exec belongs to the descriptor. Directories exist when the host's tree
 * puts a file under them or the program makes them. A program has one thread, so an operation that
 * would wait forever on Linux (reading an empty pipe whose write end is still open, writing to a full
 * one) answers -EAGAIN instead.
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
/** The x86-64 value. The shim translates AArch64's (0x4000) to this. */
export const O_DIRECTORY = 0x10000;
export const O_CLOEXEC = 0x80000;
export const AT_FDCWD = -100;
export const AT_REMOVEDIR = 0x200;

const ENOENT = -2n;
const EBADF = -9n;
const EAGAIN = -11n;
const EBUSY = -16n;
const EEXIST = -17n;
const ENOTDIR = -20n;
const EISDIR = -21n;
const EINVAL = -22n;
const EMFILE = -24n;
const ENOSPC = -28n;
const ESPIPE = -29n;
const EPIPE = -32n;
const ENOTEMPTY = -39n;

/** Largest total size of a tree, most descriptors open at once (besides the three standard ones), and the highest descriptor number + 1. */
export const MAX_TREE_BYTES = 64 * 1024 * 1024;
export const MAX_OPEN = 256;
export const MAX_FILES = 4096;
export const FD_LIMIT = 1024;
export const PIPE_BYTES = 65536;

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

const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";

/** Bytes written to stdout or stderr, kept up to 64 MiB. */
export class ByteSink {
  private parts: Uint8Array[] = [];
  private size = 0;
  push(data: Uint8Array) {
    if (this.size > 64 * 1024 * 1024) return;
    this.parts.push(data);
    this.size += data.length;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.size);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
  /** The bytes so far, leaving the sink empty (the desktop host hands output over in pieces). */
  take(): Uint8Array {
    const out = this.bytes();
    this.parts = [];
    this.size = 0;
    return out;
  }
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

class Pipe {
  data = new Uint8Array(PIPE_BYTES);
  size = 0;
}

/** An open file description: what dup'd descriptors share. */
type Desc =
  | { kind: "file"; node: Node; pos: number; read: boolean; write: boolean; append: boolean }
  | { kind: "dir"; path: string; pos: number }
  | { kind: "pipe"; pipe: Pipe; write: boolean }
  | { kind: "stream"; stream: 0 | 1 | 2 };

type Slot = { desc: Desc; cloexec: boolean };

export type Stat = { kind: "file" | "dir" | "fifo"; size: number };

export class GuestFiles {
  private tree = new Map<string, Node>();
  /** Every directory, root included: the ones the host's files sit in and the ones the program made. */
  private dirs = new Set<string>(["/"]);
  private fds = new Map<number, Slot>();
  private total = 0;
  private stdin: Uint8Array;
  private stdinAt = 0;
  readonly stdout = new ByteSink();
  readonly stderr = new ByteSink();

  /** Paths ending in "/" are empty directories. */
  constructor(files: Record<string, Uint8Array | string> = {}, stdin?: Uint8Array | string) {
    const enc = new TextEncoder();
    this.stdin = typeof stdin === "string" ? enc.encode(stdin) : stdin ?? new Uint8Array();
    for (const [path, data] of Object.entries(files)) {
      const key = normalizePath(path);
      if (key === "/") continue;
      if (path.endsWith("/")) {
        if (!this.tree.has(key)) this.addDir(key);
        continue;
      }
      if (this.dirs.has(key)) continue;
      const node = new Node(typeof data === "string" ? enc.encode(data) : data);
      this.addDir(parentOf(key));
      this.total += node.size - (this.tree.get(key)?.size ?? 0);
      this.tree.set(key, node);
    }
    for (const stream of [0, 1, 2] as const) this.fds.set(stream, { desc: { kind: "stream", stream }, cloexec: false });
  }

  /** Adds a directory and its parents, dropping any file in the way (host trees only). */
  private addDir(path: string) {
    for (let p = path; p !== "/" && !this.dirs.has(p); p = parentOf(p)) {
      const file = this.tree.get(p);
      if (file) {
        this.total -= file.size;
        this.tree.delete(p);
      }
      this.dirs.add(p);
    }
  }

  /**
   * Resolves a path the way Linux walks one: relative paths start at the directory descriptor (or the
   * working directory, "/"), every component before the last must be a directory, and ".." stops at
   * the root. Returns the absolute path, which may not exist yet.
   */
  private walk(dirfd: number, raw: string): string | bigint {
    let base = "/";
    if (!raw.startsWith("/") && dirfd !== AT_FDCWD) {
      const slot = this.fds.get(dirfd);
      if (!slot) return EBADF;
      if (slot.desc.kind !== "dir") return ENOTDIR;
      base = slot.desc.path;
    }
    const parts = raw.split("/").filter((p) => p && p !== ".");
    const stack = base === "/" ? [] : base.slice(1).split("/");
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i] === "..") stack.pop();
      else stack.push(parts[i]);
      if (i === parts.length - 1) break;
      const at = "/" + stack.join("/");
      if (this.tree.has(at)) return ENOTDIR;
      if (!this.dirs.has(at)) return ENOENT;
    }
    return "/" + stack.join("/");
  }

  private openCount(): number {
    return this.fds.size;
  }

  private lowestFreeFd(min = 0): number {
    if (this.openCount() >= MAX_OPEN + 3) return -1;
    for (let fd = min; fd < FD_LIMIT; fd += 1) if (!this.fds.has(fd)) return fd;
    return -1;
  }

  private install(desc: Desc, cloexec: boolean, min = 0): bigint {
    const fd = this.lowestFreeFd(min);
    if (fd < 0) return EMFILE;
    this.fds.set(fd, { desc, cloexec });
    return BigInt(fd);
  }

  /** Is any descriptor open on this end of the pipe? */
  private pipeEndOpen(pipe: Pipe, write: boolean): boolean {
    for (const { desc } of this.fds.values()) if (desc.kind === "pipe" && desc.pipe === pipe && desc.write === write) return true;
    return false;
  }

  open(path: string, flags: number): bigint {
    return this.openAt(AT_FDCWD, path, flags);
  }

  openAt(dirfd: number, raw: string, flags: number): bigint {
    const path = this.walk(dirfd, raw);
    if (typeof path !== "string") return path;
    const acc = flags & O_ACCMODE;
    if (acc === O_ACCMODE) return EINVAL;
    const write = acc === O_WRONLY || acc === O_RDWR;
    const cloexec = Boolean(flags & O_CLOEXEC);
    if (this.dirs.has(path)) {
      if (flags & O_CREAT && flags & O_EXCL) return EEXIST;
      if (write || flags & O_CREAT) return EISDIR;
      return this.install({ kind: "dir", path, pos: 0 }, cloexec);
    }
    let node = this.tree.get(path);
    if (flags & O_DIRECTORY) return node ? ENOTDIR : ENOENT;
    if (node && flags & O_CREAT && flags & O_EXCL) return EEXIST;
    if (!node) {
      if (!(flags & O_CREAT)) return ENOENT;
      if (this.tree.size + this.dirs.size >= MAX_FILES) return ENOSPC;
      if (this.lowestFreeFd() < 0) return EMFILE;
      node = new Node(new Uint8Array());
      this.tree.set(path, node);
    }
    const fd = this.install({ kind: "file", node, pos: 0, read: acc !== O_WRONLY, write, append: Boolean(flags & O_APPEND) }, cloexec);
    if (fd >= 0n && flags & O_TRUNC && write) {
      this.total -= node.size;
      node.size = 0;
    }
    return fd;
  }

  has(fd: number): boolean {
    return this.fds.has(fd);
  }

  close(fd: number): bigint {
    return this.fds.delete(fd) ? 0n : EBADF;
  }

  read(fd: number, max: number): Uint8Array | bigint {
    const desc = this.fds.get(fd)?.desc;
    if (!desc) return EBADF;
    switch (desc.kind) {
      case "stream": {
        if (desc.stream !== 0) return EBADF;
        const n = Math.max(0, Math.min(max, this.stdin.length - this.stdinAt));
        const out = this.stdin.slice(this.stdinAt, this.stdinAt + n);
        this.stdinAt += n;
        return out;
      }
      case "dir":
        return EISDIR;
      case "pipe": {
        if (desc.write) return EBADF;
        const p = desc.pipe;
        if (!p.size) return this.pipeEndOpen(p, true) && max > 0 ? EAGAIN : new Uint8Array();
        const n = Math.min(max, p.size);
        const out = p.data.slice(0, n);
        p.data.copyWithin(0, n, p.size);
        p.size -= n;
        return out;
      }
      case "file": {
        if (!desc.read) return EBADF;
        const n = Math.max(0, Math.min(max, desc.node.size - desc.pos));
        const out = desc.node.buf.slice(desc.pos, desc.pos + n);
        desc.pos += n;
        return out;
      }
    }
  }

  write(fd: number, data: Uint8Array): bigint {
    const desc = this.fds.get(fd)?.desc;
    if (!desc) return EBADF;
    switch (desc.kind) {
      case "stream":
        if (desc.stream === 0) return EBADF;
        (desc.stream === 1 ? this.stdout : this.stderr).push(data);
        return BigInt(data.length);
      case "dir":
        return EBADF;
      case "pipe": {
        if (!desc.write) return EBADF;
        const p = desc.pipe;
        if (!this.pipeEndOpen(p, false)) return EPIPE;
        if (!data.length) return 0n;
        const n = Math.min(data.length, PIPE_BYTES - p.size);
        if (!n) return EAGAIN;
        p.data.set(data.subarray(0, n), p.size);
        p.size += n;
        return BigInt(n);
      }
      case "file": {
        if (!desc.write) return EBADF;
        if (desc.append) desc.pos = desc.node.size;
        const end = desc.pos + data.length;
        const added = Math.max(0, end - desc.node.size);
        if (this.total + added > MAX_TREE_BYTES) return ENOSPC;
        desc.node.grow(end);
        this.total += added;
        desc.node.buf.set(data, desc.pos);
        desc.pos = end;
        return BigInt(data.length);
      }
    }
  }

  lseek(fd: number, offset: bigint, whence: number): bigint {
    const desc = this.fds.get(fd)?.desc;
    if (!desc) return EBADF;
    if (desc.kind === "pipe" || desc.kind === "stream") return ESPIPE;
    const size = desc.kind === "file" ? desc.node.size : 0;
    const base = whence === 0 ? 0n : whence === 1 ? BigInt(desc.pos) : whence === 2 && desc.kind === "file" ? BigInt(size) : null;
    if (base === null) return EINVAL;
    const at = base + offset;
    if (at < 0n || at > BigInt(MAX_TREE_BYTES)) return EINVAL;
    desc.pos = Number(at);
    return at;
  }

  /** The standard streams have no file behind them here (-ENOENT); libc then falls back to its defaults. */
  statFd(fd: number): Stat | bigint {
    const desc = this.fds.get(fd)?.desc;
    if (!desc) return EBADF;
    switch (desc.kind) {
      case "stream":
        return ENOENT;
      case "dir":
        return { kind: "dir", size: 4096 };
      case "pipe":
        return { kind: "fifo", size: 0 };
      case "file":
        return { kind: "file", size: desc.node.size };
    }
  }

  statPath(path: string): Stat | bigint {
    return this.statAt(AT_FDCWD, path);
  }

  statAt(dirfd: number, raw: string): Stat | bigint {
    const path = this.walk(dirfd, raw);
    if (typeof path !== "string") return path;
    const node = this.tree.get(path);
    if (node) return { kind: "file", size: node.size };
    return this.dirs.has(path) ? { kind: "dir", size: 4096 } : ENOENT;
  }

  mkdirAt(dirfd: number, raw: string): bigint {
    const path = this.walk(dirfd, raw);
    if (typeof path !== "string") return path;
    if (this.dirs.has(path) || this.tree.has(path)) return EEXIST;
    if (this.tree.size + this.dirs.size >= MAX_FILES) return ENOSPC;
    this.dirs.add(path);
    return 0n;
  }

  unlink(path: string): bigint {
    return this.unlinkAt(AT_FDCWD, path, 0);
  }

  /** unlink, or rmdir with AT_REMOVEDIR. */
  unlinkAt(dirfd: number, raw: string, flags: number): bigint {
    const path = this.walk(dirfd, raw);
    if (typeof path !== "string") return path;
    const node = this.tree.get(path);
    if (flags & AT_REMOVEDIR) {
      if (path === "/") return EBUSY;
      if (node) return ENOTDIR;
      if (!this.dirs.has(path)) return ENOENT;
      const prefix = path + "/";
      for (const key of this.tree.keys()) if (key.startsWith(prefix)) return ENOTEMPTY;
      for (const key of this.dirs) if (key.startsWith(prefix)) return ENOTEMPTY;
      this.dirs.delete(path);
      return 0n;
    }
    if (!node) return this.dirs.has(path) ? EISDIR : ENOENT;
    // Like Linux, descriptors already open keep the file's contents; it just leaves the tree.
    this.tree.delete(path);
    this.total -= node.size;
    return 0n;
  }

  /** ".", "..", then the directory's entries by name: [name, is a directory]. */
  private entries(path: string): [string, boolean][] {
    if (!this.dirs.has(path)) return []; // removed while open: Linux lists nothing
    const prefix = path === "/" ? "/" : path + "/";
    const out: [string, boolean][] = [];
    const direct = (key: string) => key.startsWith(prefix) && key.length > prefix.length && !key.slice(prefix.length).includes("/");
    for (const key of this.tree.keys()) if (direct(key)) out.push([key.slice(prefix.length), false]);
    for (const key of this.dirs) if (direct(key)) out.push([key.slice(prefix.length), true]);
    out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return [[".", true], ["..", true], ...out];
  }

  /** getdents64: as many struct linux_dirent64 records as fit in `max` bytes. */
  getdents(fd: number, max: number): Uint8Array | bigint {
    const desc = this.fds.get(fd)?.desc;
    if (!desc) return EBADF;
    if (desc.kind !== "dir") return ENOTDIR;
    const list = this.entries(desc.path);
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [];
    let used = 0;
    while (desc.pos < list.length) {
      const [name, dir] = list[desc.pos];
      const bytes = enc.encode(name);
      const reclen = (19 + bytes.length + 1 + 7) & ~7;
      if (used + reclen > max) {
        if (!used) return EINVAL;
        break;
      }
      const rec = new Uint8Array(reclen);
      const v = new DataView(rec.buffer);
      v.setBigUint64(0, BigInt(desc.pos + 1000), true); // d_ino: stable per position, never 0
      v.setBigInt64(8, BigInt(desc.pos + 1), true); // d_off: where the next call resumes
      v.setUint16(16, reclen, true);
      rec[18] = dir ? 4 : 8; // DT_DIR, DT_REG
      rec.set(bytes, 19);
      parts.push(rec);
      used += reclen;
      desc.pos += 1;
    }
    const out = new Uint8Array(used);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  dup(fd: number, min = 0, cloexec = false): bigint {
    const slot = this.fds.get(fd);
    if (!slot) return EBADF;
    if (min < 0 || min >= FD_LIMIT) return EINVAL;
    return this.install(slot.desc, cloexec, min);
  }

  /** dup3; dup2 is the same with flags 0 except that old == new returns new. */
  dup3(oldfd: number, newfd: number, flags: number): bigint {
    if (flags & ~O_CLOEXEC) return EINVAL;
    const slot = this.fds.get(oldfd);
    if (!slot) return EBADF;
    if (oldfd === newfd) return EINVAL;
    if (newfd < 0 || newfd >= FD_LIMIT) return EBADF;
    if (!this.fds.has(newfd) && this.openCount() >= MAX_OPEN + 3) return EMFILE;
    this.fds.set(newfd, { desc: slot.desc, cloexec: Boolean(flags & O_CLOEXEC) });
    return BigInt(newfd);
  }

  dup2(oldfd: number, newfd: number): bigint {
    if (oldfd === newfd) return this.fds.has(oldfd) ? BigInt(newfd) : EBADF;
    return this.dup3(oldfd, newfd, 0);
  }

  fcntl(fd: number, cmd: number, arg: bigint): bigint {
    const slot = this.fds.get(fd);
    if (!slot) return EBADF;
    const { desc } = slot;
    switch (cmd) {
      case 0: // F_DUPFD
      case 1030: // F_DUPFD_CLOEXEC
        return arg < 0n || arg >= BigInt(FD_LIMIT) ? EINVAL : this.dup(fd, Number(arg), cmd === 1030);
      case 1: // F_GETFD
        return slot.cloexec ? 1n : 0n;
      case 2: // F_SETFD
        slot.cloexec = (arg & 1n) !== 0n;
        return 0n;
      case 3: // F_GETFL
        switch (desc.kind) {
          case "file":
            return BigInt((desc.read && desc.write ? O_RDWR : desc.write ? O_WRONLY : 0) | (desc.append ? O_APPEND : 0));
          case "pipe":
            return desc.write ? BigInt(O_WRONLY) : 0n;
          case "dir":
            return 0n;
          case "stream":
            return BigInt(O_RDWR);
        }
        return 0n;
      case 4: // F_SETFL: only O_APPEND is honoured (O_NONBLOCK changes nothing here)
        if (desc.kind === "file") desc.append = (arg & BigInt(O_APPEND)) !== 0n;
        return 0n;
      default:
        return EINVAL;
    }
  }

  /** pipe2: [read end, write end], or an errno. */
  pipe(flags: number): [number, number] | bigint {
    if (flags & ~(O_CLOEXEC | 0x800)) return EINVAL; // O_NONBLOCK is accepted: nothing here blocks
    if (this.openCount() + 2 > MAX_OPEN + 3) return EMFILE;
    const pipe = new Pipe();
    const cloexec = Boolean(flags & O_CLOEXEC);
    const r = Number(this.install({ kind: "pipe", pipe, write: false }, cloexec));
    const w = Number(this.install({ kind: "pipe", pipe, write: true }, cloexec));
    return [r, w];
  }

  /** The tree as it stands, path -> contents, sorted by path. Directories appear as "path/" with no contents. */
  snapshot(): Record<string, Uint8Array> {
    const keys: [string, Uint8Array][] = [];
    for (const [key, node] of this.tree) keys.push([key, node.bytes()]);
    for (const key of this.dirs) if (key !== "/") keys.push([key + "/", new Uint8Array()]);
    keys.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return Object.fromEntries(keys);
  }
}
