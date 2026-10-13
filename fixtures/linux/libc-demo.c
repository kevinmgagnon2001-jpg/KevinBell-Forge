/* An ordinary glibc program: printf, malloc, qsort, string functions, snprintf, strtol, a hash table. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

typedef struct Node { char *key; int count; struct Node *next; } Node;
static unsigned hash(const char *s) { unsigned h = 2166136261u; while (*s) h = (h ^ (unsigned char)*s++) * 16777619u; return h; }
static int cmp_int(const void *a, const void *b) { int x = *(const int *)a, y = *(const int *)b; return (x > y) - (x < y); }
static int cmp_str(const void *a, const void *b) { return strcmp(*(char *const *)a, *(char *const *)b); }

int main(int argc, char **argv) {
  printf("glibc on Forge: argc=%d argv0=%s\n", argc, argv[0][0] ? "set" : "empty");
  int n = 2000; int *v = malloc(n * sizeof *v);
  unsigned x = 12345;
  for (int i = 0; i < n; i++) { x = x * 1103515245u + 12345u; v[i] = (int)(x >> 8) % 100000 - 50000; }
  qsort(v, n, sizeof *v, cmp_int);
  printf("sorted: min=%d median=%d max=%d\n", v[0], v[n / 2], v[n - 1]);
  free(v);
  const char *text = "the quick brown fox jumps over the lazy dog the fox the end";
  Node *table[64] = {0};
  char *copy = strdup(text);
  int words = 0;
  for (char *w = strtok(copy, " "); w; w = strtok(NULL, " ")) {
    words++;
    unsigned h = hash(w) % 64; Node *p = table[h];
    while (p && strcmp(p->key, w)) p = p->next;
    if (!p) { p = calloc(1, sizeof *p); p->key = strdup(w); p->next = table[h]; table[h] = p; }
    p->count++;
  }
  char *keys[64]; int k = 0;
  for (int i = 0; i < 64; i++) for (Node *p = table[i]; p; p = p->next) keys[k++] = p->key;
  qsort(keys, k, sizeof *keys, cmp_str);
  printf("%d words, %d distinct:", words, k);
  for (int i = 0; i < k; i++) { unsigned h = hash(keys[i]) % 64; Node *p = table[h]; while (strcmp(p->key, keys[i])) p = p->next; printf(" %s=%d", keys[i], p->count); }
  printf("\n");
  char buf[128];
  snprintf(buf, sizeof buf, "%08x|%-6s|%+5d|%5.2s|%lld|%llu|%c|%%", 0xbeefu, "ab", 42, "xyz", -9000000000LL, 18000000000000000000ULL, 'Q');
  printf("snprintf: [%s] len=%zu\n", buf, strlen(buf));
  printf("strtol: %ld %ld %ld\n", strtol("  -1234xyz", NULL, 10), strtol("ff", NULL, 16), strtol("0777", NULL, 0));
  char up[64]; strcpy(up, "Mixed Case Text"); for (char *p = up; *p; p++) *p = toupper((unsigned char)*p);
  printf("upper: %s, strstr: %s, memcmp: %d\n", up, strstr(text, "lazy"), memcmp("abc", "abd", 3) < 0);
  char *big = malloc(1 << 20); memset(big, 'z', 1 << 20); big[(1 << 20) - 1] = 0;
  printf("big: %zu bytes, last=%c\n", strlen(big), big[1000]);
  free(big); free(copy);
  fprintf(stderr, "this line goes to stderr\n");
  return 0;
}
