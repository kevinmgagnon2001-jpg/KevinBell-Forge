/**
 * Guest machine state and the reference interpreter.
 *
 * State lives inside guest memory in the null page (see STATE in ir.ts), so the interpreter and the
 * WebAssembly backend share one layout and the Linux shim can work with either.
 */
import {
  aluValue,
  bitsToF32,
  bitsToF64,
  CPUID,
  f32ToBits,
  f64ToBits,
  floatOp,
  floatToInt,
  i64ToF32,
  nanResult,
  parity,
  vecValue,
  evalCond,
  flagsAfter,
  M64,
  mask,
  NREG,
  XMM,
  armF2i,
  armFcmpNzcv,
  armFma,
  armFop,
  armRound,
  u64ToF32,
  u64ToF64,
  NULL_PAGE,
  nzcvFlags,
  STATE,
  Stop,
  u64,
  writeWidth,
  type Ea,
  type Flags,
  type Src,
  type StopCode,
} from "./ir.ts";
import { codeExtent, type Program } from "./lift.ts";

export class GuestState {
  readonly mem: Uint8Array;
  private view: DataView;
  constructor(mem: Uint8Array) {
    this.mem = mem;
    this.view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
  }
  get size(): number {
    return this.mem.byteLength;
  }
  reg(i: number): bigint {
    return this.view.getBigUint64(STATE.regs + i * 8, true);
  }
  setReg(i: number, v: bigint) {
    this.view.setBigUint64(STATE.regs + i * 8, u64(v), true);
  }
  get pc(): bigint {
    return this.view.getBigUint64(STATE.pc, true);
  }
  set pc(v: bigint) {
    this.view.setBigUint64(STATE.pc, u64(v), true);
  }
  get flags(): Flags {
    const g = (i: number) => this.view.getInt32(STATE.flags + i * 4, true);
    return { z: g(0), s: g(1), c: g(2), o: g(3), k: g(4), p: g(5) };
  }
  set flags(f: Flags) {
    [f.z, f.s, f.c, f.o, f.k, f.p ?? 0].forEach((v, i) => this.view.setInt32(STATE.flags + i * 4, v, true));
  }
  get fuel(): bigint {
    return this.view.getBigInt64(STATE.fuel, true);
  }
  set fuel(v: bigint) {
    this.view.setBigInt64(STATE.fuel, v, true);
  }
  get code(): number {
    return this.view.getInt32(STATE.code, true);
  }
  set code(v: number) {
    this.view.setInt32(STATE.code, v, true);
  }
  get faultAddr(): bigint {
    return this.view.getBigUint64(STATE.fault, true);
  }
  set faultAddr(v: bigint) {
    this.view.setBigUint64(STATE.fault, u64(v), true);
  }
  /** Guest memory accessors for the shim. They refuse the null page and anything out of range. */
  ok(addr: bigint, len: number): boolean {
    return addr >= BigInt(NULL_PAGE) && addr + BigInt(len) <= BigInt(this.size);
  }
  read(addr: bigint, len: number): Uint8Array | null {
    if (!this.ok(addr, len)) return null;
    return this.mem.subarray(Number(addr), Number(addr) + len);
  }
  write(addr: bigint, bytes: Uint8Array): boolean {
    if (!this.ok(addr, bytes.length)) return false;
    this.mem.set(bytes, Number(addr));
    return true;
  }
}

export interface Engine {
  readonly name: "interpreter" | "wasm";
  readonly state: GuestState;
  run(): StopCode;
}

/** The reference: slow, simple, BigInt everywhere. The WebAssembly backend is tested against it. */
export class Interpreter implements Engine {
  readonly name = "interpreter" as const;
  readonly state: GuestState;
  private program: Program;
  private regs = new Array<bigint>(NREG).fill(0n);
  private code: [bigint, bigint][];
  constructor(program: Program, state: GuestState) {
    this.program = program;
    this.state = state;
    this.code = codeExtent(program);
  }

  private val(s: Src): bigint {
    return "r" in s ? this.regs[s.r] : s.imm;
  }
  private ea(e: Ea): bigint {
    let a = e.disp;
    if (e.base !== null) a += this.regs[e.base];
    if (e.index !== null) a += this.regs[e.index] * BigInt(e.scale);
    if (e.a32) a &= 0xffffffffn;
    if (e.seg !== undefined) a += this.regs[e.seg];
    return u64(a);
  }
  private inText(addr: bigint, size: number): boolean {
    return this.code.some(([lo, hi]) => addr < hi && addr + BigInt(size) > lo);
  }

  run(): StopCode {
    const st = this.state;
    const mem = st.mem;
    const dv = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
    for (let i = 0; i < NREG; i += 1) this.regs[i] = st.reg(i);
    let flags = st.flags;
    let pc = st.pc;
    let fuel = st.fuel;
    const regs = this.regs;
    const memSize = BigInt(mem.byteLength);
    const bad = (addr: bigint, size: number) => addr < BigInt(NULL_PAGE) || addr > memSize - BigInt(size);
    let code: StopCode = Stop.running;

    outer: for (;;) {
      fuel -= 1n;
      if (fuel < 0n) {
        code = Stop.fuel;
        break;
      }
      const insn = this.program.insns.get(pc);
      if (!insn) {
        code = Stop.unmapped;
        break;
      }
      let nextPc = insn.next;
      let moved = false;
      for (const op of insn.ops) {
        switch (op.k) {
          case "mov":
            regs[op.d] = writeWidth(regs[op.d], this.val(op.s), op.w);
            break;
          case "alu": {
            const a = this.val(op.a);
            const b = this.val(op.b);
            const r = aluValue(op.op, a, b, op.w, flags.c);
            flags = flagsAfter(op.op, op.f, a, b, r, op.w, flags);
            if (op.d !== null) regs[op.d] = writeWidth(regs[op.d], r, op.w);
            break;
          }
          case "ext": {
            const v = this.val(op.s) & mask(op.from);
            const e = op.signed ? u64(BigInt.asIntN(op.from, v)) : v;
            regs[op.d] = writeWidth(regs[op.d], e, op.w);
            break;
          }
          case "lea":
            regs[op.d] = writeWidth(regs[op.d], this.ea(op.ea), op.w);
            break;
          case "load": {
            const addr = this.ea(op.ea);
            if (bad(addr, op.size)) {
              st.faultAddr = addr;
              pc = insn.pc;
              code = Stop.fault;
              break outer;
            }
            const at = Number(addr);
            let v =
              op.size === 1 ? BigInt(dv.getUint8(at)) : op.size === 2 ? BigInt(dv.getUint16(at, true)) : op.size === 4 ? BigInt(dv.getUint32(at, true)) : dv.getBigUint64(at, true);
            if (op.signed) v = u64(BigInt.asIntN(op.size * 8, v));
            regs[op.d] = writeWidth(regs[op.d], v, op.w);
            break;
          }
          case "store": {
            const addr = this.ea(op.ea);
            if (bad(addr, op.size)) {
              st.faultAddr = addr;
              pc = insn.pc;
              code = Stop.fault;
              break outer;
            }
            if (this.inText(addr, op.size)) {
              st.faultAddr = addr;
              pc = insn.pc;
              code = Stop.smc;
              break outer;
            }
            const v = this.val(op.s);
            const at = Number(addr);
            if (op.size === 1) dv.setUint8(at, Number(v & 0xffn));
            else if (op.size === 2) dv.setUint16(at, Number(v & 0xffffn), true);
            else if (op.size === 4) dv.setUint32(at, Number(v & 0xffffffffn), true);
            else dv.setBigUint64(at, v & M64, true);
            break;
          }
          case "set":
            regs[op.d] = writeWidth(regs[op.d], evalCond(op.c, flags) ? 1n : 0n, op.w);
            break;
          case "csel": {
            const v = evalCond(op.c, flags) ? this.val(op.a) : this.val(op.b);
            regs[op.d] = writeWidth(regs[op.d], v & mask(op.w), op.w);
            break;
          }
          case "ccmp": {
            if (evalCond(op.c, flags)) {
              const a = this.val(op.a);
              const b = this.val(op.b);
              const kind = op.neg ? "add" : "sub";
              flags = flagsAfter(kind, "arith", a, b, aluValue(kind, a, b, op.w), op.w, flags);
            } else flags = nzcvFlags(op.nzcv, flags.p);
            break;
          }
          case "setnzcv":
            flags = nzcvFlags(op.nzcv, flags.p);
            break;
          case "setflags": {
            const v = this.val(op.s);
            const bit = (n: number) => Number((v >> BigInt(n)) & 1n);
            flags = { c: bit(0), p: bit(2), z: bit(6), s: bit(7), o: bit(11), k: 0 };
            break;
          }
          case "br":
            if (evalCond(op.c, flags)) {
              nextPc = op.t;
              moved = true;
            }
            break;
          case "cbz": {
            const zero = (this.val(op.s) & mask(op.w)) === 0n;
            if (zero !== op.nz) {
              nextPc = op.t;
              moved = true;
            }
            break;
          }
          case "tbz": {
            const set = ((this.val(op.s) >> BigInt(op.bit)) & 1n) === 1n;
            if (set === op.nz) {
              nextPc = op.t;
              moved = true;
            }
            break;
          }
          case "jmp":
            nextPc = op.t;
            moved = true;
            break;
          case "jmpr":
            nextPc = this.val(op.s);
            moved = true;
            break;
          case "sys":
            pc = insn.next;
            code = Stop.syscall;
            break outer;
          case "guardz":
            if ((this.val(op.s) & mask(op.w)) === 0n) {
              pc = insn.pc;
              code = Stop.div0;
              break outer;
            }
            break;
          case "guardext": {
            const m = mask(op.w);
            const lo = regs[op.lo] & m;
            const want = op.signed && (lo >> BigInt(op.w - 1)) & 1n ? m : 0n;
            if ((regs[op.hi] & m) !== want) {
              pc = insn.pc;
              code = Stop.unsupported;
              break outer;
            }
            break;
          }
          case "halt":
            pc = insn.pc;
            code = Stop.halt;
            break outer;
          case "vec": {
            const pair = (x: number): [bigint, bigint] => [regs[XMM(x)], regs[XMM(x, 1)]];
            const [lo, hi] = vecValue(op.op, pair(op.a), pair(op.b), op.imm);
            regs[XMM(op.d)] = lo;
            regs[XMM(op.d, 1)] = hi;
            break;
          }
          case "vmask": {
            const lo = regs[XMM(op.a)];
            const hi = regs[XMM(op.a, 1)];
            let m = 0n;
            if (op.lanes === 16) {
              for (let i = 0; i < 8; i += 1) m |= ((lo >> BigInt(8 * i + 7)) & 1n) << BigInt(i);
              for (let i = 0; i < 8; i += 1) m |= ((hi >> BigInt(8 * i + 7)) & 1n) << BigInt(8 + i);
            } else {
              m = ((lo >> 31n) & 1n) | (((lo >> 63n) & 1n) << 1n) | (((hi >> 31n) & 1n) << 2n) | (((hi >> 63n) & 1n) << 3n);
            }
            regs[op.d] = m;
            break;
          }
          case "fop": {
            const lo = (x: number) => XMM(x);
            if (op.arm) {
              const r = armFop(op.op, regs[lo(op.a)], regs[lo(op.b)], op.size);
              regs[lo(op.d)] = op.size === 8 ? r : (regs[lo(op.d)] & 0xffffffff00000000n) | r;
              break;
            }
            if (op.op === "maxnm" || op.op === "minnm") break; // ARM only
            if (op.op === "min" || op.op === "max") {
              // exact bits of whichever operand wins; NaN or equal zeros give the second
              const read = (x: number) => (op.size === 8 ? bitsToF64(regs[lo(x)]) : bitsToF32(regs[lo(x)]));
              const A = read(op.a);
              const B = read(op.b);
              const pickA = op.op === "min" ? A < B : A > B;
              const m = op.size === 8 ? M64 : 0xffffffffn;
              const bits = (pickA ? regs[lo(op.a)] : regs[lo(op.b)]) & m;
              regs[lo(op.d)] = op.size === 8 ? bits : (regs[lo(op.d)] & 0xffffffff00000000n) | bits;
              break;
            }
            if (op.size === 8) {
              const r = floatOp(op.op, bitsToF64(regs[lo(op.a)]), bitsToF64(regs[lo(op.b)]), 8);
              regs[lo(op.d)] = Number.isNaN(r) ? nanResult(regs[lo(op.a)], regs[lo(op.b)], 8, op.op) : f64ToBits(r);
            } else {
              const r = floatOp(op.op, bitsToF32(regs[lo(op.a)]), bitsToF32(regs[lo(op.b)]), 4);
              const bits = Number.isNaN(r) ? nanResult(regs[lo(op.a)], regs[lo(op.b)], 4, op.op) : f32ToBits(r);
              regs[lo(op.d)] = (regs[lo(op.d)] & 0xffffffff00000000n) | bits;
            }
            break;
          }
          case "fcvt": {
            const lo = (x: number) => XMM(x);
            if (op.kind === "i2f" && op.unsigned) {
              const v = this.val(op.s) & mask(op.w);
              if (op.size === 8) regs[lo(op.d)] = f64ToBits(u64ToF64(v));
              else regs[lo(op.d)] = (regs[lo(op.d)] & 0xffffffff00000000n) | f32ToBits(u64ToF32(v));
            } else if (op.kind === "f2i" && op.arm) {
              regs[op.d] = writeWidth(regs[op.d], armF2i(regs[lo(op.a)], op.size, op.w, op.arm.round, op.arm.unsigned), op.w);
            } else if (op.kind === "i2f") {
              const v = this.val(op.s) & mask(op.w);
              const n = Number(BigInt.asIntN(op.w, v));
              if (op.size === 8) regs[lo(op.d)] = f64ToBits(Number(BigInt.asIntN(op.w, v)));
              else regs[lo(op.d)] = (regs[lo(op.d)] & 0xffffffff00000000n) | f32ToBits(op.w === 64 ? i64ToF32(BigInt.asIntN(64, v)) : Math.fround(n));
            } else if (op.kind === "f2i") {
              const x = op.size === 8 ? bitsToF64(regs[lo(op.a)]) : bitsToF32(regs[lo(op.a)]);
              regs[op.d] = writeWidth(regs[op.d], floatToInt(x, op.w, op.trunc), op.w);
            } else if (op.from === 8) {
              regs[lo(op.d)] = (regs[lo(op.d)] & 0xffffffff00000000n) | f32ToBits(Math.fround(bitsToF64(regs[lo(op.a)])));
            } else regs[lo(op.d)] = f64ToBits(bitsToF32(regs[lo(op.a)]));
            break;
          }
          case "fcmp": {
            const lo = (x: number) => XMM(x);
            if (op.arm) {
              if (op.cond && !evalCond(op.cond, flags)) flags = nzcvFlags(op.nzcv ?? 0, flags.p);
              else flags = nzcvFlags(armFcmpNzcv(regs[lo(op.a)], regs[lo(op.b)], op.size), flags.p);
              break;
            }
            const a = op.size === 8 ? bitsToF64(regs[lo(op.a)]) : bitsToF32(regs[lo(op.a)]);
            const b = op.size === 8 ? bitsToF64(regs[lo(op.b)]) : bitsToF32(regs[lo(op.b)]);
            const un = Number.isNaN(a) || Number.isNaN(b);
            flags = { z: un || a === b ? 1 : 0, p: un ? 1 : 0, c: un || a < b ? 1 : 0, s: 0, o: 0, k: 0 };
            break;
          }
          case "fround": {
            const r = armRound(regs[XMM(op.a)], op.size, op.mode);
            regs[XMM(op.d)] = op.size === 8 ? r : (regs[XMM(op.d)] & 0xffffffff00000000n) | r;
            break;
          }
          case "fma": {
            const r = armFma(regs[XMM(op.a)], regs[XMM(op.b)], regs[XMM(op.c)], op.size, op.negProduct, op.negAddend);
            regs[XMM(op.d)] = op.size === 8 ? r : (regs[XMM(op.d)] & 0xffffffff00000000n) | r;
            break;
          }
          case "div2": {
            const w = op.w;
            const m = mask(w);
            const d = this.val(op.s) & m;
            const hi = regs[2] & m;
            const lo = regs[0] & m;
            let q: bigint;
            let r: bigint;
            if (d === 0n) {
              pc = insn.pc;
              code = Stop.div0;
              break outer;
            }
            if (!op.signed) {
              const n = (hi << BigInt(w)) | lo;
              q = n / d;
              r = n % d;
              if (q > m) {
                pc = insn.pc;
                code = Stop.div0;
                break outer;
              }
            } else {
              const n = BigInt.asIntN(2 * w, (hi << BigInt(w)) | lo);
              const dd = BigInt.asIntN(w, d);
              q = n / dd;
              r = n % dd;
              const lim = 1n << BigInt(w - 1);
              if (q < -lim || q >= lim) {
                pc = insn.pc;
                code = Stop.div0;
                break outer;
              }
            }
            regs[0] = writeWidth(regs[0], q & m, w);
            regs[2] = writeWidth(regs[2], r & m, w);
            break;
          }
          case "flagsz": {
            if (op.when && (this.val(op.when.s) & BigInt(op.when.mask)) === 0n) break;
            const v = this.val(op.v) & mask(op.w);
            flags = { z: v === 0n ? 1 : 0, s: Number((v >> BigInt(op.w - 1)) & 1n), c: 0, o: 0, k: 0, p: parity(v) };
            break;
          }
          case "setflag": {
            if (op.when) {
              const m = Number(this.val(op.when.s) & BigInt(op.when.mask));
              if (op.when.eq === undefined ? m === 0 : m !== op.when.eq) break;
            }
            const bit = Number((this.val(op.v) >> BigInt(op.bit)) & 1n);
            flags = op.flag === "c" ? { ...flags, c: bit } : { ...flags, o: bit };
            break;
          }
          case "cpuid": {
            const leaf = Number(regs[0] & 0xffffffffn);
            const row = CPUID.find(([l]) => l === leaf)?.[1] ?? [0, 0, 0, 0];
            [0, 3, 1, 2].forEach((r, i) => (regs[r] = BigInt(row[i] >>> 0)));
            break;
          }
        }
        // A transfer ends the instruction: later ops (none, in practice) do not run.
        if (moved) break;
      }
      pc = nextPc;
    }
    for (let i = 0; i < NREG; i += 1) st.setReg(i, regs[i]);
    st.flags = flags;
    st.pc = pc;
    st.fuel = fuel < 0n ? 0n : fuel;
    st.code = code;
    return code;
  }
}
