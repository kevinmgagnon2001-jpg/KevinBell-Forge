/*
 * SSE2 integer instructions (work item N8): every packed-integer form glibc and libraries such as
 * zlib and OpenSSL use on baseline x86-64, over special and random inputs. Built with gcc -O1 so each
 * intrinsic stays one instruction. Run on the real CPU to record the expected output.
 */
#include <emmintrin.h>
#include <stdint.h>
#include <stdio.h>

static uint64_t seed = 0x9e3779b97f4a7c15ull;
static uint64_t next(void) { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; return seed; }

static __m128i pick(int i) {
  static const uint64_t special[][2] = {
    {0, 0}, {~0ull, ~0ull}, {0x8000800080008000ull, 0x7fff7fff7fff7fffull}, {0x0102030405060708ull, 0xf0e0d0c0b0a09080ull},
    {0x7f80ff0001fe7f81ull, 0x80007fffffff0001ull}, {0x0000000100000002ull, 0xffffffff80000000ull},
  };
  if (i < 6) return _mm_set_epi64x((long long)special[i][1], (long long)special[i][0]);
  return _mm_set_epi64x((long long)next(), (long long)next());
}

static void show(const char *name, __m128i v) {
  uint64_t lo = (uint64_t)_mm_cvtsi128_si64(v), hi = (uint64_t)_mm_cvtsi128_si64(_mm_unpackhi_epi64(v, v));
  printf("%s %016llx%016llx\n", name, (unsigned long long)hi, (unsigned long long)lo);
}

int main(void) {
  for (int i = 0; i < 40; i++) {
    __m128i a = pick(i % 7 == 6 ? 6 : i % 7), b = pick((i * 3 + 1) % 7 == 6 ? 6 : (i * 3 + 1) % 7);
    if (i >= 12) { a = pick(6); b = pick(6); }
    printf("case %d\n", i);
    show("packsswb", _mm_packs_epi16(a, b));
    show("packssdw", _mm_packs_epi32(a, b));
    show("packuswb", _mm_packus_epi16(a, b));
    show("paddsb", _mm_adds_epi8(a, b));
    show("paddsw", _mm_adds_epi16(a, b));
    show("paddusb", _mm_adds_epu8(a, b));
    show("paddusw", _mm_adds_epu16(a, b));
    show("psubsb", _mm_subs_epi8(a, b));
    show("psubsw", _mm_subs_epi16(a, b));
    show("psubusb", _mm_subs_epu8(a, b));
    show("psubusw", _mm_subs_epu16(a, b));
    show("pavgb", _mm_avg_epu8(a, b));
    show("pavgw", _mm_avg_epu16(a, b));
    show("pmullw", _mm_mullo_epi16(a, b));
    show("pmulhw", _mm_mulhi_epi16(a, b));
    show("pmulhuw", _mm_mulhi_epu16(a, b));
    show("pmuludq", _mm_mul_epu32(a, b));
    show("pmaddwd", _mm_madd_epi16(a, b));
    show("psadbw", _mm_sad_epu8(a, b));
    __m128i counts[] = {_mm_cvtsi32_si128(0), _mm_cvtsi32_si128(3), _mm_cvtsi32_si128(15), _mm_cvtsi32_si128(16), _mm_cvtsi32_si128(31), _mm_cvtsi32_si128(33), _mm_cvtsi32_si128(63), _mm_cvtsi32_si128(64), _mm_set_epi64x(0, 1ll << 40)};
    for (int k = 0; k < 9; k++) {
      __m128i c = counts[(i + k) % 9];
      show("psllw", _mm_sll_epi16(a, c)); show("pslld", _mm_sll_epi32(a, c)); show("psllq", _mm_sll_epi64(a, c));
      show("psrlw", _mm_srl_epi16(a, c)); show("psrld", _mm_srl_epi32(a, c)); show("psrlq", _mm_srl_epi64(a, c));
      show("psraw", _mm_sra_epi16(a, c)); show("psrad", _mm_sra_epi32(a, c));
    }
    show("pextrw0", _mm_cvtsi32_si128(_mm_extract_epi16(a, 0)));
    show("pextrw5", _mm_cvtsi32_si128(_mm_extract_epi16(a, 5)));
    show("pinsrw3", _mm_insert_epi16(a, (int)next(), 3));
    show("pinsrw7", _mm_insert_epi16(b, 0x1234, 7));
  }
  return 0;
}
