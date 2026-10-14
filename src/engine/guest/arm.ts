/**
 * AArch64 front end: one 32-bit instruction in, guest IR out.
 *
 * Covers the integer A64 base that compilers emit with -mgeneral-regs-only: move wide, add/sub
 * (immediate, shifted, extended), logical (immediate and shifted), bitfield moves, mul/div/mulh,
 * conditional select and compare, every branch form, loads and stores (unsigned offset, unscaled,
 * pre/post-index, register offset, literal, pairs), adr/adrp, svc and the hint space.
 * Also: SIMD/FP loads and stores of every size, the Advanced SIMD and scalar floating-point
 * instructions glibc's baseline code uses (arm-simd.ts), exclusive and ordered loads and stores (one
 * thread, so a store-exclusive always succeeds), and the system registers a program may read
 * (tpidr_el0, fpcr/fpsr, dczid_el0, ctr_el0, the counter). LSE atomics, SVE, MTE and SME are gaps:
 * the guest is told it has FP and Advanced SIMD only (AT_HWCAP), so libc never selects them.
 * Encodings follow the Arm ARM (DDI 0487).
 */

/** ARM vector register n (v0..v31) as a vector number for XMM(): 0..15, then 17..32 (16 is the temp). */
export const V = (n: number) => (n < 16 ? n : n + 1);

/** System registers a program may read, by their MRS encoding (op0:op1:CRn:CRm:op2). */
const SYSREG = {
  tpidr: 0xde82,
  fpcr: 0xda20,
  fpsr: 0xda21,
  dczid: 0xd807,
  ctr: 0xd801,
  cntvct: 0xdf02,
  cntfrq: 0xdf00,
  midr: 0xc000,
} as const;
import { imm, M64, mask, reg, SINK, T0, T1, T2, T3, TP, u64, XMM, type Cond, type Ea, type Insn, type Op, type Src, type W } from "./ir.ts";
import type { Decoded, Fetch } from "./x86.ts";
import { decodeSimd } from "./arm-simd.ts";

const SP = 31;
const LR = 30;
const CONDS: Cond[] = ["eq", "ne", "cs", "cc", "s", "ns", "o", "no", "hi", "ls", "ge", "lt", "gt", "le", "al", "al"];

const bits = (v: number, hi: number, lo: number) => (v >>> lo) & ((1 << (hi - lo + 1)) - 1);
const sext = (v: number, n: number) => (v << (32 - n)) >> (32 - n);

function decodeBitMasks(n: number, imms: number, immr: number, size: number): bigint | null {
  const combined = (n << 6) | (~imms & 0x3f);
  let len = -1;
  for (let i = 6; i >= 0; i -= 1) if (combined & (1 << i)) { len = i; break; }
  if (len < 1) return null;
  const levels = (1 << len) - 1;
  const s = imms & levels;
  const r = immr & levels;
  if (s === levels) return null;
  const esize = 1 << len;
  if (esize > size) return null;
  const emask = mask(esize);
  const welem = mask(s + 1);
  const rot = BigInt(r);
  const elem = ((welem >> rot) | (welem << (BigInt(esize) - rot))) & emask;
  let out = 0n;
  for (let i = 0; i < size; i += esize) out |= elem << BigInt(i);
  return out & mask(size);
}

export function decodeArm(fetch: Fetch, pc: bigint): Decoded {
  const raw: number[] = [];
  for (let i = 0n; i < 4n; i += 1n) {
    const b = fetch(pc + i);
    if (b === undefined) return { gap: { pc, bytes: raw.map((x) => x.toString(16).padStart(2, "0")).join(" "), reason: "instruction runs off mapped code" } };
    raw.push(b);
  }
  const word = (raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24)) >>> 0;
  const hexWord = raw.map((x) => x.toString(16).padStart(2, "0")).join(" ");
  const next = pc + 4n;
  const ops: Op[] = [];
  let targets: bigint[] = [];
  let fall = true;
  let text = "";
  const fail = (reason: string): Decoded => ({ gap: { pc, bytes: hexWord, reason } });
  const done = (): Decoded => {
    const insn: Insn = { pc, len: 4, next, ops, fall, text: text || hexWord };
    return { insn, targets: targets.map(u64) };
  };

  const rd = bits(word, 4, 0);
  const rn = bits(word, 9, 5);
  const rm = bits(word, 20, 16);
  const sf = word >>> 31;
  const W_: W = sf ? 64 : 32;
  /** Source register: 31 is xzr unless the encoding says sp. */
  const R = (n: number, sp = false): Src => (n === 31 ? (sp ? reg(SP) : imm(0)) : reg(n));
  /** Destination register: 31 discards unless the encoding says sp. */
  const D = (n: number, sp = false): number => (n === 31 ? (sp ? SP : SINK) : n);

  /** Apply a shift to a register operand into a temp, returning the operand. */
  const shifted = (src: Src, type: number, amount: number, w: W, tmp: number): Src | null => {
    if (amount === 0) return src;
    const op = type === 0 ? "shl" : type === 1 ? "shr" : type === 2 ? "sar" : "ror";
    ops.push({ k: "alu", op, d: tmp, a: src, b: imm(amount), w, f: "none" });
    return reg(tmp);
  };
  /** Extended register operand (uxtb..sxtx) with left shift. */
  const extended = (src: Src, option: number, amount: number, tmp: number): Src => {
    const from = [8, 16, 32, 64][option & 3] as 8 | 16 | 32 | 64;
    const signed = option >= 4;
    let out = src;
    if (from < 64) {
      ops.push({ k: "ext", d: tmp, s: src, from: from as 8 | 16 | 32, signed, w: 64 });
      out = reg(tmp);
    }
    if (amount) {
      ops.push({ k: "alu", op: "shl", d: tmp, a: out, b: imm(amount), w: 64, f: "none" });
      out = reg(tmp);
    }
    return out;
  };

  /**
   * SIMD/FP register vt loaded from or stored to ea, `size` bytes (1..16). A load writes the low
   * bytes and clears the rest of the 128-bit register, as on the CPU.
   */
  const vload = (vt: number, ea: Ea, size: number) => {
    const lo = XMM(V(vt));
    if (size === 16) {
      ops.push({ k: "lea", d: T3, ea, w: 64 });
      ops.push({ k: "load", d: lo, ea: { base: T3, index: null, scale: 1, disp: 0n }, size: 8, signed: false, w: 64 });
      ops.push({ k: "load", d: lo + 1, ea: { base: T3, index: null, scale: 1, disp: 8n }, size: 8, signed: false, w: 64 });
    } else {
      ops.push({ k: "load", d: lo, ea, size: size as 1 | 2 | 4 | 8, signed: false, w: 64 });
      ops.push({ k: "mov", d: lo + 1, s: imm(0), w: 64 });
    }
  };
  const vstore = (vt: number, ea: Ea, size: number) => {
    const lo = XMM(V(vt));
    if (size === 16) {
      ops.push({ k: "lea", d: T3, ea, w: 64 });
      ops.push({ k: "store", s: reg(lo), ea: { base: T3, index: null, scale: 1, disp: 0n }, size: 8 });
      ops.push({ k: "store", s: reg(lo + 1), ea: { base: T3, index: null, scale: 1, disp: 8n }, size: 8 });
    } else ops.push({ k: "store", s: reg(lo), ea, size: size as 1 | 2 | 4 | 8 });
  };

  // ---------- hints, barriers, system ----------
  if ((word & 0xfffff01f) >>> 0 === 0xd503201f) { text = "hint"; return done(); }
  if ((word & 0xfffff09f) >>> 0 === 0xd503309f) { text = "barrier"; return done(); } // dsb/dmb/isb
  if ((word & 0xffe0001f) >>> 0 === 0xd4000001) { text = "svc"; ops.push({ k: "sys" }); return done(); }
  if ((word & 0xffe0001f) >>> 0 === 0xd4200000) return fail("brk breakpoint");

  // ---------- branches ----------
  if ((word & 0x7c000000) >>> 0 === 0x14000000) {
    const t = u64(pc + BigInt(sext(bits(word, 25, 0), 26) * 4));
    if (word >>> 31) {
      text = "bl";
      ops.push({ k: "mov", d: LR, s: imm(next), w: 64 });
      targets = [t, next];
    } else {
      text = "b";
      targets = [t];
    }
    ops.push({ k: "jmp", t });
    fall = false;
    return done();
  }
  if ((word & 0xff000010) >>> 0 === 0x54000000) {
    const t = u64(pc + BigInt(sext(bits(word, 23, 5), 19) * 4));
    const c = CONDS[word & 15];
    text = `b.${c}`;
    if (c === "al") {
      ops.push({ k: "jmp", t });
      fall = false;
    } else ops.push({ k: "br", c, t });
    targets = [t];
    return done();
  }
  if ((word & 0x7e000000) >>> 0 === 0x34000000) {
    const t = u64(pc + BigInt(sext(bits(word, 23, 5), 19) * 4));
    const nz = ((word >>> 24) & 1) === 1;
    text = nz ? "cbnz" : "cbz";
    ops.push({ k: "cbz", s: R(rd), w: W_, nz, t });
    targets = [t];
    return done();
  }
  if ((word & 0x7e000000) >>> 0 === 0x36000000) {
    const t = u64(pc + BigInt(sext(bits(word, 18, 5), 14) * 4));
    const bit = ((word >>> 31) << 5) | bits(word, 23, 19);
    const nz = ((word >>> 24) & 1) === 1;
    text = nz ? "tbnz" : "tbz";
    ops.push({ k: "tbz", s: R(rd), bit, nz, t });
    targets = [t];
    return done();
  }
  if ((word & 0xff9ffc1f) >>> 0 === 0xd61f0000) {
    // br (opc 00), blr (opc 01), ret (opc 10)
    const opc = bits(word, 22, 21);
    if (opc === 3) return fail("unknown branch-register form");
    ops.push({ k: "mov", d: T1, s: R(rn), w: 64 });
    if (opc === 1) {
      text = "blr";
      ops.push({ k: "mov", d: LR, s: imm(next), w: 64 });
      targets = [next];
    } else text = opc === 2 ? "ret" : "br";
    ops.push({ k: "jmpr", s: reg(T1) });
    fall = false;
    return done();
  }

  // ---------- data processing, immediate ----------
  if ((word & 0x1f000000) >>> 0 === 0x10000000) {
    const immv = (bits(word, 23, 5) << 2) | bits(word, 30, 29);
    const off = BigInt(sext(immv, 21));
    if (word >>> 31) {
      text = "adrp";
      ops.push({ k: "mov", d: D(rd), s: imm((pc & ~0xfffn) + (off << 12n)), w: 64 });
    } else {
      text = "adr";
      ops.push({ k: "mov", d: D(rd), s: imm(pc + off), w: 64 });
    }
    return done();
  }
  if ((word & 0x1f800000) >>> 0 === 0x11000000) {
    const sub = ((word >>> 30) & 1) === 1;
    const setf = ((word >>> 29) & 1) === 1;
    const sh = (word >>> 22) & 1;
    const value = BigInt(bits(word, 21, 10)) << (sh ? 12n : 0n);
    text = `${sub ? "sub" : "add"}${setf ? "s" : ""}`;
    ops.push({ k: "alu", op: sub ? "sub" : "add", d: D(rd, !setf), a: R(rn, true), b: imm(value), w: W_, f: setf ? "arith" : "none" });
    return done();
  }
  if ((word & 0x1f800000) >>> 0 === 0x12000000) {
    const opc = bits(word, 30, 29);
    const n = (word >>> 22) & 1;
    if (!sf && n) return fail("invalid 32-bit logical immediate");
    const value = decodeBitMasks(n, bits(word, 15, 10), bits(word, 21, 16), W_);
    if (value === null) return fail("invalid logical immediate");
    const op = (["and", "or", "xor", "and"] as const)[opc];
    text = ["and", "orr", "eor", "ands"][opc];
    ops.push({ k: "alu", op, d: D(rd, opc !== 3), a: R(rn), b: imm(value), w: W_, f: opc === 3 ? "logic" : "none" });
    return done();
  }
  if ((word & 0x1f800000) >>> 0 === 0x12800000) {
    const opc = bits(word, 30, 29);
    const hw = bits(word, 22, 21);
    if (!sf && hw > 1) return fail("invalid move wide");
    const sh = BigInt(hw * 16);
    const v = BigInt(bits(word, 20, 5)) << sh;
    const d = D(rd);
    if (opc === 0) { text = "movn"; ops.push({ k: "mov", d, s: imm(~v & mask(W_)), w: W_ }); }
    else if (opc === 2) { text = "movz"; ops.push({ k: "mov", d, s: imm(v), w: W_ }); }
    else if (opc === 3) {
      text = "movk";
      ops.push({ k: "alu", op: "and", d: T0, a: R(rd), b: imm(~(0xffffn << sh) & M64), w: W_, f: "none" });
      ops.push({ k: "alu", op: "or", d, a: reg(T0), b: imm(v), w: W_, f: "none" });
    } else return fail("invalid move wide");
    return done();
  }
  if ((word & 0x1f800000) >>> 0 === 0x13000000) {
    const opc = bits(word, 30, 29);
    const n = (word >>> 22) & 1;
    if (n !== sf || opc === 3) return fail("invalid bitfield move");
    const r = bits(word, 21, 16);
    const s = bits(word, 15, 10);
    const w = W_;
    const src = R(rn);
    const d = D(rd);
    if (opc === 2) {
      text = "ubfm";
      if (s >= r) {
        ops.push({ k: "alu", op: "shr", d: T0, a: src, b: imm(r), w, f: "none" });
        ops.push({ k: "alu", op: "and", d, a: reg(T0), b: imm(mask(s - r + 1)), w, f: "none" });
      } else {
        ops.push({ k: "alu", op: "and", d: T0, a: src, b: imm(mask(s + 1)), w, f: "none" });
        ops.push({ k: "alu", op: "shl", d, a: reg(T0), b: imm(w - r), w, f: "none" });
      }
    } else if (opc === 0) {
      text = "sbfm";
      const up = w - 1 - s;
      ops.push({ k: "alu", op: "shl", d: T0, a: src, b: imm(up), w, f: "none" });
      if (s >= r) ops.push({ k: "alu", op: "sar", d, a: reg(T0), b: imm(up + r), w, f: "none" });
      else {
        ops.push({ k: "alu", op: "sar", d: T0, a: reg(T0), b: imm(up), w, f: "none" });
        ops.push({ k: "alu", op: "shl", d, a: reg(T0), b: imm(w - r), w, f: "none" });
      }
    } else {
      text = "bfm";
      // Field from src and the bits of dst it replaces.
      let field: bigint;
      if (s >= r) {
        ops.push({ k: "alu", op: "shr", d: T0, a: src, b: imm(r), w, f: "none" });
        field = mask(s - r + 1);
      } else {
        ops.push({ k: "alu", op: "shl", d: T0, a: src, b: imm(w - r), w, f: "none" });
        field = (mask(s + 1) << BigInt(w - r)) & mask(w);
      }
      ops.push({ k: "alu", op: "and", d: T0, a: reg(T0), b: imm(field), w, f: "none" });
      ops.push({ k: "alu", op: "and", d: T2, a: R(rd), b: imm(~field & mask(w)), w, f: "none" });
      ops.push({ k: "alu", op: "or", d, a: reg(T2), b: reg(T0), w, f: "none" });
    }
    return done();
  }
  if ((word & 0x1f800000) >>> 0 === 0x13800000) {
    // extr; ror (immediate) is extr with rn == rm
    const lsb = bits(word, 15, 10);
    if (((word >>> 22) & 1) !== sf || (!sf && lsb > 31)) return fail("invalid extr");
    if (rn === rm) {
      text = "ror";
      ops.push({ k: "alu", op: "ror", d: D(rd), a: R(rn), b: imm(lsb), w: W_, f: "none" });
      return done();
    }
    text = "extr";
    if (lsb === 0) ops.push({ k: "mov", d: D(rd), s: R(rm), w: W_ });
    else {
      // (rn:rm) >> lsb, the low W bits
      ops.push({ k: "alu", op: "shr", d: T0, a: R(rm), b: imm(lsb), w: W_, f: "none" });
      ops.push({ k: "alu", op: "shl", d: T1, a: R(rn), b: imm(W_ - lsb), w: W_, f: "none" });
      ops.push({ k: "alu", op: "or", d: D(rd), a: reg(T0), b: reg(T1), w: W_, f: "none" });
    }
    return done();
  }

  // ---------- data processing, register ----------
  if ((word & 0x1f000000) >>> 0 === 0x0a000000) {
    const opc = bits(word, 30, 29);
    const invert = ((word >>> 21) & 1) === 1;
    const amount = bits(word, 15, 10);
    if (!sf && amount > 31) return fail("invalid shift");
    let b = shifted(R(rm), bits(word, 23, 22), amount, W_, T0);
    if (!b) return fail("invalid shift");
    if (invert) {
      ops.push({ k: "alu", op: "xor", d: T0, a: b, b: imm(-1), w: W_, f: "none" });
      b = reg(T0);
    }
    const op = (["and", "or", "xor", "and"] as const)[opc];
    text = ["and", "orr", "eor", "ands"][opc] + (invert ? "n" : "");
    ops.push({ k: "alu", op, d: D(rd), a: R(rn), b, w: W_, f: opc === 3 ? "logic" : "none" });
    return done();
  }
  if ((word & 0x1f200000) >>> 0 === 0x0b000000) {
    const sub = ((word >>> 30) & 1) === 1;
    const setf = ((word >>> 29) & 1) === 1;
    const type = bits(word, 23, 22);
    if (type === 3) return fail("invalid shift");
    const b = shifted(R(rm), type, bits(word, 15, 10), W_, T0)!;
    text = `${sub ? "sub" : "add"}${setf ? "s" : ""}`;
    ops.push({ k: "alu", op: sub ? "sub" : "add", d: D(rd), a: R(rn), b, w: W_, f: setf ? "arith" : "none" });
    return done();
  }
  if ((word & 0x1f200000) >>> 0 === 0x0b200000) {
    const sub = ((word >>> 30) & 1) === 1;
    const setf = ((word >>> 29) & 1) === 1;
    const amount = bits(word, 12, 10);
    if (amount > 4) return fail("invalid extend shift");
    const b = extended(R(rm), bits(word, 15, 13), amount, T0);
    text = `${sub ? "sub" : "add"}${setf ? "s" : ""}`;
    ops.push({ k: "alu", op: sub ? "sub" : "add", d: D(rd, !setf), a: R(rn, true), b, w: W_, f: setf ? "arith" : "none" });
    return done();
  }
  if ((word & 0x1f000000) >>> 0 === 0x1b000000) {
    const op31 = bits(word, 23, 21);
    const o0 = (word >>> 15) & 1;
    const ra = bits(word, 14, 10);
    const d = D(rd);
    if (op31 === 0) {
      text = o0 ? "msub" : "madd";
      ops.push({ k: "alu", op: "mul", d: T0, a: R(rn), b: R(rm), w: W_, f: "none" });
      ops.push({ k: "alu", op: o0 ? "sub" : "add", d, a: R(ra), b: reg(T0), w: W_, f: "none" });
      return done();
    }
    if (!sf) return fail("invalid 3-source op");
    if (op31 === 1 || op31 === 5) {
      const signed = op31 === 1;
      text = `${signed ? "s" : "u"}m${o0 ? "sub" : "add"}l`;
      ops.push({ k: "ext", d: T0, s: R(rn), from: 32, signed, w: 64 });
      ops.push({ k: "ext", d: T1, s: R(rm), from: 32, signed, w: 64 });
      ops.push({ k: "alu", op: "mul", d: T0, a: reg(T0), b: reg(T1), w: 64, f: "none" });
      ops.push({ k: "alu", op: o0 ? "sub" : "add", d, a: R(ra), b: reg(T0), w: 64, f: "none" });
      return done();
    }
    if ((op31 === 2 || op31 === 6) && o0 === 0) {
      text = op31 === 2 ? "smulh" : "umulh";
      ops.push({ k: "alu", op: op31 === 2 ? "smulh" : "umulh", d, a: R(rn), b: R(rm), w: 64, f: "none" });
      return done();
    }
    return fail("3-source op is not in the map");
  }
  if ((word & 0x7fff0000) >>> 0 === 0x5ac00000) {
    // rbit, rev16, rev32/rev, clz, cls
    const opcode = bits(word, 15, 10);
    const src = R(rn);
    const d = D(rd);
    const swapBytes = (from: Src, n: number, into: number) => {
      // reverse the bytes of each n-byte group of `from` into register `into`
      ops.push({ k: "mov", d: into, s: imm(0), w: 64 });
      for (let i = 0; i < W_ / 8; i += 1) {
        const group = Math.floor(i / n) * n;
        const to = group + (n - 1 - (i - group));
        ops.push({ k: "alu", op: "shr", d: T1, a: from, b: imm(8 * i), w: 64, f: "none" });
        ops.push({ k: "alu", op: "and", d: T1, a: reg(T1), b: imm(0xff), w: 64, f: "none" });
        if (to) ops.push({ k: "alu", op: "shl", d: T1, a: reg(T1), b: imm(8 * to), w: 64, f: "none" });
        ops.push({ k: "alu", op: "or", d: into, a: reg(into), b: reg(T1), w: 64, f: "none" });
      }
    };
    if (opcode === 0) {
      text = "rbit";
      ops.push({ k: "mov", d: T0, s: imm(0), w: 64 });
      ops.push({ k: "mov", d: T2, s: src, w: 64 });
      for (let i = 0; i < W_; i += 1) {
        ops.push({ k: "alu", op: "shr", d: T1, a: reg(T2), b: imm(i), w: 64, f: "none" });
        ops.push({ k: "alu", op: "and", d: T1, a: reg(T1), b: imm(1), w: 64, f: "none" });
        ops.push({ k: "alu", op: "shl", d: T1, a: reg(T1), b: imm(W_ - 1 - i), w: 64, f: "none" });
        ops.push({ k: "alu", op: "or", d: T0, a: reg(T0), b: reg(T1), w: 64, f: "none" });
      }
      ops.push({ k: "mov", d, s: reg(T0), w: W_ });
    } else if (opcode === 1 || opcode === 2 || (opcode === 3 && sf)) {
      const n = opcode === 1 ? 2 : opcode === 2 ? 4 : 8;
      text = opcode === 1 ? "rev16" : opcode === 2 && sf ? "rev32" : "rev";
      ops.push({ k: "mov", d: T2, s: src, w: W_ });
      swapBytes(reg(T2), Math.min(n, W_ / 8), T0);
      ops.push({ k: "mov", d, s: reg(T0), w: W_ });
    } else if (opcode === 4) {
      text = "clz";
      ops.push({ k: "alu", op: "clz", d, a: src, b: imm(0), w: W_, f: "none" });
    } else if (opcode === 5) {
      // cls: bits after the sign bit that equal it = clz((x ^ (x << 1)) | 1)
      text = "cls";
      ops.push({ k: "alu", op: "shl", d: T0, a: src, b: imm(1), w: W_, f: "none" });
      ops.push({ k: "alu", op: "xor", d: T0, a: reg(T0), b: src, w: W_, f: "none" });
      ops.push({ k: "alu", op: "or", d: T0, a: reg(T0), b: imm(1), w: W_, f: "none" });
      ops.push({ k: "alu", op: "clz", d, a: reg(T0), b: imm(0), w: W_, f: "none" });
    } else return fail("1-source op is not in the map");
    return done();
  }
  if ((word & 0x1fe0fc00) >>> 0 === 0x1a000000) {
    // adc, adcs, sbc, sbcs. The guest IR keeps the x86 carry, so ARM's carry (C xor K) is moved in first.
    const sub = ((word >>> 30) & 1) === 1;
    const setf = ((word >>> 29) & 1) === 1;
    text = `${sub ? "sbc" : "adc"}${setf ? "s" : ""}`;
    if (setf) {
      ops.push({ k: "set", d: T3, c: sub ? "cc" : "cs", w: 64 }); // carry in as x86 wants it: borrow for sbb
      ops.push({ k: "setflag", flag: "c", v: reg(T3), bit: 0, when: null });
      ops.push({ k: "alu", op: sub ? "sbb" : "adc", d: D(rd), a: R(rn), b: R(rm), w: W_, f: "arith" });
    } else {
      ops.push({ k: "set", d: T3, c: "cs", w: 64 });
      let b = R(rm);
      if (sub) {
        ops.push({ k: "alu", op: "xor", d: T0, a: b, b: imm(-1), w: W_, f: "none" });
        b = reg(T0);
      }
      ops.push({ k: "alu", op: "add", d: T1, a: R(rn), b, w: W_, f: "none" });
      ops.push({ k: "alu", op: "add", d: D(rd), a: reg(T1), b: reg(T3), w: W_, f: "none" });
    }
    return done();
  }
  if ((word & 0x7fe00000) >>> 0 === 0x1ac00000) {
    const opcode = bits(word, 15, 10);
    const table: Record<number, "udiv" | "sdiv" | "shl" | "shr" | "sar" | "ror"> = { 2: "udiv", 3: "sdiv", 8: "shl", 9: "shr", 10: "sar", 11: "ror" };
    const op = table[opcode];
    if (!op) return fail("2-source op is not in the map");
    text = op;
    ops.push({ k: "alu", op, d: D(rd), a: R(rn), b: R(rm), w: W_, f: "none" });
    return done();
  }
  if ((word & 0x1fe00000) >>> 0 === 0x1a800000) {
    const op = (word >>> 30) & 1;
    const op2 = bits(word, 11, 10);
    if ((word >>> 29) & 1 || op2 > 1) return fail("invalid conditional select");
    const c = CONDS[bits(word, 15, 12)];
    let b = R(rm);
    if (op === 0 && op2 === 1) { ops.push({ k: "alu", op: "add", d: T0, a: b, b: imm(1), w: W_, f: "none" }); b = reg(T0); }
    if (op === 1 && op2 === 0) { ops.push({ k: "alu", op: "xor", d: T0, a: b, b: imm(-1), w: W_, f: "none" }); b = reg(T0); }
    if (op === 1 && op2 === 1) { ops.push({ k: "alu", op: "sub", d: T0, a: imm(0), b, w: W_, f: "none" }); b = reg(T0); }
    text = ["csel", "csinc", "csinv", "csneg"][op * 2 + op2];
    ops.push({ k: "csel", d: D(rd), c, a: R(rn), b, w: W_ });
    return done();
  }
  if ((word & 0x1fe00010) >>> 0 === 0x1a400000 && ((word >>> 29) & 1) === 1) {
    const neg = ((word >>> 30) & 1) === 0; // ccmn when op == 0
    const isImm = ((word >>> 11) & 1) === 1;
    const c = CONDS[bits(word, 15, 12)];
    text = neg ? "ccmn" : "ccmp";
    ops.push({ k: "ccmp", c, a: R(rn), b: isImm ? imm(rm) : R(rm), w: W_, neg, nzcv: word & 15 });
    return done();
  }

  // ---------- loads and stores ----------
  if ((word & 0x3b000000) >>> 0 === 0x18000000) {
    // literal
    const opc = word >>> 30;
    const addr = u64(pc + BigInt(sext(bits(word, 23, 5), 19) * 4));
    const ea: Ea = { base: null, index: null, scale: 1, disp: addr };
    if ((word >>> 26) & 1) {
      if (opc === 3) return fail("invalid SIMD/FP literal load");
      text = "ldr";
      vload(rd, ea, [4, 8, 16][opc]);
      return done();
    }
    text = "ldr";
    if (opc === 0) ops.push({ k: "load", d: D(rd), ea, size: 4, signed: false, w: 64 });
    else if (opc === 1) ops.push({ k: "load", d: D(rd), ea, size: 8, signed: false, w: 64 });
    else if (opc === 2) ops.push({ k: "load", d: D(rd), ea, size: 4, signed: true, w: 64 });
    else text = "prfm";
    return done();
  }
  if ((word & 0x3a000000) >>> 0 === 0x28000000) {
    // load/store pair
    const opc = word >>> 30;
    const mode = bits(word, 24, 23); // 0 non-temporal, 1 post, 2 offset, 3 pre
    const load = ((word >>> 22) & 1) === 1;
    if ((word >>> 26) & 1) {
      if (opc === 3) return fail("invalid SIMD/FP pair");
      const size = [4, 8, 16][opc];
      const off = BigInt(sext(bits(word, 21, 15), 7) * size);
      const rt2 = bits(word, 14, 10);
      const base = rn === 31 ? SP : rn;
      text = load ? "ldp" : "stp";
      ops.push({ k: "lea", d: T2, ea: { base, index: null, scale: 1, disp: mode === 1 ? 0n : u64(off) }, w: 64 });
      const at = (k: number): Ea => ({ base: T2, index: null, scale: 1, disp: BigInt(k * size) });
      if (load) {
        vload(rd, at(0), size);
        vload(rt2, at(1), size);
      } else {
        vstore(rd, at(0), size);
        vstore(rt2, at(1), size);
      }
      if (mode === 1) ops.push({ k: "alu", op: "add", d: base, a: reg(base), b: imm(off), w: 64, f: "none" });
      if (mode === 3) ops.push({ k: "mov", d: base, s: reg(T2), w: 64 });
      return done();
    }
    if (opc === 3 || (opc === 1 && !load)) return fail("invalid pair");
    const size = (opc === 2 ? 8 : 4) as 4 | 8;
    const off = BigInt(sext(bits(word, 21, 15), 7) * size);
    const rt2 = bits(word, 14, 10);
    const base = rn === 31 ? SP : rn;
    const signed = opc === 1;
    text = load ? "ldp" : "stp";
    // Address into T2 so writeback and a loaded base register cannot disturb each other.
    ops.push({ k: "lea", d: T2, ea: { base, index: null, scale: 1, disp: mode === 1 ? 0n : u64(off) }, w: 64 });
    const at = (k: number): Ea => ({ base: T2, index: null, scale: 1, disp: BigInt(k * size) });
    if (load) {
      ops.push({ k: "load", d: T0, ea: at(0), size, signed, w: 64 });
      ops.push({ k: "load", d: T1, ea: at(1), size, signed, w: 64 });
    } else {
      ops.push({ k: "store", s: R(rd), ea: at(0), size });
      ops.push({ k: "store", s: R(rt2), ea: at(1), size });
    }
    if (mode === 1) ops.push({ k: "alu", op: "add", d: base, a: reg(base), b: imm(off), w: 64, f: "none" });
    if (mode === 3) ops.push({ k: "mov", d: base, s: reg(T2), w: 64 });
    if (load) {
      ops.push({ k: "mov", d: D(rd), s: reg(T0), w: 64 });
      ops.push({ k: "mov", d: D(rt2), s: reg(T1), w: 64 });
    }
    return done();
  }
  if ((word & 0x3b000000) >>> 0 === 0x39000000 || (word & 0x3b200000) >>> 0 === 0x38000000 || (word & 0x3b200c00) >>> 0 === 0x38200800) {
    const simd = ((word >>> 26) & 1) === 1;
    const opc = bits(word, 23, 22);
    // SIMD/FP: size 0 with opc<1> set is a 128-bit q register; otherwise 1 << size bytes.
    const sizeLog = simd && word >>> 30 === 0 && opc & 2 ? 4 : word >>> 30;
    if (simd && sizeLog !== 4 && opc & 2) return fail("invalid SIMD/FP load/store");
    const size = (1 << sizeLog) as 1 | 2 | 4 | 8;
    const base = rn === 31 ? SP : rn;
    const unsignedOff = (word & 0x3b000000) >>> 0 === 0x39000000;
    const regOff = !unsignedOff && (word & 0x3b200c00) >>> 0 === 0x38200800;
    let ea: Ea;
    let writeback: { mode: "pre" | "post"; off: bigint } | null = null;
    if (unsignedOff) ea = { base, index: null, scale: 1, disp: BigInt(bits(word, 21, 10)) << BigInt(sizeLog) };
    else if (regOff) {
      const option = bits(word, 15, 13);
      if (!(option & 2)) return fail("invalid register-offset extend");
      const s = (word >>> 12) & 1;
      const idx = option === 3 || option === 7 ? R(rm) : extended(R(rm), option, 0, T1);
      if (!("r" in idx)) ea = { base, index: null, scale: 1, disp: 0n };
      else if (s && sizeLog === 4) {
        ops.push({ k: "alu", op: "shl", d: T1, a: idx, b: imm(4), w: 64, f: "none" });
        ea = { base, index: T1, scale: 1, disp: 0n };
      } else ea = { base, index: idx.r, scale: (s ? size : 1) as 1 | 2 | 4 | 8, disp: 0n };
    } else {
      const imm9 = BigInt(sext(bits(word, 20, 12), 9));
      const mode = bits(word, 11, 10);
      if (mode === 1) { writeback = { mode: "post", off: imm9 }; ea = { base, index: null, scale: 1, disp: 0n }; }
      else if (mode === 3) { writeback = { mode: "pre", off: imm9 }; ea = { base, index: null, scale: 1, disp: u64(imm9) }; }
      else ea = { base, index: null, scale: 1, disp: u64(imm9) };
    }
    if (writeback) {
      ops.push({ k: "lea", d: T2, ea, w: 64 });
      ea = { base: T2, index: null, scale: 1, disp: 0n };
    }
    if (simd) {
      const load = (opc & 1) === 1;
      text = load ? "ldr" : "str";
      if (load) vload(rd, ea, 1 << sizeLog);
      else vstore(rd, ea, 1 << sizeLog);
      if (writeback) {
        if (writeback.mode === "pre") ops.push({ k: "mov", d: base, s: reg(T2), w: 64 });
        else ops.push({ k: "alu", op: "add", d: base, a: reg(base), b: imm(writeback.off), w: 64, f: "none" });
      }
      return done();
    }
    if (opc === 0) {
      text = "str";
      ops.push({ k: "store", s: R(rd), ea, size });
    } else if (opc === 1) {
      text = "ldr";
      ops.push({ k: "load", d: T0, ea, size, signed: false, w: 64 });
    } else {
      if (size === 8) {
        if (opc === 2) { text = "prfm"; if (writeback) return fail("invalid prfm"); return done(); }
        return fail("invalid load");
      }
      if (size === 4 && opc === 3) return fail("invalid load");
      text = "ldrs";
      ops.push({ k: "load", d: T0, ea, size, signed: true, w: opc === 3 ? 32 : 64 });
    }
    if (writeback) {
      const base2 = base;
      if (writeback.mode === "pre") ops.push({ k: "mov", d: base2, s: reg(T2), w: 64 });
      else ops.push({ k: "alu", op: "add", d: base2, a: reg(base2), b: imm(writeback.off), w: 64, f: "none" });
    }
    if (opc !== 0) {
      const last = ops[ops.length - (writeback ? 2 : 1)] as Extract<Op, { k: "load" }>;
      ops.push({ k: "mov", d: D(rd), s: reg(T0), w: last.signed && opc === 3 ? 32 : 64 });
    }
    return done();
  }

  if ((word & 0x3f000000) >>> 0 === 0x08000000) {
    // Exclusive and ordered loads and stores. One thread runs, so a store-exclusive always succeeds
    // (status 0) and acquire/release ordering needs nothing extra.
    const size = (1 << (word >>> 30)) as 1 | 2 | 4 | 8;
    const o2 = (word >>> 23) & 1;
    const load = ((word >>> 22) & 1) === 1;
    const o1 = (word >>> 21) & 1;
    const rs = rm;
    const rt2 = bits(word, 14, 10);
    const base = rn === 31 ? SP : rn;
    const ea: Ea = { base, index: null, scale: 1, disp: 0n };
    if (o1 === 1) {
      if (o2 === 1) return fail("compare-and-swap (LSE) is not in the map");
      if (size < 4) return fail("invalid exclusive pair");
      // ldxp / stxp
      if (load) {
        text = "ldxp";
        ops.push({ k: "lea", d: T2, ea, w: 64 });
        ops.push({ k: "load", d: T0, ea: { base: T2, index: null, scale: 1, disp: 0n }, size, signed: false, w: 64 });
        ops.push({ k: "load", d: T1, ea: { base: T2, index: null, scale: 1, disp: BigInt(size) }, size, signed: false, w: 64 });
        ops.push({ k: "mov", d: D(rd), s: reg(T0), w: 64 });
        ops.push({ k: "mov", d: D(rt2), s: reg(T1), w: 64 });
      } else {
        text = "stxp";
        ops.push({ k: "lea", d: T2, ea, w: 64 });
        ops.push({ k: "store", s: R(rd), ea: { base: T2, index: null, scale: 1, disp: 0n }, size });
        ops.push({ k: "store", s: R(rt2), ea: { base: T2, index: null, scale: 1, disp: BigInt(size) }, size });
        ops.push({ k: "mov", d: D(rs), s: imm(0), w: 32 });
      }
      return done();
    }
    if (load) {
      text = o2 ? "ldar" : "ldxr";
      ops.push({ k: "load", d: T0, ea, size, signed: false, w: 64 });
      ops.push({ k: "mov", d: D(rd), s: reg(T0), w: 64 });
    } else {
      text = o2 ? "stlr" : "stxr";
      ops.push({ k: "store", s: R(rd), ea, size });
      if (!o2) ops.push({ k: "mov", d: D(rs), s: imm(0), w: 32 }); // the exclusive store succeeded
    }
    return done();
  }
  if ((word & 0x0e000000) >>> 0 === 0x0e000000 || (word & 0x0e000000) >>> 0 === 0x0c000000) {
    const why = decodeSimd(word, pc, ops, R, D);
    if (typeof why === "string") return fail(why);
    text = why.text;
    return done();
  }
  if ((word & 0xffd00000) >>> 0 === 0xd5100000 && (word >>> 20) & 1) {
    // mrs (L = 1) / msr (L = 0), register form
    const key = bits(word, 20, 5);
    const read = ((word >>> 21) & 1) === 1;
    const rt = bits(word, 4, 0);
    if (read) {
      text = "mrs";
      const d = D(rt);
      if (key === SYSREG.tpidr) ops.push({ k: "mov", d, s: reg(TP), w: 64 });
      else if (key === SYSREG.fpcr || key === SYSREG.fpsr) ops.push({ k: "mov", d, s: imm(0), w: 64 }); // round to nearest, no traps, no flags
      else if (key === SYSREG.dczid) ops.push({ k: "mov", d, s: imm(0x10), w: 64 }); // DZP: dc zva is not offered
      else if (key === SYSREG.ctr) ops.push({ k: "mov", d, s: imm(0x8444c004), w: 64 }); // 64-byte cache lines
      else if (key === SYSREG.cntfrq) ops.push({ k: "mov", d, s: imm(1_000_000_000), w: 64 });
      else if (key === SYSREG.cntvct) ops.push({ k: "mov", d, s: imm(0), w: 64 }); // a fixed clock, like clock_gettime
      else return fail("system register is not offered to programs");
      return done();
    }
    text = "msr";
    if (key === SYSREG.tpidr) ops.push({ k: "mov", d: TP, s: R(rt), w: 64 });
    else if (key === SYSREG.fpcr || key === SYSREG.fpsr) {
      /* rounding stays nearest-even; nothing to keep */
    } else return fail("system register is not offered to programs");
    return done();
  }
  if ((word & 0xffc00000) >>> 0 === 0xd5000000 || (word & 0xfff00000) >>> 0 === 0xd5300000 || (word & 0xfff00000) >>> 0 === 0xd5100000) return fail("system register access is not in the map");
  return fail("instruction is not in the map");
}
