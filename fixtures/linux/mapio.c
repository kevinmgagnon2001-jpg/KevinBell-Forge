/*
 * Mapped files, renames and readiness with no libc (work item N7, third part): file-backed mmap
 * (private and shared, with read/write coherence), msync, munmap, ftruncate and truncate,
 * renameat/renameat2 (RENAME_NOREPLACE, RENAME_EXCHANGE, directories, open descriptors), ppoll and
 * pselect6 on files, directories and pipes. Error codes for the common mistakes too.
 * Built static for x86-64 and AArch64. The x86-64 build runs on the real CPU, in a directory that
 * holds in.txt, to produce the expected output and the expected files left behind.
 */
typedef unsigned long u64;
typedef long i64;

#if defined(__x86_64__)
static i64 sys6(i64 n, i64 a, i64 b, i64 c, i64 d, i64 e, i64 f) {
  i64 ret;
  register i64 r10 __asm__("r10") = d;
  register i64 r8 __asm__("r8") = e;
  register i64 r9 __asm__("r9") = f;
  __asm__ volatile("syscall" : "=a"(ret) : "a"(n), "D"(a), "S"(b), "d"(c), "r"(r10), "r"(r8), "r"(r9) : "rcx", "r11", "memory");
  return ret;
}
#define SYS_READ 0
#define SYS_WRITE 1
#define SYS_CLOSE 3
#define SYS_FSTAT 5
#define SYS_LSEEK 8
#define SYS_MMAP 9
#define SYS_MUNMAP 11
#define SYS_RT_SIGACTION 13
#define SYS_MSYNC 26
#define SYS_TRUNCATE 76
#define SYS_FTRUNCATE 77
#define SYS_OPENAT 257
#define SYS_MKDIRAT 258
#define SYS_UNLINKAT 263
#define SYS_RENAMEAT 264
#define SYS_PSELECT6 270
#define SYS_PPOLL 271
#define SYS_PIPE2 293
#define SYS_RENAMEAT2 316
#define O_DIRECTORY 0x10000
#else
static i64 sys6(i64 n, i64 a, i64 b, i64 c, i64 d, i64 e, i64 f) {
  register i64 x8 __asm__("x8") = n;
  register i64 x0 __asm__("x0") = a;
  register i64 x1 __asm__("x1") = b;
  register i64 x2 __asm__("x2") = c;
  register i64 x3 __asm__("x3") = d;
  register i64 x4 __asm__("x4") = e;
  register i64 x5 __asm__("x5") = f;
  __asm__ volatile("svc #0" : "+r"(x0) : "r"(x8), "r"(x1), "r"(x2), "r"(x3), "r"(x4), "r"(x5) : "memory");
  return x0;
}
#define SYS_READ 63
#define SYS_WRITE 64
#define SYS_CLOSE 57
#define SYS_FSTAT 80
#define SYS_LSEEK 62
#define SYS_MMAP 222
#define SYS_MUNMAP 215
#define SYS_RT_SIGACTION 134
#define SYS_MSYNC 227
#define SYS_TRUNCATE 45
#define SYS_FTRUNCATE 46
#define SYS_OPENAT 56
#define SYS_MKDIRAT 34
#define SYS_UNLINKAT 35
#define SYS_RENAMEAT 38
#define SYS_PSELECT6 72
#define SYS_PPOLL 73
#define SYS_PIPE2 59
#define SYS_RENAMEAT2 276
#define O_DIRECTORY 0x4000
#endif
#define sys4(n, a, b, c, d) sys6(n, a, b, c, d, 0, 0)

#define AT_FDCWD (-100)
#define AT_REMOVEDIR 0x200
#define O_RDONLY 0
#define O_WRONLY 1
#define O_RDWR 2
#define O_CREAT 0x40
#define O_TRUNC 0x200
#define O_APPEND 0x400
#define PROT_READ 1
#define PROT_WRITE 2
#define MAP_SHARED 1
#define MAP_PRIVATE 2
#define MAP_FIXED 0x10
#define MAP_ANONYMOUS 0x20
#define MS_ASYNC 1
#define MS_SYNC 4
#define RENAME_NOREPLACE 1
#define RENAME_EXCHANGE 2
#define POLLIN 1
#define POLLOUT 4
#define POLLERR 8
#define POLLHUP 0x10
#define POLLNVAL 0x20
#define POLLRDNORM 0x40
#define POLLWRNORM 0x100

static char out[8192];
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
static void shown(const char *label, const char *p, int n) {
  puts_(label); puts_(": \"");
  for (int i = 0; i < n; i++) putc_(p[i] >= 32 && p[i] < 127 ? p[i] : '.');
  puts_("\"\n");
}
static int len(const char *s) { int n = 0; while (s[n]) n++; return n; }
static void copy(char *to, const char *from) { while (*from) *to++ = *from++; }

static i64 openat(i64 dir, const char *path, i64 flags) { return sys4(SYS_OPENAT, dir, (i64)path, flags, 0644); }
static i64 write_(i64 fd, const char *s) { return sys4(SYS_WRITE, fd, (i64)s, len(s), 0); }
static i64 mmap_(i64 addr, i64 length, i64 prot, i64 flags, i64 fd, i64 off) { return sys6(SYS_MMAP, addr, length, prot, flags, fd, off); }
static i64 rename2(i64 od, const char *o, i64 nd, const char *n, i64 flags) { return sys6(SYS_RENAMEAT2, od, (i64)o, nd, (i64)n, flags, 0); }
static i64 size_of(i64 fd) {
  /* st_size is at offset 48 in both layouts. */
  static i64 st[20];
  i64 r = sys4(SYS_FSTAT, fd, (i64)st, 0, 0);
  return r < 0 ? r : st[6];
}
/* What a file holds now, read through a fresh descriptor. */
static void contents(const char *label, const char *path) {
  static char buf[256];
  i64 fd = openat(AT_FDCWD, path, O_RDONLY);
  if (fd < 0) { line(label, fd); return; }
  i64 n = sys4(SYS_READ, fd, (i64)buf, sizeof buf, 0);
  sys4(SYS_CLOSE, fd, 0, 0, 0);
  shown(label, buf, n < 0 ? 0 : (int)n);
}
static void make(const char *path, const char *text) {
  i64 fd = openat(AT_FDCWD, path, O_WRONLY | O_CREAT | O_TRUNC);
  write_(fd, text);
  sys4(SYS_CLOSE, fd, 0, 0, 0);
}

struct pollfd { int fd; short events, revents; };

static void poll_line(const char *label, struct pollfd *p, int n) {
  i64 ts[2] = {0, 0};
  i64 r = sys6(SYS_PPOLL, (i64)p, n, (i64)ts, 0, 8, 0);
  puts_(label); puts_(": "); puti(r);
  for (int i = 0; i < n; i++) { puts_(" "); puti(p[i].revents); }
  putc_('\n');
}

static void select_line(const char *label, int nfds, u64 *r, u64 *w, u64 *e) {
  i64 ts[2] = {0, 0};
  i64 res = sys6(SYS_PSELECT6, nfds, (i64)r, (i64)w, (i64)e, (i64)ts, 0);
  puts_(label); puts_(": "); puti(res);
  puts_(" r="); puti(r ? (i64)r[0] : -1);
  puts_(" w="); puti(w ? (i64)w[0] : -1);
  puts_(" e="); puti(e ? (i64)e[0] : -1);
  putc_('\n');
}

int main(void) {
  static char buf[256];

  /* A private, read-only view of in.txt. */
  i64 in = openat(AT_FDCWD, "in.txt", O_RDONLY);
  i64 size = size_of(in);
  line("in.txt size", size);
  char *view = (char *)mmap_(0, size, PROT_READ, MAP_PRIVATE, in, 0);
  line("map in.txt", (i64)view > 0 && ((i64)view & 0xfff) == 0);
  shown("mapped start", view, 20);
  shown("mapped end", view + size - 10, 10);
  line("bytes after the end of file are zero", view[size] == 0 && view[4095] == 0);
  line("munmap", sys4(SYS_MUNMAP, (i64)view, size, 0, 0));

  /* Mistakes. */
  line("offset not page aligned", mmap_(0, 100, PROT_READ, MAP_PRIVATE, in, 100));
  line("length zero", mmap_(0, 0, PROT_READ, MAP_PRIVATE, in, 0));
  line("bad descriptor", mmap_(0, 100, PROT_READ, MAP_PRIVATE, 77, 0));
  line("neither shared nor private", mmap_(0, 100, PROT_READ, 0, in, 0));
  line("shared writable on a read-only descriptor", mmap_(0, 100, PROT_READ | PROT_WRITE, MAP_SHARED, in, 0));
  i64 wo = openat(AT_FDCWD, "wo.txt", O_WRONLY | O_CREAT | O_TRUNC);
  write_(wo, "write only");
  line("map a write-only descriptor", mmap_(0, 100, PROT_READ, MAP_SHARED, wo, 0));
  sys4(SYS_CLOSE, wo, 0, 0, 0);
  i64 dfd = openat(AT_FDCWD, ".", O_RDONLY | O_DIRECTORY);
  line("map a directory", mmap_(0, 100, PROT_READ, MAP_PRIVATE, dfd, 0));
  sys4(SYS_CLOSE, dfd, 0, 0, 0);
  int p[2];
  sys4(SYS_PIPE2, (i64)p, 0, 0, 0);
  line("map a pipe", mmap_(0, 100, PROT_READ, MAP_PRIVATE, p[0], 0));
  sys4(SYS_CLOSE, p[0], 0, 0, 0);
  sys4(SYS_CLOSE, p[1], 0, 0, 0);
  line("munmap not page aligned", sys4(SYS_MUNMAP, 4097, 4096, 0, 0));
  line("munmap length zero", sys4(SYS_MUNMAP, 4096 * 16, 0, 0, 0));

  /* A private writable copy: the program's changes never reach the file. */
  char *priv = (char *)mmap_(0, size, PROT_READ | PROT_WRITE, MAP_PRIVATE, in, 0);
  copy(priv, "PRIVATE");
  shown("private copy", priv, 12);
  contents("file after a private write", "in.txt");
  sys4(SYS_MUNMAP, (i64)priv, size, 0, 0);
  sys4(SYS_CLOSE, in, 0, 0, 0);

  /* A shared mapping: stores reach the file, and writes to the file show up in memory. */
  i64 fd = openat(AT_FDCWD, "map.bin", O_RDWR | O_CREAT | O_TRUNC);
  write_(fd, "0123456789");
  line("ftruncate to 5000", sys4(SYS_FTRUNCATE, fd, 5000, 0, 0));
  line("size", size_of(fd));
  char *m = (char *)mmap_(0, 8192, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  line("map shared", (i64)m > 0);
  shown("shared start", m, 12);
  copy(m, "SHARED");
  copy(m + 4096, "second page");
  sys4(SYS_LSEEK, fd, 0, 0, 0);
  i64 n = sys4(SYS_READ, fd, (i64)buf, 12, 0);
  shown("read() sees the store", buf, (int)n);
  sys4(SYS_LSEEK, fd, 4096, 0, 0);
  n = sys4(SYS_READ, fd, (i64)buf, 11, 0);
  shown("read() sees the second page", buf, (int)n);
  sys4(SYS_LSEEK, fd, 6, 0, 0);
  write_(fd, "write");
  shown("the mapping sees write()", m, 12);
  line("msync", sys4(SYS_MSYNC, (i64)m, 8192, MS_SYNC, 0));
  line("msync async", sys4(SYS_MSYNC, (i64)m, 4096, MS_ASYNC, 0));
  line("msync not aligned", sys4(SYS_MSYNC, (i64)m + 1, 4096, MS_SYNC, 0));
  line("msync both flags", sys4(SYS_MSYNC, (i64)m, 4096, MS_SYNC | MS_ASYNC, 0));

  /* Shrink the file under the mapping, then grow it again: the cut part comes back as zeros. */
  line("ftruncate to 4100", sys4(SYS_FTRUNCATE, fd, 4100, 0, 0));
  shown("second page after the cut", m + 4096, 11);
  line("ftruncate to 5000 again", sys4(SYS_FTRUNCATE, fd, 5000, 0, 0));
  shown("second page after growing", m + 4096, 11);
  copy(m + 4100, "back");
  i64 ro = openat(AT_FDCWD, "in.txt", O_RDONLY);
  line("ftruncate a read-only descriptor", sys4(SYS_FTRUNCATE, ro, 1, 0, 0));
  sys4(SYS_CLOSE, ro, 0, 0, 0);
  line("ftruncate to a negative length", sys4(SYS_FTRUNCATE, fd, -1, 0, 0));
  line("truncate a directory", sys4(SYS_TRUNCATE, (i64)".", 0, 0, 0));
  line("truncate a missing file", sys4(SYS_TRUNCATE, (i64)"nope.txt", 0, 0, 0));
  line("truncate by path", sys4(SYS_TRUNCATE, (i64)"wo.txt", 5, 0, 0));
  contents("wo.txt", "wo.txt");

  /* The mapping outlives the descriptor and the name. */
  sys4(SYS_CLOSE, fd, 0, 0, 0);
  copy(m + 10, "-closed");
  contents("after close", "map.bin");
  line("munmap the second page", sys4(SYS_MUNMAP, (i64)m + 4096, 4096, 0, 0));
  copy(m + 20, "+");
  line("munmap the first page", sys4(SYS_MUNMAP, (i64)m, 4096, 0, 0));
  contents("after munmap", "map.bin");

  /* MAP_FIXED over anonymous memory. */
  char *anon = (char *)mmap_(0, 3 * 4096, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  anon[0] = 'a'; anon[4096] = 'b'; anon[8192] = 'c';
  fd = openat(AT_FDCWD, "in.txt", O_RDONLY);
  char *fixed = (char *)mmap_((i64)anon + 4096, 4096, PROT_READ, MAP_PRIVATE | MAP_FIXED, fd, 0);
  line("MAP_FIXED lands where asked", fixed == anon + 4096);
  shown("pages around the fixed map", anon, 1);
  shown("fixed page", anon + 4096, 5);
  shown("page after", anon + 8192, 1);
  line("MAP_FIXED not aligned", mmap_((i64)anon + 1, 4096, PROT_READ, MAP_PRIVATE | MAP_FIXED, fd, 0));
  sys4(SYS_CLOSE, fd, 0, 0, 0);

  /* Renames. */
  make("a.txt", "alpha");
  make("b.txt", "bravo");
  sys4(SYS_MKDIRAT, AT_FDCWD, (i64)"dir", 0755, 0);
  sys4(SYS_MKDIRAT, AT_FDCWD, (i64)"dir/inner", 0755, 0);
  sys4(SYS_MKDIRAT, AT_FDCWD, (i64)"empty", 0755, 0);
  make("dir/x.txt", "x-ray");
  line("rename a.txt to c.txt", sys4(SYS_RENAMEAT, AT_FDCWD, (i64)"a.txt", AT_FDCWD, (i64)"c.txt"));
  contents("a.txt", "a.txt");
  contents("c.txt", "c.txt");
  i64 held = openat(AT_FDCWD, "b.txt", O_RDONLY);
  line("rename over an existing file", rename2(AT_FDCWD, "c.txt", AT_FDCWD, "b.txt", 0));
  contents("b.txt", "b.txt");
  n = sys4(SYS_READ, held, (i64)buf, 10, 0);
  shown("the replaced file, still open", buf, (int)n);
  sys4(SYS_CLOSE, held, 0, 0, 0);
  make("c.txt", "charlie");
  line("RENAME_NOREPLACE onto a file", rename2(AT_FDCWD, "c.txt", AT_FDCWD, "b.txt", RENAME_NOREPLACE));
  line("RENAME_NOREPLACE to a new name", rename2(AT_FDCWD, "c.txt", AT_FDCWD, "d.txt", RENAME_NOREPLACE));
  line("RENAME_EXCHANGE", rename2(AT_FDCWD, "b.txt", AT_FDCWD, "d.txt", RENAME_EXCHANGE));
  contents("b.txt", "b.txt");
  contents("d.txt", "d.txt");
  line("RENAME_EXCHANGE with a missing name", rename2(AT_FDCWD, "b.txt", AT_FDCWD, "zz.txt", RENAME_EXCHANGE));
  line("both flags", rename2(AT_FDCWD, "b.txt", AT_FDCWD, "d.txt", RENAME_EXCHANGE | RENAME_NOREPLACE));
  line("unknown flag", rename2(AT_FDCWD, "b.txt", AT_FDCWD, "d.txt", 64));
  line("missing source", rename2(AT_FDCWD, "nope", AT_FDCWD, "d.txt", 0));
  line("into a missing directory", rename2(AT_FDCWD, "b.txt", AT_FDCWD, "nope/b.txt", 0));
  line("through a file", rename2(AT_FDCWD, "b.txt", AT_FDCWD, "d.txt/b.txt", 0));
  line("a file over a directory", rename2(AT_FDCWD, "b.txt", AT_FDCWD, "empty", 0));
  line("a directory over a file", rename2(AT_FDCWD, "empty", AT_FDCWD, "b.txt", 0));
  line("a directory over a non-empty one", rename2(AT_FDCWD, "empty", AT_FDCWD, "dir", 0));
  line("a directory into itself", rename2(AT_FDCWD, "dir", AT_FDCWD, "dir/inner/dir", 0));
  line("a name onto itself", rename2(AT_FDCWD, "b.txt", AT_FDCWD, "b.txt", 0));
  line("a directory onto itself", rename2(AT_FDCWD, "dir", AT_FDCWD, "dir", 0));
  line("rename dot", rename2(AT_FDCWD, "dir/.", AT_FDCWD, "moved", 0));
  line("rename onto dot dot", rename2(AT_FDCWD, "b.txt", AT_FDCWD, "dir/..", 0));
  line("trailing slash on a file", rename2(AT_FDCWD, "b.txt/", AT_FDCWD, "e.txt", 0));
  dfd = openat(AT_FDCWD, "dir", O_RDONLY | O_DIRECTORY);
  line("a directory over an empty one", rename2(AT_FDCWD, "dir", AT_FDCWD, "empty", 0));
  line("the old name is gone", openat(AT_FDCWD, "dir", O_RDONLY | O_DIRECTORY));
  fd = openat(dfd, "x.txt", O_RDONLY);
  n = sys4(SYS_READ, fd, (i64)buf, 10, 0);
  shown("open directory follows the rename", buf, n < 0 ? 0 : (int)n);
  sys4(SYS_CLOSE, fd, 0, 0, 0);
  line("rename relative to it", sys4(SYS_RENAMEAT, dfd, (i64)"x.txt", AT_FDCWD, (i64)"empty/inner/x2.txt"));
  contents("empty/inner/x2.txt", "empty/inner/x2.txt");
  line("a directory with a trailing slash", rename2(AT_FDCWD, "empty/inner/", AT_FDCWD, "inner2/", 0));
  line("swap a file and a directory", rename2(AT_FDCWD, "d.txt", AT_FDCWD, "inner2", RENAME_EXCHANGE));
  contents("inner2 now", "inner2");
  contents("d.txt/x2.txt now", "d.txt/x2.txt");
  sys4(SYS_CLOSE, dfd, 0, 0, 0);

  /* Readiness: ppoll and pselect6 with a zero timeout. */
  sys4(SYS_PIPE2, (i64)p, 0, 0, 0);
  fd = openat(AT_FDCWD, "b.txt", O_RDONLY);
  dfd = openat(AT_FDCWD, "empty", O_RDONLY | O_DIRECTORY);
  struct pollfd ps[6] = {
    {p[0], POLLIN | POLLOUT, 0}, {p[1], POLLIN | POLLOUT, 0}, {fd, POLLIN | POLLOUT, 0},
    {dfd, POLLIN | POLLRDNORM | POLLWRNORM, 0}, {77, POLLIN, 0}, {-1, POLLIN, 0},
  };
  poll_line("empty pipe, file, directory, bad, negative", ps, 6);
  write_(p[1], "ping");
  poll_line("after a write", ps, 6);
  ps[0].events = 0;
  poll_line("no events asked", ps, 1);
  ps[0].events = POLLIN;
  sys4(SYS_CLOSE, p[1], 0, 0, 0);
  poll_line("writer closed, data left", ps, 1);
  sys4(SYS_READ, p[0], (i64)buf, sizeof buf, 0);
  poll_line("writer closed, drained", ps, 1);
  sys4(SYS_CLOSE, p[0], 0, 0, 0);

  u64 act[4] = {1, 0, 0, 0}; /* SIGPIPE ignored */
  sys4(SYS_RT_SIGACTION, 13, (i64)act, 0, 8);
  sys4(SYS_PIPE2, (i64)p, 0, 0, 0);
  sys4(SYS_CLOSE, p[0], 0, 0, 0);
  struct pollfd wp = {p[1], POLLOUT, 0};
  poll_line("reader closed", &wp, 1);
  sys4(SYS_CLOSE, p[1], 0, 0, 0);

  sys4(SYS_PIPE2, (i64)p, 0, 0, 0); /* lowest free: the read end lands on 3 again */
  u64 r = (1ul << p[0]) | (1ul << fd), w = (1ul << p[1]) | (1ul << fd), e = (1ul << p[0]);
  select_line("select: empty pipe and a file", 10, &r, &w, &e);
  write_(p[1], "x");
  r = (1ul << p[0]); w = 0; e = 0;
  select_line("select: after a write", 10, &r, &w, &e);
  r = (1ul << p[0]);
  select_line("select: only read set", 10, &r, 0, 0);
  r = 1ul << 40;
  select_line("select: a closed descriptor", 41, &r, 0, 0);
  r = (1ul << p[0]);
  select_line("select: nfds below the descriptor", p[0], &r, 0, 0);
  line("select: negative nfds", sys6(SYS_PSELECT6, -1, 0, 0, 0, 0, 0));
  i64 bad_ts[2] = {0, 2000000000};
  struct pollfd one = {fd, POLLIN, 0};
  line("ppoll: bad timeout", sys6(SYS_PPOLL, (i64)&one, 1, (i64)bad_ts, 0, 8, 0));
  sys4(SYS_CLOSE, p[0], 0, 0, 0);
  sys4(SYS_CLOSE, p[1], 0, 0, 0);
  sys4(SYS_CLOSE, fd, 0, 0, 0);
  sys4(SYS_CLOSE, dfd, 0, 0, 0);

  sys4(SYS_UNLINKAT, AT_FDCWD, (i64)"wo.txt", 0, 0);
  flush();
  return 0;
}

#if defined(__x86_64__)
__asm__(".globl _start\n_start:\n  xor %rbp, %rbp\n  and $-16, %rsp\n  call main\n  mov %eax, %edi\n  mov $60, %eax\n  syscall\n");
#else
__asm__(".globl _start\n_start:\n  mov x29, #0\n  bl main\n  mov x8, #93\n  svc #0\n");
#endif
