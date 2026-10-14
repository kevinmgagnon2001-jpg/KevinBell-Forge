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
export const AT_SYMLINK_FOLLOW = 0x400;
/** The x86-64 value. The shim translates AArch64's (0x8000) to this. */
export const O_NOFOLLOW = 0x20000;
/** Links followed in one path walk before ELOOP, as on Linux. */
const MAX_LINK_HOPS = 40;
export const RENAME_NOREPLACE = 1;
export const RENAME_EXCHANGE = 2;
export const POLLIN = 0x1;
export const POLLPRI = 0x2;
export const POLLOUT = 0x4;
export const POLLERR = 0x8;
export const POLLHUP = 0x10;
export const POLLNVAL = 0x20;
export const POLLRDNORM = 0x40;
export const POLLWRNORM = 0x100;
/** What Linux reports for anything that never waits: regular files, directories, the standard streams. */
const ALWAYS_READY = POLLIN | POLLOUT | POLLRDNORM | POLLWRNORM;
/** Where a directory descriptor points once its directory is gone: never a directory in the tree. */
const GONE = "/\0gone";

const ENOENT = -2n;
const EBADF = -9n;
const EAGAIN = -11n;
const EBUSY = -16n;
const EEXIST = -17n;
const ENOTDIR = -20n;
const EISDIR = -21n;
const EINVAL = -22n;
const EMFILE = -24n;
const ENODEV = -19n;
const EACCES = -13n;
const EFBIG = -27n;
const ENOSPC = -28n;
const ESPIPE = -29n;
const EPIPE = -32n;
const ENOTEMPTY = -39n;
const ELOOP = -40n;
const EPERM = -1n;

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

/** A file's contents. Descriptors, mappings and the tree share one; `version` changes with every write through a descriptor. */
export class FileNode {
  buf: Uint8Array;
  size: number;
  version = 0;
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
  /** Cut or extend to `size` bytes; anything past the old end reads as zeros. */
  resize(size: number) {
    if (size > this.size) this.grow(size);
    else this.size = size;
    this.version += 1;
  }
}

class Pipe {
  data = new Uint8Array(PIPE_BYTES);
  size = 0;
}

/** An open file description: what dup'd descriptors share. */
type Desc =
  | { kind: "file"; node: FileNode; pos: number; read: boolean; write: boolean; append: boolean }
  | { kind: "dir"; path: string; pos: number }
  | { kind: "pipe"; pipe: Pipe; write: boolean }
  | { kind: "stream"; stream: 0 | 1 | 2 };

type Slot = { desc: Desc; cloexec: boolean };

export type Stat = { kind: "file" | "dir" | "fifo" | "link"; size: number; nlink?: number };

/** A symbolic link. Hard links to it share the object. */
class Link {
  readonly target: string;
  constructor(target: string) {
    this.target = target;
  }
}

export class GuestFiles {
  private tree = new Map<string, FileNode>();
  /** Every directory, root included: the ones the host's files sit in and the ones the program made. */
  private dirs = new Set<string>(["/"]);
  /** Symbolic links: path -> link. */
  private links = new Map<string, Link>();
  private fds = new Map<number, Slot>();
  private total = 0;
  private stdin: Uint8Array;
  private stdinAt = 0;
  readonly stdout = new ByteSink();
  readonly stderr = new ByteSink();

  /** Paths ending in "/" are empty directories; paths ending in "@" are symbolic links whose contents are the target. */
  constructor(files: Record<string, Uint8Array | string> = {}, stdin?: Uint8Array | string) {
    const enc = new TextEncoder();
    this.stdin = typeof stdin === "string" ? enc.encode(stdin) : stdin ?? new Uint8Array();
    for (const [path, data] of Object.entries(files)) {
      const key = normalizePath(path);
      if (key === "/") continue;
      if (path.endsWith("@") && key.length > 2) {
        const at = key.slice(0, -1);
        const target = typeof data === "string" ? data : new TextDecoder().decode(data);
        if (target && !this.tree.has(at) && !this.dirs.has(at)) {
          this.addDir(parentOf(at));
          this.links.set(at, new Link(target));
        }
        continue;
      }
      if (path.endsWith("/")) {
        if (!this.tree.has(key)) this.addDir(key);
        continue;
      }
      if (this.dirs.has(key)) continue;
      const node = new FileNode(typeof data === "string" ? enc.encode(data) : data);
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
   * working directory, "/"), every component before the last must be a directory, symbolic links on
   * the way are followed (the last one only with `follow`, or when the path ends in "/"), and ".."
   * stops at the root. Returns the absolute path, which may not exist yet.
   */
  private walk(dirfd: number, raw: string, follow = false): string | bigint {
    let base = "/";
    if (!raw.startsWith("/") && dirfd !== AT_FDCWD) {
      const slot = this.fds.get(dirfd);
      if (!slot) return EBADF;
      if (slot.desc.kind !== "dir") return ENOTDIR;
      base = slot.desc.path;
      if (!this.dirs.has(base)) return ENOENT; // removed while open: nothing can be found or made in it
    }
    const slash = raw.endsWith("/");
    const queue = raw.split("/").filter((p) => p && p !== ".");
    let stack = base === "/" ? [] : base.slice(1).split("/");
    let hops = 0;
    while (queue.length) {
      const part = queue.shift()!;
      const last = queue.length === 0;
      if (part === "..") stack.pop();
      else if (part !== ".") stack.push(part);
      const at = "/" + stack.join("/");
      const link = this.links.get(at);
      if (link && (!last || follow || slash)) {
        if (++hops > MAX_LINK_HOPS) return ELOOP;
        stack.pop();
        if (link.target.startsWith("/")) stack = [];
        queue.unshift(...link.target.split("/").filter((p) => p && p !== "."));
        continue;
      }
      if (last) break;
      if (this.tree.has(at) || link) return ENOTDIR;
      if (!this.dirs.has(at)) return ENOENT;
    }
    const out = "/" + stack.join("/");
    if (slash && this.tree.has(out)) return ENOTDIR; // "file/" names nothing
    return out;
  }

  /** Is anything (file, directory or link) at this path? */
  private exists(path: string): boolean {
    return this.tree.has(path) || this.dirs.has(path) || this.links.has(path);
  }

  /** How many names a file or link has. */
  private nlink(item: FileNode | Link): number {
    let n = 0;
    for (const v of item instanceof Link ? this.links.values() : this.tree.values()) if (v === item) n += 1;
    return n;
  }

  /** Drop one name of a file; its bytes stop counting once no name is left. */
  private dropName(path: string) {
    const node = this.tree.get(path);
    if (!node) return;
    this.tree.delete(path);
    if (!this.nlink(node)) this.total -= node.size;
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
    // O_CREAT|O_EXCL never follows a link in the last place: the name itself must be new.
    const exclusive = Boolean(flags & O_CREAT && flags & O_EXCL);
    const path = this.walk(dirfd, raw, !(flags & O_NOFOLLOW) && !exclusive);
    if (typeof path !== "string") return path;
    if (this.links.has(path)) return exclusive ? EEXIST : ELOOP;
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
      if (this.tree.size + this.dirs.size + this.links.size >= MAX_FILES) return ENOSPC;
      if (this.lowestFreeFd() < 0) return EMFILE;
      node = new FileNode(new Uint8Array());
      this.tree.set(path, node);
    }
    const fd = this.install({ kind: "file", node, pos: 0, read: acc !== O_WRONLY, write, append: Boolean(flags & O_APPEND) }, cloexec);
    if (fd >= 0n && flags & O_TRUNC && write) {
      this.total -= node.size;
      node.resize(0);
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
        desc.node.version += 1;
        desc.pos = end;
        return BigInt(data.length);
      }
    }
  }

  /** pread64: read at `offset` without moving the descriptor's position. */
  pread(fd: number, max: number, offset: bigint): Uint8Array | bigint {
    const desc = this.fds.get(fd)?.desc;
    if (!desc) return EBADF;
    if (desc.kind === "pipe" || desc.kind === "stream") return desc.kind === "pipe" && desc.write ? EBADF : ESPIPE;
    if (desc.kind === "dir") return EISDIR;
    if (!desc.read) return EBADF;
    if (offset < 0n) return EINVAL;
    const at = Number(offset > BigInt(desc.node.size) ? BigInt(desc.node.size) : offset);
    return desc.node.buf.slice(at, at + Math.max(0, Math.min(max, desc.node.size - at)));
  }

  /** pwrite64: write at `offset` without moving the position. As on Linux, O_APPEND still appends. */
  pwrite(fd: number, data: Uint8Array, offset: bigint): bigint {
    const desc = this.fds.get(fd)?.desc;
    if (!desc) return EBADF;
    if (desc.kind === "pipe" || desc.kind === "stream") return desc.kind === "pipe" && !desc.write ? EBADF : ESPIPE;
    if (desc.kind === "dir" || !desc.write) return EBADF;
    if (offset < 0n) return EINVAL;
    if (offset > BigInt(MAX_TREE_BYTES)) return EFBIG;
    const pos = desc.pos;
    desc.pos = Number(offset);
    const n = this.write(fd, data);
    desc.pos = pos;
    return n;
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
        return { kind: "file", size: desc.node.size, nlink: this.nlink(desc.node) };
    }
  }

  statPath(path: string): Stat | bigint {
    return this.statAt(AT_FDCWD, path);
  }

  /** stat, or lstat with follow = false. */
  statAt(dirfd: number, raw: string, follow = true): Stat | bigint {
    const path = this.walk(dirfd, raw, follow);
    if (typeof path !== "string") return path;
    const link = this.links.get(path);
    if (link) return { kind: "link", size: new TextEncoder().encode(link.target).length, nlink: this.nlink(link) };
    const node = this.tree.get(path);
    if (node) return { kind: "file", size: node.size, nlink: this.nlink(node) };
    return this.dirs.has(path) ? { kind: "dir", size: 4096 } : ENOENT;
  }

  mkdirAt(dirfd: number, raw: string): bigint {
    const path = this.walk(dirfd, raw);
    if (typeof path !== "string") return path;
    if (this.exists(path)) return EEXIST;
    if (this.tree.size + this.dirs.size + this.links.size >= MAX_FILES) return ENOSPC;
    this.dirs.add(path);
    return 0n;
  }

  unlink(path: string): bigint {
    return this.unlinkAt(AT_FDCWD, path, 0);
  }

  /** unlink, or rmdir with AT_REMOVEDIR. Both act on a link itself, never on what it points at. */
  unlinkAt(dirfd: number, raw: string, flags: number): bigint {
    const slash = /[^/]\/+$/.test(raw);
    const path = this.walk(dirfd, slash ? raw.replace(/\/+$/, "") : raw);
    if (typeof path !== "string") return path;
    const node = this.tree.get(path);
    const link = this.links.has(path);
    if (flags & AT_REMOVEDIR) {
      if (path === "/") return EBUSY;
      if (node || link) return ENOTDIR;
      if (!this.dirs.has(path)) return ENOENT;
      if (this.entries(path).length > 2) return ENOTEMPTY;
      this.dirs.delete(path);
      return 0n;
    }
    if (!this.exists(path)) return ENOENT;
    if (slash) return this.dirs.has(path) ? EISDIR : ENOTDIR;
    if (link) {
      this.links.delete(path);
      return 0n;
    }
    if (!node) return EISDIR;
    // Like Linux, descriptors already open keep the file's contents; it just leaves the tree.
    this.dropName(path);
    return 0n;
  }

  /** ".", "..", then the directory's entries by name, with their getdents64 types (DT_DIR 4, DT_REG 8, DT_LNK 10). */
  private entries(path: string): [string, number][] {
    if (!this.dirs.has(path)) return []; // removed while open: Linux lists nothing
    const prefix = path === "/" ? "/" : path + "/";
    const out: [string, number][] = [];
    const direct = (key: string) => key.startsWith(prefix) && key.length > prefix.length && !key.slice(prefix.length).includes("/");
    for (const key of this.tree.keys()) if (direct(key)) out.push([key.slice(prefix.length), 8]);
    for (const key of this.dirs) if (direct(key)) out.push([key.slice(prefix.length), 4]);
    for (const key of this.links.keys()) if (direct(key)) out.push([key.slice(prefix.length), 10]);
    out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return [[".", 4], ["..", 4], ...out];
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
      const [name, type] = list[desc.pos];
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
      rec[18] = type;
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

  /** ftruncate: only a regular file open for writing can be cut or extended. */
  ftruncate(fd: number, length: bigint): bigint {
    const desc = this.fds.get(fd)?.desc;
    if (!desc) return EBADF;
    if (desc.kind !== "file" || !desc.write || length < 0n) return EINVAL;
    return this.resize(desc.node, length);
  }

  /** truncate(path): the same without a descriptor. */
  truncateAt(dirfd: number, raw: string, length: bigint): bigint {
    if (length < 0n) return EINVAL;
    const path = this.walk(dirfd, raw, true);
    if (typeof path !== "string") return path;
    const node = this.tree.get(path);
    if (!node) return this.dirs.has(path) ? EISDIR : ENOENT;
    return this.resize(node, length);
  }

  private resize(node: FileNode, length: bigint): bigint {
    if (length > BigInt(MAX_TREE_BYTES)) return EFBIG;
    const added = Number(length) - node.size;
    if (this.total + added > MAX_TREE_BYTES) return ENOSPC;
    // A file that left the tree still counts until it is gone, as it did when written.
    this.total += added;
    node.resize(Number(length));
    return 0n;
  }

  /**
   * renameat2. Flags: RENAME_NOREPLACE, RENAME_EXCHANGE. Moves a file or a whole directory; open
   * descriptors follow what they name, and a file replaced while open keeps its contents for them.
   */
  renameAt(olddirfd: number, oldRaw: string, newdirfd: number, newRaw: string, flags: number): bigint {
    if (flags & ~(RENAME_NOREPLACE | RENAME_EXCHANGE)) return EINVAL;
    if (flags & RENAME_NOREPLACE && flags & RENAME_EXCHANGE) return EINVAL;
    const from = this.walk(olddirfd, oldRaw);
    if (typeof from !== "string") return from;
    const to = this.walk(newdirfd, newRaw);
    if (typeof to !== "string") return to;
    const last = (raw: string) => raw.split("/").filter(Boolean).pop() ?? "";
    // "." and "..", or the root itself, cannot be moved or replaced.
    const special = (raw: string) => ["", ".", ".."].includes(last(raw));
    if (special(oldRaw)) return EBUSY;
    if (special(newRaw)) return flags & RENAME_NOREPLACE ? EEXIST : EBUSY;
    const fromDir = this.dirs.has(from);
    if (!this.exists(from)) return ENOENT;
    const toDir = this.dirs.has(to);
    const toExists = this.exists(to);
    if (!fromDir && (oldRaw.endsWith("/") || (newRaw.endsWith("/") && !(flags & RENAME_EXCHANGE)))) return ENOTDIR;
    if (flags & RENAME_EXCHANGE && !toExists) return ENOENT;
    if (flags & RENAME_NOREPLACE && toExists) return EEXIST;
    // Two names of one file (or one link): Linux does nothing and reports success.
    const same = (a: string, b: string) => (this.tree.get(a) ?? this.links.get(a) ?? a) === (this.tree.get(b) ?? this.links.get(b) ?? b);
    if (from === to || same(from, to)) return 0n;
    const inside = (path: string, dir: string) => path.startsWith(dir + "/");
    if (fromDir && inside(to, from)) return EINVAL;
    if (flags & RENAME_EXCHANGE) {
      if (toDir && inside(from, to)) return EINVAL;
      this.remap((p) => (p === from || inside(p, from) ? to + p.slice(from.length) : p === to || inside(p, to) ? from + p.slice(to.length) : p));
      return 0n;
    }
    if (toExists) {
      if (!fromDir && toDir) return EISDIR;
      if (fromDir && !toDir) return ENOTDIR;
      if (toDir) {
        if (this.entries(to).length > 2) return ENOTEMPTY;
        this.dirs.delete(to);
        for (const { desc } of this.fds.values()) if (desc.kind === "dir" && desc.path === to) desc.path = GONE;
      } else if (this.links.has(to)) {
        this.links.delete(to);
      } else {
        // Descriptors open on the replaced file keep it; it just leaves the tree.
        this.dropName(to);
      }
    }
    this.remap((p) => (p === from || inside(p, from) ? to + p.slice(from.length) : p));
    return 0n;
  }

  /** Renames every path in the tree, and the directories descriptors point at, through `f`. */
  private remap(f: (path: string) => string) {
    const tree = [...this.tree].map(([k, v]) => [f(k), v] as const);
    this.tree = new Map(tree);
    this.dirs = new Set([...this.dirs].map((d) => (d === "/" ? d : f(d))));
    this.links = new Map([...this.links].map(([k, v]) => [f(k), v] as const));
    for (const { desc } of this.fds.values()) if (desc.kind === "dir" && desc.path !== "/" && desc.path !== GONE) desc.path = f(desc.path);
  }

  /** symlinkat: a new name holding `target`, which need not exist. */
  symlinkAt(target: string, dirfd: number, raw: string): bigint {
    if (!target) return ENOENT;
    const path = this.walk(dirfd, raw);
    if (typeof path !== "string") return path;
    if (this.exists(path)) return EEXIST;
    if (raw.endsWith("/")) return ENOENT;
    if (this.tree.size + this.dirs.size + this.links.size >= MAX_FILES) return ENOSPC;
    this.links.set(path, new Link(target));
    return 0n;
  }

  /** readlinkat: the target of a symbolic link. */
  readlinkAt(dirfd: number, raw: string): Uint8Array | bigint {
    const path = this.walk(dirfd, raw);
    if (typeof path !== "string") return path;
    const link = this.links.get(path);
    if (link) return new TextEncoder().encode(link.target);
    return this.exists(path) ? EINVAL : ENOENT;
  }

  /** linkat: another name for a file (or for a symbolic link itself, unless AT_SYMLINK_FOLLOW). */
  linkAt(olddirfd: number, oldRaw: string, newdirfd: number, newRaw: string, flags: number): bigint {
    if (flags & ~AT_SYMLINK_FOLLOW) return EINVAL;
    const from = this.walk(olddirfd, oldRaw, Boolean(flags & AT_SYMLINK_FOLLOW));
    if (typeof from !== "string") return from;
    if (this.dirs.has(from)) return EPERM;
    const item = this.tree.get(from) ?? this.links.get(from);
    if (!item) return ENOENT;
    const to = this.walk(newdirfd, newRaw);
    if (typeof to !== "string") return to;
    if (this.exists(to)) return EEXIST;
    if (this.tree.size + this.dirs.size + this.links.size >= MAX_FILES) return ENOSPC;
    if (item instanceof Link) this.links.set(to, item);
    else this.tree.set(to, item);
    return 0n;
  }

  /**
   * The file behind a descriptor, for mmap. `type` is MAP_SHARED (1), MAP_PRIVATE (2) or
   * MAP_SHARED_VALIDATE (3); errors come in the order Linux checks them.
   */
  mapFile(fd: number, type: number, prot: number): FileNode | bigint {
    const desc = this.fds.get(fd)?.desc;
    if (!desc) return EBADF;
    if (type !== 1 && type !== 2 && type !== 3) return EINVAL;
    const readable = desc.kind === "file" ? desc.read : desc.kind === "pipe" ? !desc.write : desc.kind !== "stream" || desc.stream === 0;
    const writable = desc.kind === "file" ? desc.write : desc.kind === "pipe" ? desc.write : desc.kind === "stream" && desc.stream !== 0;
    if (type !== 2 && prot & 2 && !writable) return EACCES;
    if (!readable) return EACCES;
    if (desc.kind !== "file") return ENODEV;
    return desc.node;
  }

  /** Readiness for poll and select: a POLL* mask, or -1 for a descriptor that is not open. */
  pollMask(fd: number): number {
    const desc = this.fds.get(fd)?.desc;
    if (!desc) return -1;
    if (desc.kind !== "pipe") return ALWAYS_READY;
    const p = desc.pipe;
    if (desc.write) return (p.size < PIPE_BYTES ? POLLOUT | POLLWRNORM : 0) | (this.pipeEndOpen(p, false) ? 0 : POLLERR);
    return (p.size ? POLLIN | POLLRDNORM : 0) | (this.pipeEndOpen(p, true) ? 0 : POLLHUP);
  }

  /** The tree as it stands, path -> contents, sorted by path. Directories appear as "path/" with no contents, symbolic links as "path@" holding their target. */
  snapshot(): Record<string, Uint8Array> {
    const keys: [string, Uint8Array][] = [];
    for (const [key, node] of this.tree) keys.push([key, node.bytes()]);
    for (const key of this.dirs) if (key !== "/") keys.push([key + "/", new Uint8Array()]);
    for (const [key, link] of this.links) keys.push([key + "@", new TextEncoder().encode(link.target)]);
    keys.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return Object.fromEntries(keys);
  }
}
