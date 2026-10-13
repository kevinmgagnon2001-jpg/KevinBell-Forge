/*
 * A small ordinary Linux program with no libc: sieve, fibonacci, sorting, string work,
 * division, a switch, recursion and function pointers. Built static for x86-64 and AArch64.
 * The x86-64 build runs on the real CPU to produce the expected output.
 */
typedef unsigned long u64;
typedef long i64;

#if defined(__x86_64__)
static i64 sys3(i64 n, i64 a, i64 b, i64 c) {
  i64 ret;
  __asm__ volatile("syscall" : "=a"(ret) : "a"(n), "D"(a), "S"(b), "d"(c) : "rcx", "r11", "memory");
  return ret;
}
#define SYS_WRITE 1
#define SYS_EXIT 60
#define SYS_READ 0
#else
static i64 sys3(i64 n, i64 a, i64 b, i64 c) {
  register i64 x8 __asm__("x8") = n;
  register i64 x0 __asm__("x0") = a;
  register i64 x1 __asm__("x1") = b;
  register i64 x2 __asm__("x2") = c;
  __asm__ volatile("svc #0" : "+r"(x0) : "r"(x8), "r"(x1), "r"(x2) : "memory");
  return x0;
}
#define SYS_WRITE 64
#define SYS_EXIT 93
#define SYS_READ 63
#endif

static char out[4096];
static int outn;

static void flush(void) { sys3(SYS_WRITE, 1, (i64)out, outn); outn = 0; }
static void putc_(char c) { if (outn == sizeof out) flush(); out[outn++] = c; }
static void puts_(const char *s) { while (*s) putc_(*s++); }
static void putu(u64 v) {
  char buf[24]; int n = 0;
  do { buf[n++] = (char)('0' + v % 10); v /= 10; } while (v);
  while (n) putc_(buf[--n]);
}
static void puti(i64 v) { if (v < 0) { putc_('-'); putu((u64)(-v)); } else putu((u64)v); }
static void puthex(u64 v) {
  const char *d = "0123456789abcdef";
  puts_("0x");
  for (int i = 60; i >= 0; i -= 4) putc_(d[(v >> i) & 15]);
}

static unsigned char sieve[10000];
static int primes_below(int n) {
  int count = 0;
  for (int i = 2; i < n; i++) sieve[i] = 1;
  for (int i = 2; i * i < n; i++)
    if (sieve[i]) for (int j = i * i; j < n; j += i) sieve[j] = 0;
  for (int i = 2; i < n; i++) count += sieve[i];
  return count;
}

static u64 fib(int n) { return n < 2 ? (u64)n : fib(n - 1) + fib(n - 2); }

static void sort(i64 *a, int n) {
  for (int i = 1; i < n; i++) {
    i64 key = a[i]; int j = i - 1;
    while (j >= 0 && a[j] > key) { a[j + 1] = a[j]; j--; }
    a[j + 1] = key;
  }
}

static u64 hash(const char *s) {
  u64 h = 1469598103934665603ul;
  while (*s) { h ^= (unsigned char)*s++; h *= 1099511628211ul; }
  return h;
}

static const char *name_of(int k) {
  switch (k) {
    case 0: return "zero"; case 1: return "one"; case 2: return "two"; case 3: return "three";
    case 4: return "four"; case 5: return "five"; default: return "many";
  }
}

static i64 twice(i64 x) { return x * 2; }
static i64 square(i64 x) { return x * x; }
static i64 negate(i64 x) { return -x; }

static u64 collatz_steps(u64 n) { u64 s = 0; while (n != 1) { n = (n & 1) ? 3 * n + 1 : n / 2; s++; } return s; }

int main(void) {
  puts_("forge workload\n");
  puts_("primes below 10000: "); puti(primes_below(10000)); putc_('\n');
  puts_("fib(24): "); putu(fib(24)); putc_('\n');
  i64 arr[12] = {42, -7, 19, 0, 3, -100, 77, 5, 5, 64, -1, 12};
  sort(arr, 12);
  puts_("sorted:");
  for (int i = 0; i < 12; i++) { putc_(' '); puti(arr[i]); }
  putc_('\n');
  puts_("fnv1a(\"forge\"): "); puthex(hash("forge")); putc_('\n');
  puts_("names:");
  for (int k = 0; k < 8; k++) { putc_(' '); puts_(name_of(k)); }
  putc_('\n');
  i64 (*fns[3])(i64) = {twice, square, negate};
  i64 acc = 3;
  for (int i = 0; i < 9; i++) acc = fns[i % 3](acc) + i;
  puts_("pipeline: "); puti(acc); putc_('\n');
  u64 best = 0, arg = 0;
  for (u64 n = 1; n < 3000; n++) { u64 s = collatz_steps(n); if (s > best) { best = s; arg = n; } }
  puts_("longest collatz below 3000: "); putu(arg); puts_(" ("); putu(best); puts_(" steps)\n");
  i64 q = -1234567; puts_("division: "); puti(q / 7); putc_(' '); puti(q % 7); putc_(' '); putu(0xffffffffffffull / 1000003); putc_('\n');
  char line[64]; i64 got = sys3(SYS_READ, 0, (i64)line, sizeof line - 1);
  puts_("stdin bytes: "); puti(got); putc_('\n');
  flush();
  return 7;
}

__attribute__((noreturn)) void _start_c(void) {
  int code = main();
  sys3(SYS_EXIT, code, 0, 0);
  for (;;) {}
}

#if defined(__x86_64__)
__asm__(".globl _start\n_start:\n xor %ebp,%ebp\n and $-16,%rsp\n call _start_c\n");
#else
__asm__(".globl _start\n_start:\n mov x29, #0\n mov x30, #0\n bl _start_c\n");
#endif
