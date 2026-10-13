/**
 * Guest IR, version 2. The neutral form that x86-64 and AArch64 machine code is lifted into.
 *
 * Same idea as FEX-Emu and QEMU TCG: decode the source machine's instructions into a small set of
 * operations with exact semantics, then either interpret them (reference) or lower them to
 * WebAssembly (fast path). Bytes the decoders do not know become gaps and are never executed.
 *
 * Values are 64-bit. Widths 8/16/32/64 follow the source machine:
 *   64  full write
 *   32  result zero-extended into the register (x86 and ARM agree)
 *   16/8  merge into the low bits, upper bits kept (x86 only)
 *
 * Flags are kept as Z, S, C, O plus K. C is the x86 carry (borrow after a subtraction). K is 1 when the
 * last flag-setting op was a subtraction, so ARM's carry (which is NOT-borrow) is C xor K.
 */

export type GuestArch = "x86_64" | "aarch64";
export type W = 8 | 16 | 32 | 64;
export type Src = { r: number } | { imm: bigint };
export type Ea = { base: number | null; index: number | null; scale: 1 | 2 | 4 | 8; disp: bigint; rip?: boolean; seg?: number; a32?: boolean };
/** Ea.seg: a register added as a segment base (x86 fs: uses the thread pointer). Ea.a32: 32-bit address size. */

export type AluOp = "add" | "sub" | "adc" | "sbb" | "ctz" | "clz" | "and" | "or" | "xor" | "shl" | "shr" | "sar" | "ror" | "mul" | "umulh" | "smulh" | "udiv" | "sdiv" | "urem" | "srem";
export type FlagMode = "none" | "arith" | "logic" | "inc" | "shift";
export type Cond =
  | "eq" | "ne" | "b" | "ae" | "be" | "a" | "s" | "ns" | "o" | "no" | "lt" | "ge" | "le" | "gt"
  | "cs" | "cc" | "hi" | "ls" | "al" | "p" | "np";

export type Op =
  | { k: "mov"; d: number; s: Src; w: W }
  | { k: "alu"; op: AluOp; d: number | null; a: Src; b: Src; w: W; f: FlagMode }
  | { k: "ext"; d: number; s: Src; from: 8 | 16 | 32; signed: boolean; w: W }
  | { k: "lea"; d: number; ea: Ea; w: W }
  | { k: "load"; d: number; ea: Ea; size: 1 | 2 | 4 | 8; signed: boolean; w: W }
  | { k: "store"; s: Src; ea: Ea; size: 1 | 2 | 4 | 8 }
  | { k: "set"; d: number; c: Cond; w: W }
  | { k: "csel"; d: number; c: Cond; a: Src; b: Src; w: W }
  | { k: "ccmp"; c: Cond; a: Src; b: Src; w: W; neg: boolean; nzcv: number }
  | { k: "setnzcv"; nzcv: number }
  | { k: "br"; c: Cond; t: bigint }
  | { k: "cbz"; s: Src; w: W; nz: boolean; t: bigint }
  | { k: "tbz"; s: Src; bit: number; nz: boolean; t: bigint }
  | { k: "jmp"; t: bigint }
  | { k: "jmpr"; s: Src }
  | { k: "sys" }
  | { k: "guardz"; s: Src; w: W }
  | { k: "guardext"; hi: number; lo: number; signed: boolean; w: W }
  | { k: "halt"; why: string }
  /**
   * Scalar floating point on the low lane of vector registers (size 4: single, 8: double). d = a op b.
   * x86 rules by default; with `arm`, ARM's (see armFop): NaN operands and results, min/max of zeros,
   * and maxnm/minnm. The decoder clears the rest of the register where the architecture does.
   */
  | { k: "fop"; op: "add" | "sub" | "mul" | "div" | "min" | "max" | "sqrt" | "maxnm" | "minnm"; d: number; a: number; b: number; size: 4 | 8; arm?: boolean }
  /**
   * Conversions. i2f: vector d low lane = float(int s at width w), signed unless `unsigned`.
   * f2i: register d = int(vector a): x86 style (truncating or rounding, out of range gives the
   * "integer indefinite" value), or with `arm` ARM's: a rounding mode, saturating, NaN gives 0.
   * f2f: between sizes.
   */
  | { k: "fcvt"; kind: "i2f"; d: number; s: Src; w: 32 | 64; size: 4 | 8; unsigned?: boolean }
  | { k: "fcvt"; kind: "f2i"; d: number; a: number; w: 32 | 64; size: 4 | 8; trunc: boolean; arm?: { round: FpRound; unsigned: boolean } }
  | { k: "fcvt"; kind: "f2f"; d: number; a: number; from: 4 | 8 }
  /**
   * ucomis/comis: Z, P, C from comparing the low lanes (unordered sets all three); O, S, K cleared.
   * With `arm`: ARM's NZCV (equal 0110, less 1000, greater 0010, unordered 0011); with `cond` too,
   * fccmp: compare only when cond holds, otherwise set `nzcv`.
   */
  | { k: "fcmp"; a: number; b: number; size: 4 | 8; arm?: boolean; cond?: Cond; nzcv?: number }
  /** frint*: round the low lane of a to an integral value of the same format (ARM rules for NaN). */
  | { k: "fround"; d: number; a: number; size: 4 | 8; mode: FpRound }
  /** fmadd family, one rounding: d = (negAddend ? -c : c) + (negProduct ? -(a*b) : a*b). ARM NaN rules. */
  | { k: "fma"; d: number; a: number; b: number; c: number; size: 4 | 8; negProduct: boolean; negAddend: boolean }
  /** x86 div/idiv: (rdx:rax) / s at width w -> rax quotient, rdx remainder. Zero or a quotient that does not fit stops with div0. */
  | { k: "div2"; signed: boolean; s: Src; w: W }
  /** Z and S from v at width w, C = O = 0: the flags of a shift, applied only when the shift count is nonzero. */
  | { k: "flagsz"; v: Src; w: W; when: { s: Src; mask: number } | null }
  /** Set one flag (c or o) to bit `bit` of v, optionally only when (s & mask) is nonzero or equals eq. */
  | { k: "setflag"; flag: "c" | "o"; v: Src; bit: number; when: { s: Src; mask: number; eq?: number } | null }
  /** x86 cpuid: a fixed, honest feature table (baseline x86-64: SSE2, no AVX). Reads eax/ecx, writes eax/ebx/ecx/edx. */
  | { k: "cpuid" }
  /** 128-bit vector op on xmm registers (numbers 0..16, see XMM). d = op(a, b), imm for shuffles and shifts. */
  | { k: "vec"; op: VecOp; d: number; a: number; b: number; imm: number }
  /** Byte sign bits of xmm a (pmovmskb) or dword sign bits (movmskps) into a general register. */
  | { k: "vmask"; d: number; a: number; lanes: 16 | 4 };

/** Rounding: n nearest-even, p toward +inf, m toward -inf, z toward zero, a nearest with ties away. */
export type FpRound = "n" | "p" | "m" | "z" | "a";

export type VecOp =
  | "and" | "or" | "xor" | "andn"
  | "add8" | "add16" | "add32" | "add64" | "sub8" | "sub16" | "sub32" | "sub64"
  | "eq8" | "eq16" | "eq32" | "eq64" | "gt8" | "gt16" | "gt32" | "gt64"
  /** signed >=, unsigned >, unsigned >= */
  | "ge8" | "ge16" | "ge32" | "ge64" | "hi8" | "hi16" | "hi32" | "hs8" | "hs16" | "hs32"
  | "minu8" | "maxu8" | "mins8" | "maxs8" | "minu16" | "maxu16" | "mins16" | "maxs16" | "minu32" | "maxu32" | "mins32" | "maxs32"
  | "mul16" | "mul32" | "mul64"
  | "shuffle" // imm indexes into a table of 16 byte selectors (see vecShuffles)
  | "swizzle" // bytes of a picked by the byte indexes in b; an index of 16 or more gives 0
  | "shl8" | "shr8" | "sar8" | "shl16" | "shr16" | "sar16" | "shl32" | "shr32" | "sar32" | "shl64" | "shr64" | "sar64"
  /** One operand (b is ignored): population count of each byte, and lanes widened from the low or high half. */
  | "popcnt8"
  | "zxl8" | "zxh8" | "sxl8" | "sxh8" | "zxl16" | "zxh16" | "sxl16" | "sxh16" | "zxl32" | "zxh32" | "sxl32" | "sxh32";

/** Vector ops that read only a. */
export const VEC_UNARY = new Set<VecOp>(["popcnt8", "zxl8", "zxh8", "sxl8", "sxh8", "zxl16", "zxh16", "sxl16", "sxh16", "zxl32", "zxh32", "sxl32", "sxh32"]);

/**
 * Byte shuffles, as in wasm i8x16.shuffle: 16 indexes, 0..15 pick from a, 16..31 from b.
 * Decoders register a shuffle once and refer to it by number, so the IR stays small.
 */
export const vecShuffles: number[][] = [];
export function shuffleId(lanes: number[]): number {
  const key = lanes.join(",");
  const at = vecShuffles.findIndex((x) => x.join(",") === key);
  if (at >= 0) return at;
  vecShuffles.push(lanes);
  return vecShuffles.length - 1;
}

const toBytes = (lo: bigint, hi: bigint) => {
  const b = new Uint8Array(16);
  const dv = new DataView(b.buffer);
  dv.setBigUint64(0, lo, true);
  dv.setBigUint64(8, hi, true);
  return b;
};
const fromBytes = (b: Uint8Array): [bigint, bigint] => {
  const dv = new DataView(b.buffer, b.byteOffset, 16);
  return [dv.getBigUint64(0, true), dv.getBigUint64(8, true)];
};

/** Reference semantics of a vector op on (lo, hi) pairs. Mirrors the wasm SIMD lowering. */
export function vecValue(op: VecOp, a: [bigint, bigint], b: [bigint, bigint], immv: number): [bigint, bigint] {
  if (op === "and") return [a[0] & b[0], a[1] & b[1]];
  if (op === "or") return [a[0] | b[0], a[1] | b[1]];
  if (op === "xor") return [a[0] ^ b[0], a[1] ^ b[1]];
  if (op === "andn") return [a[0] & ~b[0] & M64, a[1] & ~b[1] & M64]; // a & ~b (wasm v128.andnot)
  const A = toBytes(a[0], a[1]);
  const B = toBytes(b[0], b[1]);
  const R = new Uint8Array(16);
  if (op === "shuffle") {
    const lanes = vecShuffles[immv];
    for (let i = 0; i < 16; i += 1) R[i] = lanes[i] < 16 ? A[lanes[i]] : B[lanes[i] - 16];
    return fromBytes(R);
  }
  if (op === "swizzle") {
    for (let i = 0; i < 16; i += 1) R[i] = B[i] < 16 ? A[B[i]] : 0;
    return fromBytes(R);
  }
  if (op === "popcnt8") {
    for (let i = 0; i < 16; i += 1) {
      let n = 0;
      for (let k = 0; k < 8; k += 1) n += (A[i] >> k) & 1;
      R[i] = n;
    }
    return fromBytes(R);
  }
  const widen = /^([zs])x([lh])(8|16|32)$/.exec(op);
  if (widen) {
    const from = Number(widen[3]) / 8;
    const n = 8 / from;
    const av0 = new DataView(A.buffer);
    const rv0 = new DataView(R.buffer);
    for (let i = 0; i < n; i += 1) {
      const at = (widen[2] === "h" ? 8 : 0) + i * from;
      let x = 0n;
      for (let k = from - 1; k >= 0; k -= 1) x = (x << 8n) | BigInt(av0.getUint8(at + k));
      if (widen[1] === "s") x = BigInt.asIntN(from * 8, x);
      const y = BigInt.asUintN(from * 16, x);
      for (let k = 0; k < from * 2; k += 1) rv0.setUint8(i * from * 2 + k, Number((y >> BigInt(8 * k)) & 0xffn));
    }
    return fromBytes(R);
  }
  const size = Number(/\d+/.exec(op)![0]) / 8;
  const n = 16 / size;
  const av = new DataView(A.buffer);
  const bv = new DataView(B.buffer);
  const rv = new DataView(R.buffer);
  const bits = BigInt(size * 8);
  const lm = (1n << bits) - 1n;
  const get = (v: DataView, i: number) => {
    let x = 0n;
    for (let k = size - 1; k >= 0; k -= 1) x = (x << 8n) | BigInt(v.getUint8(i * size + k));
    return x;
  };
  const put = (i: number, x: bigint) => {
    for (let k = 0; k < size; k += 1) rv.setUint8(i * size + k, Number((x >> BigInt(8 * k)) & 0xffn));
  };
  const sgn = (x: bigint) => BigInt.asIntN(size * 8, x);
  for (let i = 0; i < n; i += 1) {
    const x = get(av, i);
    const y = get(bv, i);
    let r = 0n;
    if (op.startsWith("add")) r = (x + y) & lm;
    else if (op.startsWith("sub")) r = (x - y) & lm;
    else if (op.startsWith("eq")) r = x === y ? lm : 0n;
    else if (op.startsWith("gt")) r = sgn(x) > sgn(y) ? lm : 0n;
    else if (op.startsWith("ge")) r = sgn(x) >= sgn(y) ? lm : 0n;
    else if (op.startsWith("hi")) r = x > y ? lm : 0n;
    else if (op.startsWith("hs")) r = x >= y ? lm : 0n;
    else if (op.startsWith("minu")) r = x < y ? x : y;
    else if (op.startsWith("maxu")) r = x > y ? x : y;
    else if (op.startsWith("mins")) r = sgn(x) < sgn(y) ? x : y;
    else if (op.startsWith("maxs")) r = sgn(x) > sgn(y) ? x : y;
    else if (op.startsWith("mul")) r = (x * y) & lm;
    else if (op.startsWith("shl")) r = (x << BigInt(immv)) & lm;
    else if (op.startsWith("shr")) r = x >> BigInt(immv);
    else if (op.startsWith("sar")) r = BigInt.asUintN(size * 8, sgn(x) >> BigInt(immv));
    put(i, r);
  }
  return fromBytes(R);
}

/** One source instruction and the IR it lifts to. */
export type Insn = { pc: bigint; len: number; next: bigint; ops: Op[]; fall: boolean; text: string };
export type Gap = { pc: bigint; bytes: string; reason: string };

/**
 * IR registers (64-bit each).
 *   0..15   x86: rax rcx rdx rbx rsp rbp rsi rdi r8..r15     ARM: x0..x15
 *   16..30  ARM: x16..x30            31 ARM sp
 *   32..34  temps                    35 write sink (ARM xzr as a destination)
 *   36      thread pointer (x86 fs base, ARM tpidr_el0)
 *   37..68  vectors 0..15 as (low, high) 64-bit halves: vector n = 37 + 2n, 38 + 2n
 *           (x86 xmm0..xmm15; ARM v0..v15)
 *   69..70  vector 16: a temp vector for memory operands and multi-step ARM operations
 *   71      fourth temp
 *   72..103 vectors 17..32 (ARM v16..v31)
 *   104..105 vector 33: a second temp vector
 */
export const NREG = 106;
/** A fourth temp, for decodings that need one more scratch value. */
export const T3 = 71;
export const T0 = 32;
export const T1 = 33;
export const T2 = 34;
export const SINK = 35;
export const TP = 36;
/** Vector register n (0..32) as an IR register: its low (half 0) or high (half 1) 64 bits. */
export const XMM = (n: number, half: 0 | 1 = 0) => (n <= 16 ? 37 + n * 2 : 72 + (n - 17) * 2) + half;
/** The temp vectors (numbers 16 and 33). */
export const VTMP = 16;
export const VTMP2 = 33;

/** Why the machine stopped. Same codes from the interpreter and from the WebAssembly module. */
export const Stop = {
  running: 0,
  syscall: 1,
  fuel: 2,
  unmapped: 3,
  gap: 4,
  fault: 5,
  div0: 6,
  smc: 7,
  unsupported: 8,
  halt: 9,
} as const;
export type StopCode = (typeof Stop)[keyof typeof Stop];
export const STOP_NAME: Record<number, string> = {
  0: "running",
  1: "syscall",
  2: "out of fuel",
  3: "jumped to an address with no translation",
  4: "reached bytes the map does not know (not executed)",
  5: "memory fault",
  6: "divide error (by zero, or the quotient does not fit)",
  7: "program tried to modify its own code",
  8: "unsupported operation",
  9: "halted",
};

/** Guest memory layout. Address 0..0x1000 is the null page; the WebAssembly backend keeps CPU state there. */
export const NULL_PAGE = 0x1000;
/**
 * CPU state in the guest's null page. codeLo/codeHi hold the translated code range that stores are
 * checked against; the WebAssembly module writes them itself when run() starts.
 */
export const STATE = { regs: 0x400, pc: 0x300, flags: 0x308, fuel: 0x320, code: 0x328, fault: 0x330, codeLo: 0x340, codeHi: 0x348 } as const;

export const M64 = (1n << 64n) - 1n;
export const mask = (w: number): bigint => (w >= 64 ? M64 : (1n << BigInt(w)) - 1n);
export const u64 = (v: bigint): bigint => v & M64;
export const sx = (v: bigint, w: number): bigint => BigInt.asIntN(w, v);
export const imm = (v: bigint | number): Src => ({ imm: u64(BigInt(v)) });
export const reg = (r: number): Src => ({ r });

export function condNames(): Cond[] {
  return ["eq", "ne", "b", "ae", "be", "a", "s", "ns", "o", "no", "lt", "ge", "le", "gt", "cs", "cc", "hi", "ls", "al"];
}

/** p: x86 parity (even number of set bits in the low byte of the result; unordered for float compares). */
export type Flags = { z: number; s: number; c: number; o: number; k: number; p?: number };

export function evalCond(c: Cond, f: Flags): boolean {
  const carm = f.c ^ f.k;
  switch (c) {
    case "eq": return f.z === 1;
    case "ne": return f.z === 0;
    case "b": return f.c === 1;
    case "ae": return f.c === 0;
    case "be": return (f.c | f.z) === 1;
    case "a": return (f.c | f.z) === 0;
    case "s": return f.s === 1;
    case "ns": return f.s === 0;
    case "o": return f.o === 1;
    case "no": return f.o === 0;
    case "lt": return (f.s ^ f.o) === 1;
    case "ge": return (f.s ^ f.o) === 0;
    case "le": return (f.z | (f.s ^ f.o)) === 1;
    case "gt": return (f.z | (f.s ^ f.o)) === 0;
    case "cs": return carm === 1;
    case "cc": return carm === 0;
    case "hi": return carm === 1 && f.z === 0;
    case "ls": return carm === 0 || f.z === 1;
    case "al": return true;
    case "p": return f.p === 1;
    case "np": return f.p !== 1;
  }
}

/** Result of an ALU op at width w, as an unsigned w-bit value. */
export function aluValue(op: AluOp, a: bigint, b: bigint, w: number, cin = 0): bigint {
  const m = mask(w);
  const aw = a & m;
  const bw = b & m;
  const sh = bw & (w === 64 ? 63n : 31n);
  switch (op) {
    case "add": return (aw + bw) & m;
    case "adc": return (aw + bw + BigInt(cin)) & m;
    case "ctz": {
      // count trailing zeros of a (b unused); w when a is zero
      if (aw === 0n) return BigInt(w);
      let n = 0n;
      while (((aw >> n) & 1n) === 0n) n += 1n;
      return n;
    }
    case "clz": {
      if (aw === 0n) return BigInt(w);
      let n = 0n;
      while (((aw >> (BigInt(w) - 1n - n)) & 1n) === 0n) n += 1n;
      return n;
    }
    case "sbb": return (aw - bw - BigInt(cin)) & m;
    case "sub": return (aw - bw) & m;
    case "and": return aw & bw;
    case "or": return aw | bw;
    case "xor": return aw ^ bw;
    case "shl": return (aw << sh) & m;
    case "shr": return aw >> sh;
    case "sar": return BigInt.asUintN(w, sx(aw, w) >> sh);
    case "ror": {
      const n = bw % BigInt(w);
      return ((aw >> n) | (aw << (BigInt(w) - n))) & m;
    }
    case "mul": return (aw * bw) & m;
    case "umulh": return ((aw * bw) >> BigInt(w)) & m;
    case "smulh": return BigInt.asUintN(w, (sx(aw, w) * sx(bw, w)) >> BigInt(w));
    case "udiv": return bw === 0n ? 0n : aw / bw;
    case "urem": return bw === 0n ? aw : aw % bw;
    case "sdiv": {
      if (bw === 0n) return 0n;
      return BigInt.asUintN(w, sx(aw, w) / sx(bw, w));
    }
    case "srem": {
      if (bw === 0n) return aw;
      return BigInt.asUintN(w, sx(aw, w) % sx(bw, w));
    }
  }
}

/** 1 when the low byte has an even number of set bits. */
export function parity(r: bigint): number {
  let b = Number(r & 0xffn);
  b ^= b >> 4;
  b ^= b >> 2;
  b ^= b >> 1;
  return (b & 1) ^ 1;
}

export function flagsAfter(op: AluOp, mode: FlagMode, a: bigint, b: bigint, r: bigint, w: number, prev: Flags): Flags {
  if (mode === "none") return prev;
  const m = mask(w);
  const top = BigInt(w - 1);
  const aw = a & m;
  const bw = b & m;
  const z = r === 0n ? 1 : 0;
  const s = Number((r >> top) & 1n);
  const p = parity(r);
  if (mode === "logic" || mode === "shift") return { z, s, c: 0, o: 0, k: 0, p };
  const isSub = op === "sub" || op === "sbb";
  const o = isSub ? Number((((aw ^ bw) & (aw ^ r)) >> top) & 1n) : Number((((aw ^ r) & (bw ^ r)) >> top) & 1n);
  if (mode === "inc") return { z, s, c: prev.c, o, k: prev.k, p };
  const cin = BigInt(prev.c);
  const c =
    op === "adc" ? (aw + bw + cin > m ? 1 : 0)
    : op === "sbb" ? (aw < bw + cin ? 1 : 0)
    : isSub ? (aw < bw ? 1 : 0) : aw + bw > m ? 1 : 0;
  return { z, s, c, o, k: isSub ? 1 : 0, p };
}

export function nzcvFlags(nzcv: number, p?: number): Flags {
  // ARM order N Z C V. Stored with K = 0, so ARM carry reads straight from C.
  return { s: (nzcv >> 3) & 1, z: (nzcv >> 2) & 1, c: (nzcv >> 1) & 1, o: nzcv & 1, k: 0, p };
}

/** Value written into a register of old value `old` by a w-bit write of `v`. */
export function writeWidth(old: bigint, v: bigint, w: number): bigint {
  if (w === 64) return v & M64;
  if (w === 32) return v & 0xffffffffn;
  const m = mask(w);
  return (old & ~m & M64) | (v & m);
}

/** The CPU the guest is told it runs on: x86-64 baseline (v1). Leaf -> [eax, ebx, ecx, edx]. */
export const CPUID: [number, [number, number, number, number]][] = [
  [0x0, [0x1, 0x67726f46, 0x55504374, 0x72695665]], // max leaf 1, vendor "ForgeVirtCPU" (ebx, edx, ecx order)
  [0x1, [0x000306a9, 0x00000800, 0x00000000, 0x07808111]], // fpu tsc cx8 cmov mmx fxsr sse sse2 (no sse3+, no avx)
  [0x80000000, [0x80000001, 0, 0, 0]],
  [0x80000001, [0, 0, 0x00000001, 0x20100800]], // lahf; syscall nx lm
];

export function describeOp(op: Op): string {
  const s = (x: Src) => ("r" in x ? `r${x.r}` : `#0x${x.imm.toString(16)}`);
  const e = (x: Ea) =>
    `[${[x.base === null ? null : `r${x.base}`, x.index === null ? null : `r${x.index}*${x.scale}`, x.disp ? `0x${x.disp.toString(16)}` : null].filter(Boolean).join("+") || "0"}]`;
  switch (op.k) {
    case "mov": return `mov.${op.w} r${op.d}, ${s(op.s)}`;
    case "alu": return `${op.op}.${op.w}${op.f === "none" ? "" : "!"} ${op.d === null ? "_" : `r${op.d}`}, ${s(op.a)}, ${s(op.b)}`;
    case "ext": return `${op.signed ? "sext" : "zext"}${op.from} r${op.d}, ${s(op.s)}`;
    case "lea": return `lea r${op.d}, ${e(op.ea)}`;
    case "load": return `ld${op.size}${op.signed ? "s" : ""} r${op.d}, ${e(op.ea)}`;
    case "store": return `st${op.size} ${s(op.s)}, ${e(op.ea)}`;
    case "set": return `set.${op.c} r${op.d}`;
    case "csel": return `csel.${op.c} r${op.d}, ${s(op.a)}, ${s(op.b)}`;
    case "ccmp": return `ccmp.${op.c} ${s(op.a)}, ${s(op.b)}, #${op.nzcv}`;
    case "setnzcv": return `nzcv #${op.nzcv}`;
    case "br": return `b.${op.c} 0x${op.t.toString(16)}`;
    case "cbz": return `${op.nz ? "cbnz" : "cbz"} ${s(op.s)}, 0x${op.t.toString(16)}`;
    case "tbz": return `${op.nz ? "tbnz" : "tbz"} ${s(op.s)}, #${op.bit}, 0x${op.t.toString(16)}`;
    case "jmp": return `jmp 0x${op.t.toString(16)}`;
    case "jmpr": return `jmp ${s(op.s)}`;
    case "sys": return "syscall";
    case "guardz": return `guard ${s(op.s)} != 0`;
    case "guardext": return `guard r${op.hi} = ext(r${op.lo})`;
    case "halt": return `halt ${op.why}`;
    case "cpuid": return "cpuid";
    case "fop": return `f${op.op}${op.size === 4 ? "s" : "d"} x${op.d}, x${op.a}, x${op.b}`;
    case "fcvt": return op.kind === "i2f" ? `cvt i${op.w}->f${op.size * 8} x${op.d}, ${s(op.s)}` : op.kind === "f2i" ? `cvt f${op.size * 8}->i${op.w} r${op.d}, x${op.a}` : `cvt f${op.from * 8}->f${op.from === 8 ? 32 : 64} x${op.d}, x${op.a}`;
    case "fcmp": return `fcmp${op.size * 8} x${op.a}, x${op.b}`;
    case "fround": return `frint${op.mode}${op.size * 8} x${op.d}, x${op.a}`;
    case "fma": return `fma${op.size * 8}${op.negProduct ? "-p" : ""}${op.negAddend ? "-c" : ""} x${op.d}, x${op.a}, x${op.b}, x${op.c}`;
    case "div2": return `${op.signed ? "idiv" : "div"}${op.w} r2:r0, ${s(op.s)}`;
    case "flagsz": return `zs = ${s(op.v)}${op.when ? ` if ${s(op.when.s)}&${op.when.mask}` : ""}`;
    case "setflag": return `${op.flag}f = ${s(op.v)}[${op.bit}]${op.when ? ` if ${s(op.when.s)}&${op.when.mask}${op.when.eq === undefined ? "" : `==${op.when.eq}`}` : ""}`;
    case "vec": return `v.${op.op} x${op.d}, x${op.a}, x${op.b}${op.op === "shuffle" ? ` [${vecShuffles[op.imm].join(",")}]` : op.imm ? `, #${op.imm}` : ""}`;
    case "vmask": return `vmask${op.lanes} r${op.d}, x${op.a}`;
  }
}

// ---------- floating point reference semantics (x86 SSE scalar) ----------

const f64 = new Float64Array(1);
const u64v = new BigUint64Array(f64.buffer);
const f32 = new Float32Array(1);
const u32v = new Uint32Array(f32.buffer);
export const bitsToF64 = (b: bigint) => ((u64v[0] = b & M64), f64[0]);
export const f64ToBits = (x: number) => ((f64[0] = x), u64v[0]);
export const bitsToF32 = (b: bigint) => ((u32v[0] = Number(b & 0xffffffffn)), f32[0]);
export const f32ToBits = (x: number) => ((f32[0] = x), BigInt(u32v[0]));

/** x86 result for a NaN-producing operation: the default quiet NaN, negative. */
export const QNAN64 = 0xfff8000000000000n;
export const QNAN32 = 0xffc00000n;

export function floatOp(op: "add" | "sub" | "mul" | "div" | "min" | "max" | "sqrt", a: number, b: number, size: 4 | 8): number {
  const round = size === 4 ? Math.fround : (x: number) => x;
  switch (op) {
    case "add": return round(a + b);
    case "sub": return round(a - b);
    case "mul": return round(a * b);
    case "div": return round(a / b);
    case "sqrt": return round(Math.sqrt(b));
    case "min": return a < b ? a : b; // x86: anything else (NaN, equal zeros) gives the second operand
    case "max": return a > b ? a : b;
  }
}

/** cvt(t)sd2si: out of range or NaN gives the "integer indefinite" value (only the top bit set). */
export function floatToInt(x: number, w: 32 | 64, trunc: boolean): bigint {
  const v = trunc ? Math.trunc(x) : roundEven(x);
  const lim = w === 64 ? 2 ** 63 : 2 ** 31;
  if (!(v >= -lim && v < lim)) return w === 64 ? 0x8000000000000000n : 0x80000000n;
  return BigInt.asUintN(w, BigInt(v));
}

export function roundEven(x: number): number {
  if (!Number.isFinite(x)) return x;
  const r = Math.round(x);
  return Math.abs(x - Math.trunc(x)) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

const isNaNBits = (b: bigint, size: 4 | 8) =>
  size === 8 ? (b & 0x7ff0000000000000n) === 0x7ff0000000000000n && (b & 0x000fffffffffffffn) !== 0n : (b & 0x7f800000n) === 0x7f800000n && (b & 0x007fffffn) !== 0n;

/**
 * The NaN an x86 SSE operation returns: a NaN first operand (made quiet), else a NaN second operand,
 * else the default negative quiet NaN (for invalid operations such as 0/0 or sqrt(-1)).
 */
export function nanResult(aBits: bigint, bBits: bigint, size: 4 | 8, op: string): bigint {
  const a = size === 8 ? aBits & M64 : aBits & 0xffffffffn;
  const b = size === 8 ? bBits & M64 : bBits & 0xffffffffn;
  const quiet = size === 8 ? 0x0008000000000000n : 0x00400000n;
  if (op !== "sqrt" && isNaNBits(a, size)) return a | quiet;
  if (isNaNBits(b, size)) return b | quiet;
  return size === 8 ? QNAN64 : QNAN32;
}

/** uint64 -> double / single with one correct rounding (to nearest even). */
export function u64ToF64(v: bigint): number {
  return Number(v); // BigInt -> Number rounds to nearest, ties to even
}
export function u64ToF32(v: bigint): number {
  return Math.fround(v < 1n << 53n ? Number(v) : roundToBits(v, 24 + 2));
}
/** v cut to `p` significant bits with a sticky bit, so one later rounding to fewer bits is exact. */
function roundToBits(v: bigint, p: number): number {
  const len = v.toString(2).length;
  if (len <= p) return Number(v);
  const shift = BigInt(len - p);
  const q = (v >> shift) | ((v & ((1n << shift) - 1n)) !== 0n ? 1n : 0n);
  return Number(q) * 2 ** Number(shift);
}

/** int64 -> single precision with one correct rounding (to nearest even), as cvtsi2ss does. */
export function i64ToF32(v: bigint): number {
  const neg = v < 0n;
  let m = neg ? -v : v;
  if (m < 1n << 53n) return Math.fround(Number(v));
  // keep 25 significant bits plus a sticky bit, then let fround do the final rounding exactly
  let shift = 0n;
  while (m >> shift >= 1n << 26n) shift += 1n;
  const sticky = (m & ((1n << shift) - 1n)) !== 0n ? 1n : 0n;
  m = (m >> shift) | sticky;
  const x = Number(m) * 2 ** Number(shift);
  return Math.fround(neg ? -x : x);
}

// ---------- ARM floating point (reference semantics; wasm.ts lowers the same rules) ----------

const QUIET = (size: 4 | 8) => (size === 8 ? 0x0008000000000000n : 0x00400000n);
const fbits = (b: bigint, size: 4 | 8) => (size === 8 ? b & M64 : b & 0xffffffffn);
const isSNaN = (b: bigint, size: 4 | 8) => isNaNBits(b, size) && (b & QUIET(size)) === 0n;
const fval = (b: bigint, size: 4 | 8) => (size === 8 ? bitsToF64(b) : bitsToF32(b));
const tobits = (x: number, size: 4 | 8) => (size === 8 ? f64ToBits(x) : f32ToBits(Math.fround(x)));
/** ARM's default NaN (FPCR.DN = 0 still uses it for invalid operations): positive and quiet. */
export const ARM_DNAN = (size: 4 | 8) => (size === 8 ? 0x7ff8000000000000n : 0x7fc00000n);

/** ARM's NaN for operands of which at least one is NaN: signalling ones first (quieted), in order. */
export function armNaN(operands: bigint[], size: 4 | 8): bigint {
  for (const x of operands) if (isSNaN(fbits(x, size), size)) return fbits(x, size) | QUIET(size);
  for (const x of operands) if (isNaNBits(fbits(x, size), size)) return fbits(x, size);
  return ARM_DNAN(size);
}

/** One ARM scalar floating-point operation on raw bits; returns the result bits (single: low 32). */
export function armFop(op: "add" | "sub" | "mul" | "div" | "min" | "max" | "sqrt" | "maxnm" | "minnm", aBits: bigint, bBits: bigint, size: 4 | 8): bigint {
  const a = fbits(aBits, size);
  const b = op === "sqrt" ? a : fbits(bBits, size);
  const nanA = isNaNBits(a, size);
  const nanB = isNaNBits(b, size);
  if (nanA || nanB) {
    if ((op === "maxnm" || op === "minnm") && nanA !== nanB) {
      const [nan, other] = nanA ? [a, b] : [b, a];
      if (!isSNaN(nan, size)) return other;
    }
    return armNaN([a, b], size);
  }
  const x = fval(a, size);
  const y = fval(b, size);
  let r: number;
  switch (op) {
    case "add": r = x + y; break;
    case "sub": r = x - y; break;
    case "mul": r = x * y; break;
    case "div": r = x / y; break;
    case "sqrt": r = Math.sqrt(x); break;
    case "max":
    case "maxnm":
      if (x === 0 && y === 0) return Object.is(x, -0) && Object.is(y, -0) ? b : Object.is(x, -0) ? b : a;
      return x > y ? a : b;
    case "min":
    case "minnm":
      if (x === 0 && y === 0) return Object.is(x, -0) ? a : b;
      return x < y ? a : b;
  }
  if (Number.isNaN(r)) return ARM_DNAN(size);
  return tobits(r, size);
}

/** x rounded to an integral value by `mode` (the sign of a zero result is kept). */
export function roundBy(x: number, mode: FpRound): number {
  if (!Number.isFinite(x)) return x;
  let r: number;
  if (mode === "p") r = Math.ceil(x);
  else if (mode === "m") r = Math.floor(x);
  else if (mode === "z") r = Math.trunc(x);
  else {
    const t = Math.trunc(x);
    const frac = Math.abs(x - t);
    const away = t + Math.sign(x);
    r = frac > 0.5 ? away : frac < 0.5 ? t : mode === "a" ? away : Math.abs(t) % 2 === 0 ? t : away;
  }
  return r === 0 ? (Object.is(x, -0) || x < 0 ? -0 : 0) : r;
}

/** frint*: NaN gives the quieted NaN. */
export function armRound(aBits: bigint, size: 4 | 8, mode: FpRound): bigint {
  const a = fbits(aBits, size);
  if (isNaNBits(a, size)) return armNaN([a], size);
  return tobits(roundBy(fval(a, size), mode), size);
}

/** fcvt{n,p,m,z,a}{s,u}: round by mode, saturate to the integer range, NaN gives 0. Unsigned w-bit result. */
export function armF2i(aBits: bigint, size: 4 | 8, w: 32 | 64, mode: FpRound, unsigned: boolean): bigint {
  const a = fbits(aBits, size);
  if (isNaNBits(a, size)) return 0n;
  const r = roundBy(fval(a, size), mode);
  const lo = unsigned ? 0n : -(1n << BigInt(w - 1));
  const hi = unsigned ? (1n << BigInt(w)) - 1n : (1n << BigInt(w - 1)) - 1n;
  let v: bigint;
  if (r === Infinity) v = hi;
  else if (r === -Infinity) v = lo;
  else v = BigInt(r);
  if (v < lo) v = lo;
  if (v > hi) v = hi;
  return BigInt.asUintN(w, v);
}

/** fcmp: NZCV as a 4-bit number. */
export function armFcmpNzcv(aBits: bigint, bBits: bigint, size: 4 | 8): number {
  const a = fbits(aBits, size);
  const b = fbits(bBits, size);
  if (isNaNBits(a, size) || isNaNBits(b, size)) return 0b0011;
  const x = fval(a, size);
  const y = fval(b, size);
  return x === y ? 0b0110 : x < y ? 0b1000 : 0b0010;
}

/** Exact value of a finite float as m * 2^e (m a signed integer). */
function decompose(b: bigint, size: 4 | 8): { m: bigint; e: number } {
  const mbits = size === 8 ? 52 : 23;
  const ebits = size === 8 ? 11 : 8;
  const bias = size === 8 ? 1023 : 127;
  const sign = (b >> BigInt(mbits + ebits)) & 1n;
  const ex = Number((b >> BigInt(mbits)) & ((1n << BigInt(ebits)) - 1n));
  let m = b & ((1n << BigInt(mbits)) - 1n);
  let e: number;
  if (ex === 0) e = 1 - bias - mbits;
  else {
    m |= 1n << BigInt(mbits);
    e = ex - bias - mbits;
  }
  return { m: sign ? -m : m, e };
}

/** Round the exact value n * 2^e to the nearest float (ties to even), with subnormals and overflow. */
function roundExact(n: bigint, e: number, size: 4 | 8): bigint {
  const mbits = size === 8 ? 52 : 23;
  const ebits = size === 8 ? 11 : 8;
  const bias = size === 8 ? 1023 : 127;
  const signBit = n < 0n ? 1n << BigInt(mbits + ebits) : 0n;
  const m = n < 0n ? -n : n;
  const len = m.toString(2).length;
  let exp = e + len - 1; // exponent of the leading bit
  const minExp = 1 - bias; // smallest normal exponent
  let keep = mbits + 1; // significant bits kept
  if (exp < minExp) keep -= minExp - exp; // subnormal: fewer bits
  const shift = len - keep;
  let q: bigint;
  if (shift > 0) {
    q = m >> BigInt(shift);
    const rem = m & ((1n << BigInt(shift)) - 1n);
    const half = 1n << BigInt(shift - 1);
    if (rem > half || (rem === half && (q & 1n) === 1n)) q += 1n;
  } else q = m << BigInt(-shift);
  // q has `keep` (or keep + 1 after a carry) significant bits; value = q * 2^(e + shift)
  const unitExp = e + shift; // exponent of q's lowest bit
  if (q === 0n) return signBit;
  const qlen = q.toString(2).length;
  exp = unitExp + qlen - 1;
  if (exp > bias) return signBit | (((1n << BigInt(ebits)) - 1n) << BigInt(mbits)); // overflow: infinity
  if (exp < minExp) return signBit | q; // subnormal (unitExp is the subnormal unit)
  const frac = (q << BigInt(mbits - (qlen - 1))) & ((1n << BigInt(mbits)) - 1n);
  return signBit | (BigInt(exp + bias) << BigInt(mbits)) | frac;
}

/** fmadd and friends, exactly: one rounding of (negAddend ? -c : c) + (negProduct ? -(a*b) : a*b). */
export function armFma(aBits: bigint, bBits: bigint, cBits: bigint, size: 4 | 8, negProduct: boolean, negAddend: boolean): bigint {
  const sign = (x: bigint) => x >> BigInt(size * 8 - 1);
  const flip = 1n << BigInt(size * 8 - 1);
  // ARM negates the first factor and/or the addend before anything else, NaNs included (FPNeg)
  const a = fbits(aBits, size) ^ (negProduct ? flip : 0n);
  const b = fbits(bBits, size);
  const c = fbits(cBits, size) ^ (negAddend ? flip : 0n);
  const x = fval(a, size);
  const y = fval(b, size);
  const infZero = (!Number.isFinite(x) && !Number.isNaN(x) && y === 0) || (x === 0 && !Number.isFinite(y) && !Number.isNaN(y));
  if (isNaNBits(a, size) || isNaNBits(b, size) || isNaNBits(c, size)) {
    // the addend is checked first; a quiet NaN addend with inf*0 still gives the default NaN
    if (isNaNBits(c, size) && !isSNaN(c, size) && !isSNaN(a, size) && !isSNaN(b, size) && infZero) return ARM_DNAN(size);
    return armNaN([c, a, b], size);
  }
  if (infZero) return ARM_DNAN(size);
  const pNeg = (sign(a) ^ sign(b)) === 1n;
  const cS = c;
  const cv = fval(cS, size);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    // the product is infinite
    if (!Number.isFinite(cv) && (cv < 0) !== pNeg) return ARM_DNAN(size);
    return tobits(pNeg ? -Infinity : Infinity, size);
  }
  if (!Number.isFinite(cv)) return cS;
  const pa = decompose(a & (flip - 1n), size);
  const pb = decompose(b & (flip - 1n), size);
  let pm = pa.m * pb.m;
  if (pNeg) pm = -pm;
  const pe = pa.e + pb.e;
  const cd = decompose(cS, size);
  const e = Math.min(pe, cd.e);
  const n = (pm << BigInt(pe - e)) + (cd.m << BigInt(cd.e - e));
  if (n === 0n) {
    // exact zero: -0 only when both the product and the addend are negative zeros (or negative)
    const productZeroNeg = pm === 0n ? pNeg : false;
    const addendNeg = sign(cS) === 1n;
    if (pm === 0n && cd.m === 0n) return productZeroNeg && addendNeg ? flip : 0n;
    return 0n;
  }
  return roundExact(n, e, size);
}

