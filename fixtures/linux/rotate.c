/*
 * 8- and 16-bit rotates (rol/ror by 1, by an immediate and by cl) with the carry and overflow flags
 * they leave, over many values and every count 0..40. Run on the real CPU to record the output.
 */
#include <stdint.h>
#include <stdio.h>

#define ROT(name, insn, type, reg)                                                                       \
  static void name(type v, uint8_t n) {                                                                  \
    type r = v; uint8_t cf, of;                                                                          \
    __asm__ volatile("stc\n" insn " %%cl, %0\n setc %1\n seto %2" : "+" reg(r), "=q"(cf), "=q"(of) : "c"(n) : "cc"); \
    /* OF is defined only for a count of one */                                                         \
    if ((n & 31) == 1) printf("%s %x %u -> %x c%u o%u\n", #name, (unsigned)v, n, (unsigned)r, cf, of);   \
    else printf("%s %x %u -> %x c%u\n", #name, (unsigned)v, n, (unsigned)r, cf);                         \
  }
ROT(rolb, "rolb", uint8_t, "q")
ROT(rorb, "rorb", uint8_t, "q")
ROT(rolw, "rolw", uint16_t, "r")
ROT(rorw, "rorw", uint16_t, "r")

int main(void) {
  static const uint16_t vals[] = {0, 1, 0x80, 0x81, 0x8000, 0x8001, 0x1234, 0xffff, 0x7f, 0xa5c3, 0x00ff, 0xfe01};
  for (unsigned i = 0; i < sizeof vals / sizeof vals[0]; i++)
    for (uint8_t n = 0; n <= 40; n++) {
      rolb((uint8_t)vals[i], n); rorb((uint8_t)vals[i], n);
      rolw(vals[i], n); rorw(vals[i], n);
    }
  /* immediate and by-one forms */
  for (unsigned i = 0; i < sizeof vals / sizeof vals[0]; i++) {
    uint16_t a = vals[i], b = vals[i], c = vals[i]; uint8_t d = (uint8_t)vals[i], cf, of;
    __asm__ volatile("rolw $8, %0" : "+r"(a));
    __asm__ volatile("rorw $3, %0\n setc %1" : "+r"(b), "=q"(cf));
    __asm__ volatile("rolw $1, %0\n seto %1" : "+r"(c), "=q"(of));
    __asm__ volatile("rorb $1, %0" : "+q"(d));
    printf("imm %x: %x %x c%u %x o%u %x\n", vals[i], a, b, cf, c, of, d);
  }
  return 0;
}
