/**
 * AArch64 Advanced SIMD (NEON) and scalar floating point, lifted to guest IR.
 *
 * Vector registers are IR register pairs (XMM() in ir.ts; ARM v0..v31 are vector numbers V(n)), so
 * whole-vector work becomes the same `vec` ops x86 SSE uses (lowered to WebAssembly SIMD), and lane
 * moves (dup, ins, umov) are plain 64-bit arithmetic on the halves. Floating point uses the shared
 * scalar ops with ARM's rules (default NaN, saturating conversions, NZCV compares).
 *
 * Covered: the forms glibc's baseline (non-SVE) string, memory and math code and compiled C use.
 * Everything else returns a reason and becomes a gap; nothing unknown is executed.
 * Writes to a 64-bit (Q = 0) vector or to a scalar FP register clear the rest of the register.
 */
import { imm, M64, mask, reg, shuffleId, T0, T2, VTMP, VTMP2, XMM, type Cond, type Op, type Src, type VecOp } from "./ir.ts";

const bits = (v: number, hi: number, lo: number) => (v >>> lo) & ((1 << (hi - lo + 1)) - 1);
const CONDS: Cond[] = ["eq", "ne", "cs", "cc", "s", "ns", "o", "no", "hi", "ls", "ge", "lt", "gt", "le", "al", "al"];

/** ARM v-register n as a vector number (the same mapping as V in arm.ts). */
const V = (n: number) => (n < 16 ? n : n + 1);

/** 64-bit pattern of one `esize`-bit value repeated. */
function replicate(v: bigint, esize: number): bigint {
  let out = 0n;
  for (let i = 0; i < 64; i += esize) out |= (v & mask(esize)) << BigInt(i);
  return out;
}

/** The 64-bit value of FP immediate imm8 (VFPExpandImm) as a single (32) or double (64). */
function fpImm(imm8: number, size: 32 | 64): bigint {
  const sign = BigInt(imm8 >> 7);
  const b6 = (imm8 >> 6) & 1;
  const low = BigInt(imm8 & 0x3f);
  if (size === 32) {
    const exp = BigInt((b6 ? 0 : 1) << 7) | (b6 ? 0x7cn : 0n) | ((low >> 4n) & 3n);
    return (sign << 31n) | (exp << 23n) | ((low & 0xfn) << 19n);
  }
  const exp = BigInt((b6 ? 0 : 1) << 10) | (b6 ? 0x3fcn : 0n) | ((low >> 4n) & 3n);
  return (sign << 63n) | (exp << 52n) | ((low & 0xfn) << 48n);
}

export type SimdResult = { text: string } | string;

export function decodeSimd(word: number, _pc: bigint, ops: Op[], R: (n: number, sp?: boolean) => Src, D: (n: number, sp?: boolean) => number): SimdResult {
  const rd = bits(word, 4, 0);
  const rn = bits(word, 9, 5);
  const rm = bits(word, 20, 16);
  const Q = (word >>> 30) & 1;
  const U = (word >>> 29) & 1;
  const size = bits(word, 23, 22);

  const lo = (vn: number) => XMM(vn);
  const hi = (vn: number) => XMM(vn, 1);
  const vec = (op: VecOp, d: number, a: number, b: number, immv = 0) => ops.push({ k: "vec", op, d, a, b, imm: immv });
  const mov = (d: number, s: Src) => ops.push({ k: "mov", d, s, w: 64 });
  /** Set a whole vector to constant halves. */
  const setv = (vn: number, l: bigint, h: bigint) => {
    mov(lo(vn), imm(l));
    mov(hi(vn), imm(h));
  };
  const copyv = (d: number, a: number) => {
    if (d === a) return;
    mov(lo(d), reg(lo(a)));
    mov(hi(d), reg(hi(a)));
  };
  /** Clear the high half when the instruction works on 64 bits. */
  const narrow = (vn: number) => {
    if (!Q) mov(hi(vn), imm(0));
  };
  const shuffle = (d: number, a: number, b: number, lanes: number[]) => vec("shuffle", d, a, b, shuffleId(lanes));
  /** Byte indexes (into a ++ b) of the bytes of element `i` of `eb` bytes. */
  const elemBytes = (i: number, eb: number) => Array.from({ length: eb }, (_, k) => i * eb + k);

  const vd = V(rd);
  const vn = V(rn);
  const vm = V(rm);
  const ok = (text: string): SimdResult => ({ text });

  // ---------- load/store multiple structures: ld1/st1 with 1 to 4 registers ----------
  if ((word & 0xbfbf0000) >>> 0 === 0x0c000000 || (word & 0xbfa00000) >>> 0 === 0x0c800000) {
    const load = ((word >>> 22) & 1) === 1;
    const opcode = bits(word, 15, 12);
    const count = ({ 7: 1, 10: 2, 6: 3, 2: 4 } as Record<number, number>)[opcode];
    if (!count) return "ld2/ld3/ld4 (interleaved structures) are not in the map";
    const bytes = Q ? 16 : 8;
    const base = rn === 31 ? 31 : rn;
    ops.push({ k: "lea", d: T2, ea: { base, index: null, scale: 1, disp: 0n }, w: 64 });
    for (let i = 0; i < count; i += 1) {
      const t = V((rd + i) % 32);
      const at = (k: number) => ({ base: T2, index: null, scale: 1 as const, disp: BigInt(i * bytes + k) });
      if (load) {
        ops.push({ k: "load", d: lo(t), ea: at(0), size: 8, signed: false, w: 64 });
        if (Q) ops.push({ k: "load", d: hi(t), ea: at(8), size: 8, signed: false, w: 64 });
        else mov(hi(t), imm(0));
      } else {
        ops.push({ k: "store", s: reg(lo(t)), ea: at(0), size: 8 });
        if (Q) ops.push({ k: "store", s: reg(hi(t)), ea: at(8), size: 8 });
      }
    }
    if ((word >>> 23) & 1) {
      // post-index: by the transfer size (rm = 31) or by a register
      const by: Src = rm === 31 ? imm(count * bytes) : R(rm);
      ops.push({ k: "alu", op: "add", d: base, a: reg(base), b: by, w: 64, f: "none" });
    }
    return ok(load ? "ld1" : "st1");
  }
  // ld1r: load one element and replicate it to every lane
  if ((word & 0xbffff000) >>> 0 === 0x0d40c000 || (word & 0xbfe0f000) >>> 0 === 0x0dc0c000) {
    const eb = 1 << size;
    const base = rn === 31 ? 31 : rn;
    ops.push({ k: "load", d: T0, ea: { base, index: null, scale: 1, disp: 0n }, size: eb as 1 | 2 | 4 | 8, signed: false, w: 64 });
    ops.push({ k: "alu", op: "mul", d: lo(vd), a: reg(T0), b: imm(replicate(1n, eb * 8)), w: 64, f: "none" });
    mov(hi(vd), Q ? reg(lo(vd)) : imm(0));
    if ((word >>> 23) & 1) ops.push({ k: "alu", op: "add", d: base, a: reg(base), b: rm === 31 ? imm(eb) : R(rm), w: 64, f: "none" });
    return ok("ld1r");
  }

  // ---------- AdvSIMD copy: dup, ins, umov, smov ----------
  if ((word & 0x9fe08400) >>> 0 === 0x0e000400) {
    const imm5 = bits(word, 20, 16);
    const imm4 = bits(word, 14, 11);
    const op = (word >>> 29) & 1;
    const lsb = imm5 & -imm5;
    if (!lsb || lsb > 8) return "invalid element size";
    const eb = lsb; // element bytes: 1, 2, 4, 8
    const esize = eb * 8;
    const index = imm5 >> (Math.log2(eb) + 1);
    /** Register holding element `i` of vector `v`, and the bit shift within it. */
    const where = (v: number, i: number) => ({ r: (i * eb) >= 8 ? hi(v) : lo(v), sh: ((i * eb) % 8) * 8 });
    const extract = (v: number, i: number, into: number) => {
      const at = where(v, i);
      ops.push({ k: "alu", op: "shr", d: into, a: reg(at.r), b: imm(at.sh), w: 64, f: "none" });
      if (esize < 64) ops.push({ k: "alu", op: "and", d: into, a: reg(into), b: imm(mask(esize)), w: 64, f: "none" });
    };
    const insert = (v: number, i: number, value: number) => {
      const at = where(v, i);
      const m = mask(esize) << BigInt(at.sh);
      ops.push({ k: "alu", op: "and", d: at.r, a: reg(at.r), b: imm(~m & M64), w: 64, f: "none" });
      if (esize < 64) ops.push({ k: "alu", op: "and", d: value, a: reg(value), b: imm(mask(esize)), w: 64, f: "none" });
      if (at.sh) ops.push({ k: "alu", op: "shl", d: value, a: reg(value), b: imm(at.sh), w: 64, f: "none" });
      ops.push({ k: "alu", op: "or", d: at.r, a: reg(at.r), b: reg(value), w: 64, f: "none" });
    };
    const fill = (value: number) => {
      ops.push({ k: "alu", op: "mul", d: lo(vd), a: reg(value), b: imm(replicate(1n, esize)), w: 64, f: "none" });
      mov(hi(vd), Q ? reg(lo(vd)) : imm(0));
    };
    if (op === 1) {
      // ins (element): v[d][index] = v[n][imm4 >> log2(eb)]
      extract(vn, imm4 >> Math.log2(eb), T0);
      insert(vd, index, T0);
      return ok("mov");
    }
    if (imm4 === 0) {
      if (eb === 8 && !Q) return "invalid dup";
      extract(vn, index, T0);
      fill(T0);
      return ok("dup");
    }
    if (imm4 === 1) {
      if (eb === 8 && !Q) return "invalid dup";
      ops.push({ k: "alu", op: "and", d: T0, a: R(rn), b: imm(mask(esize)), w: 64, f: "none" });
      fill(T0);
      return ok("dup");
    }
    if (imm4 === 3) {
      ops.push({ k: "mov", d: T0, s: R(rn), w: 64 });
      insert(vd, index, T0);
      return ok("mov");
    }
    if (imm4 === 5 || imm4 === 7) {
      extract(vn, index, T0);
      const d = D(rd);
      if (imm4 === 7) {
        if ((eb === 8) !== (Q === 1)) return "invalid umov";
        ops.push({ k: "mov", d, s: reg(T0), w: Q ? 64 : 32 });
        return ok("umov");
      }
      if (eb === 8 || (eb === 4 && !Q)) return "invalid smov";
      ops.push({ k: "ext", d, s: reg(T0), from: esize as 8 | 16 | 32, signed: true, w: Q ? 64 : 32 });
      return ok("smov");
    }
    return "SIMD copy form is not in the map";
  }

  // ---------- AdvSIMD modified immediate: movi, mvni, orr, bic, fmov (vector) ----------
  if ((word & 0x9ff80400) >>> 0 === 0x0f000400) {
    const op = (word >>> 29) & 1;
    const cmode = bits(word, 15, 12);
    const imm8 = (bits(word, 18, 16) << 5) | bits(word, 9, 5);
    const i8 = BigInt(imm8);
    let pattern: bigint;
    let kind: "mov" | "mvn" | "orr" | "bic";
    if (cmode < 8) {
      pattern = replicate(i8 << BigInt(8 * (cmode >> 1)), 32);
      kind = cmode & 1 ? (op ? "bic" : "orr") : op ? "mvn" : "mov";
    } else if (cmode < 12) {
      pattern = replicate(i8 << BigInt(8 * ((cmode >> 1) & 1)), 16);
      kind = cmode & 1 ? (op ? "bic" : "orr") : op ? "mvn" : "mov";
    } else if (cmode < 14) {
      pattern = replicate(cmode === 12 ? (i8 << 8n) | 0xffn : (i8 << 16n) | 0xffffn, 32);
      kind = op ? "mvn" : "mov";
    } else if (cmode === 14) {
      if (op) {
        pattern = 0n;
        for (let i = 0; i < 8; i += 1) if ((imm8 >> i) & 1) pattern |= 0xffn << BigInt(8 * i);
      } else pattern = replicate(i8, 8);
      kind = "mov";
    } else {
      if (op && !Q) return "invalid fmov";
      pattern = op ? fpImm(imm8, 64) : replicate(fpImm(imm8, 32), 32);
      kind = "mov";
    }
    if (kind === "mvn") pattern = ~pattern & M64;
    if (kind === "mov" || kind === "mvn") {
      setv(vd, pattern, Q ? pattern : 0n);
      return ok(kind === "mov" ? "movi" : "mvni");
    }
    for (const h of Q ? [lo(vd), hi(vd)] : [lo(vd)]) {
      ops.push({ k: "alu", op: kind === "orr" ? "or" : "and", d: h, a: reg(h), b: imm(kind === "orr" ? pattern : ~pattern & M64), w: 64, f: "none" });
    }
    narrow(vd);
    return ok(kind);
  }

  // ---------- AdvSIMD three same ----------
  if ((word & 0x9f200400) >>> 0 === 0x0e200400) {
    const opcode = bits(word, 15, 11);
    const es = 8 << size;
    const sfx = String(es) as "8" | "16" | "32" | "64";
    if (opcode === 3) {
      // logical, by U:size
      const which = U * 4 + size;
      if (which === 0) vec("and", vd, vn, vm);
      else if (which === 1) vec("andn", vd, vn, vm);
      else if (which === 2) vec("or", vd, vn, vm);
      else if (which === 3) {
        setv(VTMP, M64, M64);
        vec("xor", VTMP, vm, VTMP);
        vec("or", vd, vn, VTMP);
      } else if (which === 4) vec("xor", vd, vn, vm);
      else {
        // bsl: d = (d & n) | (~d & m); bit: d = (n & m) | (d & ~m); bif: d = (d & m) | (n & ~m)
        const [sel, onSet, onClear] = which === 5 ? [vd, vn, vm] : which === 6 ? [vm, vn, vd] : [vm, vd, vn];
        vec("and", VTMP, onSet, sel);
        vec("andn", VTMP2, onClear, sel);
        vec("or", vd, VTMP, VTMP2);
      }
      narrow(vd);
      return ok(["and", "bic", "orr", "orn", "eor", "bsl", "bit", "bif"][which]);
    }
    const table: Record<number, [VecOp | null, VecOp | null, string]> = {
      0x10: [`add${sfx}` as VecOp, `sub${sfx}` as VecOp, U ? "sub" : "add"],
      0x11: [null, `eq${sfx}` as VecOp, U ? "cmeq" : "cmtst"],
      0x06: [`gt${sfx}` as VecOp, `hi${sfx}` as VecOp, U ? "cmhi" : "cmgt"],
      0x07: [`ge${sfx}` as VecOp, `hs${sfx}` as VecOp, U ? "cmhs" : "cmge"],
      0x0c: [`maxs${sfx}` as VecOp, `maxu${sfx}` as VecOp, U ? "umax" : "smax"],
      0x0d: [`mins${sfx}` as VecOp, `minu${sfx}` as VecOp, U ? "umin" : "smin"],
      0x13: [`mul${sfx}` as VecOp, null, "mul"],
    };
    const pairwise: Record<number, [VecOp | null, VecOp | null, string]> = {
      0x14: [`maxs${sfx}` as VecOp, `maxu${sfx}` as VecOp, U ? "umaxp" : "smaxp"],
      0x15: [`mins${sfx}` as VecOp, `minu${sfx}` as VecOp, U ? "uminp" : "sminp"],
      0x17: [`add${sfx}` as VecOp, null, "addp"],
    };
    if (opcode === 0x11 && !U) {
      // cmtst: (n & m) != 0
      vec("and", VTMP, vn, vm);
      setv(VTMP2, 0n, 0n);
      vec(`eq${sfx}` as VecOp, VTMP, VTMP, VTMP2);
      setv(VTMP2, M64, M64);
      vec("xor", vd, VTMP, VTMP2);
      narrow(vd);
      return ok("cmtst");
    }
    const row = table[opcode] ?? pairwise[opcode];
    const vop = row?.[U] as VecOp | null | undefined;
    if (!row || !vop) return "SIMD three-same op is not in the map";
    if ((es === 64 && /^(max|min|mul|hi|hs)/.test(vop)) || (es === 64 && !Q) || (vop.startsWith("mul") && es === 8)) return "SIMD element size is not in the map";
    if (table[opcode]) {
      vec(vop, vd, vn, vm);
      narrow(vd);
      return ok(row[2]);
    }
    // pairwise: op(evens, odds) of n ++ m (for 64-bit vectors, of the low halves)
    const eb = es / 8;
    const src = Q ? Array.from({ length: 32 }, (_, i) => i) : [...Array.from({ length: 8 }, (_, i) => i), ...Array.from({ length: 8 }, (_, i) => 16 + i)];
    const count = (Q ? 32 : 16) / eb / 2;
    const pick = (odd: number) => {
      const out: number[] = [];
      for (let j = 0; j < count; j += 1) for (const k of elemBytes(2 * j + odd, eb)) out.push(src[k]);
      while (out.length < 16) out.push(0);
      return out;
    };
    shuffle(VTMP, vn, vm, pick(0));
    shuffle(VTMP2, vn, vm, pick(1));
    vec(vop, vd, VTMP, VTMP2);
    narrow(vd);
    return ok(row[2]);
  }

  // ---------- AdvSIMD two-register misc ----------
  if ((word & 0x9f3e0c00) >>> 0 === 0x0e200800) {
    const opcode = bits(word, 16, 12);
    const es = 8 << size;
    const sfx = String(es);
    const eb = es / 8;
    if (opcode === 0 || (opcode === 1 && !U)) {
      // rev64 (U = 0, opcode 0), rev32 (U = 1, opcode 0), rev16 (U = 0, opcode 1): reverse elements in each group
      const group = opcode === 1 ? 2 : U ? 4 : 8;
      if (eb >= group) return "invalid rev";
      const lanes: number[] = [];
      for (let g = 0; g < 16; g += group) for (let i = group / eb - 1; i >= 0; i -= 1) lanes.push(...elemBytes(i, eb).map((b) => g + b));
      shuffle(vd, vn, vn, lanes);
      narrow(vd);
      return ok(group === 8 ? "rev64" : group === 4 ? "rev32" : "rev16");
    }
    if (opcode === 5 && !U && size === 0) {
      vec("popcnt8", vd, vn, vn);
      narrow(vd);
      return ok("cnt");
    }
    if (opcode === 5 && U && size === 0) {
      setv(VTMP, M64, M64);
      vec("xor", vd, vn, VTMP);
      narrow(vd);
      return ok("not");
    }
    if (opcode >= 8 && opcode <= 10) {
      // compare with zero: cmgt/cmge (8, U), cmeq/cmle (9, U), cmlt (10)
      if (es === 64 && !Q) return "invalid compare";
      setv(VTMP, 0n, 0n);
      if (opcode === 8) vec(`${U ? "ge" : "gt"}${sfx}` as VecOp, vd, vn, VTMP);
      else if (opcode === 9 && !U) vec(`eq${sfx}` as VecOp, vd, vn, VTMP);
      else if (opcode === 9) vec(`ge${sfx}` as VecOp, vd, VTMP, vn); // n <= 0
      else if (!U) vec(`gt${sfx}` as VecOp, vd, VTMP, vn); // n < 0
      else return "invalid compare";
      narrow(vd);
      return ok(["cmgt", "cmeq", "cmlt"][opcode - 8]);
    }
    if (opcode === 11 && U) {
      setv(VTMP, 0n, 0n);
      vec(`sub${sfx}` as VecOp, vd, VTMP, vn);
      narrow(vd);
      return ok("neg");
    }
    if (opcode === 18 && !U) {
      // xtn / xtn2: keep the low half of each element
      if (size === 3) return "invalid xtn";
      const lanes: number[] = [];
      for (let i = 0; i < 8 / eb; i += 1) lanes.push(...elemBytes(2 * i, eb));
      if (!Q) {
        shuffle(vd, vn, vn, [...lanes, ...lanes]);
        mov(hi(vd), imm(0));
      } else {
        shuffle(VTMP, vn, vn, [...lanes, ...lanes]);
        mov(hi(vd), reg(lo(VTMP)));
      }
      return ok(Q ? "xtn2" : "xtn");
    }
    return "SIMD two-register op is not in the map";
  }

  // ---------- AdvSIMD across lanes: addv, umaxv, uminv, smaxv, sminv, uaddlv ----------
  if ((word & 0x9f3e0c00) >>> 0 === 0x0e300800) {
    const opcode = bits(word, 16, 12);
    let es = 8 << size;
    let eb = es / 8;
    const sfx = () => String(es);
    let vop: VecOp;
    let src = vn;
    if (opcode === 27) vop = `add${sfx()}` as VecOp;
    else if (opcode === 10) vop = `${U ? "maxu" : "maxs"}${sfx()}` as VecOp;
    else if (opcode === 26) vop = `${U ? "minu" : "mins"}${sfx()}` as VecOp;
    else if (opcode === 3) {
      // uaddlv/saddlv: widen both halves, add them, then add across the wider lanes
      if (size === 2 && !Q) return "invalid addlv";
      const w = size === 0 ? "8" : size === 1 ? "16" : "32";
      vec(`${U ? "zx" : "sx"}l${w}` as VecOp, VTMP, vn, vn);
      es *= 2;
      eb *= 2;
      if (Q) {
        vec(`${U ? "zx" : "sx"}h${w}` as VecOp, VTMP2, vn, vn);
        vec(`add${sfx()}` as VecOp, VTMP, VTMP, VTMP2);
      }
      src = VTMP;
      vop = `add${sfx()}` as VecOp;
    } else return "SIMD across-lanes op is not in the map";
    if (es > 32 && opcode !== 3) return "invalid across-lanes size";
    // halve the active width each step: lanes [half, 2*half) onto [0, half)
    let active = Q || opcode === 3 ? 16 : 8;
    if (src !== VTMP) copyv(VTMP, src);
    while (active > eb) {
      const half = active / 2;
      const lanes = Array.from({ length: 16 }, (_, i) => (i < half ? i + half : i));
      shuffle(VTMP2, VTMP, VTMP, lanes);
      vec(vop, VTMP, VTMP, VTMP2);
      active = half;
    }
    ops.push({ k: "alu", op: "and", d: lo(vd), a: reg(lo(VTMP)), b: imm(mask(es)), w: 64, f: "none" });
    mov(hi(vd), imm(0));
    return ok(["addv", "maxv", "minv", "addlv"][[27, 10, 26, 3].indexOf(opcode)]);
  }

  // ---------- AdvSIMD shift by immediate ----------
  if ((word & 0x9f800400) >>> 0 === 0x0f000400 && bits(word, 22, 19) !== 0) {
    const immh = bits(word, 22, 19);
    const immhb = bits(word, 22, 16);
    const opcode = bits(word, 15, 11);
    const es = 8 << Math.floor(Math.log2(immh));
    const sfx = String(es);
    if (es === 64 && !Q && opcode !== 0x10 && opcode !== 0x14) return "invalid shift";
    const right = 2 * es - immhb;
    const left = immhb - es;
    if (opcode === 0 || opcode === 2) {
      // sshr/ushr, ssra/usra
      const kind = U ? "shr" : "sar";
      const target = opcode === 2 ? VTMP : vd;
      if (right >= es) {
        if (U) setv(target, 0n, 0n);
        else vec(`sar${sfx}` as VecOp, target, vn, vn, es - 1);
      } else vec(`${kind}${sfx}` as VecOp, target, vn, vn, right);
      if (opcode === 2) vec(`add${sfx}` as VecOp, vd, vd, VTMP);
      narrow(vd);
      return ok(`${U ? "u" : "s"}${opcode === 2 ? "sra" : "shr"}`);
    }
    if (opcode === 0x0a && !U) {
      vec(`shl${sfx}` as VecOp, vd, vn, vn, left);
      narrow(vd);
      return ok("shl");
    }
    if (opcode === 0x10 && !U) {
      // shrn/shrn2: shift right each element, keep its low half
      if (es === 64) return "invalid shrn";
      // immh gives the narrow (result) element size; the source elements are twice as wide
      vec(`shr${es * 2}` as VecOp, VTMP, vn, vn, right);
      const eb = es / 8;
      const lanes: number[] = [];
      for (let i = 0; i < 16 / (2 * eb); i += 1) lanes.push(...elemBytes(2 * i, eb));
      shuffle(VTMP, VTMP, VTMP, [...lanes, ...lanes]);
      if (Q) mov(hi(vd), reg(lo(VTMP)));
      else {
        mov(lo(vd), reg(lo(VTMP)));
        mov(hi(vd), imm(0));
      }
      return ok(Q ? "shrn2" : "shrn");
    }
    if (opcode === 0x14) {
      // sshll/ushll (sxtl/uxtl): widen the low (or, for the 2 form, high) half, then shift left
      if (es === 64) return "invalid shll";
      vec(`${U ? "zx" : "sx"}${Q ? "h" : "l"}${sfx}` as VecOp, vd, vn, vn);
      if (left) vec(`shl${es * 2}` as VecOp, vd, vd, vd, left);
      return ok(`${U ? "u" : "s"}shll${Q ? "2" : ""}`);
    }
    return "SIMD shift form is not in the map";
  }

  // ---------- AdvSIMD permute: uzp, trn, zip ----------
  if ((word & 0xbf208c00) >>> 0 === 0x0e000800) {
    const opcode = bits(word, 14, 12);
    const eb = 1 << size;
    if (size === 3 && !Q) return "invalid permute";
    const n = (Q ? 16 : 8) / eb; // elements per operand
    const srcA = (i: number) => elemBytes(i, eb);
    const srcB = (i: number) => elemBytes(i, eb).map((b) => b + 16);
    const part = opcode >= 5 ? 1 : 0;
    const kind = opcode & 3; // 1 uzp, 2 trn, 3 zip
    const out: number[] = [];
    for (let i = 0; i < n; i += 1) {
      let bytes: number[];
      if (kind === 1) {
        const k = 2 * i + part;
        bytes = k < n ? srcA(k) : srcB(k - n);
      } else if (kind === 2) bytes = i % 2 === 0 ? srcA(i + part) : srcB(i - 1 + part);
      else {
        const base = part * (n / 2);
        bytes = i % 2 === 0 ? srcA(base + i / 2) : srcB(base + (i - 1) / 2);
      }
      out.push(...bytes);
    }
    while (out.length < 16) out.push(0);
    if (kind === 0) return "invalid permute";
    shuffle(vd, vn, vm, out);
    narrow(vd);
    return ok(`${["", "uzp", "trn", "zip"][kind]}${part + 1}`);
  }

  // ---------- AdvSIMD extract (ext) ----------
  if ((word & 0xbfe08400) >>> 0 === 0x2e000000) {
    const index = bits(word, 14, 11);
    if (!Q && index > 7) return "invalid ext";
    const lanes = Q ? Array.from({ length: 16 }, (_, i) => index + i) : Array.from({ length: 16 }, (_, i) => (i < 8 ? (index + i < 8 ? index + i : 16 + index + i - 8) : 0));
    shuffle(vd, vn, vm, lanes);
    narrow(vd);
    return ok("ext");
  }

  // ---------- AdvSIMD table lookup: tbl with one or two table registers ----------
  if ((word & 0xbfe09c00) >>> 0 === 0x0e000000) {
    const len = bits(word, 14, 13);
    if (len === 0) vec("swizzle", vd, vn, vm);
    else if (len === 1) {
      vec("swizzle", VTMP, vn, vm);
      setv(VTMP2, replicate(16n, 8), replicate(16n, 8));
      vec("sub8", VTMP2, vm, VTMP2);
      vec("swizzle", VTMP2, V((rn + 1) % 32), VTMP2);
      vec("or", vd, VTMP, VTMP2);
    } else return "tbl with 3 or 4 registers is not in the map";
    narrow(vd);
    return ok("tbl");
  }

  // ---------- AdvSIMD three different: uaddl, saddl, uaddw, saddw, usubl, ssubl, umull, smull ----------
  if ((word & 0x9f200c00) >>> 0 === 0x0e200000) {
    const opcode = bits(word, 15, 12);
    if (size === 3) return "invalid size";
    const es = 8 << size;
    const w = String(es);
    const wide = String(es * 2);
    const half = Q ? "h" : "l";
    const ext = `${U ? "zx" : "sx"}${half}${w}` as VecOp;
    const names: Record<number, string> = { 0: "addl", 1: "addw", 2: "subl", 3: "subw", 12: "mull" };
    if (!(opcode in names)) return "SIMD three-different op is not in the map";
    if (opcode === 1 || opcode === 3) copyv(VTMP, vn);
    else vec(ext, VTMP, vn, vn);
    vec(ext, VTMP2, vm, vm);
    const op = opcode === 12 ? `mul${wide}` : opcode >= 2 ? `sub${wide}` : `add${wide}`;
    vec(op as VecOp, vd, VTMP, VTMP2);
    return ok(`${U ? "u" : "s"}${names[opcode]}${Q ? "2" : ""}`);
  }

  // ---------- AdvSIMD scalar pairwise (addp d, v.2d) and scalar copy (dup s/d, v.s[i]) ----------
  if ((word & 0xff3ffc00) >>> 0 === 0x5e31b800 && size === 3) {
    ops.push({ k: "alu", op: "add", d: lo(vd), a: reg(lo(vn)), b: reg(hi(vn)), w: 64, f: "none" });
    mov(hi(vd), imm(0));
    return ok("addp");
  }
  if ((word & 0xffe0fc00) >>> 0 === 0x5e000400) {
    const imm5 = bits(word, 20, 16);
    const lsb = imm5 & -imm5;
    if (!lsb || lsb > 8) return "invalid element size";
    const esize = lsb * 8;
    const index = imm5 >> (Math.log2(lsb) + 1);
    const byte = index * lsb;
    ops.push({ k: "alu", op: "shr", d: T0, a: reg(byte >= 8 ? hi(vn) : lo(vn)), b: imm((byte % 8) * 8), w: 64, f: "none" });
    ops.push({ k: "alu", op: "and", d: lo(vd), a: reg(T0), b: imm(mask(esize)), w: 64, f: "none" });
    mov(hi(vd), imm(0));
    return ok("mov");
  }

  // ---------- scalar floating point ----------
  if ((word & 0x5e000000) >>> 0 === 0x1e000000) {
    const ftype = bits(word, 23, 22);
    if (ftype > 1) return "half-precision floating point is not in the map";
    const fsize = (ftype ? 8 : 4) as 4 | 8;
    const fbits = fsize * 8;
    /** Write a scalar FP result: clear everything above it. */
    const fdone = (vn0: number) => {
      if (fsize === 4) ops.push({ k: "alu", op: "and", d: lo(vn0), a: reg(lo(vn0)), b: imm(0xffffffffn), w: 64, f: "none" });
      mov(hi(vn0), imm(0));
    };
    const sf = word >>> 31;
    // conversions between floating point and integers, and fmov to/from general registers
    if ((word & 0x7f20fc00) >>> 0 === 0x1e200000) {
      const rmode = bits(word, 20, 19);
      const opcode = bits(word, 18, 16);
      const iw = (sf ? 64 : 32) as 32 | 64;
      if (opcode === 6 || opcode === 7) {
        // fmov between a general register and an FP register (rmode 1: the top half of a 128-bit register)
        if (rmode === 1) return "fmov to the top half is not in the map";
        if (rmode !== 0 || (sf ? fsize !== 8 : fsize !== 4)) return "invalid fmov";
        if (opcode === 6) ops.push({ k: "mov", d: D(rd), s: reg(lo(vn)), w: iw });
        else {
          ops.push({ k: "mov", d: lo(vd), s: R(rn), w: iw });
          mov(hi(vd), imm(0));
        }
        return ok("fmov");
      }
      if ((opcode === 2 || opcode === 3) && rmode === 0) {
        ops.push({ k: "fcvt", kind: "i2f", d: vd, s: R(rn), w: iw, size: fsize, unsigned: opcode === 3 });
        fdone(vd);
        return ok(opcode === 3 ? "ucvtf" : "scvtf");
      }
      if (opcode <= 1 || opcode === 4 || opcode === 5) {
        // fcvt{n,p,m,z}{s,u} by rmode; fcvta{s,u} (opcode 4/5, rmode 0)
        const round = opcode >= 4 ? "a" : (["n", "p", "m", "z"] as const)[rmode];
        if (opcode >= 4 && rmode !== 0) return "invalid conversion";
        ops.push({ k: "fcvt", kind: "f2i", d: D(rd), a: vn, w: iw, size: fsize, trunc: round === "z", arm: { round, unsigned: (opcode & 1) === 1 } });
        return ok(`fcvt${round}${opcode & 1 ? "u" : "s"}`);
      }
      return "FP/integer conversion is not in the map";
    }
    if ((word & 0xff207c00) >>> 0 === 0x1e204000) {
      const opcode = bits(word, 20, 15);
      if (opcode === 0) {
        mov(lo(vd), reg(lo(vn)));
        fdone(vd);
        return ok("fmov");
      }
      if (opcode === 1 || opcode === 2) {
        const sign = 1n << BigInt(fbits - 1);
        ops.push({ k: "alu", op: opcode === 1 ? "and" : "xor", d: lo(vd), a: reg(lo(vn)), b: imm(opcode === 1 ? ~sign & mask(fbits) : sign), w: 64, f: "none" });
        fdone(vd);
        return ok(opcode === 1 ? "fabs" : "fneg");
      }
      if (opcode === 3) {
        ops.push({ k: "fop", op: "sqrt", d: vd, a: vn, b: vn, size: fsize, arm: true });
        fdone(vd);
        return ok("fsqrt");
      }
      if (opcode === 4 || opcode === 5) {
        const to = opcode === 4 ? 4 : 8;
        if (to === fsize) return "invalid fcvt";
        ops.push({ k: "fcvt", kind: "f2f", d: vd, a: vn, from: fsize });
        if (to === 4) ops.push({ k: "alu", op: "and", d: lo(vd), a: reg(lo(vd)), b: imm(0xffffffffn), w: 64, f: "none" });
        mov(hi(vd), imm(0));
        return ok("fcvt");
      }
      if (opcode >= 8 && opcode <= 15 && opcode !== 13) {
        const mode = (["n", "p", "m", "z", "a", "", "x", "i"] as const)[opcode - 8];
        ops.push({ k: "fround", d: vd, a: vn, size: fsize, mode: mode === "i" || mode === "x" ? "n" : (mode as "n" | "p" | "m" | "z" | "a") });
        fdone(vd);
        return ok(`frint${mode}`);
      }
      return "FP one-source op is not in the map";
    }
    if ((word & 0xff20fc07) >>> 0 === 0x1e202000) {
      const zero = ((word >>> 3) & 1) === 1;
      if (zero) setv(VTMP, 0n, 0n);
      ops.push({ k: "fcmp", a: vn, b: zero ? VTMP : vm, size: fsize, arm: true });
      return ok((word >>> 4) & 1 ? "fcmpe" : "fcmp");
    }
    if ((word & 0xff201fe0) >>> 0 === 0x1e201000) {
      const imm8 = bits(word, 20, 13);
      mov(lo(vd), imm(fpImm(imm8, fsize === 8 ? 64 : 32)));
      mov(hi(vd), imm(0));
      return ok("fmov");
    }
    if ((word & 0xff200c00) >>> 0 === 0x1e200400) {
      // fccmp: if cond, flags from compare, else nzcv
      const cond = bits(word, 15, 12);
      const nzcv = word & 15;
      ops.push({ k: "fcmp", a: vn, b: vm, size: fsize, arm: true, cond: CONDS[cond], nzcv });
      return ok("fccmp");
    }
    if ((word & 0xff200c00) >>> 0 === 0x1e200800) {
      const opcode = bits(word, 15, 12);
      const table: Record<number, "mul" | "div" | "add" | "sub" | "max" | "min" | "maxnm" | "minnm"> = { 0: "mul", 1: "div", 2: "add", 3: "sub", 4: "max", 5: "min", 6: "maxnm", 7: "minnm", 8: "mul" };
      const op = table[opcode];
      if (!op) return "FP two-source op is not in the map";
      ops.push({ k: "fop", op, d: vd, a: vn, b: vm, size: fsize, arm: true });
      if (opcode === 8) ops.push({ k: "alu", op: "xor", d: lo(vd), a: reg(lo(vd)), b: imm(1n << BigInt(fbits - 1)), w: 64, f: "none" });
      fdone(vd);
      return ok(opcode === 8 ? "fnmul" : `f${op}`);
    }
    if ((word & 0xff200c00) >>> 0 === 0x1e200c00) {
      const cond = bits(word, 15, 12);
      ops.push({ k: "csel", d: lo(vd), c: CONDS[cond], a: reg(lo(vn)), b: reg(lo(vm)), w: 64 });
      fdone(vd);
      return ok("fcsel");
    }
    if ((word & 0xff000000) >>> 0 === 0x1f000000) {
      const ra = bits(word, 14, 10);
      const o1 = (word >>> 21) & 1;
      const o0 = (word >>> 15) & 1;
      // fmadd: a + n*m; fmsub: a - n*m; fnmadd: -a - n*m; fnmsub: -a + n*m (one rounding)
      ops.push({ k: "fma", d: vd, a: vn, b: vm, c: V(ra), size: fsize, negProduct: o0 !== o1, negAddend: o1 === 1 });
      fdone(vd);
      return ok(["fmadd", "fmsub", "fnmadd", "fnmsub"][o1 * 2 + o0]);
    }
    return "floating-point form is not in the map";
  }
  return "SIMD/FP is not in the map";
}
