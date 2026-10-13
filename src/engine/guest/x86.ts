/**
 * x86-64 front end: one instruction of machine code in, guest IR out.
 *
 * Covers the integer core that compilers emit for ordinary programs built with
 * -mgeneral-regs-only: mov/movzx/movsx/lea, the ALU group, shifts, mul/imul/div/idiv,
 * test/cmp, jcc/jmp/call/ret, setcc/cmovcc, push/pop/leave, cdq/cqo, syscall and the nop forms.
 * Anything else (SSE, x87, segment overrides, string ops, adc/sbb, rotates by flag...) is a gap.
 * Encodings follow the Intel SDM, Volume 2.
 */
import { imm, reg, shuffleId, SINK, T0, T1, T2, T3, TP, u64, XMM, type Cond, type Ea, type Gap, type Insn, type Op, type Src, type VecOp, type W } from "./ir.ts";

export type Fetch = (addr: bigint) => number | undefined;
export type Decoded = { insn: Insn; targets: bigint[] } | { gap: Gap };

// p/np read the parity flag, which only floating-point compares set here (other ops leave it as it was).
const CC: (Cond | null)[] = ["o", "no", "b", "ae", "eq", "ne", "be", "a", "s", "ns", "p", "np", "lt", "ge", "le", "gt"];
const ALU = ["add", "or", "adc", "sbb", "and", "sub", "xor", "cmp"] as const;
const RSP = 4;
const RBP = 5;
const RAX = 0;
const RDX = 2;
const RCX = 1;

class Gapped extends Error {}

/**
 * Set CF = OF = bit (a 0/1 value in register r), as mul/imul do. Uses (bit << 63) + (bit << 63):
 * the sum's carry and signed overflow both equal bit. ZF and SF are architecturally undefined after
 * a multiply; here they read as 1 and 0.
 */
function overflowFlags(r: number): Op[] {
  return [
    { k: "alu", op: "shl", d: T2, a: reg(r), b: imm(63), w: 64, f: "none" },
    { k: "alu", op: "add", d: null, a: reg(T2), b: reg(T2), w: 64, f: "arith" },
  ];
}

/** movss/movsd between registers: replace only the low 32 bits of d. */
function mergeLow32(d: number, s: number): Op[] {
  return [
    { k: "alu", op: "and", d: T2, a: reg(s), b: imm(0xffffffffn), w: 64, f: "none" },
    { k: "alu", op: "and", d, a: reg(d), b: imm(0xffffffff00000000n), w: 64, f: "none" },
    { k: "alu", op: "or", d, a: reg(d), b: reg(T2), w: 64, f: "none" },
  ];
}

const HIGH = 1000;
const isHigh = (r: number | null | undefined) => typeof r === "number" && r >= HIGH;
const srcHigh = (x: Src) => "r" in x && isHigh(x.r);
function usesHigh(op: Op): boolean {
  switch (op.k) {
    case "mov": return isHigh(op.d) || srcHigh(op.s);
    case "alu": return isHigh(op.d) || srcHigh(op.a) || srcHigh(op.b);
    case "ext": return isHigh(op.d) || srcHigh(op.s);
    case "load": return isHigh(op.d);
    case "store": return srcHigh(op.s);
    case "set": return isHigh(op.d);
    case "csel": return isHigh(op.d) || srcHigh(op.a) || srcHigh(op.b);
    case "flagsz":
    case "setflag": return srcHigh(op.v);
    default: return false;
  }
}

/** Turn pseudo high-byte registers into: read = (r >> 8), write = merge into bits 8..15. */
function rewriteHigh(ops: Op[]): Op[] | null {
  const out: Op[] = [];
  for (const op of ops) {
    if (!usesHigh(op)) {
      out.push(op);
      continue;
    }
    const scratch = [T2, SINK];
    const read = (x: Src): Src => {
      if (!srcHigh(x)) return x;
      const t = scratch.shift();
      if (t === undefined) throw new Gapped("too many high-byte operands");
      out.push({ k: "alu", op: "shr", d: t, a: reg((x as { r: number }).r - HIGH), b: imm(8), w: 64, f: "none" });
      return reg(t);
    };
    const copy = { ...op } as Op & Record<string, unknown>;
    for (const key of ["s", "a", "b", "v"] as const) if (key in copy && copy[key]) (copy as Record<string, unknown>)[key] = read(copy[key] as Src);
    const d = (copy as { d?: number | null }).d;
    if (isHigh(d)) {
      const base = (d as number) - HIGH;
      const t = T2;
      (copy as { d: number }).d = t;
      if ((copy as { w?: number }).w !== 8) return null;
      out.push(copy);
      out.push({ k: "alu", op: "and", d: t, a: reg(t), b: imm(0xff), w: 64, f: "none" });
      out.push({ k: "alu", op: "shl", d: t, a: reg(t), b: imm(8), w: 64, f: "none" });
      out.push({ k: "alu", op: "and", d: base, a: reg(base), b: imm(~0xff00n), w: 64, f: "none" });
      out.push({ k: "alu", op: "or", d: base, a: reg(base), b: reg(t), w: 64, f: "none" });
    } else out.push(copy);
  }
  return out;
}

export function decodeX86(fetch: Fetch, pc: bigint): Decoded {
  let p = pc;
  const raw: number[] = [];
  const byte = (): number => {
    const b = fetch(p);
    if (b === undefined) throw new Gapped("instruction runs off mapped code");
    raw.push(b);
    p += 1n;
    return b;
  };
  const s8 = () => BigInt.asIntN(8, BigInt(byte()));
  const u16 = () => BigInt(byte() | (byte() << 8));
  const s32 = () => BigInt.asIntN(32, BigInt((byte() | (byte() << 8) | (byte() << 16) | (byte() << 24)) >>> 0));
  const u64v = () => {
    let v = 0n;
    for (let i = 0n; i < 8n; i += 1n) v |= BigInt(byte()) << (8n * i);
    return v;
  };
  const hexRaw = () => raw.map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const fail = (reason: string): Decoded => {
    // Show at least the bytes we looked at so the gap is useful evidence.
    if (!raw.length) {
      const b = fetch(pc);
      if (b !== undefined) raw.push(b);
    }
    return { gap: { pc, bytes: hexRaw(), reason } };
  };

  try {
    let opsize16 = false;
    let rep = false;
    let repne = false;
    let fs = false;
    let addr32 = false;
    for (;;) {
      const b = fetch(p);
      if (b === 0x66) { opsize16 = true; byte(); continue; }
      if (b === 0xf3) { rep = true; byte(); continue; }
      if (b === 0xf2) { repne = true; byte(); continue; }
      if (b === 0x2e || b === 0x3e || b === 0xf0) { byte(); continue; } // branch hints, ds, lock (one guest thread)
      if (b === 0x64) { fs = true; byte(); continue; } // fs: thread-local storage, based on the thread pointer
      if (b === 0x65) return fail("gs segment is not in the map");
      if (b === 0x67) { addr32 = true; byte(); continue; }
      if (b === 0x26 || b === 0x36) { byte(); continue; }
      break;
    }
    let rex = 0;
    if (((fetch(p) ?? 0) & 0xf0) === 0x40) rex = byte();
    const rexW = (rex & 8) !== 0;
    const rexR = (rex & 4) !== 0 ? 8 : 0;
    const rexX = (rex & 2) !== 0 ? 8 : 0;
    const rexB = (rex & 1) !== 0 ? 8 : 0;
    const w: W = rexW ? 64 : opsize16 ? 16 : 32;

    const ops: Op[] = [];
    const eas: Ea[] = [];
    let targets: bigint[] = [];
    let fall = true;
    let text = "";

    type ModRM = { mod: number; reg: number; rm: number; ea: Ea | null };
    const modrm = (): ModRM => {
      const m = byte();
      const mod = m >> 6;
      const regf = ((m >> 3) & 7) | rexR;
      const rmLow = m & 7;
      if (mod === 3) return { mod, reg: regf, rm: rmLow | rexB, ea: null };
      let base: number | null = null;
      let index: number | null = null;
      let scale: 1 | 2 | 4 | 8 = 1;
      let disp = 0n;
      let rip = false;
      if (rmLow === 4) {
        const sib = byte();
        scale = (1 << (sib >> 6)) as 1 | 2 | 4 | 8;
        const idx = ((sib >> 3) & 7) | rexX;
        index = idx === 4 ? null : idx;
        const bs = sib & 7;
        if (bs === 5 && mod === 0) {
          base = null;
          disp = s32();
        } else base = bs | rexB;
      } else if (rmLow === 5 && mod === 0) {
        rip = true;
        disp = s32();
      } else base = rmLow | rexB;
      if (mod === 1) disp = s8();
      else if (mod === 2) disp = s32();
      const ea: Ea = { base, index, scale, disp: u64(disp), rip, ...(fs ? { seg: TP } : {}), ...(addr32 ? { a32: true } : {}) };
      eas.push(ea);
      return { mod, reg: regf, rm: rmLow | rexB, ea };
    };

    // ah/ch/dh/bh (8-bit operands 4..7 without REX) are bits 8..15 of rax/rcx/rdx/rbx. They are
    // decoded as pseudo-registers HIGH + n and rewritten into shifts and merges in finish().
    const byteReg = (r: number): number => (!rex && r >= 4 && r <= 7 ? HIGH + (r - 4) : r);
    const sizeOf = (bits: W) => (bits / 8) as 1 | 2 | 4 | 8;
    /** Read an r/m operand as a source. Memory goes through a temp. */
    const readRm = (m: ModRM, bits: W, tmp = T0): Src => {
      if (!m.ea) return reg(bits === 8 ? byteReg(m.rm) : m.rm);
      ops.push({ k: "load", d: tmp, ea: m.ea, size: sizeOf(bits), signed: false, w: 64 });
      return reg(tmp);
    };
    /** d = a * b (signed, width w), with CF = OF = the product did not fit. */
    const imulFlags = (a: Src, b: Src, d: number) => {
      ops.push({ k: "alu", op: "smulh", d: T1, a, b, w, f: "none" });
      ops.push({ k: "alu", op: "mul", d: SINK, a, b, w: 64, f: "none" });
      ops.push({ k: "alu", op: "sar", d: T2, a: reg(SINK), b: imm(w - 1), w, f: "none" });
      ops.push({ k: "mov", d, s: reg(SINK), w });
      ops.push({ k: "alu", op: "sub", d: null, a: reg(T2), b: reg(T1), w, f: "arith" });
      ops.push({ k: "set", d: T1, c: "ne", w: 64 });
      ops.push(...overflowFlags(T1));
    };
    const immOf = (bits: W): bigint => (bits === 8 ? s8() : bits === 16 ? u16() : s32());

    /** dst op= src, with flags; writes back to r/m (register or memory) unless it is cmp/test. */
    const aluRm = (name: (typeof ALU)[number], m: ModRM, src: Src, bits: W) => {
      if (name === null) throw new Gapped("adc/sbb are not in the map");
      const op = name === "cmp" ? "sub" : name;
      const flags = name === "add" || name === "sub" || name === "cmp" || name === "adc" || name === "sbb" ? "arith" : "logic";
      if (!m.ea) {
        const r = bits === 8 ? byteReg(m.rm) : m.rm;
        ops.push({ k: "alu", op, d: name === "cmp" ? null : r, a: reg(r), b: src, w: bits, f: flags });
        return;
      }
      ops.push({ k: "load", d: T0, ea: m.ea, size: sizeOf(bits), signed: false, w: 64 });
      ops.push({ k: "alu", op, d: name === "cmp" ? null : T0, a: reg(T0), b: src, w: bits, f: flags });
      if (name !== "cmp") ops.push({ k: "store", s: reg(T0), ea: m.ea, size: sizeOf(bits) });
    };
    const writeRm = (m: ModRM, src: Src, bits: W) => {
      if (!m.ea) ops.push({ k: "mov", d: bits === 8 ? byteReg(m.rm) : m.rm, s: src, w: bits });
      else ops.push({ k: "store", s: src, ea: m.ea, size: sizeOf(bits) });
    };
    const push = (src: Src) => {
      ops.push({ k: "alu", op: "sub", d: RSP, a: reg(RSP), b: imm(8), w: 64, f: "none" });
      ops.push({ k: "store", s: src, ea: { base: RSP, index: null, scale: 1, disp: 0n }, size: 8 });
    };
    const pop = (d: number) => {
      ops.push({ k: "load", d: T1, ea: { base: RSP, index: null, scale: 1, disp: 0n }, size: 8, signed: false, w: 64 });
      ops.push({ k: "alu", op: "add", d: RSP, a: reg(RSP), b: imm(8), w: 64, f: "none" });
      ops.push({ k: "mov", d, s: reg(T1), w: 64 });
    };

    const op = byte();
    const finish = (): Decoded => {
      const next = p;
      if (ops.some(usesHigh)) {
        const rewritten = rewriteHigh(ops);
        if (!rewritten) throw new Gapped("this use of ah/ch/dh/bh is not in the map");
        ops.splice(0, ops.length, ...rewritten);
      }
      for (const ea of eas) if (ea.rip) {
        ea.disp = u64(next + ea.disp);
        ea.rip = false;
      }
      targets = targets.map(u64);
      const insn: Insn = { pc, len: Number(next - pc), next, ops, fall, text: text || hexRaw() };
      return { insn, targets };
    };

    // ---------- one-byte opcodes ----------
    if (op < 0x40 && (op & 7) <= 5) {
      const name = ALU[op >> 3];
      if (name === null) return fail("adc/sbb are not in the map");
      const form = op & 7;
      text = name;
      if (form === 0 || form === 1) {
        const bits: W = form === 0 ? 8 : w;
        const m = modrm();
        aluRm(name, m, reg(bits === 8 ? byteReg(m.reg) : m.reg), bits);
      } else if (form === 2 || form === 3) {
        const bits: W = form === 2 ? 8 : w;
        const m = modrm();
        const src = readRm(m, bits);
        const r = bits === 8 ? byteReg(m.reg) : m.reg;
        const aop = name === "cmp" ? "sub" : name;
        ops.push({ k: "alu", op: aop, d: name === "cmp" ? null : r, a: reg(r), b: src, w: bits, f: name === "and" || name === "or" || name === "xor" ? "logic" : "arith" });
      } else {
        const bits: W = form === 4 ? 8 : w;
        const value = immOf(bits === 64 ? 32 : bits);
        aluRm(name, { mod: 3, reg: 0, rm: RAX, ea: null }, imm(value), bits);
      }
      return finish();
    }
    if (op >= 0x50 && op <= 0x57) { text = "push"; push(reg((op & 7) | rexB)); return finish(); }
    if (op >= 0x58 && op <= 0x5f) { text = "pop"; pop((op & 7) | rexB); return finish(); }
    if (op === 0x63) {
      text = "movsxd";
      const m = modrm();
      const src = m.ea ? (ops.push({ k: "load", d: T0, ea: m.ea, size: 4, signed: false, w: 64 }), reg(T0)) : reg(m.rm);
      ops.push({ k: "ext", d: m.reg, s: src, from: 32, signed: rexW, w });
      return finish();
    }
    if (op === 0x68 || op === 0x6a) { text = "push"; push(imm(op === 0x68 ? s32() : s8())); return finish(); }
    if (op === 0x69 || op === 0x6b) {
      text = "imul";
      const m = modrm();
      const src = readRm(m, w);
      const value = op === 0x69 ? immOf(w === 64 ? 32 : w) : s8();
      if ("r" in src && src.r !== T0) ops.push({ k: "mov", d: T0, s: src, w: 64 });
      imulFlags(reg(T0), imm(value), m.reg);
      return finish();
    }
    if (op >= 0x70 && op <= 0x7f) {
      const c = CC[op & 15];
      if (!c) return fail("parity conditions are not in the map");
      const rel = s8();
      text = `j${c}`;
      const t = u64(p + rel);
      ops.push({ k: "br", c, t });
      targets = [t];
      return finish();
    }
    if (op === 0x80 || op === 0x81 || op === 0x83) {
      const bits: W = op === 0x80 ? 8 : w;
      const m = modrm();
      const name = ALU[m.reg & 7];
      if (name === null) return fail("adc/sbb are not in the map");
      const value = op === 0x81 ? immOf(bits === 64 ? 32 : bits) : s8();
      text = name;
      aluRm(name, m, imm(value), bits);
      return finish();
    }
    if (op === 0x84 || op === 0x85) {
      const bits: W = op === 0x84 ? 8 : w;
      const m = modrm();
      text = "test";
      const src = readRm(m, bits);
      ops.push({ k: "alu", op: "and", d: null, a: src, b: reg(bits === 8 ? byteReg(m.reg) : m.reg), w: bits, f: "logic" });
      return finish();
    }
    if (op === 0x86) {
      const m = modrm();
      text = "xchg";
      const a = byteReg(m.reg);
      const src = readRm(m, 8, T1);
      ops.push({ k: "mov", d: T0, s: reg(a), w: 64 });
      ops.push({ k: "mov", d: a, s: src, w: 8 });
      writeRm(m, reg(T0), 8);
      return finish();
    }
    if (op >= 0x91 && op <= 0x97) {
      // xchg rax, r
      const r = (op & 7) | rexB;
      text = "xchg";
      ops.push({ k: "mov", d: T0, s: reg(RAX), w: 64 }, { k: "mov", d: RAX, s: reg(r), w }, { k: "mov", d: r, s: reg(T0), w });
      return finish();
    }
    if (op === 0x87) {
      const m = modrm();
      text = "xchg";
      const a = m.reg;
      const src = readRm(m, w, T1);
      ops.push({ k: "mov", d: T0, s: reg(a), w: 64 });
      ops.push({ k: "mov", d: a, s: src, w });
      writeRm(m, reg(T0), w);
      return finish();
    }
    if (op >= 0x88 && op <= 0x8b) {
      const bits: W = op & 1 ? w : 8;
      const m = modrm();
      text = "mov";
      const r = bits === 8 ? byteReg(m.reg) : m.reg;
      if (op <= 0x89) writeRm(m, reg(r), bits);
      else {
        if (m.ea) ops.push({ k: "load", d: r, ea: m.ea, size: sizeOf(bits), signed: false, w: bits });
        else ops.push({ k: "mov", d: r, s: reg(bits === 8 ? byteReg(m.rm) : m.rm), w: bits });
      }
      return finish();
    }
    if (op === 0x8d) {
      const m = modrm();
      if (!m.ea) return fail("lea with a register operand is invalid");
      text = "lea";
      delete m.ea.seg; // lea computes the offset only
      ops.push({ k: "lea", d: m.reg, ea: m.ea, w });
      return finish();
    }
    if (op === 0x90) { text = rep ? "pause" : "nop"; if (rexB) return fail("xchg r8 is not in the map"); return finish(); }
    if (op === 0x98) {
      text = rexW ? "cdqe" : "cwde";
      if (opsize16) return fail("cbw is not in the map");
      ops.push({ k: "ext", d: RAX, s: reg(RAX), from: rexW ? 32 : 16, signed: true, w });
      return finish();
    }
    if (op === 0x99) {
      text = rexW ? "cqo" : "cdq";
      ops.push({ k: "alu", op: "sar", d: RDX, a: reg(RAX), b: imm(w - 1), w, f: "none" });
      return finish();
    }
    if (op === 0xa8 || op === 0xa9) {
      const bits: W = op === 0xa8 ? 8 : w;
      text = "test";
      ops.push({ k: "alu", op: "and", d: null, a: reg(RAX), b: imm(immOf(bits === 64 ? 32 : bits)), w: bits, f: "logic" });
      return finish();
    }
    if (op >= 0xb0 && op <= 0xb7) { text = "mov"; ops.push({ k: "mov", d: byteReg((op & 7) | rexB), s: imm(byte()), w: 8 }); return finish(); }
    if (op >= 0xb8 && op <= 0xbf) {
      text = "mov";
      const value = rexW ? u64v() : opsize16 ? u16() : BigInt.asUintN(32, s32());
      ops.push({ k: "mov", d: (op & 7) | rexB, s: imm(value), w });
      return finish();
    }
    if (op === 0xc0 || op === 0xc1 || op === 0xd0 || op === 0xd1 || op === 0xd2 || op === 0xd3) {
      const bits: W = op & 1 ? w : 8;
      const m = modrm();
      const kind = m.reg & 7;
      let count: Src = op <= 0xc1 ? imm(byte()) : op <= 0xd1 ? imm(1) : reg(RCX);
      if (kind === 0 || kind === 1) {
        // rol / ror: CF from the rotated bit, OF for a count of one; a zero count changes nothing.
        if (bits < 32) return fail("8/16-bit rotates are not in the map");
        const written = count;
        if (kind === 0) {
          // rol by n == ror by (-n mod width)
          ops.push({ k: "alu", op: "sub", d: T1, a: imm(0), b: count, w: 64, f: "none" });
          count = reg(T1);
        }
        text = kind === 0 ? "rol" : "ror";
        const rawCount = op <= 0xd1 ? (written as { imm?: bigint }) : null;
        let res: number;
        if (!m.ea) {
          ops.push({ k: "alu", op: "ror", d: m.rm, a: reg(m.rm), b: count, w: bits, f: "none" });
          res = m.rm;
        } else {
          ops.push({ k: "load", d: T0, ea: m.ea, size: sizeOf(bits), signed: false, w: 64 });
          ops.push({ k: "alu", op: "ror", d: T0, a: reg(T0), b: count, w: bits, f: "none" });
          ops.push({ k: "store", s: reg(T0), ea: m.ea, size: sizeOf(bits) });
          res = T0;
        }
        // CF: rol -> low bit of the result, ror -> top bit. OF for a count of one. Nothing changes for a count of zero.
        const cmask = bits === 64 ? 63 : 31;
        const when = (eq?: number) =>
          op >= 0xd2 ? { s: reg(RCX), mask: cmask, ...(eq === undefined ? {} : { eq }) } : null;
        const immCount = op >= 0xd2 ? -1 : op >= 0xd0 ? 1 : Number((rawCount?.imm ?? 0n) & BigInt(cmask));
        if (immCount !== 0) {
          ops.push({ k: "setflag", flag: "c", v: reg(res), bit: kind === 0 ? 0 : bits - 1, when: when() });
          if (immCount === 1 || immCount === -1) {
            if (kind === 0) ops.push({ k: "alu", op: "shr", d: T2, a: reg(res), b: imm(bits - 1), w: bits, f: "none" }, { k: "alu", op: "xor", d: T2, a: reg(T2), b: reg(res), w: 64, f: "none" });
            else ops.push({ k: "alu", op: "shl", d: T2, a: reg(res), b: imm(1), w: bits, f: "none" }, { k: "alu", op: "xor", d: T2, a: reg(T2), b: reg(res), w: 64, f: "none" });
            ops.push({ k: "setflag", flag: "o", v: reg(T2), bit: kind === 0 ? 0 : bits - 1, when: when(1) ?? (immCount === 1 ? null : { s: imm(0), mask: 1, eq: 1 }) });
          }
        }
        return finish();
      }
      const name = kind === 4 || kind === 6 ? "shl" : kind === 5 ? "shr" : kind === 7 ? "sar" : null;
      if (!name) return fail("rcl/rcr are not in the map");
      text = name;
      const target = m.ea ? T0 : bits === 8 ? byteReg(m.rm) : m.rm;
      if (m.ea) ops.push({ k: "load", d: T0, ea: m.ea, size: sizeOf(bits), signed: false, w: 64 });
      // CF = the last bit shifted out, computed from the original value (32/64-bit forms).
      const cmask = bits === 64 ? 63 : 31;
      const variable = op >= 0xd2;
      const n = variable ? -1 : Number(((count as { imm: bigint }).imm ?? 0n) & BigInt(cmask));
      const carry = bits >= 32 && n !== 0;
      if (carry) {
        if (variable) {
          ops.push({ k: "alu", op: "and", d: T1, a: reg(RCX), b: imm(cmask), w: 64, f: "none" });
          if (name === "shl") ops.push({ k: "alu", op: "sub", d: T1, a: imm(bits), b: reg(T1), w: 64, f: "none" });
          else ops.push({ k: "alu", op: "sub", d: T1, a: reg(T1), b: imm(1), w: 64, f: "none" });
          ops.push({ k: "alu", op: name === "sar" ? "sar" : "shr", d: SINK, a: reg(target), b: reg(T1), w: bits, f: "none" });
        } else ops.push({ k: "alu", op: name === "sar" ? "sar" : "shr", d: SINK, a: reg(target), b: imm(name === "shl" ? bits - n : n - 1), w: bits, f: "none" });
        // OF for a count of one: shl -> top bit of result xor CF; shr -> top bit of the original; sar -> 0
        ops.push({ k: "alu", op: "shr", d: T1, a: reg(target), b: imm(bits - 1), w: bits, f: "none" });
      }
      // A shift by zero leaves every flag alone; otherwise Z and S follow the result.
      ops.push({ k: "alu", op: name, d: target, a: reg(target), b: count, w: bits, f: "none" });
      if (n !== 0) ops.push({ k: "flagsz", v: reg(target), w: bits, when: variable ? { s: reg(RCX), mask: cmask } : null });
      if (carry) {
        const when = variable ? { s: reg(RCX), mask: cmask } : null;
        ops.push({ k: "setflag", flag: "c", v: reg(SINK), bit: 0, when });
        if (n === 1 || variable) {
          const one = variable ? { s: reg(RCX), mask: cmask, eq: 1 } : null;
          if (name === "shr") ops.push({ k: "setflag", flag: "o", v: reg(T1), bit: 0, when: one });
          if (name === "shl") {
            ops.push({ k: "alu", op: "shr", d: T1, a: reg(target), b: imm(bits - 1), w: bits, f: "none" });
            ops.push({ k: "alu", op: "xor", d: T1, a: reg(T1), b: reg(SINK), w: 64, f: "none" });
            ops.push({ k: "setflag", flag: "o", v: reg(T1), bit: 0, when: one });
          }
        }
      }
      if (m.ea) ops.push({ k: "store", s: reg(T0), ea: m.ea, size: sizeOf(bits) });
      return finish();
    }
    if (op === 0xc2 || op === 0xc3) {
      text = "ret";
      const extra = op === 0xc2 ? u16() : 0n;
      ops.push({ k: "load", d: T1, ea: { base: RSP, index: null, scale: 1, disp: 0n }, size: 8, signed: false, w: 64 });
      ops.push({ k: "alu", op: "add", d: RSP, a: reg(RSP), b: imm(8n + extra), w: 64, f: "none" });
      ops.push({ k: "jmpr", s: reg(T1) });
      fall = false;
      return finish();
    }
    if (op === 0xc6 || op === 0xc7) {
      const bits: W = op === 0xc6 ? 8 : w;
      const m = modrm();
      if ((m.reg & 7) !== 0) return fail("c6/c7 extension is not mov");
      text = "mov";
      writeRm(m, imm(immOf(bits === 64 ? 32 : bits)), bits);
      return finish();
    }
    if (op === 0xc9) {
      text = "leave";
      ops.push({ k: "mov", d: RSP, s: reg(RBP), w: 64 });
      pop(RBP);
      return finish();
    }
    if (op === 0xa4 || op === 0xa5 || op === 0xaa || op === 0xab) {
      // movs / stos, optionally with rep. The direction flag is assumed clear (the ABI requires it).
      const bits: W = op & 1 ? w : 8;
      const size = sizeOf(bits);
      const movs = op <= 0xa5;
      const RSI = 6;
      const RDI = 7;
      text = `${rep ? "rep " : ""}${movs ? "movs" : "stos"}`;
      if (rep) ops.push({ k: "cbz", s: reg(RCX), w: 64, nz: false, t: p });
      if (movs) {
        ops.push({ k: "load", d: T0, ea: { base: RSI, index: null, scale: 1, disp: 0n }, size, signed: false, w: 64 });
        ops.push({ k: "store", s: reg(T0), ea: { base: RDI, index: null, scale: 1, disp: 0n }, size });
        ops.push({ k: "alu", op: "add", d: RSI, a: reg(RSI), b: imm(size), w: 64, f: "none" });
      } else ops.push({ k: "store", s: reg(RAX), ea: { base: RDI, index: null, scale: 1, disp: 0n }, size });
      ops.push({ k: "alu", op: "add", d: RDI, a: reg(RDI), b: imm(size), w: 64, f: "none" });
      if (rep) {
        // One element per pass, then back to the same instruction: interruptible and fuel-counted.
        ops.push({ k: "alu", op: "sub", d: RCX, a: reg(RCX), b: imm(1), w: 64, f: "none" });
        ops.push({ k: "jmp", t: pc });
        fall = false;
        targets = [pc, p];
      }
      return finish();
    }
    if (op === 0xd9 || op === 0xdd || op === 0xdb) {
      // x87: only the control-word reads/writes that libc uses to learn the rounding mode
      const m = modrm();
      const kind = m.reg & 7;
      if (op === 0xd9 && m.ea && kind === 7) {
        text = "fnstcw";
        ops.push({ k: "store", s: imm(0x037f), ea: m.ea, size: 2 }); // default: round to nearest, all exceptions masked
        return finish();
      }
      if (op === 0xd9 && m.ea && kind === 5) {
        text = "fldcw"; // the x87 unit is not emulated; the rounding mode stays round-to-nearest
        return finish();
      }
      return fail("x87 floating point is not in the map");
    }
    if (op === 0xcc) return fail("int3 breakpoint");
    if (op === 0xe8) {
      const rel = s32();
      const t = u64(p + rel);
      text = "call";
      push(imm(p));
      ops.push({ k: "jmp", t });
      fall = false;
      targets = [t, p];
      return finish();
    }
    if (op === 0xe9 || op === 0xeb) {
      const rel = op === 0xe9 ? s32() : s8();
      const t = u64(p + rel);
      text = "jmp";
      ops.push({ k: "jmp", t });
      fall = false;
      targets = [t];
      return finish();
    }
    if (op === 0xf4) { text = "hlt"; ops.push({ k: "halt", why: "hlt" }); fall = false; return finish(); }
    if (op === 0xf6 || op === 0xf7) {
      const bits: W = op === 0xf6 ? 8 : w;
      const m = modrm();
      const kind = m.reg & 7;
      if (kind === 0 || kind === 1) {
        text = "test";
        const src = readRm(m, bits);
        ops.push({ k: "alu", op: "and", d: null, a: src, b: imm(immOf(bits === 64 ? 32 : bits)), w: bits, f: "logic" });
        return finish();
      }
      if (kind === 2 || kind === 3) {
        text = kind === 2 ? "not" : "neg";
        const src = readRm(m, bits);
        if (kind === 2) ops.push({ k: "alu", op: "xor", d: T0, a: src, b: imm(-1), w: bits, f: "none" });
        else ops.push({ k: "alu", op: "sub", d: T0, a: imm(0), b: src, w: bits, f: "arith" });
        writeRm(m, reg(T0), bits);
        return finish();
      }
      if (bits === 8) return fail("8-bit mul/div are not in the map");
      const src = readRm(m, bits, T1);
      if (kind === 4 || kind === 5) {
        text = kind === 4 ? "mul" : "imul";
        ops.push({ k: "alu", op: kind === 4 ? "umulh" : "smulh", d: T0, a: reg(RAX), b: src, w: bits, f: "none" });
        ops.push({ k: "alu", op: "mul", d: RAX, a: reg(RAX), b: src, w: bits, f: "none" });
        ops.push({ k: "mov", d: RDX, s: reg(T0), w: bits });
        // CF = OF = the high half carries information: mul, high != 0; imul, high != sign of low
        if (kind === 4) ops.push({ k: "alu", op: "sub", d: null, a: imm(0), b: reg(T0), w: bits, f: "arith" }, { k: "set", d: T1, c: "b", w: 64 });
        else
          ops.push(
            { k: "alu", op: "sar", d: T1, a: reg(RAX), b: imm(bits - 1), w: bits, f: "none" },
            { k: "alu", op: "sub", d: null, a: reg(T1), b: reg(T0), w: bits, f: "arith" },
            { k: "set", d: T1, c: "ne", w: 64 },
          );
        ops.push(...overflowFlags(T1));
        return finish();
      }
      text = kind === 6 ? "div" : "idiv";
      ops.push({ k: "div2", signed: kind === 7, s: src, w: bits });
      return finish();
    }
    if (op === 0xfe || op === 0xff) {
      const bits: W = op === 0xfe ? 8 : w;
      const m = modrm();
      const kind = m.reg & 7;
      if (kind === 0 || kind === 1) {
        text = kind === 0 ? "inc" : "dec";
        const src = readRm(m, bits);
        ops.push({ k: "alu", op: kind === 0 ? "add" : "sub", d: T0, a: src, b: imm(1), w: bits, f: "inc" });
        writeRm(m, reg(T0), bits);
        return finish();
      }
      if (op === 0xfe) return fail("fe extension is not in the map");
      if (kind === 2 || kind === 4) {
        const target = readRm(m, 64, T1);
        if ("r" in target && target.r !== T1) ops.push({ k: "mov", d: T1, s: target, w: 64 });
        if (kind === 2) {
          text = "call";
          push(imm(p));
          targets = [p];
        } else text = "jmp";
        ops.push({ k: "jmpr", s: reg(T1) });
        fall = false;
        return finish();
      }
      if (kind === 6) {
        text = "push";
        const src = readRm(m, 64, T0);
        push(src);
        return finish();
      }
      return fail("far call/jmp are not in the map");
    }

    // ---------- two-byte opcodes ----------
    if (op === 0x0f) {
      const op2 = byte();

      // ---------- SSE/SSE2 (integer and data movement) ----------
      {
        const X = (n: number) => XMM(n); // low half of xmm n; high half is X(n) + 1
        const XT = 16; // temp vector for memory operands
        const eaPlus = (ea: Ea, k: number): Ea => {
          const copy: Ea = { ...ea, disp: u64(ea.disp + BigInt(k)) };
          eas.push(copy);
          return copy;
        };
        /** xmm operand from r/m: a register, or memory loaded into the temp vector. */
        const xrm = (m: ModRM, size: 4 | 8 | 16): number => {
          if (!m.ea) return m.rm;
          ops.push({ k: "load", d: X(XT), ea: m.ea, size: size === 16 ? 8 : size, signed: false, w: 64 });
          if (size === 16) ops.push({ k: "load", d: X(XT) + 1, ea: eaPlus(m.ea, 8), size: 8, signed: false, w: 64 });
          else ops.push({ k: "mov", d: X(XT) + 1, s: imm(0), w: 64 });
          return XT;
        };
        const storeX = (ea: Ea, x: number, size: 4 | 8 | 16) => {
          ops.push({ k: "store", s: reg(X(x)), ea, size: size === 16 ? 8 : size });
          if (size === 16) ops.push({ k: "store", s: reg(X(x) + 1), ea: eaPlus(ea, 8), size: 8 });
        };
        const copyX = (d: number, a: number) => {
          if (d === a) return;
          ops.push({ k: "mov", d: X(d), s: reg(X(a)), w: 64 });
          ops.push({ k: "mov", d: X(d) + 1, s: reg(X(a) + 1), w: 64 });
        };
        const vec = (vop: VecOp, d: number, a: number, b: number, immv = 0) => ops.push({ k: "vec", op: vop, d, a, b, imm: immv });
        const lanesUnpack = (size: number, high: boolean) => {
          const out: number[] = [];
          const per = 16 / size;
          for (let j = 0; j < per; j += 1) {
            const lane = (high ? per / 2 : 0) + (j >> 1);
            for (let k = 0; k < size; k += 1) out.push((j & 1 ? 16 : 0) + lane * size + k);
          }
          return shuffleId(out);
        };
        const dwordShuffle = (pick: (i: number) => number) => {
          const out: number[] = [];
          for (let i = 0; i < 4; i += 1) for (let k = 0; k < 4; k += 1) out.push(pick(i) * 4 + k);
          return shuffleId(out);
        };
        const wordShuffle = (pick: (i: number) => number) => {
          const out: number[] = [];
          for (let i = 0; i < 8; i += 1) for (let k = 0; k < 2; k += 1) out.push(pick(i) * 2 + k);
          return shuffleId(out);
        };
        const zeroTemp = () => {
          ops.push({ k: "mov", d: X(XT), s: imm(0), w: 64 });
          ops.push({ k: "mov", d: X(XT) + 1, s: imm(0), w: 64 });
        };
        const p66 = opsize16 && !rep && !repne;
        const none = !opsize16 && !rep && !repne;
        const BIT: Record<number, VecOp> = { 0xdb: "and", 0xeb: "or", 0xef: "xor", 0x54: "and", 0x56: "or", 0x57: "xor" };
        const PACKED: Record<number, VecOp> = {
          0x64: "gt8", 0x65: "gt16", 0x66: "gt32", 0x74: "eq8", 0x75: "eq16", 0x76: "eq32",
          0xd4: "add64", 0xfc: "add8", 0xfd: "add16", 0xfe: "add32", 0xf8: "sub8", 0xf9: "sub16", 0xfa: "sub32", 0xfb: "sub64",
          0xda: "minu8", 0xde: "maxu8", 0xea: "mins16", 0xee: "maxs16",
        };
        const sseDone = (name: string): Decoded => {
          text = name;
          return finish();
        };
        if ((op2 === 0x10 || op2 === 0x11) && (none || p66)) {
          const m = modrm();
          const xr = m.reg;
          if (op2 === 0x10) copyX(xr, xrm(m, 16));
          else if (m.ea) storeX(m.ea, xr, 16);
          else copyX(m.rm, xr);
          return sseDone("movups");
        }
        if ((op2 === 0x28 || op2 === 0x29) && (none || p66)) {
          const m = modrm();
          if (op2 === 0x28) copyX(m.reg, xrm(m, 16));
          else if (m.ea) storeX(m.ea, m.reg, 16);
          else copyX(m.rm, m.reg);
          return sseDone("movaps");
        }
        if ((op2 === 0x6f || op2 === 0x7f) && (p66 || (rep && !repne))) {
          const m = modrm();
          if (op2 === 0x6f) copyX(m.reg, xrm(m, 16));
          else if (m.ea) storeX(m.ea, m.reg, 16);
          else copyX(m.rm, m.reg);
          return sseDone(rep ? "movdqu" : "movdqa");
        }
        if ((op2 === 0x2b && (none || p66)) || (op2 === 0xe7 && p66)) {
          const m = modrm();
          if (!m.ea) throw new Gapped("non-temporal store needs memory");
          storeX(m.ea, m.reg, 16);
          return sseDone("movnt");
        }
        if ((op2 === 0x10 || op2 === 0x11) && (rep || repne)) {
          const size = rep ? 4 : 8;
          const m = modrm();
          const xr = m.reg;
          if (op2 === 0x11) {
            if (m.ea) ops.push({ k: "store", s: reg(X(xr)), ea: m.ea, size });
            else if (size === 8) ops.push({ k: "mov", d: X(m.rm), s: reg(X(xr)), w: 64 });
            else ops.push(...mergeLow32(X(m.rm), X(xr)));
          } else if (m.ea) {
            ops.push({ k: "load", d: X(xr), ea: m.ea, size, signed: false, w: 64 });
            ops.push({ k: "mov", d: X(xr) + 1, s: imm(0), w: 64 });
          } else if (size === 8) ops.push({ k: "mov", d: X(xr), s: reg(X(m.rm)), w: 64 });
          else ops.push(...mergeLow32(X(xr), X(m.rm)));
          return sseDone(rep ? "movss" : "movsd");
        }
        // ---------- scalar floating point (SSE/SSE2) ----------
        if ((rep || repne) && !(rep && repne) && [0x51, 0x58, 0x59, 0x5c, 0x5d, 0x5e, 0x5f].includes(op2)) {
          const size = repne ? 8 : 4;
          const m = modrm();
          const b = xrm(m, size);
          const fname = ({ 0x51: "sqrt", 0x58: "add", 0x59: "mul", 0x5c: "sub", 0x5d: "min", 0x5e: "div", 0x5f: "max" } as const)[op2 as 0x51]!;
          ops.push({ k: "fop", op: fname, d: m.reg, a: m.reg, b, size });
          return sseDone(`${fname}s${size === 8 ? "d" : "s"}`);
        }
        if ((rep || repne) && op2 === 0x2a) {
          const m = modrm();
          const src = readRm(m, rexW ? 64 : 32, T0);
          ops.push({ k: "fcvt", kind: "i2f", d: m.reg, s: src, w: rexW ? 64 : 32, size: repne ? 8 : 4 });
          return sseDone("cvtsi2s");
        }
        if ((rep || repne) && (op2 === 0x2c || op2 === 0x2d)) {
          const m = modrm();
          const a = xrm(m, repne ? 8 : 4);
          ops.push({ k: "fcvt", kind: "f2i", d: m.reg, a, w: rexW ? 64 : 32, size: repne ? 8 : 4, trunc: op2 === 0x2c });
          return sseDone(op2 === 0x2c ? "cvtts2si" : "cvts2si");
        }
        if ((rep || repne) && op2 === 0x5a) {
          const m = modrm();
          const from = repne ? 8 : 4;
          const a = xrm(m, from);
          ops.push({ k: "fcvt", kind: "f2f", d: m.reg, a, from });
          return sseDone(repne ? "cvtsd2ss" : "cvtss2sd");
        }
        if ((op2 === 0x2e || op2 === 0x2f) && (none || p66)) {
          const m = modrm();
          const size = p66 ? 8 : 4;
          ops.push({ k: "fcmp", a: m.reg, b: xrm(m, size), size });
          return sseDone(op2 === 0x2e ? "ucomis" : "comis");
        }
        if ((op2 === 0x12 || op2 === 0x13 || op2 === 0x16 || op2 === 0x17) && (none || p66)) {
          const m = modrm();
          const high = op2 >= 0x16;
          const half = (x: number) => X(x) + (high ? 1 : 0);
          if (op2 === 0x13 || op2 === 0x17) {
            if (!m.ea) throw new Gapped("movlps/movhps store needs memory");
            ops.push({ k: "store", s: reg(half(m.reg)), ea: m.ea, size: 8 });
          } else if (m.ea) ops.push({ k: "load", d: half(m.reg), ea: m.ea, size: 8, signed: false, w: 64 });
          else if (none) ops.push({ k: "mov", d: half(m.reg), s: reg(X(m.rm) + (high ? 0 : 1)), w: 64 }); // movhlps / movlhps
          else throw new Gapped("movlpd/movhpd with a register is invalid");
          return sseDone(high ? "movhps" : "movlps");
        }
        if ((BIT[op2] && (p66 || (op2 < 0x60 && none))) || (op2 === 0x55 && (none || p66)) || (op2 === 0xdf && p66)) {
          const m = modrm();
          const b = xrm(m, 16);
          if (op2 === 0xdf || op2 === 0x55) vec("andn", m.reg, b, m.reg); // dst = ~dst & src
          else vec(BIT[op2], m.reg, m.reg, b);
          return sseDone("pbitwise");
        }
        if (PACKED[op2] && p66) {
          const m = modrm();
          vec(PACKED[op2], m.reg, m.reg, xrm(m, 16));
          return sseDone("packed");
        }
        if (p66 && ((op2 >= 0x60 && op2 <= 0x62) || (op2 >= 0x68 && op2 <= 0x6a) || op2 === 0x6c || op2 === 0x6d)) {
          const m = modrm();
          const size = op2 === 0x6c || op2 === 0x6d ? 8 : 1 << (op2 & 3);
          const high = op2 >= 0x68 && op2 !== 0x6c;
          vec("shuffle", m.reg, m.reg, xrm(m, 16), lanesUnpack(size, high));
          return sseDone("punpck");
        }
        if ((op2 === 0x14 || op2 === 0x15) && (none || p66)) {
          const m = modrm();
          vec("shuffle", m.reg, m.reg, xrm(m, 16), lanesUnpack(none ? 4 : 8, op2 === 0x15));
          return sseDone("unpck");
        }
        if (op2 === 0x70 && (p66 || rep || repne)) {
          const m = modrm();
          const src = xrm(m, 16);
          const k = byte();
          if (p66) vec("shuffle", m.reg, src, src, dwordShuffle((i) => (k >> (2 * i)) & 3));
          else if (repne) vec("shuffle", m.reg, src, src, wordShuffle((i) => (i < 4 ? (k >> (2 * i)) & 3 : i)));
          else vec("shuffle", m.reg, src, src, wordShuffle((i) => (i < 4 ? i : 4 + ((k >> (2 * (i - 4))) & 3))));
          return sseDone("pshuf");
        }
        if (op2 === 0xc6 && none) {
          const m = modrm();
          const src = xrm(m, 16);
          const k = byte();
          vec("shuffle", m.reg, m.reg, src, dwordShuffle((i) => (i < 2 ? (k >> (2 * i)) & 3 : 4 + ((k >> (2 * i)) & 3))));
          return sseDone("shufps");
        }
        if (p66 && op2 >= 0x71 && op2 <= 0x73) {
          const m = modrm();
          if (m.ea) throw new Gapped("vector shift by immediate needs a register");
          const kind = m.reg & 7;
          const n = byte();
          const x = m.rm;
          if (op2 === 0x73 && (kind === 3 || kind === 7)) {
            zeroTemp();
            const lanes = Array.from({ length: 16 }, (_, i) => (kind === 3 ? (i + n < 16 ? i + n : 16) : i >= n ? i - n : 16));
            vec("shuffle", x, x, XT, shuffleId(lanes));
            return sseDone(kind === 3 ? "psrldq" : "pslldq");
          }
          const width = op2 === 0x71 ? 16 : op2 === 0x72 ? 32 : 64;
          const name = kind === 2 ? "shr" : kind === 4 ? "sar" : kind === 6 ? "shl" : null;
          if (!name || (name === "sar" && width === 64)) throw new Gapped("vector shift form is not in the map");
          if (n >= width && name !== "sar") vec("xor", x, x, x);
          else vec(`${name}${width}` as VecOp, x, x, x, Math.min(n, width - 1));
          return sseDone(`p${name}`);
        }
        if (op2 === 0x6e && p66) {
          const m = modrm();
          const src = m.ea ? (ops.push({ k: "load", d: T0, ea: m.ea, size: rexW ? 8 : 4, signed: false, w: 64 }), reg(T0)) : reg(m.rm);
          ops.push({ k: "mov", d: X(m.reg), s: src, w: rexW ? 64 : 32 });
          ops.push({ k: "mov", d: X(m.reg) + 1, s: imm(0), w: 64 });
          return sseDone(rexW ? "movq" : "movd");
        }
        if (op2 === 0x7e && p66) {
          const m = modrm();
          if (m.ea) ops.push({ k: "store", s: reg(X(m.reg)), ea: m.ea, size: rexW ? 8 : 4 });
          else ops.push({ k: "mov", d: m.rm, s: reg(X(m.reg)), w: rexW ? 64 : 32 });
          return sseDone(rexW ? "movq" : "movd");
        }
        if ((op2 === 0x7e && rep && !repne) || (op2 === 0xd6 && p66)) {
          const m = modrm();
          if (op2 === 0x7e) {
            const src = xrm(m, 8);
            ops.push({ k: "mov", d: X(m.reg), s: reg(X(src)), w: 64 });
            ops.push({ k: "mov", d: X(m.reg) + 1, s: imm(0), w: 64 });
          } else if (m.ea) ops.push({ k: "store", s: reg(X(m.reg)), ea: m.ea, size: 8 });
          else {
            ops.push({ k: "mov", d: X(m.rm), s: reg(X(m.reg)), w: 64 });
            ops.push({ k: "mov", d: X(m.rm) + 1, s: imm(0), w: 64 });
          }
          return sseDone("movq");
        }
        if (op2 === 0xd7 && p66) {
          const m = modrm();
          if (m.ea) throw new Gapped("pmovmskb needs a register");
          ops.push({ k: "vmask", d: m.reg, a: m.rm, lanes: 16 });
          return sseDone("pmovmskb");
        }
        if (op2 === 0x50 && none) {
          const m = modrm();
          if (m.ea) throw new Gapped("movmskps needs a register");
          ops.push({ k: "vmask", d: m.reg, a: m.rm, lanes: 4 });
          return sseDone("movmskps");
        }
        if (op2 === 0x18 || op2 === 0x0d) {
          modrm();
          return sseDone("prefetch");
        }
        if (op2 === 0xae && none) {
          const m = modrm();
          const kind = m.reg & 7;
          if (!m.ea && kind >= 5) return sseDone("fence");
          if (m.ea && kind === 2) return sseDone("ldmxcsr"); // rounding control is fixed: round to nearest
          if (m.ea && kind === 3) {
            ops.push({ k: "store", s: imm(0x1f80), ea: m.ea, size: 4 });
            return sseDone("stmxcsr");
          }
          throw new Gapped("0f ae form is not in the map");
        }
      }
      if (op2 === 0x05) { text = "syscall"; ops.push({ k: "sys" }); return finish(); }
      if (op2 === 0xa2) { text = "cpuid"; ops.push({ k: "cpuid" }); return finish(); }
      if (op2 === 0x0b) { text = "ud2"; ops.push({ k: "halt", why: "ud2" }); fall = false; return finish(); }
      if (op2 === 0x1f) { text = "nop"; modrm(); return finish(); }
      if (op2 === 0x1e && rep) {
        const b = byte();
        if (b === 0xfa || b === 0xfb) { text = "endbr"; return finish(); }
        if ((b & 0xf8) === 0xc8) { text = "rdssp"; return finish(); } // no shadow stack here: rdssp is a nop, as on CPUs without CET
        return fail("0f 1e form is not in the map");
      }
      if (op2 >= 0x40 && op2 <= 0x4f) {
        const c = CC[op2 & 15];
        if (!c) return fail("parity conditions are not in the map");
        const m = modrm();
        const src = readRm(m, w);
        text = `cmov${c}`;
        ops.push({ k: "csel", d: m.reg, c, a: src, b: reg(m.reg), w });
        return finish();
      }
      if (op2 >= 0x80 && op2 <= 0x8f) {
        const c = CC[op2 & 15];
        if (!c) return fail("parity conditions are not in the map");
        const rel = s32();
        const t = u64(p + rel);
        text = `j${c}`;
        ops.push({ k: "br", c, t });
        targets = [t];
        return finish();
      }
      if (op2 >= 0x90 && op2 <= 0x9f) {
        const c = CC[op2 & 15];
        if (!c) return fail("parity conditions are not in the map");
        const m = modrm();
        text = `set${c}`;
        if (!m.ea) ops.push({ k: "set", d: byteReg(m.rm), c, w: 8 });
        else {
          ops.push({ k: "set", d: T0, c, w: 64 });
          ops.push({ k: "store", s: reg(T0), ea: m.ea, size: 1 });
        }
        return finish();
      }
      if (op2 === 0xa4 || op2 === 0xa5 || op2 === 0xac || op2 === 0xad) {
        // shld / shrd: shift dst, filling from src. Count 0 changes nothing.
        if (w === 16) return fail("16-bit shld/shrd is not in the map");
        const left = op2 <= 0xa5;
        const m = modrm();
        const cmask = w === 64 ? 63 : 31;
        const variable = op2 === 0xa5 || op2 === 0xad;
        const n = variable ? -1 : byte() & cmask;
        if (n === 0) {
          // a zero count changes nothing, except that a 32-bit register destination is still written (zero-extended)
          text = left ? "shld" : "shrd";
          if (!m.ea && w === 32) ops.push({ k: "mov", d: m.rm, s: reg(m.rm), w: 32 });
          return finish();
        }
        const dst = readRm(m, w, T0);
        if ("r" in dst && dst.r !== T0) ops.push({ k: "mov", d: T0, s: dst, w: 64 });
        const count: Src = variable ? reg(T2) : imm(n);
        if (variable) ops.push({ k: "alu", op: "and", d: T2, a: reg(RCX), b: imm(cmask), w: 64, f: "none" });
        const back: Src = variable ? reg(SINK) : imm(w - 1 - n);
        if (variable) ops.push({ k: "alu", op: "sub", d: SINK, a: imm(w - 1), b: reg(T2), w: 64, f: "none" });
        // fill bits from src; n = 0 gives 0 here because the shift is split in two
        ops.push({ k: "alu", op: left ? "shr" : "shl", d: T1, a: reg(m.reg), b: imm(1), w, f: "none" });
        ops.push({ k: "alu", op: left ? "shr" : "shl", d: T1, a: reg(T1), b: back, w, f: "none" });
        // carry: the last bit shifted out of dst. shld: bit (w - n); shrd: bit (n - 1)
        if (left) {
          ops.push({ k: "alu", op: "shr", d: T3, a: reg(T0), b: imm(1), w, f: "none" });
          ops.push({ k: "alu", op: "shr", d: T3, a: reg(T3), b: back, w, f: "none" });
        } else {
          ops.push({ k: "alu", op: "sub", d: T3, a: count, b: imm(1), w: 64, f: "none" });
          ops.push({ k: "alu", op: "shr", d: T3, a: reg(T0), b: reg(T3), w, f: "none" });
        }
        ops.push({ k: "alu", op: left ? "shl" : "shr", d: T0, a: reg(T0), b: count, w, f: "none" });
        ops.push({ k: "alu", op: "or", d: T0, a: reg(T0), b: reg(T1), w, f: "none" });
        const when = variable ? { s: reg(RCX), mask: cmask } : null;
        ops.push({ k: "flagsz", v: reg(T0), w, when });
        ops.push({ k: "setflag", flag: "c", v: reg(T3), bit: 0, when });
        writeRm(m, reg(T0), w);
        text = left ? "shld" : "shrd";
        return finish();
      }
      if (op2 === 0xa3 || op2 === 0xab || op2 === 0xb3 || op2 === 0xbb || op2 === 0xba) {
        // bt / bts / btr / btc: CF = the bit; then set, clear or flip it. Other flags are left as a subtraction would.
        const m = modrm();
        let kind: number;
        let index: Src;
        if (op2 === 0xba) {
          kind = m.reg & 7;
          if (kind < 4) return fail("0f ba form is not in the map");
          index = imm(byte() & (w - 1));
        } else {
          kind = { 0xa3: 4, 0xab: 5, 0xb3: 6, 0xbb: 7 }[op2]!;
          index = reg(m.reg);
        }
        let target = m.ea;
        if (target && "r" in index) {
          // bit strings in memory: the register index can reach other words
          const shift = Math.log2(w);
          ops.push({ k: "alu", op: "sar", d: T2, a: index, b: imm(shift), w: 64, f: "none" });
          ops.push({ k: "alu", op: "shl", d: T2, a: reg(T2), b: imm(Math.log2(w / 8)), w: 64, f: "none" });
          ops.push({ k: "lea", d: T2, ea: { ...target, index: T2, scale: 1 }, w: 64 });
          target = { base: T2, index: null, scale: 1, disp: 0n };
        }
        const mm = { ...m, ea: target };
        const value = readRm(mm, w, T0);
        if ("r" in value && value.r !== T0) ops.push({ k: "mov", d: T0, s: value, w: 64 });
        ops.push({ k: "alu", op: "shr", d: T1, a: reg(T0), b: index, w, f: "none" });
        ops.push({ k: "alu", op: "and", d: T1, a: reg(T1), b: imm(1), w: 64, f: "none" });
        ops.push({ k: "alu", op: "sub", d: null, a: imm(0), b: reg(T1), w: 64, f: "arith" }); // C = bit
        text = ["bt", "bts", "btr", "btc"][kind - 4];
        if (kind === 4) return finish();
        ops.push({ k: "alu", op: "shl", d: T1, a: imm(1), b: index, w, f: "none" });
        if (kind === 5) ops.push({ k: "alu", op: "or", d: T0, a: reg(T0), b: reg(T1), w, f: "none" });
        if (kind === 6) {
          ops.push({ k: "alu", op: "xor", d: T1, a: reg(T1), b: imm(-1), w, f: "none" });
          ops.push({ k: "alu", op: "and", d: T0, a: reg(T0), b: reg(T1), w, f: "none" });
        }
        if (kind === 7) ops.push({ k: "alu", op: "xor", d: T0, a: reg(T0), b: reg(T1), w, f: "none" });
        writeRm(mm, reg(T0), w);
        return finish();
      }
      if (op2 === 0xbc || op2 === 0xbd) {
        const m = modrm();
        const src = readRm(m, w, T1);
        const bsr = op2 === 0xbd;
        if (rep) {
          // tzcnt / lzcnt: a zero source gives the width. Z from the result, C = source was zero.
          text = bsr ? "lzcnt" : "tzcnt";
          ops.push({ k: "alu", op: bsr ? "clz" : "ctz", d: m.reg, a: src, b: imm(0), w, f: "logic" });
          // CF = source was zero, which is exactly when the count equals the width
          ops.push({ k: "setflag", flag: "c", v: reg(m.reg), bit: Math.log2(w), when: null });
          return finish();
        }
        text = bsr ? "bsr" : "bsf";
        ops.push({ k: "alu", op: bsr ? "clz" : "ctz", d: T0, a: src, b: imm(0), w, f: "none" });
        if (bsr) ops.push({ k: "alu", op: "sub", d: T0, a: imm(w - 1), b: reg(T0), w, f: "none" });
        ops.push({ k: "alu", op: "and", d: null, a: src, b: src, w, f: "logic" }); // Z = source is zero
        ops.push({ k: "csel", d: m.reg, c: "ne", a: reg(T0), b: reg(m.reg), w }); // zero source: destination unchanged
        return finish();
      }
      if (op2 === 0xb0 || op2 === 0xb1) {
        // cmpxchg (one guest thread, so lock needs nothing extra)
        const bits: W = op2 === 0xb0 ? 8 : w;
        const m = modrm();
        const cur = readRm(m, bits, T0);
        if ("r" in cur && cur.r !== T0) ops.push({ k: "mov", d: T0, s: cur, w: bits === 8 ? 64 : bits });
        ops.push({ k: "alu", op: "sub", d: null, a: reg(RAX), b: reg(T0), w: bits, f: "arith" });
        if (!m.ea && bits !== 8) {
          // register destination: written (with the usual 32-bit zero extension) only when equal
          ops.push({ k: "mov", d: T1, s: reg(m.reg), w: bits });
          ops.push({ k: "csel", d: m.rm, c: "eq", a: reg(T1), b: reg(m.rm), w: 64 });
        } else {
          ops.push({ k: "csel", d: T1, c: "eq", a: reg(bits === 8 ? byteReg(m.reg) : m.reg), b: reg(T0), w: 64 });
          writeRm(m, reg(T1), bits);
        }
        if (bits === 8) ops.push({ k: "csel", d: T1, c: "eq", a: reg(RAX), b: reg(T0), w: 64 }, { k: "mov", d: RAX, s: reg(T1), w: 8 });
        else ops.push({ k: "csel", d: RAX, c: "eq", a: reg(RAX), b: reg(T0), w: 64 });
        text = "cmpxchg";
        return finish();
      }
      if (op2 === 0xc0 || op2 === 0xc1) {
        const bits: W = op2 === 0xc0 ? 8 : w;
        const m = modrm();
        const cur = readRm(m, bits, T0);
        if ("r" in cur && cur.r !== T0) ops.push({ k: "mov", d: T0, s: cur, w: 64 });
        const r = bits === 8 ? byteReg(m.reg) : m.reg;
        ops.push({ k: "alu", op: "add", d: T1, a: reg(T0), b: reg(r), w: bits, f: "arith" });
        ops.push({ k: "mov", d: r, s: reg(T0), w: bits });
        writeRm(m, reg(T1), bits);
        text = "xadd";
        return finish();
      }
      if (op2 >= 0xc8 && op2 <= 0xcf) {
        // bswap
        const r = (op2 & 7) | rexB;
        text = "bswap";
        ops.push({ k: "mov", d: T0, s: imm(0), w: 64 });
        const n = w === 64 ? 8 : 4;
        for (let i = 0; i < n; i += 1) {
          ops.push({ k: "alu", op: "shr", d: T1, a: reg(r), b: imm(8 * i), w: 64, f: "none" });
          ops.push({ k: "alu", op: "and", d: T1, a: reg(T1), b: imm(0xff), w: 64, f: "none" });
          ops.push({ k: "alu", op: "shl", d: T1, a: reg(T1), b: imm(8 * (n - 1 - i)), w: 64, f: "none" });
          ops.push({ k: "alu", op: "or", d: T0, a: reg(T0), b: reg(T1), w: 64, f: "none" });
        }
        ops.push({ k: "mov", d: r, s: reg(T0), w: w === 64 ? 64 : 32 });
        return finish();
      }
      if (op2 === 0xaf) {
        const m = modrm();
        const src = readRm(m, w);
        text = "imul";
        if ("r" in src && src.r !== T0) ops.push({ k: "mov", d: T0, s: src, w: 64 });
        imulFlags(reg(m.reg), reg(T0), m.reg);
        return finish();
      }
      if (op2 === 0xb6 || op2 === 0xb7 || op2 === 0xbe || op2 === 0xbf) {
        const from = op2 & 1 ? 16 : 8;
        const signed = op2 >= 0xbe;
        const m = modrm();
        text = signed ? "movsx" : "movzx";
        let src: Src;
        if (m.ea) {
          ops.push({ k: "load", d: T0, ea: m.ea, size: (from / 8) as 1 | 2, signed: false, w: 64 });
          src = reg(T0);
        } else src = reg(from === 8 ? byteReg(m.rm) : m.rm);
        ops.push({ k: "ext", d: m.reg, s: src, from, signed, w });
        return finish();
      }
      return fail(`0f ${op2.toString(16).padStart(2, "0")} is not in the map`);
    }
    return fail(`opcode ${op.toString(16).padStart(2, "0")} is not in the map`);
  } catch (error) {
    if (error instanceof Gapped) return fail(error.message);
    throw error;
  }
}

export const X86_SINK = SINK;
