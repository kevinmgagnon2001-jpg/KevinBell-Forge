/**
 * Run a static Linux executable inside Forge.
 *
 *   ELF  ->  lift (x86-64 or AArch64 machine code -> guest IR)  ->  WebAssembly (or the interpreter)
 *        ->  run until a system call  ->  the Linux shim answers it  ->  run again
 *
 * The shim is a capability boundary, not a kernel. It implements what ordinary command-line
 * programs need to print and exit (write, writev, read from a provided stdin, brk, anonymous mmap,
 * exit) and answers everything else with -ENOSYS, recorded in the report. Files, network, processes
 * and signals are not reachable. Bytes the lifter does not know are reported and never executed.
 */
import { readElf, PF_X, type Segment } from "./elf.ts";
import { GuestState, Interpreter, type Engine } from "./machine.ts";
import { STOP_NAME, Stop, TP, type Gap, type GuestArch, type StopCode } from "./ir.ts";
import { inText, lift, newProgram, type Program } from "./lift.ts";
import { instantiate, lowerProgram } from "./wasm.ts";

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
};

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
};

const ENOSYS = -38n;
const EBADF = -9n;
const EINVAL = -22n;
const ENOMEM = -12n;
const ENOTTY = -25n;
const EFAULT = -14n;
const ENOENT = -2n;

export const ABI: Record<GuestArch, { nr: number; args: number[]; ret: number; sp: number; names: Record<number, string> }> = {
  x86_64: {
    nr: 0,
    args: [7, 6, 2, 10, 8, 9],
    ret: 0,
    sp: 4,
    names: { 0: "read", 1: "write", 2: "open", 3: "close", 5: "fstat", 9: "mmap", 10: "mprotect", 11: "munmap", 12: "brk", 13: "rt_sigaction", 14: "rt_sigprocmask", 16: "ioctl", 20: "writev", 21: "access", 28: "madvise", 39: "getpid", 60: "exit", 63: "uname", 89: "readlink", 102: "getuid", 104: "getgid", 107: "geteuid", 108: "getegid", 158: "arch_prctl", 186: "gettid", 201: "time", 218: "set_tid_address", 228: "clock_gettime", 231: "exit_group", 257: "openat", 262: "newfstatat", 267: "readlinkat", 269: "faccessat", 273: "set_robust_list", 302: "prlimit64", 318: "getrandom", 334: "rseq" },
  },
  aarch64: {
    nr: 8,
    args: [0, 1, 2, 3, 4, 5],
    ret: 0,
    sp: 31,
    names: { 29: "ioctl", 48: "faccessat", 56: "openat", 57: "close", 63: "read", 64: "write", 66: "writev", 78: "readlinkat", 79: "newfstatat", 80: "fstat", 93: "exit", 94: "exit_group", 96: "set_tid_address", 99: "set_robust_list", 113: "clock_gettime", 134: "rt_sigaction", 135: "rt_sigprocmask", 160: "uname", 172: "getpid", 174: "getuid", 175: "geteuid", 176: "getgid", 177: "getegid", 178: "gettid", 214: "brk", 215: "munmap", 222: "mmap", 226: "mprotect", 233: "madvise", 261: "prlimit64", 278: "getrandom", 293: "rseq" },
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
  const auxv: bigint[] = [6n, 4096n, 25n, random, 3n, phdr.addr, 4n, BigInt(phdr.entsize), 5n, BigInt(phdr.count), 9n, elf.entry, 23n, 0n, 0n, 0n];
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

class ByteSink {
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
}

/**
 * The Linux system-call shim. The same table is implemented in Rust for the desktop host
 * (src-tauri/src/guest.rs); keep the two in step.
 */
export class LinuxShim {
  readonly arch: GuestArch;
  readonly stdout = new ByteSink();
  readonly stderr = new ByteSink();
  readonly counts: Record<string, number> = {};
  readonly unsupported = new Set<string>();
  exitCode: number | null = null;
  private stdin: Uint8Array;
  private stdinAt = 0;
  private brkBase: bigint;
  private brk: bigint;
  private mmapTop: bigint;

  constructor(arch: GuestArch, brkBase: bigint, mmapTop: bigint, stdin?: Uint8Array | string) {
    this.arch = arch;
    this.brkBase = brkBase;
    this.brk = brkBase;
    this.mmapTop = mmapTop;
    this.stdin = typeof stdin === "string" ? enc.encode(stdin) : stdin ?? new Uint8Array();
  }

  private writeOut(fd: bigint, data: Uint8Array): bigint {
    if (fd === 1n) this.stdout.push(data);
    else if (fd === 2n) this.stderr.push(data);
    else return EBADF;
    return BigInt(data.length);
  }

  /** Answer the system call the guest is making. Returns "exit" when the program ends. */
  handle(state: GuestState): "exit" | "continue" {
    const abi = ABI[this.arch];
    const nr = Number(state.reg(abi.nr));
    const [a0, a1, a2, a3] = abi.args.map((r) => state.reg(r));
    const name = abi.names[nr] ?? `#${nr}`;
    this.counts[name] = (this.counts[name] ?? 0) + 1;
    const out = this.call(state, name, a0, a1, a2, a3);
    if (out === "exit") return "exit";
    state.setReg(abi.ret, out);
    return "continue";
  }

  private call(state: GuestState, name: string, a0: bigint, a1: bigint, a2: bigint, a3: bigint): bigint | "exit" {
    switch (name) {
      case "write": {
        const len = Number(a2 > 0x7fffffffn ? 0x7fffffffn : a2);
        const data = state.read(a1, len);
        return data ? this.writeOut(a0, data.slice()) : EFAULT;
      }
      case "writev": {
        let total = 0n;
        for (let i = 0; i < Number(a2 > 1024n ? 1024n : a2); i += 1) {
          const iov = state.read(a1 + BigInt(i * 16), 16);
          if (!iov) return EFAULT;
          const v = new DataView(iov.buffer, iov.byteOffset, 16);
          const data = state.read(v.getBigUint64(0, true), Number(v.getBigUint64(8, true) & 0x7fffffffn));
          if (!data) return EFAULT;
          const n = this.writeOut(a0, data.slice());
          if (n < 0n) return n;
          total += n;
        }
        return total;
      }
      case "read": {
        if (a0 !== 0n) return EBADF;
        const n = Math.max(0, Math.min(Number(a2 > 0x7fffffffn ? 0x7fffffffn : a2), this.stdin.length - this.stdinAt));
        if (n > 0 && !state.write(a1, this.stdin.subarray(this.stdinAt, this.stdinAt + n))) return EFAULT;
        this.stdinAt += n;
        return BigInt(n);
      }
      case "exit":
      case "exit_group":
        this.exitCode = Number(a0 & 0xffn);
        return "exit";
      case "brk":
        if (a0 === 0n || a0 < this.brkBase || a0 > this.mmapTop) return this.brk;
        if (a0 > this.brk) state.mem.fill(0, Number(this.brk), Number(a0));
        this.brk = a0;
        return this.brk;
      case "mmap": {
        if ((Number(a3) & 0x20) === 0) return ENOSYS; // only anonymous memory; there are no files
        const size = pageUp(a1);
        const next = (this.mmapTop - size) & ~0xfffn;
        if (size === 0n || next < pageUp(this.brk)) return ENOMEM;
        this.mmapTop = next;
        state.mem.fill(0, Number(next), Number(next + size));
        return next;
      }
      case "arch_prctl":
        if (a0 === 0x1002n) {
          // ARCH_SET_FS: the thread pointer for thread-local storage
          state.setReg(TP, a1);
          return 0n;
        }
        return EINVAL;
      case "munmap":
      case "mprotect":
      case "madvise":
      case "rt_sigaction":
      case "rt_sigprocmask":
      case "close":
      case "set_robust_list":
        return 0n;
      case "ioctl":
        return ENOTTY;
      case "getpid":
      case "gettid":
      case "getuid":
      case "geteuid":
      case "getgid":
      case "getegid":
      case "set_tid_address":
        return 1000n;
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
      case "readlinkat":
      case "readlink":
      case "openat":
      case "open":
      case "access":
      case "faccessat":
      case "newfstatat":
      case "fstat":
        return ENOENT; // there is no file system
      case "prlimit64":
      case "rseq":
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
    stop: finished ? "exit" : STOP_NAME[stop] ?? "stopped",
    detail: finished ? `exited with code ${shim.exitCode}` : detail || "stopped: too many host round trips",
    gaps: [...program.gaps.values()],
    syscalls: shim.counts,
    unsupportedSyscalls: [...shim.unsupported],
    instructions,
    relifts,
  };
}

export function runLinux(bytes: Uint8Array, options: LinuxOptions = {}): LinuxReport {
  const engineKind = options.engine ?? "tiered";
  const prepared = prepareLinux(bytes, options);
  if (!prepared.ok) {
    return {
      ok: false, arch: prepared.arch, engine: engineKind, exitCode: null, stdout: "", stdoutBytes: new Uint8Array(), stderr: "",
      stop: "not started", detail: prepared.reason, gaps: [], syscalls: {}, unsupportedSyscalls: [], instructions: 0, relifts: 0,
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
  const shim = new LinuxShim(prepared.arch, prepared.brkBase, prepared.mmapTop, options.stdin);
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
