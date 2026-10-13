/* A skill as a Linux program: reads {"a":N,"b":M} on stdin, prints gcd(a, b) as JSON. */
typedef long i64;
#if defined(__x86_64__)
static i64 sys3(i64 n, i64 a, i64 b, i64 c) { i64 r; __asm__ volatile("syscall" : "=a"(r) : "a"(n), "D"(a), "S"(b), "d"(c) : "rcx", "r11", "memory"); return r; }
enum { RD = 0, WR = 1, EX = 60 };
#else
static i64 sys3(i64 n, i64 a, i64 b, i64 c) {
  register i64 x8 __asm__("x8") = n; register i64 x0 __asm__("x0") = a; register i64 x1 __asm__("x1") = b; register i64 x2 __asm__("x2") = c;
  __asm__ volatile("svc #0" : "+r"(x0) : "r"(x8), "r"(x1), "r"(x2) : "memory"); return x0;
}
enum { RD = 63, WR = 64, EX = 93 };
#endif
static i64 field(const char *s, char key) {
  for (; *s; s++) if (s[0] == '"' && s[1] == key && s[2] == '"' && s[3] == ':') {
    s += 4; i64 v = 0, neg = 0; if (*s == '-') { neg = 1; s++; }
    while (*s >= '0' && *s <= '9') v = v * 10 + (*s++ - '0');
    return neg ? -v : v;
  }
  return 0;
}
void _start_c(void) {
  static char in[256]; i64 n = sys3(RD, 0, (i64)in, 255); in[n > 0 ? n : 0] = 0;
  i64 a = field(in, 'a'), b = field(in, 'b');
  if (a < 0) a = -a; if (b < 0) b = -b;
  while (b) { i64 t = a % b; a = b; b = t; }
  char out[24]; int k = 23; out[k--] = '\n';
  do { out[k--] = (char)('0' + a % 10); a /= 10; } while (a);
  sys3(WR, 1, (i64)(out + k + 1), 23 - k);
  sys3(EX, 0, 0, 0);
  for (;;) {}
}
#if defined(__x86_64__)
__asm__(".globl _start\n_start:\n and $-16,%rsp\n call _start_c\n");
#else
__asm__(".globl _start\n_start:\n bl _start_c\n");
#endif
