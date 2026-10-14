/*
 * x87 floating point (work item N8): 80-bit extended precision arithmetic, conversions, compares and
 * rounding modes, over special and random values. Results are printed as raw bits (10 bytes for a
 * long double), so nothing depends on printf's own conversions. Run on the real CPU to record them.
 */
#include <fenv.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static uint64_t seed = 0x2545f4914f6cdd1dull;
static uint64_t next(void) { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; return seed; }

static long double make(uint64_t mant, unsigned sexp) {
  long double x = 0;
  memcpy(&x, &mant, 8);
  memcpy((char *)&x + 8, &sexp, 2);
  return x;
}

static void put(const char *name, long double x) {
  uint64_t m; uint16_t e;
  memcpy(&m, &x, 8); memcpy(&e, (char *)&x + 8, 2);
  printf("%s %04x%016llx\n", name, e, (unsigned long long)m);
}

static long double special(int i) {
  static const struct { uint64_t m; unsigned e; } t[] = {
    {0, 0}, {0, 0x8000}, {1ull << 63, 0x3fff}, {1ull << 63, 0xbfff}, {0xc000000000000000ull, 0x4000},
    {~0ull, 0x7ffe}, {1ull << 63, 0x0001}, {1, 0}, {0x7fffffffffffffffull, 0}, {1ull << 63, 0x7fff},
    {1ull << 63, 0xffff}, {0xc000000000000000ull, 0x7fff}, {0xaaaaaaaaaaaaaaabull, 0x3ffd}, {0xffffffffffffffffull, 0x3ffe},
    {0x8000000000000001ull, 0x3fff}, {0x8000000000000400ull, 0x403e}, {0xb504f333f9de6484ull, 0x3fff}, {1ull << 63, 0x3ffe},
  };
  return make(t[i].m, t[i].e);
}

static long double value(int i) {
  if (i < 18) return special(i);
  int kind = (int)(next() % 4);
  uint64_t m = next() | (1ull << 63);
  unsigned e;
  if (kind == 0) e = 0x3fff - 8 + (unsigned)(next() % 16);
  else if (kind == 1) e = 0x3fff - 70 + (unsigned)(next() % 140);
  else if (kind == 2) e = (unsigned)(next() % 0x7fff);
  else { e = 0x3fff; m = (1ull << 63) | (next() >> 50); }
  return make(m, e | (next() % 2 ? 0x8000 : 0));
}

static const int modes[] = {FE_TONEAREST, FE_DOWNWARD, FE_UPWARD, FE_TOWARDZERO};

int main(void) {
  for (int i = 0; i < 160; i++) {
    volatile long double a = value(i), b = value((i * 7 + 3) % 160 < 18 ? (i * 7 + 3) % 160 : 18 + i);
    fesetround(modes[i % 4]);
    printf("case %d mode %d\n", i, i % 4);
    put("a", a);
    put("b", b);
    put("add", a + b);
    put("sub", a - b);
    put("mul", a * b);
    put("div", a / b);
    put("sqrt", sqrtl(a));
    put("neg", -a);
    put("abs", fabsl(a));
    put("rint", rintl(a));
    volatile double d = (double)a;
    volatile float f = (float)a;
    long double back = d;
    put("to-double", back);
    put("to-float", (long double)f);
    printf("lrint %lld\n", (long long)llrintl(a));
    printf("trunc %lld\n", (long long)a);
    printf("cmp %d %d %d %d\n", a < b, a == b, a > b, a != a);
    volatile int64_t n = (int64_t)next();
    volatile int32_t n32 = (int32_t)next();
    volatile int16_t n16 = (int16_t)next();
    put("from-i64", (long double)n);
    put("from-i32", (long double)n32);
    put("from-i16", (long double)n16);
    volatile double dd = 0;
    uint64_t bits = next();
    memcpy((void *)&dd, &bits, 8);
    put("from-double", (long double)dd);
    put("scale", scalbnl(a, (int)(next() % 200) - 100));
    put("fmod", fmodl(a, b));
  }
  fesetround(FE_TONEAREST);
  put("1/3", 1.0L / 3);
  put("pi", 3.14159265358979323846264338327950288L);
  return 0;
}
