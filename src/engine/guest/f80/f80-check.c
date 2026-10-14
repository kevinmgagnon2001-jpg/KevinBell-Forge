/*
 * Checks f80.c against the real x87 on an x86-64 machine: every operation, every rounding mode and
 * precision, over special values, edge cases and millions of random operands. Prints mismatches and
 * a count; exit status 0 only when everything agrees.
 *   cc -O1 -o f80-check src/engine/guest/f80/f80-check.c && ./f80-check [cases]
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "f80.c"

static u64 seed = 0x9e3779b97f4a7c15ull;
static u64 rnd(void) { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; return seed; }

typedef struct { u64 m; u32 se; } V;
static long double ld(V v) { long double x = 0; memcpy(&x, &v.m, 8); memcpy((char *)&x + 8, &v.se, 2); return x; }
static V vv(long double x) { V v = {0, 0}; memcpy(&v.m, &x, 8); unsigned short e; memcpy(&e, (char *)&x + 8, 2); v.se = e; return v; }

static void setcw(unsigned cw) { unsigned short c = (unsigned short)cw; __asm__ volatile("fldcw %0" ::"m"(c)); }

static V operand(void) {
  static const V special[] = {
    {0, 0}, {0, 0x8000}, {1ull << 63, 0x3fff}, {1ull << 63, 0xbfff}, {~0ull, 0x7ffe}, {~0ull, 0xfffe}, {1ull << 63, 1}, {1, 0},
    {0x7fffffffffffffffull, 0}, {0x8000000000000001ull, 0}, {1ull << 63, 0x7fff}, {1ull << 63, 0xffff}, {0xc000000000000000ull, 0x7fff},
    {0xc000000000000001ull, 0xffff}, {0x8000000000000001ull, 0x7fff}, {0xa000000000000000ull, 0x7fff}, {0x4000000000000000ull, 0x3fff},
    {0, 0x7fff}, {0x4000000000000000ull, 0x7fff}, {0x8000000000000400ull, 0x403e}, {0xfffffffffffff800ull, 0x403e}, {1ull << 63, 0x403e},
    {1ull << 63, 0x3ffe}, {0xc000000000000000ull, 0x3ffe}, {1ull << 63, 0x3c00}, {1ull << 63, 0x43fe}, {1ull << 63, 0x3f81},
  };
  u64 k = rnd() % 8;
  V v;
  if (k == 0) return special[rnd() % (sizeof special / sizeof special[0])];
  v.m = rnd() | (1ull << 63);
  if (k == 1) v.se = 0x3fff - 4 + (u32)(rnd() % 8);
  else if (k == 2) v.se = (u32)(rnd() % 0x7fff);
  else if (k == 3) { v.se = (u32)(rnd() % 80); if (rnd() & 1) v.m >>= rnd() % 64; if (!v.se) v.m &= ~(rnd() & 1 ? 0 : 1ull << 63); }
  else if (k == 4) { v.se = 0x3fff + (u32)(rnd() % 70); }
  else if (k == 5) { v.se = 0x7ffe - (u32)(rnd() % 80); }
  else if (k == 6) { v.se = 0x3fff; v.m = (1ull << 63) | (rnd() >> (rnd() % 64)); v.m &= ~((1ull << (rnd() % 40)) - 1); }
  else { v.se = (u32)(rnd() & 0x7fff); v.m = rnd(); } /* anything, unnormals included */
  if (rnd() & 1) v.se |= 0x8000;
  return v;
}

static long fails, checks;
static void same(const char *op, unsigned cw, V a, V b, u64 hm, u32 he, u64 sm, u32 se) {
  checks++;
  if (hm == sm && (he & 0xffff) == (se & 0xffff)) return;
  if (++fails <= 4000)
    printf("MISMATCH %s cw=%04x a=%04x:%016llx b=%04x:%016llx hw=%04x:%016llx soft=%04x:%016llx\n", op, cw, a.se, (unsigned long long)a.m, b.se,
           (unsigned long long)b.m, he & 0xffff, (unsigned long long)hm, se & 0xffff, (unsigned long long)sm);
}

int main(int argc, char **argv) {
  long cases = argc > 1 ? atol(argv[1]) : 200000;
  static const unsigned cws[] = {0x037f, 0x077f, 0x0b7f, 0x0f7f, 0x027f, 0x067f, 0x0a7f, 0x0e7f, 0x007f, 0x047f, 0x087f, 0x0c7f};
  for (long i = 0; i < cases; i++) {
    unsigned cw = cws[i % 12];
    V a = operand(), b = operand();
    long double x = ld(a), y = ld(b), r;
    F80 s;
    setcw(cw);
    __asm__ volatile("faddp" : "=t"(r) : "0"(x), "u"(y) : "st(1)"); s = f80_add(a.m, a.se, b.m, b.se, cw); same("add", cw, a, b, vv(r).m, vv(r).se, s.m, s.se);
    __asm__ volatile("fsubp" : "=t"(r) : "0"(x), "u"(y) : "st(1)"); s = f80_sub(a.m, a.se, b.m, b.se, cw); same("sub", cw, a, b, vv(r).m, vv(r).se, s.m, s.se);
    __asm__ volatile("fmulp" : "=t"(r) : "0"(x), "u"(y) : "st(1)"); s = f80_mul(a.m, a.se, b.m, b.se, cw); same("mul", cw, a, b, vv(r).m, vv(r).se, s.m, s.se);
    __asm__ volatile("fdivp" : "=t"(r) : "0"(x), "u"(y) : "st(1)"); s = f80_div(a.m, a.se, b.m, b.se, cw); same("div", cw, a, b, vv(r).m, vv(r).se, s.m, s.se);
    __asm__ volatile("fsqrt" : "=t"(r) : "0"(x)); s = f80_sqrt(a.m, a.se, cw); same("sqrt", cw, a, b, vv(r).m, vv(r).se, s.m, s.se);
    __asm__ volatile("frndint" : "=t"(r) : "0"(x)); s = f80_round(a.m, a.se, cw); same("rndint", cw, a, b, vv(r).m, vv(r).se, s.m, s.se);
    __asm__ volatile("fscale" : "=t"(r) : "0"(x), "u"(y)); s = f80_scale(a.m, a.se, b.m, b.se, cw); same("scale", cw, a, b, vv(r).m, vv(r).se, s.m, s.se);
    setcw(0x037f);
    {
      unsigned short sw;
      long double q = x;
      __asm__ volatile("1: fprem\n fnstsw %%ax\n testw $0x400, %%ax\n jnz 1b" : "=t"(q), "=a"(sw) : "0"(q), "u"(y));
      F80Q p = f80_prem(a.m, a.se, b.m, b.se);
      same("prem", cw, a, b, vv(q).m, vv(q).se, p.m, p.se);
      u32 hq = ((sw >> 8) & 1) << 2 | ((sw >> 14) & 1) << 1 | ((sw >> 9) & 1); /* C0 C3 C1 = Q2 Q1 Q0 */
      u32 sq = p.q & 7;
      if (kind(a.m, a.se) == FINITE && kind(b.m, b.se) == FINITE && (a.se & 0x7fff) - (b.se & 0x7fff) < 60) same("prem-q", cw, a, b, hq, 0, sq, 0);
      q = x;
      __asm__ volatile("1: fprem1\n fnstsw %%ax\n testw $0x400, %%ax\n jnz 1b" : "=t"(q), "=a"(sw) : "0"(q), "u"(y));
      p = f80_prem1(a.m, a.se, b.m, b.se);
      same("prem1", cw, a, b, vv(q).m, vv(q).se, p.m, p.se);
    }
    setcw(cw);
    {
      double d; float f;
      __asm__ volatile("fstpl %0" : "=m"(d) : "t"(x) : "st");
      u64 db; memcpy(&db, &d, 8);
      same("to-f64", cw, a, b, db, 0, f80_to_f64(a.m, a.se, cw), 0);
      __asm__ volatile("fstps %0" : "=m"(f) : "t"(x) : "st");
      u32 fb; memcpy(&fb, &f, 4);
      same("to-f32", cw, a, b, fb, 0, f80_to_f32(a.m, a.se, cw), 0);
      long long n; int n32; short n16;
      __asm__ volatile("fistpll %0" : "=m"(n) : "t"(x) : "st");
      same("to-i64", cw, a, b, (u64)n, 0, (u64)f80_to_int(a.m, a.se, cw, 64, 0), 0);
      __asm__ volatile("fistpl %0" : "=m"(n32) : "t"(x) : "st");
      same("to-i32", cw, a, b, (u64)(i64)n32, 0, (u64)f80_to_int(a.m, a.se, cw, 32, 0), 0);
      __asm__ volatile("fistps %0" : "=m"(n16) : "t"(x) : "st");
      same("to-i16", cw, a, b, (u64)(i64)n16, 0, (u64)f80_to_int(a.m, a.se, cw, 16, 0), 0);
      __asm__ volatile("fisttpll %0" : "=m"(n) : "t"(x) : "st");
      same("trunc-i64", cw, a, b, (u64)n, 0, (u64)f80_to_int(a.m, a.se, cw, 64, 1), 0);
      u64 bits = rnd();
      if (rnd() % 4 == 0) bits = (bits & 0x800fffffffffffffull) | ((rnd() % 3 == 0 ? 0x7ffull : 0) << 52);
      memcpy(&d, &bits, 8);
      __asm__ volatile("fldl %1" : "=t"(r) : "m"(d));
      s = f80_from_f64(bits); same("from-f64", cw, a, b, vv(r).m, vv(r).se, s.m, s.se);
      u32 fbits = (u32)rnd();
      if (rnd() % 4 == 0) fbits = (fbits & 0x807fffffu) | ((rnd() % 3 == 0 ? 0xffu : 0) << 23);
      memcpy(&f, &fbits, 4);
      __asm__ volatile("flds %1" : "=t"(r) : "m"(f));
      s = f80_from_f32(fbits); same("from-f32", cw, a, b, vv(r).m, vv(r).se, s.m, s.se);
      long long iv = (long long)rnd() >> (rnd() % 64);
      __asm__ volatile("fildll %1" : "=t"(r) : "m"(iv));
      s = f80_from_i64(iv); same("from-i64", cw, a, b, vv(r).m, vv(r).se, s.m, s.se);
    }
    {
      unsigned short sw;
      __asm__ volatile("fucompp\n fnstsw %%ax" : "=a"(sw) : "t"(x), "u"(y) : "st", "st(1)");
      u32 c = (sw >> 8) & 0x45; /* C0 (bit 0), C2 (bit 2), C3 (bit 6) */
      u32 hw = c == 0x45 ? 3 : c == 0x40 ? 1 : c == 0x01 ? 0 : 2;
      same("cmp", cw, a, b, hw, 0, f80_cmp(a.m, a.se, b.m, b.se), 0);
      __asm__ volatile("fxam\n fnstsw %%ax" : "=a"(sw) : "t"(x));
      u32 hc = ((sw >> 14) & 1) << 2 | ((sw >> 10) & 1) << 1 | ((sw >> 8) & 1);
      same("class", cw, a, b, hc, 0, f80_class(a.m, a.se), 0);
    }
  }
  printf("%ld checks, %ld mismatches\n", checks, fails);
  return fails != 0;
}
