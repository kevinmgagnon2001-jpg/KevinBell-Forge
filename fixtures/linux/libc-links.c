/*
 * Symbolic and hard links the ordinary way, statically linked against glibc: symlink, readlink,
 * lstat and stat, realpath, link, fopen through a link, readdir's d_type, and a "current" link
 * swapped atomically with rename, as deploy tools do. Run on the real CPU in a directory holding
 * in.txt to record the expected output and files.
 */
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <limits.h>
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
    /* the recording harness's own files */
    if (!strcmp(e->d_name, "prog") || !strcmp(e->d_name, "stdout") || !strcmp(e->d_name, "exitcode")) continue;
    char *item = malloc(300);
    snprintf(item, 300, "%s%s", e->d_name, e->d_type == DT_LNK ? "@" : e->d_type == DT_DIR ? "/" : "");
    names[n++] = item;
  }
  closedir(dir);
  qsort(names, n, sizeof names[0], by_name);
  printf("%s:", path);
  for (int i = 0; i < n; i++) { printf(" %s", names[i]); free(names[i]); }
  printf("\n");
}

static void first_line(const char *path) {
  FILE *f = fopen(path, "r");
  if (!f) { printf("%s: cannot open (errno %d)\n", path, errno); return; }
  char line[128];
  if (fgets(line, sizeof line, f)) printf("%s: %s", path, line);
  if (line[strlen(line) - 1] != '\n') printf("\n");
  fclose(f);
}

static void describe(const char *path) {
  struct stat st, lst;
  int r = stat(path, &st), l = lstat(path, &lst);
  printf("%s: stat %d lstat %d", path, r, l);
  if (l == 0) printf(" link %d", S_ISLNK(lst.st_mode));
  if (r == 0) printf(" dir %d size %lld nlink %d", S_ISDIR(st.st_mode), (long long)st.st_size, S_ISDIR(st.st_mode) ? 0 : (int)st.st_nlink);
  printf("\n");
}

static void write_file(const char *path, const char *text) {
  FILE *f = fopen(path, "w");
  fputs(text, f);
  fclose(f);
}

int main(void) {
  /* Two releases and a "current" link pointing at one of them. */
  mkdir("releases", 0755);
  mkdir("releases/v1", 0755);
  mkdir("releases/v2", 0755);
  write_file("releases/v1/app.conf", "version=1\n");
  write_file("releases/v2/app.conf", "version=2\n");
  printf("symlink current: %d\n", symlink("releases/v1", "current"));
  first_line("current/app.conf");
  char target[PATH_MAX];
  ssize_t n = readlink("current", target, sizeof target - 1);
  target[n < 0 ? 0 : n] = 0;
  printf("readlink current: %zd %s\n", n, target);

  /* Switch releases atomically: make the new link beside the old one, rename it over. */
  printf("symlink current.new: %d\n", symlink("releases/v2", "current.new"));
  printf("rename over current: %d\n", rename("current.new", "current"));
  first_line("current/app.conf");
  show(".");
  show("releases/v1");

  char *real = realpath("current/app.conf", NULL);
  printf("realpath: %s\n", real ? real + strlen(real) - strlen("releases/v2/app.conf") : "(null)");
  free(real);
  errno = 0;
  real = realpath("current/missing.conf", NULL);
  printf("realpath of a missing file: %s errno %d\n", real ? real : "(null)", errno);

  /* A link to a file, a dangling one, a loop. */
  printf("symlink notes: %d\n", symlink("in.txt", "notes"));
  printf("symlink ghost: %d\n", symlink("gone.txt", "ghost"));
  printf("symlink self: %d\n", symlink("self", "self"));
  describe("notes");
  describe("ghost");
  describe("current");
  first_line("notes");
  FILE *f = fopen("self", "r");
  printf("open self: %s errno %d\n", f ? "opened" : "failed", errno);
  f = fopen("ghost", "w");
  fputs("now it exists\n", f);
  fclose(f);
  first_line("gone.txt");
  describe("ghost");

  /* Hard links. */
  write_file("data.txt", "shared contents\n");
  printf("link: %d\n", link("data.txt", "data-copy.txt"));
  describe("data.txt");
  f = fopen("data-copy.txt", "a");
  fputs("appended through the other name\n", f);
  fclose(f);
  printf("unlink data.txt: %d\n", unlink("data.txt"));
  describe("data-copy.txt");
  f = fopen("data-copy.txt", "r");
  char line[128];
  while (fgets(line, sizeof line, f)) printf("  | %s", line);
  fclose(f);
  int r = link("releases", "releases-link");
  printf("link a directory: %d errno %d\n", r, errno);

  /* Removing links leaves their targets. */
  printf("unlink current: %d\n", unlink("current"));
  printf("unlink self: %d\n", unlink("self"));
  r = rmdir("notes");
  printf("rmdir a link: %d errno %d\n", r, errno);
  show(".");
  show("releases");
  return 0;
}
