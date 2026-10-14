/*
 * x87 80-bit extended precision, in software (work item N8).
 *
 * One implementation for every engine: compiled to WebAssembly (scripts/build-f80.mjs) and embedded
 * in each lowered guest module, so the browser, the interpreter and wasmtime compute the same bits.
 * It is tested natively against the real x87 (src/engine/guest/f80/f80-check.c) over millions of
 * operands, every rounding and precision mode included.
 *
 * Rules: plain C, 64-bit integers only (no __int128, no arrays, no globals, no memory), so the
 * WebAssembly has no imports, no memory and no calls. Exceptions are not modelled (all masked, the
 * x87 default): invalid operations give the "real indefinite" NaN, overflow gives infinity or the
 * largest finite number as the rounding mode says.
 *
 * An 80-bit value travels as (m, se): the 64-bit significand with its explicit integer bit, and the
 * sign (bit 15) with the 15-bit biased exponent. cw is the x87 control word: rounding control in bits
 * 10-11, precision control in bits 8-9.
 */
typedef unsigned long long u64;
typedef long long i64;
typedef unsigned int u32;
typedef int i32;

#define INLINE static inline __attribute__((always_inline))
#define EXPORT __attribute__((visibility("default")))

typedef struct { u64 m; u32 se; } F80;
typedef struct { u64 m; u32 se; u32 q; } F80Q;

#define IND_M 0xc000000000000000ull
#define IND_SE 0xffffu
#define TOP 0x8000000000000000ull

INLINE F80 f80(u64 m, u32 se) { F80 r; r.m = m; r.se = se; return r; }
INLINE F80 indefinite(void) { return f80(IND_M, IND_SE); }

INLINE i32 clz64(u64 x) { return x ? __builtin_clzll(x) : 64; }

/* 64 x 64 -> 128 */
INLINE void mul64(u64 a, u64 b, u64 *hi, u64 *lo) {
  u64 a0 = a & 0xffffffffu, a1 = a >> 32, b0 = b & 0xffffffffu, b1 = b >> 32;
  u64 p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
  u64 mid = (p00 >> 32) + (p01 & 0xffffffffu) + (p10 & 0xffffffffu);
  *lo = (mid << 32) | (p00 & 0xffffffffu);
  *hi = p11 + (p01 >> 32) + (p10 >> 32) + (mid >> 32);
}

/* (hi:lo) >> n, n >= 0, with every bit shifted out ORed into bit 0 */
INLINE void shr128(u64 *hi, u64 *lo, i32 n) {
  if (n <= 0) return;
  u64 h = *hi, l = *lo;
  if (n >= 128) {
    *lo = (h | l) != 0;
    *hi = 0;
  } else if (n >= 64) {
    u64 lost = l | (n > 64 ? h << (128 - n) : 0);
    *lo = (n == 64 ? h : h >> (n - 64)) | (lost != 0);
    *hi = 0;
  } else {
    u64 lost = l << (64 - n);
    *lo = (l >> n) | (h << (64 - n)) | (lost != 0);
    *hi = h >> n;
  }
}

/* --- classes of an 80-bit value --- */
enum { ZERO, FINITE, INF, QNAN, SNAN, INVALID };

INLINE i32 kind(u64 m, u32 se) {
  u32 e = se & 0x7fff;
  if (e == 0x7fff) {
    if (!(m & TOP)) return INVALID; /* pseudo-infinity, pseudo-NaN */
    if (!(m << 1)) return INF;
    return (m & 0x4000000000000000ull) ? QNAN : SNAN;
  }
  if (e == 0) return m ? FINITE : ZERO; /* denormals and pseudo-denormals are values */
  return (m & TOP) ? FINITE : INVALID;  /* unnormals */
}

/* A finite nonzero value as sig * 2^(e - 63) with sig normalized (bit 63 set). */
INLINE void unpack(u64 m, u32 se, u64 *sig, i32 *e) {
  i32 ex = (i32)(se & 0x7fff);
  i32 base = (ex == 0 ? 1 : ex) - 16383; /* exponent of bit 63 before normalizing */
  i32 lz = clz64(m);
  *sig = m << lz;
  *e = base - lz;
}

/*
 * Round sig (128 bits, bit 127 set; anything below kept as sticky in bit 0) at exponent e (bit 127
 * stands for 2^e) to p significant bits, with normal exponents emin..emax and denormals below emin.
 * Returns the rounded integer M and the exponent of its lowest bit; overflow is left to the packer.
 */
INLINE void round_core(u32 sign, i32 e, u64 hi, u64 lo, i32 p, i32 emin, i32 rc, u64 *M, i32 *lsb) {
  i32 kept = e >= emin ? p : p - (emin - e);
  *lsb = e - kept + 1;
  u64 m, round, sticky;
  if (kept <= 0) {
    m = 0;
    round = kept == 0 ? 1 : 0; /* bit 127 is the round bit only when nothing is kept */
    sticky = kept == 0 ? ((hi << 1) | lo) != 0 : 1;
  } else {
    i32 s = 128 - kept; /* >= 64 */
    u64 h = hi, l = lo;
    m = s >= 128 ? 0 : (s >= 64 ? (s == 64 ? h : h >> (s - 64)) : 0);
    /* the bits below m: round bit at s - 1 */
    i32 r = s - 1;
    round = r >= 64 ? (h >> (r - 64)) & 1 : (l >> r) & 1;
    u64 below_h = r >= 64 ? (r == 64 ? 0 : h & ((1ull << (r - 64)) - 1)) : 0;
    u64 below_l = r >= 64 ? l : (r == 0 ? 0 : l & ((1ull << r) - 1));
    sticky = (below_h | below_l) != 0;
  }
  u64 inc;
  if (rc == 0) inc = round && (sticky || (m & 1));
  else if (rc == 1) inc = sign && (round || sticky);   /* down */
  else if (rc == 2) inc = !sign && (round || sticky);  /* up */
  else inc = 0;                                         /* toward zero */
  if (inc && m == ~0ull) { *M = TOP; *lsb += 1; return; } /* 2^64: one bit up */
  *M = m + inc; /* may carry to 2^kept: the packer renormalizes */
}

/* Largest finite magnitude, or infinity, for an overflow in this rounding mode. */
INLINE i32 overflow_to_inf(u32 sign, i32 rc) { return rc == 0 || (rc == 1 && sign) || (rc == 2 && !sign); }

/* Pack M * 2^lsb into the 80-bit format with precision p. */
INLINE F80 pack80(u32 sign, u64 M, i32 lsb, i32 p, i32 rc) {
  u32 s = sign << 15;
  if (!M) return f80(0, s);
  i32 top = 63 - clz64(M); /* exponent of the leading bit = lsb + top */
  i32 E = lsb + top;
  if (E > 16383) {
    if (overflow_to_inf(sign, rc)) return f80(TOP, s | 0x7fff);
    return f80(p >= 64 ? ~0ull : (~0ull << (64 - p)), s | 0x7ffe);
  }
  if (E >= -16382) return f80(M << (63 - top), s | (u32)(E + 16383));
  return f80(M << (lsb + 16445), s); /* denormal: the lowest bit is 2^-16445 */
}

INLINE i32 precision(u32 cw) {
  u32 pc = (cw >> 8) & 3;
  return pc == 0 ? 24 : pc == 2 ? 53 : 64;
}
INLINE i32 rcOf(u32 cw) { return (i32)((cw >> 10) & 3); }

INLINE F80 round80(u32 sign, i32 e, u64 hi, u64 lo, u32 cw, i32 p) {
  u64 M; i32 lsb;
  i32 rc = rcOf(cw);
  round_core(sign, e, hi, lo, p, -16382, rc, &M, &lsb);
  return pack80(sign, M, lsb, p, rc);
}

/* x87 NaN rules for two operands: quiet the NaN, or of two NaNs the larger significand. */
INLINE F80 quiet(u64 m, u32 se) { return f80(m | 0x4000000000000000ull, se); }
INLINE F80 nan2(u64 am, u32 ae, i32 ka, u64 bm, u32 be, i32 kb) {
  i32 an = ka == QNAN || ka == SNAN, bn = kb == QNAN || kb == SNAN;
  if (an && bn) {
    /* a quiet NaN wins over a signalling one; otherwise the larger significand */
    if (ka == QNAN && kb == SNAN) return quiet(am, ae);
    if (kb == QNAN && ka == SNAN) return quiet(bm, be);
    u64 x = am & 0x3fffffffffffffffull, y = bm & 0x3fffffffffffffffull;
    if (x > y) return quiet(am, ae);
    if (y > x) return quiet(bm, be);
    return quiet(am, ae); /* equal significands: the first operand */
  }
  return an ? quiet(am, ae) : quiet(bm, be);
}

INLINE i32 isnan(i32 k) { return k == QNAN || k == SNAN; }

INLINE F80 add_core(u64 am, u32 ae, u64 bm, u32 be, u32 cw) {
  i32 ka = kind(am, ae), kb = kind(bm, be);
  if (ka == INVALID || kb == INVALID) return indefinite();
  if (isnan(ka) || isnan(kb)) return nan2(am, ae, ka, bm, be, kb);
  u32 sa = ae >> 15, sb = be >> 15;
  i32 rc = rcOf(cw);
  if (ka == INF || kb == INF) {
    if (ka == INF && kb == INF && sa != sb) return indefinite();
    return ka == INF ? f80(TOP, (sa << 15) | 0x7fff) : f80(TOP, (sb << 15) | 0x7fff);
  }
  if (ka == ZERO && kb == ZERO) return f80(0, (sa == sb ? sa : (u32)(rc == 1)) << 15);
  i32 p = precision(cw);
  /* a zero operand: the other one, rounded to the precision in force */
  u64 xs, ys; i32 xe, ye; u32 xsign, ysign;
  if (ka == ZERO || kb == ZERO) {
    u64 sig; i32 e; u32 s;
    if (ka == ZERO) { unpack(bm, be, &sig, &e); s = sb; } else { unpack(am, ae, &sig, &e); s = sa; }
    return round80(s, e, sig, 0, cw, p);
  }
  unpack(am, ae, &xs, &xe); xsign = sa;
  unpack(bm, be, &ys, &ye); ysign = sb;
  /* x is the larger magnitude */
  if (ye > xe || (ye == xe && ys > xs)) {
    u64 t = xs; xs = ys; ys = t;
    i32 te = xe; xe = ye; ye = te;
    u32 ts = xsign; xsign = ysign; ysign = ts;
  }
  u64 xh = xs, xl = 0, yh = ys, yl = 0;
  shr128(&yh, &yl, xe - ye);
  i32 e = xe;
  if (xsign == ysign) {
    u64 l = xl + yl;
    u64 c = l < xl;
    u64 s1 = xh + yh;
    u64 h = s1 + c;
    u64 carry = (s1 < xh) | (h < s1);
    if (carry) {
      /* 129 bits: shift right one, keeping the sticky */
      u64 s = l & 1;
      l = (l >> 1) | (h << 63) | s;
      h = (h >> 1) | TOP;
      e += 1;
    }
    return round80(xsign, e, h, l, cw, p);
  }
  u64 l = xl - yl;
  u64 h = xh - yh - (xl < yl);
  if (!h && !l) return f80(0, (u32)(rc == 1) << 15);
  i32 lz = h ? clz64(h) : 64 + clz64(l);
  if (lz >= 64) { h = l << (lz - 64); l = 0; }
  else if (lz > 0) { h = (h << lz) | (l >> (64 - lz)); l <<= lz; }
  return round80(xsign, e - lz, h, l, cw, p);
}

EXPORT F80 f80_add(u64 am, u32 ae, u64 bm, u32 be, u32 cw) { return add_core(am, ae, bm, be, cw); }
EXPORT F80 f80_sub(u64 am, u32 ae, u64 bm, u32 be, u32 cw) {
  /* a NaN b keeps its own sign in the NaN rules; flip only real operands */
  i32 kb = kind(bm, be);
  return add_core(am, ae, bm, isnan(kb) ? be : be ^ 0x8000, cw);
}

EXPORT F80 f80_mul(u64 am, u32 ae, u64 bm, u32 be, u32 cw) {
  i32 ka = kind(am, ae), kb = kind(bm, be);
  if (ka == INVALID || kb == INVALID) return indefinite();
  if (isnan(ka) || isnan(kb)) return nan2(am, ae, ka, bm, be, kb);
  u32 s = (ae ^ be) >> 15;
  if (ka == INF || kb == INF) {
    if (ka == ZERO || kb == ZERO) return indefinite();
    return f80(TOP, (s << 15) | 0x7fff);
  }
  if (ka == ZERO || kb == ZERO) return f80(0, s << 15);
  u64 xs, ys; i32 xe, ye;
  unpack(am, ae, &xs, &xe);
  unpack(bm, be, &ys, &ye);
  u64 h, l;
  mul64(xs, ys, &h, &l);
  i32 e = xe + ye + 1;
  if (!(h & TOP)) { h = (h << 1) | (l >> 63); l <<= 1; e -= 1; }
  return round80(s, e, h, l, cw, precision(cw));
}

EXPORT F80 f80_div(u64 am, u32 ae, u64 bm, u32 be, u32 cw) {
  i32 ka = kind(am, ae), kb = kind(bm, be);
  if (ka == INVALID || kb == INVALID) return indefinite();
  if (isnan(ka) || isnan(kb)) return nan2(am, ae, ka, bm, be, kb);
  u32 s = (ae ^ be) >> 15;
  if (ka == INF) return kb == INF ? indefinite() : f80(TOP, (s << 15) | 0x7fff);
  if (kb == INF) return f80(0, s << 15);
  if (kb == ZERO) return ka == ZERO ? indefinite() : f80(TOP, (s << 15) | 0x7fff);
  if (ka == ZERO) return f80(0, s << 15);
  u64 xs, ys; i32 xe, ye;
  unpack(am, ae, &xs, &xe);
  unpack(bm, be, &ys, &ye);
  /* restoring division: 66 quotient bits, then the remainder as sticky */
  u64 r = xs, qh = 0, ql = 0;
  i32 e = xe - ye;
  if (r >= ys) { r -= ys; ql = 1; } else e -= 1;
  for (i32 i = 0; i < 66; i++) {
    u64 carry = r >> 63;
    r <<= 1;
    qh = (qh << 1) | (ql >> 63);
    ql <<= 1;
    if (carry || r >= ys) { r -= ys; ql |= 1; }
  }
  /* q has 66 or 67 bits (the first may be the integer 1): put its top bit at 127 */
  i32 lz = qh ? clz64(qh) : 64 + clz64(ql);
  if (lz >= 64) { qh = ql << (lz - 64); ql = 0; }
  else { qh = (qh << lz) | (lz ? ql >> (64 - lz) : 0); ql <<= lz; }
  ql |= r != 0;
  return round80(s, e, qh, ql, cw, precision(cw));
}

EXPORT F80 f80_sqrt(u64 am, u32 ae, u32 cw) {
  i32 ka = kind(am, ae);
  if (ka == INVALID) return indefinite();
  if (isnan(ka)) return quiet(am, ae);
  if (ka == ZERO) return f80(0, ae & 0x8000);
  if (ae & 0x8000) return indefinite();
  if (ka == INF) return f80(TOP, 0x7fff);
  u64 sig; i32 e;
  unpack(am, ae, &sig, &e);
  /* value = sig * 2^(e - 63). Radicand N = sig * 2^k with e - 63 - k even and N in [2^126, 2^128),
     so the root R = floor(sqrt(N)) has exactly 64 bits; bit 63 of R then stands for 2^re. */
  u64 nh, nl;
  i32 re;
  if (e & 1) { nh = sig; nl = 0; re = (e - 1) / 2; }   /* k = 64 */
  else { nh = sig >> 1; nl = sig << 63; re = e / 2; } /* k = 63 */
  u64 R = 0;
  for (i32 bit = 63; bit >= 0; bit--) {
    u64 t = R | (1ull << bit), th, tl;
    mul64(t, t, &th, &tl);
    if (th < nh || (th == nh && tl <= nl)) R = t;
  }
  u64 sh, sl;
  mul64(R, R, &sh, &sl);
  u64 remh = nh - sh - (nl < sl), reml = nl - sl;
  u64 roundbit = remh != 0 || reml > R; /* remainder > R: the root's fraction is at least one half */
  u64 sticky = (remh | reml) != 0;
  return round80(0, re, R, (roundbit << 63) | sticky, cw, precision(cw));
}

/* --- conversions --- */

EXPORT F80 f80_from_i64(i64 v) {
  if (!v) return f80(0, 0);
  u32 s = v < 0;
  u64 m = s ? (u64)0 - (u64)v : (u64)v;
  i32 lz = clz64(m);
  return f80(m << lz, (s << 15) | (u32)(16383 + 63 - lz));
}

EXPORT F80 f80_from_f64(u64 bits) {
  u32 s = (u32)(bits >> 63) << 15;
  i32 e = (i32)((bits >> 52) & 0x7ff);
  u64 frac = bits & 0xfffffffffffffull;
  if (e == 0x7ff) {
    if (!frac) return f80(TOP, s | 0x7fff);
    return f80(TOP | 0x4000000000000000ull | (frac << 11), s | 0x7fff); /* quieted */
  }
  if (e == 0) {
    if (!frac) return f80(0, s);
    i32 lz = clz64(frac);
    return f80(frac << lz, s | (u32)(16383 - 1022 - 1 - (lz - 12) + 0));
  }
  return f80(TOP | (frac << 11), s | (u32)(e - 1023 + 16383));
}

EXPORT F80 f80_from_f32(u32 bits) {
  u32 s = (bits >> 31) << 15;
  i32 e = (i32)((bits >> 23) & 0xff);
  u64 frac = bits & 0x7fffff;
  if (e == 0xff) {
    if (!frac) return f80(TOP, s | 0x7fff);
    return f80(TOP | 0x4000000000000000ull | (frac << 40), s | 0x7fff);
  }
  if (e == 0) {
    if (!frac) return f80(0, s);
    i32 lz = clz64(frac);
    return f80(frac << lz, s | (u32)(16383 - 126 - 1 - (lz - 41)));
  }
  return f80(TOP | (frac << 40), s | (u32)(e - 127 + 16383));
}

/* Round to a binary format with p bits and exponent range emin..emax; returns the IEEE bits. */
INLINE u64 to_ieee(u64 am, u32 ae, u32 cw, i32 p, i32 emin, i32 emax, i32 ebits) {
  i32 k = kind(am, ae);
  u64 sign = (u64)(ae >> 15);
  i32 fbits = p - 1;
  u64 expmax = (1ull << ebits) - 1;
  u64 sbit = sign << (fbits + ebits);
  if (k == INVALID) return (1ull << (fbits + ebits)) | (expmax << fbits) | (1ull << (fbits - 1));
  if (k == ZERO) return sbit;
  if (k == INF) return sbit | (expmax << fbits);
  if (isnan(k)) return sbit | (expmax << fbits) | (1ull << (fbits - 1)) | ((am >> (63 - fbits)) & ((1ull << fbits) - 1));
  u64 sig; i32 e;
  unpack(am, ae, &sig, &e);
  i32 rc = rcOf(cw);
  u64 M; i32 lsb;
  round_core((u32)sign, e, sig, 0, p, emin, rc, &M, &lsb);
  if (!M) return sbit;
  i32 top = 63 - clz64(M);
  i32 E = lsb + top;
  if (E > emax) {
    if (overflow_to_inf((u32)sign, rc)) return sbit | (expmax << fbits);
    return sbit | ((expmax - 1) << fbits) | ((1ull << fbits) - 1);
  }
  if (E >= emin) return sbit | ((u64)(E + emax) << fbits) | ((M << (fbits - top)) & ((1ull << fbits) - 1));
  return sbit | (M << (lsb - (emin - fbits))); /* denormal */
}

EXPORT u64 f80_to_f64(u64 am, u32 ae, u32 cw) { return to_ieee(am, ae, cw, 53, -1022, 1023, 11); }
EXPORT u32 f80_to_f32(u64 am, u32 ae, u32 cw) { return (u32)to_ieee(am, ae, cw, 24, -126, 127, 8); }

/* |value| rounded to an integer, value = sig * 2^(e - 63); big when it needs more than 64 bits. */
INLINE u64 round_to_integer(u32 sign, u64 sig, i32 e, i32 rc, i32 *big) {
  *big = e > 63;
  if (e >= 63) return sig;
  u64 M; i32 lsb;
  round_core(sign, e, sig, 0, e + 1, -2000000000, rc, &M, &lsb); /* keep the integer bits; lsb is 0 */
  return M;
}

EXPORT i64 f80_to_int(u64 am, u32 ae, u32 cw, u32 width, u32 trunc) {
  i64 indefinite_int = width == 64 ? (i64)TOP : width == 32 ? (i64)(i32)0x80000000u : (i64)(short)0x8000;
  i32 k = kind(am, ae);
  if (k == ZERO) return 0;
  if (k != FINITE) return indefinite_int;
  u64 sig; i32 e;
  unpack(am, ae, &sig, &e);
  u32 sign = ae >> 15;
  i32 big;
  u64 v = round_to_integer(sign, sig, e, trunc ? 3 : rcOf(cw), &big);
  if (big) return indefinite_int;
  u64 limit = 1ull << (width - 1); /* magnitude allowed: limit - 1, or limit when negative */
  if (sign ? v > limit : v >= limit) return indefinite_int;
  return sign ? (i64)((u64)0 - v) : (i64)v;
}

EXPORT F80 f80_round(u64 am, u32 ae, u32 cw) {
  i32 k = kind(am, ae);
  if (k == INVALID) return indefinite();
  if (isnan(k)) return quiet(am, ae);
  if (k != FINITE) return f80(am, ae);
  u64 sig; i32 e;
  unpack(am, ae, &sig, &e);
  if (e >= 63) return f80(am, ae);
  u32 sign = ae >> 15;
  i32 big;
  u64 v = round_to_integer(sign, sig, e, rcOf(cw), &big);
  if (!v) return f80(0, sign << 15);
  i32 lz = clz64(v);
  return f80(v << lz, (sign << 15) | (u32)(16383 + 63 - lz));
}

/* fscale: a * 2^trunc(b) */
EXPORT F80 f80_scale(u64 am, u32 ae, u64 bm, u32 be, u32 cw) {
  i32 ka = kind(am, ae), kb = kind(bm, be);
  if (ka == INVALID || kb == INVALID) return indefinite();
  if (isnan(ka) || isnan(kb)) return nan2(am, ae, ka, bm, be, kb);
  if (kb == INF) {
    if (be & 0x8000) return ka == INF ? indefinite() : f80(0, ae & 0x8000);
    return ka == ZERO ? indefinite() : f80(TOP, (ae & 0x8000) | 0x7fff);
  }
  if (ka == ZERO || ka == INF) return f80(am, ae);
  i64 n = 0;
  if (kb == FINITE) {
    u64 sig; i32 e;
    unpack(bm, be, &sig, &e);
    if (e >= 30) n = 1 << 30;
    else if (e >= 0) n = (i64)(sig >> (63 - e));
    if (be & 0x8000) n = -n;
  }
  u64 sig; i32 e;
  unpack(am, ae, &sig, &e);
  return round80(ae >> 15, (i32)(e + n), sig, 0, cw, 64);
}

/* fprem (truncating) and fprem1 (round to nearest): the exact remainder, and the low three quotient
   bits for C0 C3 C1. */
INLINE F80Q rem_core(u64 am, u32 ae, u64 bm, u32 be, i32 nearest) {
  F80Q out;
  out.q = 0;
  i32 ka = kind(am, ae), kb = kind(bm, be);
  F80 r;
  if (ka == INVALID || kb == INVALID) r = indefinite();
  else if (isnan(ka) || isnan(kb)) r = nan2(am, ae, ka, bm, be, kb);
  else if (ka == INF || kb == ZERO) r = indefinite();
  else if (isnan(ka) || isnan(kb)) r = nan2(am, ae, ka, bm, be, kb);
  else if (ka == ZERO) r = f80(am, ae);
  else if (kb == INF) {
    u64 xs; i32 xe;
    unpack(am, ae, &xs, &xe);
    r = round80(ae >> 15, xe, xs, 0, 0x37f, 64); /* a, re-encoded */
  }
  else {
    u64 xs, ys; i32 xe, ye;
    unpack(am, ae, &xs, &xe);
    unpack(bm, be, &ys, &ye);
    i32 d = xe - ye;
    u64 q = 0;
    u64 rem = xs;
    u32 sign = ae >> 15;
    if (d < 0) {
      if (nearest && d == -1 && xs > ys) {
        /* |a| > |b|/2: one subtraction brings it below */
        out.q = 1;
        /* rem = a - b (magnitudes), sign flips */
        F80 t = add_core(am, ae, bm, (be & 0x7fff) | ((ae & 0x8000) ^ 0x8000), 0x37f);
        out.m = t.m; out.se = t.se;
        return out;
      }
      unpack(am, ae, &xs, &xe);
      r = round80(sign, xe, xs, 0, 0x37f, 64); /* a, re-encoded (a pseudo-denormal comes back normal) */
    } else {
      for (i32 i = 0; i <= d; i++) {
        u64 carry = 0;
        if (i) { carry = rem >> 63; rem <<= 1; }
        q <<= 1;
        if (carry || rem >= ys) { rem -= ys; q |= 1; }
      }
      /* rem * 2^(ye - 63) is the truncated remainder */
      if (nearest) {
        /* compare 2*rem with ys: round the quotient to nearest even */
        u64 twice_carry = rem >> 63, twice = rem << 1;
        if (twice_carry || twice > ys || (twice == ys && (q & 1))) { rem = ys - rem; q += 1; sign ^= 1; }
      }
      out.q = (u32)(q & 7);
      if (!rem) { out.m = 0; out.se = (ae & 0x8000); return out; }
      i32 lz = clz64(rem);
      F80 t = round80(sign, ye - lz, rem << lz, 0, 0x37f, 64); /* exact: it fits */
      out.m = t.m; out.se = t.se;
      return out;
    }
  }
  out.m = r.m; out.se = r.se;
  return out;
}

EXPORT F80Q f80_prem(u64 am, u32 ae, u64 bm, u32 be) { return rem_core(am, ae, bm, be, 0); }
EXPORT F80Q f80_prem1(u64 am, u32 ae, u64 bm, u32 be) { return rem_core(am, ae, bm, be, 1); }

/* Compare: 0 a < b, 1 equal, 2 a > b, 3 unordered. */
EXPORT u32 f80_cmp(u64 am, u32 ae, u64 bm, u32 be) {
  i32 ka = kind(am, ae), kb = kind(bm, be);
  if (ka == INVALID || kb == INVALID || isnan(ka) || isnan(kb)) return 3;
  if (ka == ZERO && kb == ZERO) return 1;
  i32 na = ka != ZERO && (ae >> 15), nb = kb != ZERO && (be >> 15);
  if (ka == ZERO) return nb ? 2 : 0;
  if (kb == ZERO) return na ? 0 : 2;
  if (na != nb) return na ? 0 : 2;
  i32 c;
  if (ka == INF || kb == INF) c = ka == kb ? 0 : ka == INF ? 1 : -1;
  else {
    u64 xs, ys; i32 xe, ye;
    unpack(am, ae, &xs, &xe);
    unpack(bm, be, &ys, &ye);
    c = xe > ye ? 1 : xe < ye ? -1 : xs > ys ? 1 : xs < ys ? -1 : 0;
  }
  if (na) c = -c;
  return c < 0 ? 0 : c == 0 ? 1 : 2;
}

/* fxam: C3 C2 C0 as bits 2 1 0: 0 unsupported, 1 NaN, 2 normal, 3 infinity, 4 zero, 6 denormal. */
EXPORT u32 f80_class(u64 am, u32 ae) {
  i32 k = kind(am, ae);
  if (k == INVALID) return 0;
  if (isnan(k)) return 1;
  if (k == INF) return 3;
  if (k == ZERO) return 4;
  return (ae & 0x7fff) == 0 ? 6 : 2;
}
