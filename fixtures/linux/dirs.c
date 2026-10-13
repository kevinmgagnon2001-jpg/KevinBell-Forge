/*
 * Directories, descriptors and pipes with no libc (work item N7, second part): mkdirat, openat on a
 * directory and relative to a directory descriptor, getdents64, unlinkat with AT_REMOVEDIR, dup,
 * dup3, fcntl, redirecting stdout into a file, and pipe2. Error codes for the common mistakes too.
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
#define SYS_RT_SIGACTION 13
#define SYS_DUP 32
#define SYS_FCNTL 72
#define SYS_GETDENTS64 217
#define SYS_OPENAT 257
#define SYS_MKDIRAT 258
#define SYS_UNLINKAT 263
#define SYS_DUP3 292
#define SYS_PIPE2 293
#define O_DIRECTORY 0x10000
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
#define SYS_RT_SIGACTION 134
#define SYS_DUP 23
#define SYS_FCNTL 25
#define SYS_GETDENTS64 61
#define SYS_OPENAT 56
#define SYS_MKDIRAT 34
#define SYS_UNLINKAT 35
#define SYS_DUP3 24
#define SYS_PIPE2 59
#define O_DIRECTORY 0x4000
#endif

#define AT_FDCWD (-100)
#define AT_REMOVEDIR 0x200
#define O_RDONLY 0
#define O_WRONLY 1
#define O_RDWR 2
#define O_CREAT 0x40
#define O_TRUNC 0x200
#define O_APPEND 0x400
#define O_CLOEXEC 0x80000
#define F_DUPFD 0
#define F_GETFD 1
#define F_SETFD 2
#define F_GETFL 3
#define F_SETFL 4
#define F_DUPFD_CLOEXEC 1030

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
static int cmp(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return (unsigned char)*a - (unsigned char)*b; }

static i64 openat(i64 dir, const char *path, i64 flags) { return sys4(SYS_OPENAT, dir, (i64)path, flags, 0644); }
static i64 write_(i64 fd, const char *s) { return sys4(SYS_WRITE, fd, (i64)s, len(s), 0); }
static i64 mode_of(i64 fd) {
  /* st_mode: offset 24 on x86-64, 16 in the generic (AArch64) struct stat. */
  static unsigned st[40];
  i64 r = sys4(SYS_FSTAT, fd, (i64)st, 0, 0);
#if defined(__x86_64__)
  return r < 0 ? r : st[6] & 0xf000;
#else
  return r < 0 ? r : st[4] & 0xf000;
#endif
}

/* List a directory: names and types, sorted, because the order on disk depends on the file system. */
static int list(i64 dfd, const char *label) {
  static char buf[1024];
  static char names[32][64];
  static int types[32];
  int count = 0;
  for (;;) {
    i64 n = sys4(SYS_GETDENTS64, dfd, (i64)buf, sizeof buf, 0);
    if (n < 0) { line("getdents64", n); return -1; }
    if (n == 0) break;
    for (i64 at = 0; at < n;) {
      unsigned short reclen = *(unsigned short *)(buf + at + 16);
      unsigned char type = (unsigned char)buf[at + 18];
      const char *name = buf + at + 19;
      if (count < 32) {
        int i = 0;
        while (name[i] && i < 63) { names[count][i] = name[i]; i++; }
        names[count][i] = 0;
        types[count] = type;
        count++;
      }
      at += reclen;
    }
  }
  for (int i = 1; i < count; i++)
    for (int j = i; j > 0 && cmp(names[j - 1], names[j]) > 0; j--) {
      char tmp[64]; int t = types[j];
      for (int k = 0; k < 64; k++) { tmp[k] = names[j][k]; names[j][k] = names[j - 1][k]; names[j - 1][k] = tmp[k]; }
      types[j] = types[j - 1]; types[j - 1] = t;
    }
  puts_(label); puts_(":");
  for (int i = 0; i < count; i++) { putc_(' '); puts_(names[i]); putc_(types[i] == 4 ? '/' : types[i] == 8 ? '*' : '?'); }
  putc_('\n');
  return count;
}

int main(void) {
  char buf[256];

  /* Make directories. */
  line("mkdir d", sys4(SYS_MKDIRAT, AT_FDCWD, (i64)"d", 0755, 0));
  line("mkdir d again", sys4(SYS_MKDIRAT, AT_FDCWD, (i64)"d", 0755, 0));
  line("mkdir d/sub", sys4(SYS_MKDIRAT, AT_FDCWD, (i64)"d/sub", 0755, 0));
  line("mkdir under missing", sys4(SYS_MKDIRAT, AT_FDCWD, (i64)"missing/x", 0755, 0));
  line("mkdir under a file", sys4(SYS_MKDIRAT, AT_FDCWD, (i64)"in.txt/x", 0755, 0));

  /* Files in it, by path and relative to a directory descriptor. */
  i64 fd = openat(AT_FDCWD, "d/a.txt", O_WRONLY | O_CREAT | O_TRUNC);
  write_(fd, "alpha\n");
  sys4(SYS_CLOSE, fd, 0, 0, 0);
  i64 dfd = openat(AT_FDCWD, "d", O_RDONLY | O_DIRECTORY);
  line("open d", dfd >= 3);
  line("d is a directory", mode_of(dfd) == 0x4000);
  fd = openat(dfd, "b.txt", O_WRONLY | O_CREAT | O_TRUNC);
  line("create relative to d", fd >= 3);
  write_(fd, "bravo\n");
  sys4(SYS_CLOSE, fd, 0, 0, 0);
  fd = openat(dfd, "sub/c.txt", O_WRONLY | O_CREAT | O_TRUNC);
  write_(fd, "charlie\n");
  sys4(SYS_CLOSE, fd, 0, 0, 0);
  fd = openat(dfd, "../in.txt", O_RDONLY);
  line("read ../in.txt from d", sys4(SYS_READ, fd, (i64)buf, 5, 0));
  sys4(SYS_CLOSE, fd, 0, 0, 0);
  line("create in missing directory", openat(AT_FDCWD, "missing/x.txt", O_WRONLY | O_CREAT));
  line("open file as directory", openat(AT_FDCWD, "in.txt", O_RDONLY | O_DIRECTORY));
  line("open directory for writing", openat(AT_FDCWD, "d", O_WRONLY));
  line("path through a file", openat(AT_FDCWD, "in.txt/x", O_RDONLY));
  line("read a directory", sys4(SYS_READ, dfd, (i64)buf, 4, 0));
  line("relative to a file fd", openat(0, "x", O_RDONLY));

  /* List it. */
  line("small buffer", sys4(SYS_GETDENTS64, dfd, (i64)buf, 8, 0));
  line("entries", list(dfd, "d"));
  line("listed again without rewinding", list(dfd, "d"));
  line("rewind", sys4(SYS_LSEEK, dfd, 0, 0, 0));
  line("entries after rewind", list(dfd, "d"));
  i64 sub = openat(dfd, "sub", O_RDONLY | O_DIRECTORY);
  list(sub, "d/sub");
  line("getdents64 on a file", sys4(SYS_GETDENTS64, 0, (i64)buf, sizeof buf, 0));

  /* Remove things. */
  line("rmdir non-empty", sys4(SYS_UNLINKAT, AT_FDCWD, (i64)"d", AT_REMOVEDIR, 0));
  line("unlink a directory", sys4(SYS_UNLINKAT, AT_FDCWD, (i64)"d", 0, 0));
  line("rmdir a file", sys4(SYS_UNLINKAT, AT_FDCWD, (i64)"d/a.txt", AT_REMOVEDIR, 0));
  line("unlink relative to d", sys4(SYS_UNLINKAT, dfd, (i64)"b.txt", 0, 0));
  line("unlink sub/c.txt", sys4(SYS_UNLINKAT, sub, (i64)"c.txt", 0, 0));
  line("rmdir d/sub", sys4(SYS_UNLINKAT, AT_FDCWD, (i64)"d/sub", AT_REMOVEDIR, 0));
  line("rmdir d/sub again", sys4(SYS_UNLINKAT, AT_FDCWD, (i64)"d/sub", AT_REMOVEDIR, 0));
  sys4(SYS_LSEEK, dfd, 0, 0, 0);
  list(dfd, "d");
  line("mkdir d/empty", sys4(SYS_MKDIRAT, dfd, (i64)"empty", 0700, 0));
  sys4(SYS_CLOSE, sub, 0, 0, 0);
  sys4(SYS_CLOSE, dfd, 0, 0, 0);

  /* Duplicated descriptors share one offset. */
  fd = openat(AT_FDCWD, "log.txt", O_RDWR | O_CREAT | O_TRUNC);
  i64 d2 = sys4(SYS_DUP, fd, 0, 0, 0);
  line("dup is the next descriptor", d2 == fd + 1);
  write_(fd, "one ");
  write_(d2, "two ");
  line("shared offset", sys4(SYS_LSEEK, fd, 0, 1, 0));
  line("dup3 to 10", sys4(SYS_DUP3, fd, 10, O_CLOEXEC, 0));
  line("close-on-exec on 10", sys4(SYS_FCNTL, 10, F_GETFD, 0, 0));
  line("close-on-exec on the original", sys4(SYS_FCNTL, fd, F_GETFD, 0, 0));
  line("clear close-on-exec", sys4(SYS_FCNTL, 10, F_SETFD, 0, 0));
  line("close-on-exec cleared", sys4(SYS_FCNTL, 10, F_GETFD, 0, 0));
  write_(10, "three ");
  line("dup3 onto itself", sys4(SYS_DUP3, fd, fd, 0, 0));
  line("dup3 of a bad descriptor", sys4(SYS_DUP3, 77, 12, 0, 0));
  line("F_DUPFD from 20", sys4(SYS_FCNTL, fd, F_DUPFD, 20, 0));
  line("F_DUPFD from 20 again", sys4(SYS_FCNTL, fd, F_DUPFD, 20, 0));
  line("F_DUPFD_CLOEXEC", sys4(SYS_FCNTL, fd, F_DUPFD_CLOEXEC, 0, 0));
  line("access mode", sys4(SYS_FCNTL, fd, F_GETFL, 0, 0) & (3 | O_APPEND));
  line("set append", sys4(SYS_FCNTL, fd, F_SETFL, O_APPEND, 0));
  line("append shared by dup", sys4(SYS_FCNTL, d2, F_GETFL, 0, 0) & (3 | O_APPEND));
  sys4(SYS_LSEEK, fd, 0, 0, 0);
  write_(d2, "four\n");
  line("fcntl on a bad descriptor", sys4(SYS_FCNTL, 99, F_GETFD, 0, 0));
  line("close 21", sys4(SYS_CLOSE, 21, 0, 0, 0));
  line("close 21 again", sys4(SYS_CLOSE, 21, 0, 0, 0));

  /* Send stdout into a file for a while. */
  flush();
  i64 saved = sys4(SYS_DUP, 1, 0, 0, 0);
  line("stdout into log", sys4(SYS_DUP3, fd, 1, 0, 0));
  puts_("this line goes to log.txt\n");
  flush();
  line("stdout back", sys4(SYS_DUP3, saved, 1, 0, 0));
  sys4(SYS_CLOSE, saved, 0, 0, 0);
  sys4(SYS_LSEEK, fd, 0, 0, 0);
  i64 n = sys4(SYS_READ, fd, (i64)buf, sizeof buf - 1, 0);
  line("log size", n);
  buf[n > 0 ? n : 0] = 0;
  puts_(buf);
  sys4(SYS_CLOSE, fd, 0, 0, 0);
  sys4(SYS_CLOSE, d2, 0, 0, 0);
  sys4(SYS_CLOSE, 10, 0, 0, 0);
  sys4(SYS_CLOSE, 20, 0, 0, 0);

  /* Pipes. SIGPIPE is ignored so a write with no reader returns EPIPE instead of ending the program. */
  u64 act[4] = {1, 0, 0, 0}; /* SIG_IGN */
  sys4(SYS_RT_SIGACTION, 13, (i64)act, 0, 8);
  int p[2];
  line("pipe2", sys4(SYS_PIPE2, (i64)p, 0, 0, 0));
  line("pipe ends are the lowest free", p[0] == 3 && p[1] == 4);
  line("pipe is a fifo", mode_of(p[0]) == 0x1000);
  line("write into the pipe", write_(p[1], "hello pipe"));
  line("read 4", sys4(SYS_READ, p[0], (i64)buf, 4, 0));
  line("read the rest", sys4(SYS_READ, p[0], (i64)buf, sizeof buf, 0));
  line("seek on a pipe", sys4(SYS_LSEEK, p[0], 0, 0, 0));
  line("write to the read end", write_(p[0], "x"));
  line("read the write end", sys4(SYS_READ, p[1], (i64)buf, 1, 0));
  line("read end flags", sys4(SYS_FCNTL, p[0], F_GETFL, 0, 0) & 3);
  line("write end flags", sys4(SYS_FCNTL, p[1], F_GETFL, 0, 0) & 3);
  i64 w2 = sys4(SYS_DUP, p[1], 0, 0, 0);
  write_(p[1], "abc");
  sys4(SYS_CLOSE, p[1], 0, 0, 0);
  write_(w2, "def");
  sys4(SYS_CLOSE, w2, 0, 0, 0);
  n = sys4(SYS_READ, p[0], (i64)buf, sizeof buf - 1, 0);
  line("read after both writers wrote", n);
  buf[n > 0 ? n : 0] = 0;
  puts_(buf); putc_('\n');
  line("read with no writers left", sys4(SYS_READ, p[0], (i64)buf, 1, 0));
  sys4(SYS_CLOSE, p[0], 0, 0, 0);
  sys4(SYS_PIPE2, (i64)p, O_CLOEXEC, 0, 0);
  line("pipe2 close-on-exec", sys4(SYS_FCNTL, p[0], F_GETFD, 0, 0) + sys4(SYS_FCNTL, p[1], F_GETFD, 0, 0));
  sys4(SYS_CLOSE, p[0], 0, 0, 0);
  line("write with no reader", write_(p[1], "lost"));
  sys4(SYS_CLOSE, p[1], 0, 0, 0);

  /* Closing a standard stream really closes it. */
  line("close stdin", sys4(SYS_CLOSE, 0, 0, 0, 0));
  line("read closed stdin", sys4(SYS_READ, 0, (i64)buf, 1, 0));
  line("next open takes descriptor 0", openat(AT_FDCWD, "in.txt", O_RDONLY));

  flush();
  return 0;
}

#if defined(__x86_64__)
__asm__(".globl _start\n_start:\n  xor %rbp, %rbp\n  and $-16, %rsp\n  call main\n  mov %eax, %edi\n  mov $60, %eax\n  syscall\n");
#else
__asm__(".globl _start\n_start:\n  mov x29, #0\n  bl main\n  mov x8, #93\n  svc #0\n");
#endif
