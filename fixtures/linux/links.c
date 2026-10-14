/*
 * Symbolic and hard links with no libc (work item N7, fourth part): symlinkat, readlinkat, stat and
 * lstat, following links in paths (relative targets, links to directories, loops, dangling links,
 * O_NOFOLLOW, O_CREAT through a dangling link), getdents64 types, and linkat. Unlink, rmdir and
 * rename act on the link itself. Built static for x86-64 and AArch64; the x86-64 build runs on the
 * real CPU, in a directory that holds in.txt, to record the output and the tree left behind.
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
#define SYS_NEWFSTATAT 262
#define SYS_LINKAT 265
#define SYS_SYMLINKAT 266
#define SYS_READLINKAT 267
#define SYS_FACCESSAT 269
#define SYS_GETDENTS64 217
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
#define SYS_NEWFSTATAT 79
#define SYS_LINKAT 37
#define SYS_SYMLINKAT 36
#define SYS_READLINKAT 78
#define SYS_FACCESSAT 48
#define SYS_GETDENTS64 61
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


#define O_NOFOLLOW_X86 0x20000
#define O_EXCL 0x80
#define AT_SYMLINK_NOFOLLOW 0x100
#define AT_SYMLINK_FOLLOW 0x400
#if defined(__x86_64__)
#define O_NOFOLLOW 0x20000
#else
#define O_NOFOLLOW 0x8000
#endif

static i64 openat(i64 dir, const char *path, i64 flags) { return sys4(SYS_OPENAT, dir, (i64)path, flags, 0644); }
static i64 write_(i64 fd, const char *s) { return sys4(SYS_WRITE, fd, (i64)s, len(s), 0); }
static i64 symlink_(const char *target, const char *path) { return sys4(SYS_SYMLINKAT, (i64)target, AT_FDCWD, (i64)path, 0); }
static i64 link_(const char *from, const char *to, i64 flags) { return sys6(SYS_LINKAT, AT_FDCWD, (i64)from, AT_FDCWD, (i64)to, flags, 0); }
static void readlink_(const char *label, const char *path, i64 size) {
  static char buf[64];
  i64 n = sys4(SYS_READLINKAT, AT_FDCWD, (i64)path, (i64)buf, size);
  if (n < 0) line(label, n); else shown(label, buf, (int)n);
}
/* stat or lstat: "kind size nlink", kind f (file), d (directory), l (link). */
static void stat_(const char *label, const char *path, i64 flags) {
  static unsigned st[40];
  i64 r = sys4(SYS_NEWFSTATAT, AT_FDCWD, (i64)path, (i64)st, flags);
  puts_(label); puts_(": ");
  if (r < 0) { puti(r); putc_('\n'); return; }
#if defined(__x86_64__)
  unsigned mode = st[6], nlink = st[4];
#else
  unsigned mode = st[4], nlink = st[5];
#endif
  unsigned t = mode & 0xf000;
  putc_(t == 0x8000 ? 'f' : t == 0x4000 ? 'd' : t == 0xa000 ? 'l' : '?');
  putc_(' '); puti(*(i64 *)((char *)st + 48));
  if (t != 0x4000) { putc_(' '); puti(nlink); }
  putc_('\n');
}
static void contents(const char *label, const char *path) {
  static char buf[64];
  i64 fd = openat(AT_FDCWD, path, O_RDONLY);
  if (fd < 0) { line(label, fd); return; }
  i64 n = sys4(SYS_READ, fd, (i64)buf, 20, 0);
  sys4(SYS_CLOSE, fd, 0, 0, 0);
  shown(label, buf, n < 0 ? 0 : (int)n);
}
static void make(const char *path, const char *text) {
  i64 fd = openat(AT_FDCWD, path, O_WRONLY | O_CREAT | O_TRUNC);
  write_(fd, text);
  sys4(SYS_CLOSE, fd, 0, 0, 0);
}
/* Directory entries with their types, sorted (on-disk order depends on the file system). */
static void list(const char *path) {
  static char buf[2048], names[32][40];
  int count = 0;
  i64 dfd = openat(AT_FDCWD, path, O_RDONLY | O_DIRECTORY);
  for (;;) {
    i64 n = sys4(SYS_GETDENTS64, dfd, (i64)buf, sizeof buf, 0);
    if (n <= 0) break;
    for (i64 at = 0; at < n; at += *(unsigned short *)(buf + at + 16)) {
      const char *name = buf + at + 19;
      if (name[0] == '.' && (!name[1] || (name[1] == '.' && !name[2]))) continue;
      int i = 0;
      while (name[i] && i < 36) { names[count][i] = name[i]; i++; }
      unsigned char type = (unsigned char)buf[at + 18];
      names[count][i++] = type == 4 ? '/' : type == 10 ? '@' : type == 8 ? '*' : '?';
      names[count][i] = 0;
      count++;
    }
  }
  sys4(SYS_CLOSE, dfd, 0, 0, 0);
  for (int i = 1; i < count; i++)
    for (int j = i; j > 0; j--) {
      int k = 0;
      while (names[j - 1][k] && names[j - 1][k] == names[j][k]) k++;
      if ((unsigned char)names[j - 1][k] <= (unsigned char)names[j][k]) break;
      char t[40];
      for (k = 0; k < 40; k++) { t[k] = names[j][k]; names[j][k] = names[j - 1][k]; names[j - 1][k] = t[k]; }
    }
  puts_(path); puts_(":");
  for (int i = 0; i < count; i++) { putc_(' '); puts_(names[i]); }
  putc_('\n');
}

int main(void) {
  static char buf[64];
  sys4(SYS_MKDIRAT, AT_FDCWD, (i64)"d", 0755, 0);
  make("d/x.txt", "x-ray");

  /* Symbolic links. */
  line("symlink to in.txt", symlink_("in.txt", "l1"));
  line("symlink again", symlink_("in.txt", "l1"));
  line("dangling symlink", symlink_("nowhere.txt", "dangling"));
  line("symlink to a directory", symlink_("d", "dl"));
  line("relative to its own directory", symlink_("../in.txt", "d/up"));
  line("a loop", symlink_("loop", "loop"));
  line("empty target", symlink_("", "empty"));
  line("in a missing directory", symlink_("in.txt", "missing/l"));
  readlink_("readlink l1", "l1", 64);
  readlink_("readlink short buffer", "l1", 3);
  readlink_("readlink size 0", "l1", 0);
  readlink_("readlink a file", "in.txt", 64);
  readlink_("readlink missing", "nope", 64);
  readlink_("readlink through a link to a directory", "dl/up", 64);
  stat_("stat l1", "l1", 0);
  stat_("lstat l1", "l1", AT_SYMLINK_NOFOLLOW);
  stat_("stat dangling", "dangling", 0);
  stat_("lstat dangling", "dangling", AT_SYMLINK_NOFOLLOW);
  stat_("stat dl", "dl", 0);
  stat_("lstat dl", "dl", AT_SYMLINK_NOFOLLOW);
  stat_("lstat dl/", "dl/", AT_SYMLINK_NOFOLLOW);
  stat_("stat loop", "loop", 0);
  contents("read through l1", "l1");
  contents("read d/up", "d/up");
  contents("read dl/up", "dl/up");
  contents("read dl/x.txt", "dl/x.txt");
  contents("read dl/../in.txt", "dl/../in.txt");
  line("O_NOFOLLOW on a link", openat(AT_FDCWD, "l1", O_RDONLY | O_NOFOLLOW));
  line("O_NOFOLLOW through a link to a directory", openat(AT_FDCWD, "dl/x.txt", O_RDONLY | O_NOFOLLOW) >= 0);
  line("open a loop", openat(AT_FDCWD, "loop", O_RDONLY));
  line("open through a loop", openat(AT_FDCWD, "loop/x", O_RDONLY));
  line("open dangling", openat(AT_FDCWD, "dangling", O_RDONLY));
  line("O_CREAT|O_EXCL on dangling", openat(AT_FDCWD, "dangling", O_WRONLY | O_CREAT | O_EXCL));
  i64 fd = openat(AT_FDCWD, "dangling", O_WRONLY | O_CREAT);
  line("O_CREAT through dangling creates the target", fd >= 0);
  write_(fd, "made");
  sys4(SYS_CLOSE, fd, 0, 0, 0);
  contents("nowhere.txt", "nowhere.txt");
  line("open empty target", openat(AT_FDCWD, "empty", O_RDONLY));
  line("access through l1", sys4(SYS_FACCESSAT, AT_FDCWD, (i64)"l1", 4, 0));
  line("access a loop", sys4(SYS_FACCESSAT, AT_FDCWD, (i64)"loop", 0, 0));
  line("mkdir over a link", sys4(SYS_MKDIRAT, AT_FDCWD, (i64)"l1", 0755, 0));
  line("mkdir through a link", sys4(SYS_MKDIRAT, AT_FDCWD, (i64)"dl/sub", 0755, 0));
  line("O_DIRECTORY on dl", openat(AT_FDCWD, "dl", O_RDONLY | O_DIRECTORY) >= 0);
  line("O_DIRECTORY on l1", openat(AT_FDCWD, "l1", O_RDONLY | O_DIRECTORY));
  line("truncate through a link", sys4(SYS_TRUNCATE, (i64)"dangling", 2, 0, 0));
  contents("nowhere.txt after", "nowhere.txt");
  list("d");

  /* Links are names: unlink, rmdir and rename act on the link, not its target. */
  line("rmdir a link to a directory", sys4(SYS_UNLINKAT, AT_FDCWD, (i64)"dl", AT_REMOVEDIR, 0));
  line("unlink dl/ (trailing slash)", sys4(SYS_UNLINKAT, AT_FDCWD, (i64)"dl/", 0, 0));
  line("rename a link", sys6(SYS_RENAMEAT2, AT_FDCWD, (i64)"l1", AT_FDCWD, (i64)"d/l1", 0, 0));
  contents("moved link resolves from its new place", "d/l1");
  line("rename d/up down a level", sys6(SYS_RENAMEAT2, AT_FDCWD, (i64)"d/up", AT_FDCWD, (i64)"d/sub/up", 0, 0));
  contents("d/sub/up now", "d/sub/up");
  line("unlink the loop", sys4(SYS_UNLINKAT, AT_FDCWD, (i64)"loop", 0, 0));
  line("unlink empty", sys4(SYS_UNLINKAT, AT_FDCWD, (i64)"empty", 0, 0));
  line("unlink dl", sys4(SYS_UNLINKAT, AT_FDCWD, (i64)"dl", 0, 0));
  stat_("d still there", "d", 0);

  /* Hard links: two names, one file. */
  make("f.txt", "first");
  line("link f.txt g.txt", link_("f.txt", "g.txt", 0));
  stat_("stat f.txt", "f.txt", 0);
  fd = openat(AT_FDCWD, "g.txt", O_WRONLY | O_APPEND);
  write_(fd, "+more");
  sys4(SYS_CLOSE, fd, 0, 0, 0);
  contents("f.txt after writing g.txt", "f.txt");
  line("link onto an existing name", link_("f.txt", "g.txt", 0));
  line("link a directory", link_("d", "d2", 0));
  line("link a missing file", link_("nope", "n2", 0));
  line("link into a missing directory", link_("f.txt", "nope/f", 0));
  line("link a symlink", link_("dangling", "hard-to-link", 0));
  stat_("lstat hard-to-link", "hard-to-link", AT_SYMLINK_NOFOLLOW);
  line("link with AT_SYMLINK_FOLLOW", link_("dangling", "hard-to-target", AT_SYMLINK_FOLLOW));
  stat_("lstat hard-to-target", "hard-to-target", AT_SYMLINK_NOFOLLOW);
  line("bad flag", link_("f.txt", "h.txt", 1));
  line("unlink f.txt", sys4(SYS_UNLINKAT, AT_FDCWD, (i64)"f.txt", 0, 0));
  stat_("stat g.txt", "g.txt", 0);
  line("rename g.txt onto its own hard link", link_("g.txt", "g2.txt", 0) | sys6(SYS_RENAMEAT2, AT_FDCWD, (i64)"g.txt", AT_FDCWD, (i64)"g2.txt", 0, 0));
  stat_("g.txt still there", "g.txt", 0);
  (void)buf;
  flush();
  return 0;
}

#if defined(__x86_64__)
__asm__(".globl _start\n_start:\n  xor %rbp, %rbp\n  and $-16, %rsp\n  call main\n  mov %eax, %edi\n  mov $60, %eax\n  syscall\n");
#else
__asm__(".globl _start\n_start:\n  mov x29, #0\n  bl main\n  mov x8, #93\n  svc #0\n");
#endif
