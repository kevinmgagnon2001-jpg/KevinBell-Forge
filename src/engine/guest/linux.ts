/**
 * Run a static Linux executable inside Forge.
 *
 *   ELF  ->  lift (x86-64 or AArch64 machine code -> guest IR)  ->  WebAssembly (or the interpreter)
 *        ->  run until a system call  ->  the Linux shim answers it  ->  run again
 *
 * The shim is a capability boundary, not a kernel. It implements what ordinary command-line
 * programs need to print and exit (write, writev, read from a provided stdin, brk, anonymous mmap,
 * exit), plus files inside a private tree the host hands over (options.files): open, read, write,
 * seek, stat, unlink, directories (mkdir, getdents64, rmdir), dup/dup2/dup3, fcntl and pipes act on
 * that tree and the program's own descriptors only, and the tree as the program left it comes back in
 * the report. Everything else answers -ENOSYS, recorded in the report. The host's own files, network,
 * processes and signals are not reachable. Bytes the lifter does not know are reported and never executed.
 */
import { readElf, PF_X, type Segment } from "./elf.ts";
import { GuestState, Interpreter, type Engine } from "./machine.ts";
import { NREG, STATE, STOP_NAME, Stop, TP, type Gap, type GuestArch, type StopCode } from "./ir.ts";
import { inText, lift, newProgram, type Program } from "./lift.ts";
import { instantiate, lowerProgram } from "./wasm.ts";
import { AT_FDCWD, FD_LIMIT, GuestFiles, O_DIRECTORY, O_NOFOLLOW, POLLERR, POLLHUP, POLLIN, POLLNVAL, POLLOUT, POLLPRI, POLLRDNORM, POLLWRNORM, type ByteSink, type FileNode, type Stat } from "./files.ts";

export type LinuxOptions = {
  /** "tiered" (default): interpreter first, WebAssembly once the program runs long. "wasm": WebAssembly from the start. */
  engine?: "tiered" | "wasm" | "interpreter";
  /** Instructions to interpret before lowering to WebAssembly in "tiered" mode. */
  tierUpAfter?: number;
  memBytes?: number;
  fuel?: number;
  stdin?: Uint8Array | string;
  argv?: string[];
  /** Upper bound on host round trips (system calls and re-lifts). */
  maxEvents?: number;
  /**
   * The program's file tree, path -> contents. Relative paths resolve against "/"; a path ending in
   * "/" is an empty directory. The program sees only these files (and any it creates); nothing
   * outside the tree is reachable.
   */
  files?: FileTree;
};

export type FileTree = Record<string, Uint8Array | string>;

export type LinuxReport = {
  ok: boolean;
  arch: GuestArch | null;
  engine: "tiered" | "wasm" | "interpreter";
  exitCode: number | null;
  stdout: string;
  /** Exact bytes written to stdout (stdout above is the UTF-8 decoding). */
  stdoutBytes: Uint8Array;
  stderr: string;
  stop: string;
  detail: string;
  gaps: Gap[];
  syscalls: Record<string, number>;
  unsupportedSyscalls: string[];
  instructions: number;
  relifts: number;
  /** The file tree as the program left it. Directories appear as "path/" with empty contents. */
  files: Record<string, Uint8Array>;
};

const ENOSYS = -38n;
const EINVAL = -22n;
const ENOMEM = -12n;
const ENOTTY = -25n;
const EFAULT = -14n;
const ENOENT = -2n;
const EBADF = -9n;
const ENAMETOOLONG = -36n;

export const ABI: Record<GuestArch, { nr: number; args: number[]; ret: number; sp: number; names: Record<number, string> }> = {
  x86_64: {
    nr: 0,
    args: [7, 6, 2, 10, 8, 9],
    ret: 0,
    sp: 4,
    names: { 0: "read", 1: "write", 2: "open", 3: "close", 4: "stat", 5: "fstat", 6: "lstat", 7: "poll", 8: "lseek", 9: "mmap", 10: "mprotect", 11: "munmap", 12: "brk", 13: "rt_sigaction", 14: "rt_sigprocmask", 24: "sched_yield", 16: "ioctl", 17: "pread64", 18: "pwrite64", 20: "writev", 21: "access", 22: "pipe", 23: "select", 26: "msync", 28: "madvise", 32: "dup", 33: "dup2", 39: "getpid", 56: "clone", 60: "exit", 63: "uname", 72: "fcntl", 76: "truncate", 77: "ftruncate", 79: "getcwd", 82: "rename", 83: "mkdir", 84: "rmdir", 86: "link", 87: "unlink", 88: "symlink", 89: "readlink", 102: "getuid", 104: "getgid", 107: "geteuid", 108: "getegid", 158: "arch_prctl", 186: "gettid", 201: "time", 202: "futex", 217: "getdents64", 218: "set_tid_address", 228: "clock_gettime", 231: "exit_group", 257: "openat", 258: "mkdirat", 262: "newfstatat", 263: "unlinkat", 264: "renameat", 265: "linkat", 266: "symlinkat", 267: "readlinkat", 269: "faccessat", 270: "pselect6", 271: "ppoll", 273: "set_robust_list", 292: "dup3", 293: "pipe2", 302: "prlimit64", 316: "renameat2", 318: "getrandom", 334: "rseq", 435: "clone3" },
  },
  aarch64: {
    nr: 8,
    args: [0, 1, 2, 3, 4, 5],
    ret: 0,
    sp: 31,
    names: { 17: "getcwd", 23: "dup", 24: "dup3", 25: "fcntl", 29: "ioctl", 34: "mkdirat", 35: "unlinkat", 36: "symlinkat", 37: "linkat", 38: "renameat", 45: "truncate", 46: "ftruncate", 48: "faccessat", 56: "openat", 57: "close", 59: "pipe2", 61: "getdents64", 62: "lseek", 63: "read", 64: "write", 66: "writev", 67: "pread64", 68: "pwrite64", 72: "pselect6", 73: "ppoll", 78: "readlinkat", 79: "newfstatat", 80: "fstat", 93: "exit", 94: "exit_group", 96: "set_tid_address", 98: "futex", 99: "set_robust_list", 113: "clock_gettime", 124: "sched_yield", 134: "rt_sigaction", 135: "rt_sigprocmask", 160: "uname", 172: "getpid", 174: "getuid", 175: "geteuid", 176: "getgid", 177: "getegid", 178: "gettid", 214: "brk", 215: "munmap", 220: "clone", 222: "mmap", 226: "mprotect", 227: "msync", 233: "madvise", 261: "prlimit64", 276: "renameat2", 278: "getrandom", 293: "rseq", 435: "clone3" },
  },
};

const enc = new TextEncoder();
const dec = new TextDecoder();

export const pageUp = (v: bigint) => (v + 0xfffn) & ~0xfffn;
export const STACK_BYTES = 0x80000n;

export type Prepared =
  | {
      ok: true;
      arch: GuestArch;
      entry: bigint;
      memBytes: number;
      /** The initial image: segments, stack and CPU state. */
      memory: Uint8Array;
      program: Program;
      /** Reads code bytes from the initial image (code never changes: stores into it are refused). */
      fetch: (addr: bigint) => number | undefined;
      brkBase: bigint;
      mmapTop: bigint;
    }
  | { ok: false; arch: GuestArch | null; reason: string };

/** Load the ELF, build the stack and CPU state, and lift from the entry point. Runs nothing. */
export function prepareLinux(bytes: Uint8Array, options: LinuxOptions = {}): Prepared {
  const parsed = readElf(bytes);
  if (!parsed.ok) return { ok: false, arch: null, reason: parsed.reason };
  const elf = parsed.elf;
  const memBytes = options.memBytes ?? 16 * 1024 * 1024;
  const memory = new Uint8Array(memBytes);
  let top = 0n;
  const text: [bigint, bigint][] = [];
  for (const seg of elf.segments) {
    const end = seg.vaddr + seg.memsz;
    if (seg.vaddr < 0x1000n || end > BigInt(memBytes) - 0x100000n) {
      return { ok: false, arch: elf.arch, reason: `segment at 0x${seg.vaddr.toString(16)} does not fit in ${memBytes >> 20} MiB of guest memory` };
    }
    memory.set(bytes.subarray(seg.offset, seg.offset + Number(seg.filesz)), Number(seg.vaddr));
    if (seg.flags & PF_X) text.push([seg.vaddr, end]);
    if (end > top) top = end;
  }
  if (!text.length) return { ok: false, arch: elf.arch, reason: "no executable segment" };
  const abi = ABI[elf.arch];
  const stackTop = BigInt(memBytes) - 0x1000n;
  const state = new GuestState(memory);
  const argv = options.argv ?? ["program"];
  let sp = stackTop;
  const strings: bigint[] = [];
  for (const arg of argv) {
    const data = enc.encode(`${arg}\0`);
    sp -= BigInt(data.length);
    state.write(sp, data);
    strings.push(sp);
  }
  // 16 random bytes for AT_RANDOM (libc seeds its stack guard from them)
  sp -= 16n;
  const random = sp;
  state.write(random, globalThis.crypto.getRandomValues(new Uint8Array(16)));
  sp &= ~0xfn;
  const phdr = elf.phdr;
  // argc, argv..., NULL, envp NULL, auxv pairs, AT_NULL
  // AT_HWCAP on ARM64: FP and Advanced SIMD only, so libc picks its baseline code (no SVE, LSE atomics, MTE).
  const hwcap: bigint[] = elf.arch === "aarch64" ? [16n, 3n, 26n, 0n] : [];
  const auxv: bigint[] = [6n, 4096n, 25n, random, 3n, phdr.addr, 4n, BigInt(phdr.entsize), 5n, BigInt(phdr.count), 9n, elf.entry, 23n, 0n, ...hwcap, 0n, 0n];
  const words: bigint[] = [BigInt(argv.length), ...strings, 0n, 0n, ...auxv];
  sp -= BigInt(words.length * 8);
  sp &= ~0xfn;
  const dv = new DataView(memory.buffer);
  words.forEach((w, i) => dv.setBigUint64(Number(sp) + i * 8, w, true));
  state.setReg(abi.sp, sp);
  state.pc = elf.entry;
  state.fuel = BigInt(options.fuel ?? 2_000_000_000);
  state.flags = { z: 0, s: 0, c: 0, o: 0, k: 0 };
  const program: Program = newProgram(elf.arch, text);
  const image = memory.slice();
  const fetch = (addr: bigint) => (addr >= 0n && addr < BigInt(memBytes) ? image[Number(addr)] : undefined);
  lift(program, fetch, [elf.entry, ...codePointers(memory, elf.segments, text, elf.arch)]);
  if (elf.arch === "x86_64") lift(program, fetch, jumpTableTargets(program, memory, elf.segments, text));
  return { ok: true, arch: elf.arch, entry: elf.entry, memBytes, memory, program, fetch, brkBase: pageUp(top), mmapTop: stackTop - STACK_BYTES };
}

/**
 * Likely code addresses stored as data (function pointer tables, init arrays, vtables): every
 * aligned 64-bit value in a non-executable segment that lands inside the code. Lifting them up front
 * saves re-lifting at run time; a wrong guess only decodes some bytes that never run.
 */
export function codePointers(memory: Uint8Array, segments: Segment[], text: [bigint, bigint][], arch: GuestArch): bigint[] {
  const out = new Set<bigint>();
  const dv = new DataView(memory.buffer, memory.byteOffset, memory.byteLength);
  for (const seg of segments) {
    if (seg.flags & PF_X) continue;
    const start = Number((seg.vaddr + 7n) & ~7n);
    const end = Number(seg.vaddr + seg.filesz);
    for (let at = start; at + 8 <= end; at += 8) {
      const v = dv.getBigUint64(at, true);
      if (arch === "aarch64" && v % 4n !== 0n) continue;
      if (text.some(([lo, hi]) => v >= lo && v < hi)) out.add(v);
    }
  }
  return [...out].slice(0, 200_000);
}

/**
 * x86 switch tables: compilers emit `lea base, [rip + table]` then add a signed 32-bit entry from the
 * table to `base` and jump. For every rip-relative address taken into read-only data, read entries
 * while they land inside the code.
 */
export function jumpTableTargets(program: Program, memory: Uint8Array, segments: Segment[], text: [bigint, bigint][]): bigint[] {
  const out = new Set<bigint>();
  const dv = new DataView(memory.buffer, memory.byteOffset, memory.byteLength);
  const inCode = (v: bigint) => text.some(([lo, hi]) => v >= lo && v < hi);
  const data = segments.filter((seg) => !(seg.flags & PF_X));
  for (const insn of program.insns.values()) {
    for (const op of insn.ops) {
      if (op.k !== "lea" || op.ea.base !== null || op.ea.index !== null) continue;
      const table = op.ea.disp;
      if (!data.some((seg) => table >= seg.vaddr && table < seg.vaddr + seg.filesz)) continue;
      for (let i = 0; i < 4096; i += 1) {
        const at = Number(table) + i * 4;
        if (at + 4 > memory.length) break;
        const target = table + BigInt(dv.getInt32(at, true));
        if (!inCode(target)) break;
        out.add(target);
      }
    }
  }
  return [...out];
}

/** Nonzero runs of memory, for sending an initial image somewhere else without 16 MB of zeros. */
export function sparseChunks(memory: Uint8Array, gap = 64): { addr: number; bytes: Uint8Array }[] {
  const out: { addr: number; bytes: Uint8Array }[] = [];
  let i = 0;
  const n = memory.length;
  while (i < n) {
    while (i < n && memory[i] === 0) i += 1;
    if (i >= n) break;
    const start = i;
    let zeros = 0;
    while (i < n && zeros < gap) {
      zeros = memory[i] === 0 ? zeros + 1 : 0;
      i += 1;
    }
    out.push({ addr: start, bytes: memory.slice(start, i - zeros) });
  }
  return out;
}

/**
 * A MAP_SHARED view of a file. Guest memory is one flat array, so the page cache is imitated: around
 * every system call, bytes the program stored since the last one (it differs from `shadow`, what was
 * loaded) go to the file, and the file's current contents come back into every view of it. With one
 * thread nothing can look in between, so read() sees stores, the mapping sees write(), and two views
 * of one file agree at every system call (not between two stores with no call in between).
 */
type SharedMap = { addr: number; len: number; node: FileNode; off: number; shadow: Uint8Array; version: number; visible: number };

/**
 * A thread of the guest program. The shim runs one at a time and switches only at system calls: when
 * the running thread waits on a futex, yields or exits. Its registers live in guest memory while it
 * runs and in `ctx` (the pc, flags and register area of the state page) while it does not, so every
 * engine, wasmtime included, runs threads without knowing about them.
 */
type Thread = { tid: number; ctx: Uint8Array | null; wait: bigint | null; bitset: number; timed: boolean; clearTid: bigint };
const CTX_PARTS: [number, number][] = [[STATE.pc, STATE.fuel], [STATE.regs, STATE.regs + NREG * 8]];
const CTX_BYTES = CTX_PARTS.reduce((n, [a, b]) => n + b - a, 0);
/** Where register `r` sits inside a saved context. */
const ctxReg = (r: number) => STATE.fuel - STATE.pc + r * 8;
export const MAX_THREADS = 64;
const MAIN_TID = 1000;
const BLOCK = Symbol("block");
const YIELD = Symbol("yield");
const THREAD_EXIT = Symbol("thread exit");
type Switch = typeof BLOCK | typeof YIELD | typeof THREAD_EXIT;

const POLLIN_SET = POLLIN | POLLRDNORM | POLLHUP | POLLERR;
const POLLOUT_SET = POLLOUT | POLLWRNORM | POLLERR;

/** A descriptor argument: the low 32 bits, signed, as the kernel reads an int. */
const fd = (v: bigint) => Number(BigInt.asIntN(32, v));

/**
 * The Linux system-call shim. The same table is implemented in Rust for the desktop host
 * (src-tauri/src/guest.rs); keep the two in step.
 */
export class LinuxShim {
  readonly arch: GuestArch;
  readonly counts: Record<string, number> = {};
  readonly unsupported = new Set<string>();
  exitCode: number | null = null;
  private brkBase: bigint;
  private brk: bigint;
  private mmapTop: bigint;
  private shared: SharedMap[] = [];
  /** Every live thread; `cur` is the one running. */
  private threads: Thread[] = [{ tid: MAIN_TID, ctx: null, wait: null, bitset: 0, timed: false, clearTid: 0n }];
  private cur = 0;
  private nextTid = MAIN_TID + 1;
  /** Why the program stopped without exiting (every thread waiting forever), or null. */
  halt: string | null = null;
  readonly files: GuestFiles;

  constructor(arch: GuestArch, brkBase: bigint, mmapTop: bigint, stdin?: Uint8Array | string, files?: FileTree) {
    this.arch = arch;
    this.brkBase = brkBase;
    this.brk = brkBase;
    this.mmapTop = mmapTop;
    this.files = new GuestFiles(files, stdin);
  }

  get stdout(): ByteSink {
    return this.files.stdout;
  }

  get stderr(): ByteSink {
    return this.files.stderr;
  }

  /** A NUL-terminated path from guest memory, or an errno. */
  private path(state: GuestState, addr: bigint): string | bigint {
    const bytes: number[] = [];
    for (let i = 0; i < 4096; i += 1) {
      const b = state.read(addr + BigInt(i), 1);
      if (!b) return EFAULT;
      if (b[0] === 0) return dec.decode(Uint8Array.from(bytes));
      bytes.push(b[0]);
    }
    return ENAMETOOLONG;
  }

  /** struct stat for this architecture (x86-64, or the generic layout AArch64 uses). */
  private stat(state: GuestState, buf: bigint, st: Stat | bigint): bigint {
    if (typeof st === "bigint") return st;
    const out = new Uint8Array(this.arch === "x86_64" ? 144 : 128);
    const v = new DataView(out.buffer);
    const mode = st.kind === "dir" ? 0o40755 : st.kind === "fifo" ? 0o10600 : st.kind === "link" ? 0o120777 : 0o100644;
    const ino = BigInt(st.size + 2);
    v.setBigUint64(8, ino, true);
    if (this.arch === "x86_64") {
      v.setBigUint64(16, BigInt(st.nlink ?? 1), true); // st_nlink
      v.setUint32(24, mode, true);
      v.setBigInt64(56, 4096n, true); // st_blksize
    } else {
      v.setUint32(16, mode, true);
      v.setUint32(20, st.nlink ?? 1, true); // st_nlink
      v.setInt32(56, 4096, true); // st_blksize
    }
    v.setBigInt64(48, BigInt(st.size), true); // st_size: same offset on both
    v.setBigInt64(64, BigInt(Math.ceil(st.size / 512)), true); // st_blocks
    return state.write(buf, out) ? 0n : EFAULT;
  }

  /** A path argument: empty paths do not name anything. */
  private pathArg(state: GuestState, addr: bigint): string | bigint {
    const path = this.path(state, addr);
    return path === "" ? ENOENT : path;
  }

  private rename(state: GuestState, olddir: number, oldAt: bigint, newdir: number, newAt: bigint, flags: bigint): bigint {
    const from = this.pathArg(state, oldAt);
    if (typeof from !== "string") return from;
    const to = this.pathArg(state, newAt);
    if (typeof to !== "string") return to;
    return flags >> 32n ? EINVAL : this.files.renameAt(olddir, from, newdir, to, Number(flags));
  }

  /**
   * O_DIRECTORY is 0x4000 and O_NOFOLLOW 0x8000 on AArch64 (where 0x10000 and 0x20000 are O_DIRECT and
   * O_LARGEFILE); GuestFiles takes the x86-64 bits.
   */
  private openFlags(flags: bigint): number {
    let f = Number(flags & 0xffffffffn);
    if (this.arch === "aarch64") {
      const dir = f & 0x4000;
      const nofollow = f & 0x8000;
      f &= ~(0x4000 | 0x8000 | 0x10000 | 0x20000);
      if (dir) f |= O_DIRECTORY;
      if (nofollow) f |= O_NOFOLLOW;
    }
    return f;
  }

  /** Answer the system call the guest is making. Returns "exit" when the program ends. */
  handle(state: GuestState): "exit" | "continue" {
    const abi = ABI[this.arch];
    const nr = Number(state.reg(abi.nr));
    const [a0, a1, a2, a3, a4, a5] = abi.args.map((r) => state.reg(r));
    const name = abi.names[nr] ?? `#${nr}`;
    this.counts[name] = (this.counts[name] ?? 0) + 1;
    this.storeShared(state.mem);
    const out = this.call(state, name, a0, a1, a2, a3, a4, a5);
    if (out === "exit") return "exit";
    if (typeof out === "symbol") {
      if (!this.schedule(state, out)) return "exit";
    } else state.setReg(abi.ret, out);
    this.loadShared(state.mem);
    return "continue";
  }

  private saveCtx(mem: Uint8Array): Uint8Array {
    const ctx = new Uint8Array(CTX_BYTES);
    let at = 0;
    for (const [a, b] of CTX_PARTS) {
      ctx.set(mem.subarray(a, b), at);
      at += b - a;
    }
    return ctx;
  }

  private loadCtx(mem: Uint8Array, ctx: Uint8Array) {
    let at = 0;
    for (const [a, b] of CTX_PARTS) {
      mem.set(ctx.subarray(at, at + b - a), a);
      at += b - a;
    }
  }

  /** The value a waiting (not running) thread's system call returns when it runs again. */
  private answer(t: Thread, v: bigint) {
    new DataView(t.ctx!.buffer).setBigUint64(ctxReg(ABI[this.arch].ret), BigInt.asUintN(64, v), true);
  }

  /**
   * After the running thread blocked, yielded or exited: run the next ready thread (round robin). When
   * none is ready, time passes: the first thread waiting with a timeout times out. When nobody has a
   * timeout either, every thread waits forever and the program stops. Returns false when it stops.
   */
  private schedule(state: GuestState, why: Switch): boolean {
    const me = this.threads[this.cur];
    const ret = ABI[this.arch].ret;
    if (why === YIELD) state.setReg(ret, 0n);
    if (why === THREAD_EXIT) {
      this.threads.splice(this.cur, 1);
      this.cur -= 1;
    } else me.ctx = this.saveCtx(state.mem);
    const n = this.threads.length;
    let next = -1;
    for (let k = 1; k <= n && next < 0; k += 1) {
      const i = (this.cur + k + n) % n;
      if (this.threads[i].wait === null) next = i; // the yielding thread itself comes last
    }
    if (next < 0) {
      next = this.threads.findIndex((t) => t.timed);
      if (next < 0) {
        this.halt = `every thread is waiting on a futex that nothing will wake (${n} thread${n === 1 ? "" : "s"})`;
        return false;
      }
      const t = this.threads[next];
      t.wait = null;
      t.timed = false;
      this.answer(t, -110n); // ETIMEDOUT
    }
    this.cur = next;
    this.loadCtx(state.mem, this.threads[next].ctx!);
    this.threads[next].ctx = null;
    return true;
  }

  /** Wake up to `count` threads waiting on `addr` whose bitset meets `bitset`, oldest first. */
  private wake(addr: bigint, count: number, bitset = 0xffffffff, moveTo: bigint | null = null, moveCount = 0): number {
    let woken = 0;
    let moved = 0;
    for (const t of this.threads) {
      if (t.wait !== addr || !(t.bitset & bitset)) continue;
      if (woken < count) {
        t.wait = null;
        t.timed = false;
        this.answer(t, 0n);
        woken += 1;
      } else if (moveTo !== null && moved < moveCount) {
        t.wait = moveTo;
        moved += 1;
      }
    }
    return woken + moved;
  }

  private futex(state: GuestState, addr: bigint, op: bigint, val: bigint, timeout: bigint, addr2: bigint, val3: bigint): bigint | Switch {
    const cmd = Number(op & 0x7fn); // without FUTEX_PRIVATE_FLAG and FUTEX_CLOCK_REALTIME
    if (addr & 3n) return EINVAL;
    const word = () => {
      const b = state.read(addr, 4);
      return b ? BigInt(new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true)) : null;
    };
    const v32 = val & 0xffffffffn;
    switch (cmd) {
      case 0: // FUTEX_WAIT
      case 9: { // FUTEX_WAIT_BITSET
        const bitset = cmd === 9 ? Number(val3 & 0xffffffffn) : 0xffffffff;
        if (!bitset) return EINVAL;
        const now = word();
        if (now === null) return EFAULT;
        if (now !== v32) return -11n; // EAGAIN: it changed before we slept
        if (timeout) {
          const t = this.timespec(state, timeout);
          if (t !== null && t < 0n) return t;
        }
        const me = this.threads[this.cur];
        me.wait = addr;
        me.bitset = bitset;
        me.timed = timeout !== 0n;
        return BLOCK;
      }
      case 1: // FUTEX_WAKE
      case 10: { // FUTEX_WAKE_BITSET
        const bitset = cmd === 10 ? Number(val3 & 0xffffffffn) : 0xffffffff;
        if (!bitset) return EINVAL;
        return BigInt(this.wake(addr, Number(BigInt.asIntN(32, val) < 0n ? 0n : v32), bitset));
      }
      case 3: // FUTEX_REQUEUE
      case 4: { // FUTEX_CMP_REQUEUE
        if (addr2 & 3n) return EINVAL;
        if (cmd === 4) {
          const now = word();
          if (now === null) return EFAULT;
          if (now !== (val3 & 0xffffffffn)) return -11n;
        }
        const n = this.wake(addr, Number(v32), 0xffffffff, addr2, Number(timeout & 0x7fffffffn));
        return BigInt(n);
      }
      default:
        this.unsupported.add(`futex op ${cmd}`);
        return ENOSYS;
    }
  }

  /** clone for a new thread (CLONE_VM | CLONE_THREAD). A new process is not provided. */
  private clone(state: GuestState, flags: bigint, stack: bigint, ptid: bigint, ctid: bigint, tls: bigint): bigint {
    const f = Number(flags & 0xffffffffn);
    if ((f & 0x10100) !== 0x10100) {
      this.unsupported.add("clone (a new process)");
      return ENOSYS;
    }
    if (this.threads.length >= MAX_THREADS) return -11n; // EAGAIN
    const tid = this.nextTid++;
    const put = (addr: bigint) => {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setUint32(0, tid, true);
      return state.write(addr, b);
    };
    if (f & 0x100000 && !put(ptid)) return EFAULT; // CLONE_PARENT_SETTID
    if (f & 0x1000000 && !put(ctid)) return EFAULT; // CLONE_CHILD_SETTID
    // The child starts as a copy of the parent returning 0 from clone, on its own stack and TLS.
    const parent = this.saveCtx(state.mem);
    const abi = ABI[this.arch];
    state.setReg(abi.ret, 0n);
    if (stack) state.setReg(abi.sp, stack);
    if (f & 0x80000) state.setReg(TP, tls); // CLONE_SETTLS
    const ctx = this.saveCtx(state.mem);
    this.loadCtx(state.mem, parent);
    this.threads.push({ tid, ctx, wait: null, bitset: 0, timed: false, clearTid: f & 0x200000 ? ctid : 0n }); // CLONE_CHILD_CLEARTID
    return BigInt(tid);
  }

  /** A thread ends: its CLONE_CHILD_CLEARTID word becomes 0 and one waiter on it wakes (pthread_join). */
  private threadExit(state: GuestState): Switch {
    const me = this.threads[this.cur];
    if (me.clearTid && state.write(me.clearTid, new Uint8Array(4))) this.wake(me.clearTid, 1);
    return THREAD_EXIT;
  }

  /** Program stores into shared mappings reach their files (only bytes inside the file; Linux drops the rest too). */
  private storeShared(mem: Uint8Array) {
    for (const m of this.shared) {
      const end = Math.min(m.len, m.node.size - m.off);
      let changed = false;
      // Skip unchanged words four bytes at a time; the byte loop below handles the rest.
      const aligned = (mem.byteOffset + m.addr) % 4 === 0 && m.shadow.byteOffset % 4 === 0;
      const words = aligned && end > 0 ? end >> 2 : 0;
      const now = new Uint32Array(mem.buffer, mem.byteOffset + m.addr, words);
      const was = new Uint32Array(m.shadow.buffer, m.shadow.byteOffset, words);
      for (let w = 0; w < words; w += 1) {
        if (now[w] === was[w]) continue;
        for (let i = w * 4; i < w * 4 + 4; i += 1) {
          const b = mem[m.addr + i];
          if (b === m.shadow[i]) continue; // only the bytes this view changed: another view may own the rest
          m.node.buf[m.off + i] = b;
          m.shadow[i] = b;
        }
        changed = true;
      }
      for (let i = words * 4; i < end; i += 1) {
        const b = mem[m.addr + i];
        if (b !== m.shadow[i]) {
          m.node.buf[m.off + i] = b;
          m.shadow[i] = b;
          changed = true;
        }
      }
      if (changed) m.node.version += 1; // every view of this file reloads after the call
    }
  }

  /** Every shared mapping shows its file as it is now. A cut file reads as zeros past its new end. */
  private loadShared(mem: Uint8Array) {
    for (const m of this.shared) {
      if (m.version === m.node.version) continue;
      const visible = Math.max(0, Math.min(m.len, m.node.size - m.off));
      const fresh = m.node.buf.subarray(m.off, m.off + visible);
      mem.set(fresh, m.addr);
      m.shadow.set(fresh);
      if (visible < m.visible) {
        const cut = Math.min(m.len, Math.max(m.visible, Number(pageUp(BigInt(visible)))));
        mem.fill(0, m.addr + visible, m.addr + cut);
        m.shadow.fill(0, visible, cut);
      }
      m.visible = visible;
      m.version = m.node.version;
    }
  }

  /** Forget shared mappings in [addr, end), keeping the parts outside it. */
  private unmapShared(addr: number, end: number) {
    const kept: SharedMap[] = [];
    for (const m of this.shared) {
      const lo = m.addr;
      const hi = m.addr + m.len;
      if (hi <= addr || lo >= end) {
        kept.push(m);
        continue;
      }
      const piece = (from: number, to: number): SharedMap => ({
        ...m,
        addr: from,
        len: to - from,
        off: m.off + (from - lo),
        shadow: m.shadow.slice(from - lo, to - lo),
        visible: Math.max(0, Math.min(to - from, m.visible - (from - lo))),
      });
      if (lo < addr) kept.push(piece(lo, addr));
      if (hi > end) kept.push(piece(end, hi));
    }
    this.shared = kept;
  }

  /** mmap: anonymous memory, or a private or shared view of a file. */
  private mmap(state: GuestState, addr: bigint, length: bigint, prot: bigint, flags: bigint, fdArg: bigint, offset: bigint): bigint {
    const f = Number(flags & 0xffffffffn);
    const anonymous = (f & 0x20) !== 0;
    if (offset & 0xfffn) return EINVAL;
    let node: FileNode | null = null;
    if (!anonymous) {
      if (!this.files.has(fd(fdArg))) return EBADF;
    }
    if (length === 0n) return EINVAL;
    if (!anonymous) {
      const got = this.files.mapFile(fd(fdArg), f & 3, Number(prot & 0xffn));
      if (typeof got === "bigint") return got;
      node = got;
    } else if ((f & 3) === 0) return EINVAL;
    const size = pageUp(length);
    let at: bigint;
    if (f & 0x10) {
      // MAP_FIXED: exactly there, replacing whatever was mapped
      if (addr & 0xfffn) return EINVAL;
      if (addr + size > BigInt(state.size) || addr === 0n) return ENOMEM;
      at = addr;
    } else {
      at = (this.mmapTop - size) & ~0xfffn;
      if (size > this.mmapTop || at < pageUp(this.brk)) return ENOMEM;
      this.mmapTop = at;
    }
    const lo = Number(at);
    const len = Number(size);
    this.unmapShared(lo, lo + len);
    state.mem.fill(0, lo, lo + len);
    if (node) {
      const off = Number(offset);
      const visible = Math.max(0, Math.min(len, node.size - off));
      state.mem.set(node.buf.subarray(off, off + visible), lo);
      if ((f & 3) !== 2) {
        this.shared.push({ addr: lo, len, node, off, shadow: state.mem.slice(lo, lo + len), version: node.version, visible });
      }
    }
    return at;
  }

  /** A struct timespec argument: absent (null), or an errno when it is out of range. */
  private timespec(state: GuestState, addr: bigint, usec = false): bigint | null {
    if (addr === 0n) return null;
    const raw = state.read(addr, 16);
    if (!raw) return EFAULT;
    const v = new DataView(raw.buffer, raw.byteOffset, 16);
    const sec = v.getBigInt64(0, true);
    const frac = v.getBigInt64(8, true);
    return sec < 0n || frac < 0n || frac >= (usec ? 1_000_000n : 1_000_000_000n) ? EINVAL : 0n;
  }

  /**
   * poll and ppoll. Nothing here ever becomes ready by waiting (one thread, a fixed clock), so the
   * answer is the readiness right now, whatever the timeout.
   */
  private poll(state: GuestState, fds: bigint, nfds: bigint): bigint {
    if (nfds > BigInt(FD_LIMIT)) return EINVAL;
    const n = Number(nfds);
    const raw = state.read(fds, n * 8);
    if (!raw) return EFAULT;
    const v = new DataView(raw.buffer, raw.byteOffset, n * 8);
    let ready = 0;
    for (let i = 0; i < n; i += 1) {
      const which = v.getInt32(i * 8, true);
      const events = v.getUint16(i * 8 + 4, true);
      let revents = 0;
      if (which >= 0) {
        const mask = this.files.pollMask(which);
        revents = mask < 0 ? POLLNVAL : mask & (events | POLLERR | POLLHUP);
      }
      v.setUint16(i * 8 + 6, revents, true);
      if (revents) ready += 1;
    }
    return n && !state.write(fds, raw) ? EFAULT : BigInt(ready);
  }

  /** select and pselect6: the three descriptor sets, rewritten to the ready ones. */
  private select(state: GuestState, nfds: bigint, sets: bigint[]): bigint {
    const n = Number(BigInt.asIntN(32, nfds));
    if (n < 0) return EINVAL;
    const count = Math.min(n, FD_LIMIT);
    const bytes = Math.ceil(count / 64) * 8;
    const ins = sets.map((addr) => (addr === 0n ? null : state.read(addr, bytes)?.slice() ?? EFAULT));
    for (const set of ins) if (set === EFAULT) return EFAULT;
    const bit = (set: Uint8Array | null | bigint, i: number) => set instanceof Uint8Array && (set[i >> 3] >> (i & 7)) & 1;
    const outs = sets.map(() => new Uint8Array(bytes));
    const want = [POLLIN_SET, POLLOUT_SET, POLLPRI];
    let ready = 0;
    for (let i = 0; i < count; i += 1) {
      if (!ins.some((set) => bit(set, i))) continue;
      const mask = this.files.pollMask(i);
      if (mask < 0) return EBADF;
      ins.forEach((set, k) => {
        if (bit(set, i) && mask & want[k]) {
          outs[k][i >> 3] |= 1 << (i & 7);
          ready += 1;
        }
      });
    }
    for (let k = 0; k < 3; k += 1) if (ins[k] && bytes && !state.write(sets[k], outs[k])) return EFAULT;
    return BigInt(ready);
  }

  private call(state: GuestState, name: string, a0: bigint, a1: bigint, a2: bigint, a3: bigint, a4: bigint, a5: bigint): bigint | "exit" | Switch {
    switch (name) {
      case "write": {
        const len = Number(a2 > 0x7fffffffn ? 0x7fffffffn : a2);
        const data = state.read(a1, len);
        return data ? this.files.write(fd(a0), data.slice()) : EFAULT;
      }
      case "writev": {
        let total = 0n;
        for (let i = 0; i < Number(a2 > 1024n ? 1024n : a2); i += 1) {
          const iov = state.read(a1 + BigInt(i * 16), 16);
          if (!iov) return EFAULT;
          const v = new DataView(iov.buffer, iov.byteOffset, 16);
          const data = state.read(v.getBigUint64(0, true), Number(v.getBigUint64(8, true) & 0x7fffffffn));
          if (!data) return EFAULT;
          const n = this.files.write(fd(a0), data.slice());
          if (n < 0n) return total || n;
          total += n;
          if (n < BigInt(data.length)) break;
        }
        return total;
      }
      case "read": {
        const got = this.files.read(fd(a0), Number(a2 > 0x7fffffffn ? 0x7fffffffn : a2));
        if (typeof got === "bigint") return got;
        return got.length && !state.write(a1, got) ? EFAULT : BigInt(got.length);
      }
      case "pread64": {
        const got = this.files.pread(fd(a0), Number(a2 > 0x7fffffffn ? 0x7fffffffn : a2), BigInt.asIntN(64, a3));
        if (typeof got === "bigint") return got;
        return got.length && !state.write(a1, got) ? EFAULT : BigInt(got.length);
      }
      case "pwrite64": {
        const data = state.read(a1, Number(a2 > 0x7fffffffn ? 0x7fffffffn : a2));
        return data ? this.files.pwrite(fd(a0), data.slice(), BigInt.asIntN(64, a3)) : EFAULT;
      }
      case "exit":
        // One thread ends; the program ends with the last one.
        if (this.threads.length > 1) return this.threadExit(state);
        this.exitCode = Number(a0 & 0xffn);
        return "exit";
      case "exit_group":
        this.exitCode = Number(a0 & 0xffn);
        return "exit";
      case "clone":
        return this.arch === "x86_64" ? this.clone(state, a0, a1, a2, a3, a4) : this.clone(state, a0, a1, a2, a4, a3);
      case "futex":
        return this.futex(state, a0, a1, a2, a3, a4, a5);
      case "sched_yield":
        return this.threads.length > 1 ? YIELD : 0n;
      case "brk":
        if (a0 === 0n || a0 < this.brkBase || a0 > this.mmapTop) return this.brk;
        if (a0 > this.brk) state.mem.fill(0, Number(this.brk), Number(a0));
        this.brk = a0;
        return this.brk;
      case "mmap":
        return this.mmap(state, a0, a1, a2, a3, a4, a5);
      case "munmap":
        if (a0 & 0xfffn || a1 === 0n) return EINVAL;
        this.unmapShared(Number(a0), Number(a0 + pageUp(a1)));
        return 0n;
      case "msync":
        // Stores already reached the file at this system call; only the arguments are checked.
        if (a0 & 0xfffn || a2 & ~7n || (a2 & 5n) === 5n) return EINVAL;
        return 0n;
      case "arch_prctl":
        if (a0 === 0x1002n) {
          // ARCH_SET_FS: the thread pointer for thread-local storage
          state.setReg(TP, a1);
          return 0n;
        }
        return EINVAL;
      case "mprotect":
      case "madvise":
      case "rt_sigaction":
      case "rt_sigprocmask":
      case "set_robust_list":
        return 0n;
      case "close":
        return this.files.close(fd(a0));
      case "openat":
      case "open": {
        const [dirfd, at, flags] = name === "open" ? [AT_FDCWD, a0, a1] : [fd(a0), a1, a2];
        const path = this.pathArg(state, at);
        return typeof path === "string" ? this.files.openAt(dirfd, path, this.openFlags(flags)) : path;
      }
      case "lseek":
        return this.files.lseek(fd(a0), BigInt.asIntN(64, a1), Number(a2 & 0xffffffffn));
      case "fstat":
        return this.stat(state, a1, this.files.statFd(fd(a0)));
      case "newfstatat": {
        const path = this.path(state, a1);
        if (typeof path !== "string") return path;
        // fstat(fd) arrives as newfstatat(fd, "", buf, AT_EMPTY_PATH).
        if (path === "") return (a3 & 0x1000n) !== 0n ? this.stat(state, a2, this.files.statFd(fd(a0))) : ENOENT;
        return a3 & ~0x1900n ? EINVAL : this.stat(state, a2, this.files.statAt(fd(a0), path, (a3 & 0x100n) === 0n)); // AT_SYMLINK_NOFOLLOW
      }
      case "stat":
      case "lstat": {
        const path = this.pathArg(state, a0);
        return typeof path === "string" ? this.stat(state, a1, this.files.statAt(AT_FDCWD, path, name === "stat")) : path;
      }
      case "symlink":
      case "symlinkat": {
        const target = this.path(state, a0);
        if (typeof target !== "string") return target;
        const at = this.pathArg(state, name === "symlink" ? a1 : a2);
        return typeof at === "string" ? this.files.symlinkAt(target, name === "symlink" ? AT_FDCWD : fd(a1), at) : at;
      }
      case "link":
      case "linkat": {
        const [od, oa, nd, na, flags] = name === "link" ? [AT_FDCWD, a0, AT_FDCWD, a1, 0n] : [fd(a0), a1, fd(a2), a3, a4];
        const from = this.pathArg(state, oa);
        if (typeof from !== "string") return from;
        const to = this.pathArg(state, na);
        return typeof to === "string" ? this.files.linkAt(od, from, nd, to, Number(flags & 0xffffffffn)) : to;
      }
      case "readlink":
      case "readlinkat": {
        const [dirfd, at, buf, size] = name === "readlink" ? [AT_FDCWD, a0, a1, a2] : [fd(a0), a1, a2, a3];
        if (BigInt.asIntN(32, size) <= 0n) return EINVAL;
        const path = this.pathArg(state, at);
        if (typeof path !== "string") return path;
        const got = this.files.readlinkAt(dirfd, path);
        if (typeof got === "bigint") return got;
        const out = got.subarray(0, Number(size > BigInt(got.length) ? BigInt(got.length) : size));
        return state.write(buf, out) ? BigInt(out.length) : EFAULT;
      }
      case "getcwd":
        // The working directory is always the root of the tree.
        if (a1 < 2n) return -34n; // ERANGE
        return state.write(a0, Uint8Array.from([0x2f, 0])) ? 2n : EFAULT;
      case "access":
      case "faccessat": {
        const path = this.pathArg(state, name === "access" ? a0 : a1);
        if (typeof path !== "string") return path;
        const st = this.files.statAt(name === "access" ? AT_FDCWD : fd(a0), path);
        return typeof st === "bigint" ? st : 0n;
      }
      case "unlink":
      case "rmdir":
      case "unlinkat": {
        const path = this.pathArg(state, name === "unlinkat" ? a1 : a0);
        if (typeof path !== "string") return path;
        if (name === "unlinkat") return a2 & ~0x200n ? EINVAL : this.files.unlinkAt(fd(a0), path, Number(a2));
        return this.files.unlinkAt(AT_FDCWD, path, name === "rmdir" ? 0x200 : 0);
      }
      case "mkdir":
      case "mkdirat": {
        const path = this.pathArg(state, name === "mkdir" ? a0 : a1);
        return typeof path === "string" ? this.files.mkdirAt(name === "mkdir" ? AT_FDCWD : fd(a0), path) : path;
      }
      case "rename":
        return this.rename(state, AT_FDCWD, a0, AT_FDCWD, a1, 0n);
      case "renameat":
        return this.rename(state, fd(a0), a1, fd(a2), a3, 0n);
      case "renameat2":
        return this.rename(state, fd(a0), a1, fd(a2), a3, a4);
      case "ftruncate":
        return this.files.ftruncate(fd(a0), BigInt.asIntN(64, a1));
      case "truncate": {
        const path = this.pathArg(state, a0);
        return typeof path === "string" ? this.files.truncateAt(AT_FDCWD, path, BigInt.asIntN(64, a1)) : path;
      }
      case "poll":
        return this.poll(state, a0, a1);
      case "ppoll": {
        const t = this.timespec(state, a2);
        return t !== null && t < 0n ? t : this.poll(state, a0, a1);
      }
      case "select": {
        const t = this.timespec(state, a4, true);
        return t !== null && t < 0n ? t : this.select(state, a0, [a1, a2, a3]);
      }
      case "pselect6": {
        const t = this.timespec(state, a4);
        return t !== null && t < 0n ? t : this.select(state, a0, [a1, a2, a3]);
      }
      case "getdents64": {
        const got = this.files.getdents(fd(a0), Number(a2 > 0x7fffffffn ? 0x7fffffffn : a2));
        if (typeof got === "bigint") return got;
        return got.length && !state.write(a1, got) ? EFAULT : BigInt(got.length);
      }
      case "dup":
        return this.files.dup(fd(a0));
      case "dup2":
        return this.files.dup2(fd(a0), fd(a1));
      case "dup3":
        return this.files.dup3(fd(a0), fd(a1), Number(a2 & 0xffffffffn));
      case "fcntl":
        return this.files.fcntl(fd(a0), Number(a1 & 0xffffffffn), a2);
      case "pipe":
      case "pipe2": {
        const ends = this.files.pipe(name === "pipe" ? 0 : Number(a1 & 0xffffffffn));
        if (typeof ends === "bigint") return ends;
        const buf = new Uint8Array(8);
        new DataView(buf.buffer).setInt32(0, ends[0], true);
        new DataView(buf.buffer).setInt32(4, ends[1], true);
        if (state.write(a0, buf)) return 0n;
        this.files.close(ends[0]);
        this.files.close(ends[1]);
        return EFAULT;
      }
      case "ioctl":
        return ENOTTY;
      case "gettid":
        return BigInt(this.threads[this.cur].tid);
      case "set_tid_address":
        this.threads[this.cur].clearTid = a0;
        return BigInt(this.threads[this.cur].tid);
      case "getpid":
      case "getuid":
      case "geteuid":
      case "getgid":
      case "getegid":
        return BigInt(MAIN_TID);
      case "uname": {
        const buf = new Uint8Array(65 * 6);
        ["Linux", "forge", "6.0.0-forge", "#1 Forge", this.arch, ""].forEach((s, i) => buf.set(enc.encode(s), i * 65));
        return state.write(a0, buf) ? 0n : EFAULT;
      }
      case "clock_gettime":
        return state.write(a1, new Uint8Array(16)) ? 0n : EFAULT; // a fixed clock: always zero
      case "getrandom": {
        const n = Math.min(Number(a1 > 256n ? 256n : a1), 256);
        const buf = globalThis.crypto.getRandomValues(new Uint8Array(n));
        return state.write(a0, buf) ? BigInt(n) : EFAULT;
      }
      case "prlimit64":
      case "rseq":
      case "clone3": // libc falls back to clone
        return ENOSYS; // known, deliberately not provided: libc falls back

      default:
        this.unsupported.add(name);
        return ENOSYS;
    }
  }
}

export type Relift = { ok: true } | { ok: false; stop: StopCode; detail: string };

/** The machine reached an address with no translation: lift from there, or say why it must stop. */
export function relift(program: Program, fetch: (addr: bigint) => number | undefined, pc: bigint, attempts: number): Relift {
  const gap = program.gaps.get(pc);
  if (gap) return { ok: false, stop: Stop.gap, detail: `stopped at 0x${pc.toString(16)}: ${gap.reason} (bytes ${gap.bytes}). Not executed.` };
  if (!inText(program, pc) || attempts > 256) return { ok: false, stop: Stop.unmapped, detail: `jumped to 0x${pc.toString(16)}, outside the program's code` };
  const { added } = lift(program, fetch, [pc]);
  if (!added && !program.insns.has(pc)) {
    const g = program.gaps.get(pc);
    return { ok: false, stop: Stop.gap, detail: g ? `stopped at 0x${pc.toString(16)}: ${g.reason} (bytes ${g.bytes}). Not executed.` : `no translation for 0x${pc.toString(16)}` };
  }
  return { ok: true };
}

export function stopDetail(stop: StopCode, pc: bigint, faultAddr: bigint): string {
  if (stop === Stop.fault) return `memory fault at 0x${faultAddr.toString(16)} (pc 0x${pc.toString(16)})`;
  if (stop === Stop.smc) return `store into code at 0x${faultAddr.toString(16)}; self-modifying code is not supported`;
  return `${STOP_NAME[stop]} at pc 0x${pc.toString(16)}`;
}

export function finishReport(
  shim: LinuxShim,
  program: Program,
  engine: LinuxReport["engine"],
  stop: StopCode,
  detail: string,
  instructions: number,
  relifts: number,
): LinuxReport {
  const finished = shim.exitCode !== null;
  const out = shim.stdout.bytes();
  return {
    ok: finished,
    arch: program.arch,
    engine,
    exitCode: shim.exitCode,
    stdout: dec.decode(out),
    stdoutBytes: out,
    stderr: dec.decode(shim.stderr.bytes()),
    stop: finished ? "exit" : shim.halt ? "deadlock" : STOP_NAME[stop] ?? "stopped",
    detail: finished ? `exited with code ${shim.exitCode}` : shim.halt ?? (detail || "stopped: too many host round trips"),
    gaps: [...program.gaps.values()],
    syscalls: shim.counts,
    unsupportedSyscalls: [...shim.unsupported],
    instructions,
    relifts,
    files: shim.files.snapshot(),
  };
}

export function runLinux(bytes: Uint8Array, options: LinuxOptions = {}): LinuxReport {
  const engineKind = options.engine ?? "tiered";
  const prepared = prepareLinux(bytes, options);
  if (!prepared.ok) {
    return {
      ok: false, arch: prepared.arch, engine: engineKind, exitCode: null, stdout: "", stdoutBytes: new Uint8Array(), stderr: "",
      stop: "not started", detail: prepared.reason, gaps: [], syscalls: {}, unsupportedSyscalls: [], instructions: 0, relifts: 0, files: {},
    };
  }
  const { program, fetch, memBytes } = prepared;
  let memory = prepared.memory;
  let state = new GuestState(memory);
  /**
   * Tiers, like any virtual machine with a JIT: the interpreter starts at once; once a program has run
   * long enough (tierUpAfter instructions) it is lowered to WebAssembly and continues there. When
   * WebAssembly reaches code that was not lifted yet, the new code runs in the interpreter for a slice
   * and the module is rebuilt only after discovery settles, instead of once per new address.
   */
  let tierAt = engineKind === "tiered" ? BigInt(options.tierUpAfter ?? 3_000_000) : 0n;
  const SLICE = 1_000_000n;
  let mode: "interp" | "wasm" = engineKind === "interpreter" || tierAt > 0n ? "interp" : "wasm";
  let wasm: Engine | null = null;
  let interp: Interpreter | null = null;
  let interpRan = 0n;
  const buildWasm = (): Engine => {
    if (!program.insns.size) return { name: "wasm", state, run: () => Stop.unmapped }; // nothing translatable yet
    const { run, mem } = instantiate(lowerProgram(program, memBytes));
    const fresh = new Uint8Array(mem.buffer);
    fresh.set(memory);
    memory = fresh;
    state = new GuestState(memory);
    interp = null;
    return { name: "wasm", state, run: () => run() as StopCode };
  };
  const shim = new LinuxShim(prepared.arch, prepared.brkBase, prepared.mmapTop, options.stdin, options.files);
  const maxEvents = options.maxEvents ?? 1_000_000;
  const startFuel = state.fuel;
  let relifts = 0;
  let stop: StopCode = Stop.running;
  let detail = "";
  for (let events = 0; events < maxEvents; events += 1) {
    if (mode === "wasm") {
      wasm ??= buildWasm();
      stop = wasm.run();
    } else {
      const total = state.fuel;
      const slice = engineKind === "interpreter" || total < SLICE ? total : SLICE;
      state.fuel = slice;
      interp ??= new Interpreter(program, state);
      stop = interp.run();
      const used = slice - state.fuel;
      state.fuel = total - used;
      interpRan += used;
      if (stop === Stop.fuel && state.fuel > 0n) {
        if (engineKind !== "interpreter" && interpRan >= tierAt) mode = "wasm";
        continue;
      }
    }
    if (stop === Stop.syscall) {
      if (shim.handle(state) === "exit") break;
      continue;
    }
    if (stop === Stop.unmapped) {
      const again = relift(program, fetch, state.pc, relifts);
      relifts += 1;
      if (!again.ok) {
        stop = again.stop;
        detail = again.detail;
        break;
      }
      interp = null; // new code: the interpreter picks it up at once
      if (engineKind !== "interpreter") {
        wasm = null; // rebuilt when the interpreter has run a slice without finding more
        mode = "interp";
        interpRan = 0n;
        tierAt = tierAt > SLICE ? tierAt : SLICE;
      }
      continue;
    }
    detail = stopDetail(stop, state.pc, state.faultAddr);
    break;
  }
  return finishReport(shim, program, engineKind, stop, detail, Number(startFuel - state.fuel), relifts);
}
