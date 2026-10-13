/*
 * Ordinary stdio file handling, statically linked against glibc: read a text file line by line,
 * write a report, reopen it, seek around, append, and remove a temporary file.
 * Run on the real CPU in a directory holding in.txt to record the expected output and files.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <ctype.h>

int main(void) {
  FILE *in = fopen("in.txt", "r");
  if (!in) { printf("cannot open in.txt: %d\n", errno); return 1; }
  char line[256];
  int lines = 0, words = 0, longest = 0;
  char longest_line[256] = "";
  while (fgets(line, sizeof line, in)) {
    lines++;
    int n = (int)strlen(line);
    if (n && line[n - 1] == '\n') line[--n] = 0;
    if (n > longest) { longest = n; strcpy(longest_line, line); }
    int inword = 0;
    for (char *p = line; *p; p++) {
      if (isspace((unsigned char)*p)) inword = 0;
      else if (!inword) { inword = 1; words++; }
    }
  }
  fclose(in);

  FILE *rep = fopen("report.txt", "w");
  fprintf(rep, "lines=%d words=%d\n", lines, words);
  fprintf(rep, "longest (%d): %s\n", longest, longest_line);
  for (int i = 1; i <= 3; i++) fprintf(rep, "row %d: %6.2f\n", i, i * 1.25);
  fclose(rep);

  rep = fopen("report.txt", "r+");
  fseek(rep, 0, SEEK_END);
  long size = ftell(rep);
  printf("report size %ld\n", size);
  fseek(rep, 6, SEEK_SET);
  char word[16] = "";
  if (fscanf(rep, "%15s", word) != 1) word[0] = 0;
  printf("after seek: %s\n", word);
  fseek(rep, 0, SEEK_END);
  fputs("end of report\n", rep);
  fclose(rep);

  rep = fopen("report.txt", "r");
  int c, count = 0;
  while ((c = fgetc(rep)) != EOF) { putchar(c); count++; }
  fclose(rep);
  printf("%d bytes\n", count);

  FILE *tmp = fopen("tmp.txt", "w");
  fputs("temporary\n", tmp);
  fclose(tmp);
  printf("remove tmp: %d\n", remove("tmp.txt"));
  errno = 0;
  printf("open removed: %s errno %d\n", fopen("tmp.txt", "r") ? "yes" : "no", errno);
  printf("open missing for read: %s errno %d\n", fopen("nope/x.txt", "r") ? "yes" : "no", errno);
  return 0;
}
