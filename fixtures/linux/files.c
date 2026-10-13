/*
 * File system calls with no libc: openat (create, truncate, append, exclusive), read, write, lseek,
 * fstat, faccessat, unlinkat and close, plus the error codes for the common mistakes.
 * Built static for x86-64 and AArch64. The x86-64 build runs on the real CPU, in a directory that
 * holds in.txt, to produce the expected output and the expected files left behind.
 */
typedef unsigned long u64;
typedef long i64;

#if defined(__x86_64__)
static i64 sys4(i64 n, i64 a, i64 b, i64 c, i64 d) {
  i64 ret;
  register i64 r10 __asm__("r10") = d;
  __asm__ volatile("syscall" : "=a"(ret) : "a"(n), "D"(a), "S"(b), "d"(c), "r"(r10) : "rcx", "r11", "memory");
  return ret;
}
#define SYS_READ 0
#define SYS_WRITE 1
#define SYS_CLOSE 3
#define SYS_FSTAT 5
#define SYS_LSEEK 8
#define SYS_EXIT 60
#define SYS_OPENAT 257
#define SYS_UNLINKAT 263
#define SYS_FACCESSAT 269
#else
static i64 sys4(i64 n, i64 a, i64 b, i64 c, i64 d) {
  register i64 x8 __asm__("x8") = n;
  register i64 x0 __asm__("x0") = a;
  register i64 x1 __asm__("x1") = b;
  register i64 x2 __asm__("x2") = c;
  register i64 x3 __asm__("x3") = d;
  __asm__ volatile("svc #0" : "+r"(x0) : "r"(x8), "r"(x1), "r"(x2), "r"(x3) : "memory");
  return x0;
}
#define SYS_READ 63
#define SYS_WRITE 64
#define SYS_CLOSE 57
#define SYS_FSTAT 80
#define SYS_LSEEK 62
#define SYS_EXIT 93
#define SYS_OPENAT 56
#define SYS_UNLINKAT 35
#define SYS_FACCESSAT 48
#endif

#define AT_FDCWD (-100)
#define O_RDONLY 0
#define O_WRONLY 1
#define O_RDWR 2
#define O_CREAT 0x40
#define O_EXCL 0x80
#define O_TRUNC 0x200
#define O_APPEND 0x400

static char out[4096];
static int outn;

static void flush(void) { sys4(SYS_WRITE, 1, (i64)out, outn, 0); outn = 0; }
static void putc_(char c) { if (outn == sizeof out) flush(); out[outn++] = c; }
static void puts_(const char *s) { while (*s) putc_(*s++); }
static void puti(i64 v) {
  char buf[24]; int n = 0;
  u64 u = v < 0 ? (u64)(-v) : (u64)v;
  if (v < 0) putc_('-');
  do { buf[n++] = (char)('0' + u % 10); u /= 10; } while (u);
  while (n) putc_(buf[--n]);
}
static void line(const char *label, i64 v) { puts_(label); puts_(": "); puti(v); putc_('\n'); }
static int len(const char *s) { int n = 0; while (s[n]) n++; return n; }

static i64 openat(const char *path, i64 flags) { return sys4(SYS_OPENAT, AT_FDCWD, (i64)path, flags, 0644); }
static i64 write_(i64 fd, const char *s) { return sys4(SYS_WRITE, fd, (i64)s, len(s), 0); }
static i64 size_of(i64 fd) {
  /* st_size is at byte 48 in both the x86-64 and the generic (AArch64) struct stat. */
  static i64 st[32];
  i64 r = sys4(SYS_FSTAT, fd, (i64)st, 0, 0);
  return r < 0 ? r : st[6];
}

int main(void) {
  char buf[256];

  /* Read the input file the host provided and checksum it. */
  i64 in = openat("in.txt", O_RDONLY);
  line("open in.txt", in >= 3);
  line("in.txt size", size_of(in));
  u64 sum = 0, lines = 0;
  for (;;) {
    i64 n = sys4(SYS_READ, in, (i64)buf, 7, 0); /* odd chunk size on purpose */
    if (n <= 0) { line("last read", n); break; }
    for (i64 i = 0; i < n; i++) { sum = sum * 31 + (unsigned char)buf[i]; lines += buf[i] == '\n'; }
  }
  line("in.txt lines", (i64)lines);
  line("in.txt checksum mod 1000003", (i64)(sum % 1000003));
  line("write to read-only fd", sys4(SYS_WRITE, in, (i64)"x", 1, 0));
  line("close in.txt", sys4(SYS_CLOSE, in, 0, 0, 0));
  line("close again", sys4(SYS_CLOSE, in, 0, 0, 0));

  /* Create, write, seek, overwrite in the middle, read back. */
  i64 fd = openat("out.txt", O_RDWR | O_CREAT | O_TRUNC);
  line("create out.txt", fd >= 3);
  line("write", write_(fd, "hello, forge\n"));
  line("write", write_(fd, "second line\n"));
  line("size", size_of(fd));
  line("seek to 7", sys4(SYS_LSEEK, fd, 7, 0, 0));
  line("overwrite", write_(fd, "FORGE"));
  line("seek from end -5", sys4(SYS_LSEEK, fd, -5, 2, 0));
  line("seek current +2", sys4(SYS_LSEEK, fd, 2, 1, 0));
  line("seek negative", sys4(SYS_LSEEK, fd, -100, 0, 0));
  line("seek to 0", sys4(SYS_LSEEK, fd, 0, 0, 0));
  i64 n = sys4(SYS_READ, fd, (i64)buf, sizeof buf - 1, 0);
  line("read back", n);
  buf[n > 0 ? n : 0] = 0;
  puts_(buf);
  line("read at end", sys4(SYS_READ, fd, (i64)buf, 10, 0));
  sys4(SYS_CLOSE, fd, 0, 0, 0);

  /* Append, then truncate a second file. */
  fd = openat("out.txt", O_WRONLY | O_APPEND);
  sys4(SYS_LSEEK, fd, 0, 0, 0);
  line("append", write_(fd, "appended\n"));
  line("size after append", size_of(fd));
  line("read from write-only fd", sys4(SYS_READ, fd, (i64)buf, 4, 0));
  sys4(SYS_CLOSE, fd, 0, 0, 0);
  fd = openat("scratch.txt", O_WRONLY | O_CREAT);
  write_(fd, "this goes away");
  sys4(SYS_CLOSE, fd, 0, 0, 0);
  fd = openat("scratch.txt", O_WRONLY | O_TRUNC);
  line("truncated size", size_of(fd));
  write_(fd, "short");
  sys4(SYS_CLOSE, fd, 0, 0, 0);

  /* Errors. */
  line("open missing", openat("missing.txt", O_RDONLY));
  line("exclusive create of existing", openat("out.txt", O_WRONLY | O_CREAT | O_EXCL));
  line("access out.txt", sys4(SYS_FACCESSAT, AT_FDCWD, (i64)"out.txt", 0, 0));
  line("access missing", sys4(SYS_FACCESSAT, AT_FDCWD, (i64)"missing.txt", 0, 0));
  line("read bad fd", sys4(SYS_READ, 99, (i64)buf, 1, 0));
  line("unlink scratch", sys4(SYS_UNLINKAT, AT_FDCWD, (i64)"scratch.txt", 0, 0));
  line("open after unlink", openat("scratch.txt", O_RDONLY));
  line("unlink missing", sys4(SYS_UNLINKAT, AT_FDCWD, (i64)"scratch.txt", 0, 0));

  /* Lowest free descriptor is reused. */
  i64 a = openat("out.txt", O_RDONLY), b = openat("out.txt", O_RDONLY);
  sys4(SYS_CLOSE, a, 0, 0, 0);
  i64 c = openat("in.txt", O_RDONLY);
  line("descriptor reused", c == a);
  sys4(SYS_CLOSE, b, 0, 0, 0);
  sys4(SYS_CLOSE, c, 0, 0, 0);

  flush();
  return 3;
}

#if defined(__x86_64__)
__asm__(".globl _start\n_start:\n  xor %rbp, %rbp\n  and $-16, %rsp\n  call main\n  mov %eax, %edi\n  mov $60, %eax\n  syscall\n");
#else
__asm__(".globl _start\n_start:\n  mov x29, #0\n  bl main\n  mov x8, #93\n  svc #0\n");
#endif
