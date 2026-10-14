/*
 * Directories, pipes and descriptor juggling the ordinary way, statically linked against glibc:
 * mkdir, opendir/readdir, stat, rmdir, pipe + fdopen, dup2 to send stdout into a file, fcntl.
 * Run on the real CPU in a directory holding in.txt to record the expected output and files.
 */
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int by_name(const void *a, const void *b) { return strcmp(*(char *const *)a, *(char *const *)b); }

static void show(const char *path) {
  DIR *dir = opendir(path);
  if (!dir) { printf("%s: cannot open (errno %d)\n", path, errno); return; }
  char *names[64];
  int n = 0;
  struct dirent *e;
  while ((e = readdir(dir)) && n < 64) {
    if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
    char full[512];
    snprintf(full, sizeof full, "%s/%s", path, e->d_name);
    struct stat st;
    stat(full, &st);
    char *item = malloc(300);
    snprintf(item, 300, "%s%s(%lld)", e->d_name, S_ISDIR(st.st_mode) ? "/" : "", S_ISDIR(st.st_mode) ? 0LL : (long long)st.st_size);
    names[n++] = item;
  }
  closedir(dir);
  qsort(names, n, sizeof names[0], by_name);
  printf("%s:", path);
  for (int i = 0; i < n; i++) { printf(" %s", names[i]); free(names[i]); }
  printf("\n");
}

int main(void) {
  printf("mkdir work: %d\n", mkdir("work", 0755));
  int r = mkdir("work", 0755);
  printf("mkdir work again: %d errno %d\n", r, errno);
  mkdir("work/logs", 0755);
  for (int i = 0; i < 5; i++) {
    char name[64];
    snprintf(name, sizeof name, "work/file-%d.txt", i);
    FILE *f = fopen(name, "w");
    for (int j = 0; j <= i; j++) fprintf(f, "line %d of %d\n", j, i);
    fclose(f);
  }
  show("work");
  show("work/logs");

  struct stat st;
  r = stat("work", &st);
  printf("stat work: %d dir %d\n", r, S_ISDIR(st.st_mode));
  r = rmdir("work");
  printf("rmdir work: %d errno %d\n", r, errno);
  for (int i = 0; i < 5; i += 2) {
    char name[64];
    snprintf(name, sizeof name, "work/file-%d.txt", i);
    remove(name);
  }
  printf("rmdir work/logs: %d\n", rmdir("work/logs"));
  show("work");

  /* stdout into a file and back. */
  fflush(stdout);
  int saved = dup(1);
  int log = open("work/stdout.txt", O_WRONLY | O_CREAT | O_TRUNC, 0644);
  dup2(log, 1);
  close(log);
  printf("captured %d\n", 42);
  fflush(stdout);
  dup2(saved, 1);
  close(saved);
  FILE *f = fopen("work/stdout.txt", "r");
  char buf[128] = "";
  if (!fgets(buf, sizeof buf, f)) buf[0] = 0;
  fclose(f);
  printf("read back: %s", buf);

  /* A pipe through stdio. */
  int p[2];
  printf("pipe: %d\n", pipe(p));
  FILE *w = fdopen(p[1], "w");
  for (int i = 0; i < 3; i++) fprintf(w, "msg %d\n", i);
  fclose(w);
  FILE *rd = fdopen(p[0], "r");
  while (fgets(buf, sizeof buf, rd)) printf("got %s", buf);
  fclose(rd);

  int fd = open("in.txt", O_RDONLY | O_CLOEXEC);
  printf("cloexec %d\n", fcntl(fd, F_GETFD) & FD_CLOEXEC);
  int high = fcntl(fd, F_DUPFD, 30);
  printf("dup at %d\n", high);
  printf("read via dup: %zd\n", read(high, buf, 10));
  printf("offset of original: %ld\n", (long)lseek(fd, 0, SEEK_CUR));
  close(high);
  close(fd);
  show("work");
  return 0;
}
