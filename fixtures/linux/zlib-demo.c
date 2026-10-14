/*
 * A real library (work item N8): zlib 1.3, statically linked, compresses and checks 200 KB. zlib's
 * baseline x86-64 code uses SSE2 integer instructions (pinsrw, pmaddwd, psadbw...). Needs libz.a.
 */
#include <stdio.h>
#include <string.h>
#include <zlib.h>
int main(void) {
  static unsigned char in[200000], comp[220000], back[200000];
  for (int i = 0; i < (int)sizeof in; i++) in[i] = "the quick brown fox jumps over the lazy dog "[i % 44] ^ (i / 4000);
  uLongf cl = sizeof comp, bl = sizeof back;
  int r = compress2(comp, &cl, in, sizeof in, 9);
  int r2 = uncompress(back, &bl, comp, cl);
  printf("zlib %s: compress %d -> %lu bytes, uncompress %d, same %d, crc %08lx, adler %08lx\n", zlibVersion(), r, cl, r2, memcmp(in, back, sizeof in) == 0, crc32(0, in, sizeof in), adler32(1, in, sizeof in));
  return 0;
}
