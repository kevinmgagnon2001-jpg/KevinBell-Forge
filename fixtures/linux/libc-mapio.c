/*
 * Mapped files, renames and readiness the ordinary way, statically linked against glibc: a log written
 * with stdio and read back through mmap, a record file edited in place through a shared mapping,
 * rename, renameat2 and an atomic save (write a temporary, rename over), poll and select on a pipe.
 * Run on the real CPU in a directory holding in.txt to record the expected output and files.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/select.h>
#include <sys/stat.h>
#include <unistd.h>

struct record { char name[12]; int score; };

static void cat(const char *path) {
  FILE *f = fopen(path, "r");
  if (!f) { printf("%s: missing (errno %d)\n", path, errno); return; }
  char line[256];
  printf("%s:\n", path);
  while (fgets(line, sizeof line, f)) printf("  | %s", line);
  if (line[strlen(line) - 1] != '\n') printf("\n");
  fclose(f);
}

static int save(const char *path, const char *text) {
  /* Write the new version next to the old one, then rename it over: readers see one or the other. */
  char tmp[64];
  snprintf(tmp, sizeof tmp, "%s.tmp", path);
  FILE *f = fopen(tmp, "w");
  if (!f) return -1;
  fputs(text, f);
  if (fclose(f)) return -1;
  return rename(tmp, path);
}

int main(void) {
  /* Count words in in.txt through a read-only mapping. */
  int fd = open("in.txt", O_RDONLY);
  struct stat st;
  fstat(fd, &st);
  const char *text = mmap(NULL, st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
  close(fd);
  if (text == MAP_FAILED) { printf("mmap failed: %d\n", errno); return 1; }
  int words = 0, lines = 0;
  for (off_t i = 0; i < st.st_size; i++) {
    if (text[i] == '\n') lines++;
    if ((i == 0 || strchr(" \n", text[i - 1])) && !strchr(" \n", text[i])) words++;
  }
  printf("in.txt: %lld bytes, %d lines, %d words\n", (long long)st.st_size, lines, words);
  munmap((void *)text, st.st_size);

  /* A table of records, edited in place through a shared mapping. */
  fd = open("scores.bin", O_RDWR | O_CREAT | O_TRUNC, 0644);
  int n = 6;
  printf("ftruncate: %d\n", ftruncate(fd, n * sizeof(struct record)));
  struct record *rec = mmap(NULL, n * sizeof *rec, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  const char *names[] = {"ada", "brian", "cleo", "dmitri", "eve", "farah"};
  for (int i = 0; i < n; i++) {
    snprintf(rec[i].name, sizeof rec[i].name, "%s", names[i]);
    rec[i].score = (i * 37 + 11) % 100;
  }
  printf("msync: %d\n", msync(rec, n * sizeof *rec, MS_SYNC));
  struct record back;
  if (pread(fd, &back, sizeof back, 3 * sizeof back) != sizeof back) return 1;
  printf("pread record 3: %s %d\n", back.name, back.score);
  back.score = 99;
  if (pwrite(fd, &back, sizeof back, 3 * sizeof back) != sizeof back) return 1;
  printf("offset untouched by pread/pwrite: %lld\n", (long long)lseek(fd, 0, SEEK_CUR));
  printf("mapping after pwrite: %s %d\n", rec[3].name, rec[3].score);
  munmap(rec, n * sizeof *rec);
  close(fd);

  /* Read it back with stdio and print a sorted table. */
  FILE *f = fopen("scores.bin", "rb");
  struct record all[8];
  size_t got = fread(all, sizeof all[0], 8, f);
  fclose(f);
  for (size_t i = 1; i < got; i++)
    for (size_t j = i; j > 0 && all[j - 1].score < all[j].score; j--) { struct record t = all[j]; all[j] = all[j - 1]; all[j - 1] = t; }
  for (size_t i = 0; i < got; i++) printf("%zu. %-8s %3d\n", i + 1, all[i].name, all[i].score);

  /* Text written with stdio, then viewed through a mapping. */
  f = fopen("log.txt", "w");
  for (int i = 0; i < 4; i++) fprintf(f, "entry %d: %s\n", i, names[i]);
  fflush(f);
  fd = fileno(f);
  fstat(fd, &st);
  char *view = mmap(NULL, st.st_size, PROT_READ, MAP_SHARED, open("log.txt", O_RDONLY), 0);
  printf("log through mmap: %.*s", (int)(strchr(view, '\n') - view + 1), view);
  fprintf(f, "entry 4: %s\n", names[4]);
  fclose(f);
  printf("first bytes of the mapping still: %.7s\n", view);

  /* Renames. */
  int r;
  printf("save config: %d\n", save("config.txt", "colour=blue\nsize=3\n"));
  printf("save again: %d\n", save("config.txt", "colour=green\nsize=4\n"));
  cat("config.txt");
  printf("config.txt.tmp left behind: %d\n", access("config.txt.tmp", F_OK) == 0);
  r = rename("nothing.txt", "x.txt");
  printf("rename missing: %d errno %d\n", r, errno);
  mkdir("archive", 0755);
  printf("move log into archive: %d\n", rename("log.txt", "archive/log-1.txt"));
  r = renameat2(AT_FDCWD, "config.txt", AT_FDCWD, "archive/log-1.txt", RENAME_NOREPLACE);
  printf("renameat2 NOREPLACE: %d errno %d\n", r, errno);
  printf("renameat2 EXCHANGE: %d\n", renameat2(AT_FDCWD, "config.txt", AT_FDCWD, "archive/log-1.txt", RENAME_EXCHANGE));
  cat("config.txt");
  cat("archive/log-1.txt");
  printf("rename the directory: %d\n", rename("archive", "old"));
  cat("old/log-1.txt");
  r = (int)pwrite(1000, "x", 1, 0);
  printf("pwrite to a bad descriptor: %d errno %d\n", r, errno);

  /* poll and select on a pipe. */
  signal(SIGPIPE, SIG_IGN);
  int p[2];
  if (pipe(p)) return 1;
  struct pollfd pf[2] = {{p[0], POLLIN, 0}, {p[1], POLLOUT, 0}};
  r = poll(pf, 2, 0);
  printf("poll empty: %d (%d %d)\n", r, pf[0].revents, pf[1].revents);
  if (write(p[1], "hello", 5) != 5) return 1;
  r = poll(pf, 2, 0);
  printf("poll after write: %d (%d %d)\n", r, pf[0].revents, pf[1].revents);
  fd_set rs;
  FD_ZERO(&rs);
  FD_SET(p[0], &rs);
  struct timeval tv = {0, 0};
  r = select(p[0] + 1, &rs, NULL, NULL, &tv);
  printf("select: %d readable %d\n", r, FD_ISSET(p[0], &rs));
  r = pwrite(p[1], "x", 1, 0);
  printf("pwrite to a pipe: %d errno %d\n", r, errno);
  close(p[1]);
  char buf[16];
  printf("read: %zd\n", read(p[0], buf, sizeof buf));
  r = poll(pf, 1, 0);
  printf("poll writer gone: %d (%d)\n", r, pf[0].revents);
  close(p[0]);
  return 0;
}
