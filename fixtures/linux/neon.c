/*
 * ARM64 instruction corpus for Forge's Advanced SIMD, floating-point and integer additions (N6).
 * Every instruction form the decoder handles runs here, on real ARM64 hardware, over the same 32
 * inputs: special floating-point values (signed zeros, infinities, quiet and signalling NaNs with
 * payloads, subnormals, ties), lane edge cases and random bits. Each line is one instruction and
 * one input: the 128-bit result (and, for scalar forms, the integer result and flags).
 * Built static with gcc on ARM64 (build-arm.sh); Forge must print the same bytes.
 */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef struct { uint64_t lo, hi; } v128;
#define N 32

static v128 in_a[N], in_b[N], in_c[N];

static uint64_t rng = 0x9e3779b97f4a7c15ull;
static uint64_t next(void) {
  rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17;
  return rng;
}

static const uint64_t D_SPECIAL[] = {
  0x0000000000000000ull, 0x8000000000000000ull, 0x3ff0000000000000ull, 0xbff0000000000000ull,
  0x3fe0000000000000ull, 0x3ff8000000000000ull, 0x4004000000000000ull, 0xc004000000000000ull,
  0x7ff0000000000000ull, 0xfff0000000000000ull, 0x7ff8000000000000ull, 0x7ff4000000000001ull,
  0xfff8000000000abcull, 0x0000000000000001ull, 0x000fffffffffffffull, 0x7fefffffffffffffull,
  0x43e0000000000000ull, 0xc3e0000000000000ull, 0x41dfffffffc00000ull, 0x4330000000000001ull,
  0x3fdfffffffffffffull, 0xc1e0000000200000ull, 0x4041000000000000ull, 0x3fb999999999999aull,
};
static const uint32_t S_SPECIAL[] = {
  0x00000000u, 0x80000000u, 0x3f800000u, 0xbf800000u, 0x3f000000u, 0x3fc00000u, 0x40200000u, 0xc0200000u,
  0x7f800000u, 0xff800000u, 0x7fc00000u, 0x7fa00001u, 0xffc00abcu, 0x00000001u, 0x007fffffu, 0x7f7fffffu,
  0x5f000000u, 0xdf000000u, 0x4effffffu, 0x4b000001u, 0x3effffffu, 0xcf000001u, 0x42080000u, 0x3dcccccdu,
};

static uint64_t pick_d(void) { return next() % 3 ? D_SPECIAL[next() % 24] : next(); }
static uint64_t pick_s2(void) {
  uint64_t lo = next() % 3 ? S_SPECIAL[next() % 24] : (uint32_t)next();
  uint64_t hi = next() % 3 ? S_SPECIAL[next() % 24] : (uint32_t)next();
  return lo | hi << 32;
}
static uint64_t pick_bytes(void) {
  /* integer lanes with edge values: 0, -1, min, max, small */
  static const uint64_t E[] = {0, ~0ull, 0x8080808080808080ull, 0x7f7f7f7f7f7f7f7full, 0x0102030405060708ull,
                               0x8000000080000000ull, 0x7fffffff7fffffffull, 0x0000ffff0000ffffull, 0xff00ff00ff00ff00ull,
                               0x0f0e0d0c0b0a0908ull, 0x1f1e1d1c1b1a1918ull, 0x8000000000000000ull};
  return next() % 2 ? E[next() % 12] : next();
}
static void fill(void) {
  for (int i = 0; i < N; i++) {
    int kind = i % 4; /* 0 doubles, 1 singles, 2 integer edges, 3 random */
    v128 *v[3] = {&in_a[i], &in_b[i], &in_c[i]};
    for (int k = 0; k < 3; k++) {
      if (kind == 0) { v[k]->lo = pick_d(); v[k]->hi = pick_d(); }
      else if (kind == 1) { v[k]->lo = pick_s2(); v[k]->hi = pick_s2(); }
      else if (kind == 2) { v[k]->lo = pick_bytes(); v[k]->hi = pick_bytes(); }
      else { v[k]->lo = next(); v[k]->hi = next(); }
    }
  }
}

/* ---- vector harness: v0 = a, v1 = b, v2 = v3 = c; the instruction writes v2 ---- */
typedef void (*vfn)(const v128 *, const v128 *, const v128 *, v128 *);
#define VT(name, insn)                                                                            \
  static void name(const v128 *a, const v128 *b, const v128 *c, v128 *out) {                     \
    __asm__ volatile("ldr q0, [%1]\n ldr q1, [%2]\n ldr q2, [%3]\n ldr q3, [%3]\n" insn "\n str q2, [%0]" \
                     : : "r"(out), "r"(a), "r"(b), "r"(c) : "v0", "v1", "v2", "v3", "memory");      \
  }
/* ---- scalar harness: x0 = a.lo, x1 = b.lo, x2 = c.lo, v0..v3 as above; writes x3 and v2, flags kept ---- */
typedef struct { uint64_t x, pad; v128 v; uint64_t nzcv; } sres;
typedef void (*sfn)(const v128 *, const v128 *, const v128 *, sres *);
#define ST(name, insn)                                                                            \
  static void name(const v128 *a, const v128 *b, const v128 *c, sres *out) {                     \
    __asm__ volatile("ldr q0, [%1]\n ldr q1, [%2]\n ldr q2, [%3]\n ldr q3, [%3]\n"                \
                     "ldr x0, [%1]\n ldr x1, [%2]\n ldr x2, [%3]\n mov x3, #0\n cmp x2, x0\n"     \
                     insn "\n str x3, [%0]\n str q2, [%0, #16]\n"                                  \
                     "cset x4, mi\n cset x5, eq\n cset x6, cs\n cset x7, vs\n"                    \
                     "orr x4, x5, x4, lsl #1\n orr x4, x6, x4, lsl #1\n orr x4, x7, x4, lsl #1\n str x4, [%0, #32]" \
                     : : "r"(out), "r"(a), "r"(b), "r"(c) : "x0", "x1", "x2", "x3", "x4", "x5", "x6", "x7", "v0", "v1", "v2", "v3", "memory", "cc"); \
  }

/* integer */
ST(i_rbit64, "rbit x3, x0") ST(i_rbit32, "rbit w3, w0") ST(i_rev16, "rev16 x3, x0") ST(i_rev32, "rev32 x3, x0")
ST(i_rev64, "rev x3, x0") ST(i_revw, "rev w3, w0") ST(i_rev16w, "rev16 w3, w0") ST(i_clz64, "clz x3, x0") ST(i_clz32, "clz w3, w0")
ST(i_cls64, "cls x3, x0") ST(i_cls32, "cls w3, w0") ST(i_extr64, "extr x3, x0, x1, #13") ST(i_extr32, "extr w3, w0, w1, #7")
ST(i_extr0, "extr x3, x0, x1, #0") ST(i_adc, "adc x3, x0, x1") ST(i_adcs, "adcs x3, x0, x1") ST(i_adcw, "adcs w3, w0, w1")
ST(i_sbc, "sbc x3, x0, x1") ST(i_sbcs, "sbcs x3, x0, x1") ST(i_sbcw, "sbcs w3, w0, w1") ST(i_ngc, "ngcs x3, x1")
/* lane moves and constants */
VT(c_dup8, "dup v2.16b, w0") VT(c_dup16, "dup v2.8h, w1") VT(c_dup32, "dup v2.2s, w0") VT(c_dupd, "dup v2.2d, x1")
VT(c_dupe8, "dup v2.16b, v0.b[13]") VT(c_dupe32, "dup v2.4s, v1.s[3]") VT(c_dupe64, "dup v2.2d, v0.d[1]")
VT(c_ins8, "mov v2.b[9], w0") VT(c_ins64, "mov v2.d[1], x1") VT(c_inse, "mov v2.h[5], v0.h[2]") VT(c_inss, "mov v2.s[0], v1.s[3]")
ST(c_umov8, "umov w3, v0.b[11]") ST(c_umov16, "umov w3, v1.h[6]") ST(c_umov32, "mov w3, v0.s[2]") ST(c_umov64, "mov x3, v1.d[1]")
ST(c_smov8, "smov x3, v0.b[3]") ST(c_smov16w, "smov w3, v1.h[7]") ST(c_smov32, "smov x3, v0.s[1]")
VT(m_movi8, "movi v2.16b, #0xa5") VT(m_movi32, "movi v2.4s, #0x5c, lsl #16") VT(m_movi16, "movi v2.4h, #0x81, lsl #8")
VT(m_movid, "movi v2.2d, #0xff00ff0000ffff00") VT(m_moviD, "movi d2, #0x00ff00ff00ff00ff") VT(m_movimsl, "movi v2.4s, #0x3c, msl #8")
VT(m_mvni, "mvni v2.4s, #0x21, lsl #24") VT(m_mvnih, "mvni v2.8h, #0x7, lsl #0") VT(m_orr, "orr v2.4s, #0x77, lsl #8")
VT(m_bic, "bic v2.8h, #0x3c") VT(m_bic2s, "bic v2.2s, #0xff, lsl #24") VT(m_fmovv, "fmov v2.4s, #-1.25") VT(m_fmovd, "fmov v2.2d, #0.5")
/* three same */
VT(t_and, "and v2.16b, v0.16b, v1.16b") VT(t_bic, "bic v2.8b, v0.8b, v1.8b") VT(t_orr, "orr v2.16b, v0.16b, v1.16b")
VT(t_orn, "orn v2.16b, v0.16b, v1.16b") VT(t_eor, "eor v2.8b, v0.8b, v1.8b") VT(t_bsl, "bsl v2.16b, v0.16b, v1.16b")
VT(t_bit, "bit v2.16b, v0.16b, v1.16b") VT(t_bif, "bif v2.8b, v0.8b, v1.8b") VT(t_add8, "add v2.16b, v0.16b, v1.16b")
VT(t_add16, "add v2.4h, v0.4h, v1.4h") VT(t_add32, "add v2.4s, v0.4s, v1.4s") VT(t_add64, "add v2.2d, v0.2d, v1.2d")
VT(t_sub8, "sub v2.8b, v0.8b, v1.8b") VT(t_sub64, "sub v2.2d, v0.2d, v1.2d") VT(t_cmeq8, "cmeq v2.16b, v0.16b, v1.16b")
VT(t_cmeq64, "cmeq v2.2d, v0.2d, v1.2d") VT(t_cmtst, "cmtst v2.8h, v0.8h, v1.8h") VT(t_cmgt, "cmgt v2.4s, v0.4s, v1.4s")
VT(t_cmgt64, "cmgt v2.2d, v0.2d, v1.2d") VT(t_cmhi, "cmhi v2.16b, v0.16b, v1.16b") VT(t_cmge, "cmge v2.8h, v0.8h, v1.8h")
VT(t_cmhs, "cmhs v2.4s, v0.4s, v1.4s") VT(t_umax, "umax v2.16b, v0.16b, v1.16b") VT(t_smax, "smax v2.8h, v0.8h, v1.8h")
VT(t_umin, "umin v2.4s, v0.4s, v1.4s") VT(t_smin, "smin v2.8b, v0.8b, v1.8b") VT(t_mul16, "mul v2.8h, v0.8h, v1.8h")
VT(t_mul32, "mul v2.2s, v0.2s, v1.2s") VT(t_umaxp, "umaxp v2.16b, v0.16b, v1.16b") VT(t_umaxp8, "umaxp v2.8b, v0.8b, v1.8b")
VT(t_uminp, "uminp v2.4s, v0.4s, v1.4s") VT(t_smaxp, "smaxp v2.8h, v0.8h, v1.8h") VT(t_sminp, "sminp v2.2s, v0.2s, v1.2s")
VT(t_addp, "addp v2.16b, v0.16b, v1.16b") VT(t_addp64, "addp v2.2d, v0.2d, v1.2d") VT(t_addph, "addp v2.4h, v0.4h, v1.4h")
/* two-register misc */
VT(r_rev64, "rev64 v2.16b, v0.16b") VT(r_rev64s, "rev64 v2.4s, v0.4s") VT(r_rev32, "rev32 v2.8h, v0.8h") VT(r_rev16, "rev16 v2.8b, v0.8b")
VT(r_cnt, "cnt v2.16b, v0.16b") VT(r_not, "not v2.8b, v0.8b") VT(r_cmeqz, "cmeq v2.16b, v0.16b, #0") VT(r_cmgtz, "cmgt v2.4s, v0.4s, #0")
VT(r_cmgez, "cmge v2.8h, v0.8h, #0") VT(r_cmlez, "cmle v2.2d, v0.2d, #0") VT(r_cmltz, "cmlt v2.8b, v0.8b, #0") VT(r_neg, "neg v2.4s, v0.4s")
VT(r_xtn, "xtn v2.8b, v0.8h") VT(r_xtn2, "xtn2 v2.4s, v0.2d") VT(r_xtns, "xtn v2.4h, v0.4s")
/* across lanes */
VT(a_addv, "addv b2, v0.16b") VT(a_addvh, "addv h2, v0.4h") VT(a_addvs, "addv s2, v0.4s") VT(a_umaxv, "umaxv b2, v0.16b")
VT(a_smaxv, "smaxv h2, v0.8h") VT(a_uminv, "uminv s2, v0.4s") VT(a_sminv, "sminv b2, v0.8b") VT(a_uaddlv, "uaddlv h2, v0.16b")
VT(a_uaddlv8, "uaddlv h2, v0.8b") VT(a_saddlv, "saddlv s2, v0.8h") VT(a_uaddlvs, "uaddlv d2, v0.4s")
/* shifts */
VT(h_ushr, "ushr v2.16b, v0.16b, #3") VT(h_ushr8, "ushr v2.8b, v0.8b, #8") VT(h_sshr, "sshr v2.8h, v0.8h, #16")
VT(h_sshr32, "sshr v2.4s, v0.4s, #7") VT(h_ushr64, "ushr v2.2d, v0.2d, #63") VT(h_usra, "usra v2.4s, v0.4s, #9")
VT(h_ssra, "ssra v2.16b, v0.16b, #2") VT(h_shl, "shl v2.8h, v0.8h, #5") VT(h_shl64, "shl v2.2d, v0.2d, #33")
VT(h_shrn, "shrn v2.8b, v0.8h, #4") VT(h_shrn2, "shrn2 v2.8h, v0.4s, #16") VT(h_shrns, "shrn v2.2s, v0.2d, #31")
VT(h_ushll, "ushll v2.8h, v0.8b, #0") VT(h_ushll2, "ushll2 v2.4s, v0.8h, #3") VT(h_sshll, "sshll v2.2d, v0.2s, #0")
VT(h_sshll2, "sshll2 v2.8h, v0.16b, #7")
/* permute, ext, tbl */
VT(p_uzp1, "uzp1 v2.16b, v0.16b, v1.16b") VT(p_uzp2, "uzp2 v2.8h, v0.8h, v1.8h") VT(p_zip1, "zip1 v2.4s, v0.4s, v1.4s")
VT(p_zip2, "zip2 v2.8b, v0.8b, v1.8b") VT(p_trn1, "trn1 v2.16b, v0.16b, v1.16b") VT(p_trn2, "trn2 v2.4h, v0.4h, v1.4h")
VT(p_zip1d, "zip1 v2.2d, v0.2d, v1.2d") VT(p_uzp2s, "uzp2 v2.2s, v0.2s, v1.2s") VT(x_ext, "ext v2.16b, v0.16b, v1.16b, #5")
VT(x_ext8, "ext v2.8b, v0.8b, v1.8b, #3") VT(x_tbl, "and v1.16b, v1.16b, v3.16b\n tbl v2.16b, {v0.16b}, v1.16b")
VT(x_tbl8, "tbl v2.8b, {v0.16b}, v1.8b") VT(x_tbl2, "tbl v2.16b, {v0.16b, v1.16b}, v3.16b")
/* three different */
VT(d_uaddl, "uaddl v2.8h, v0.8b, v1.8b") VT(d_saddl2, "saddl2 v2.4s, v0.8h, v1.8h") VT(d_uaddw, "uaddw v2.2d, v0.2d, v1.2s")
VT(d_saddw2, "saddw2 v2.8h, v0.8h, v1.16b") VT(d_usubl, "usubl v2.4s, v0.4h, v1.4h") VT(d_ssubw, "ssubw v2.8h, v0.8h, v1.8b")
VT(d_umull, "umull v2.8h, v0.8b, v1.8b") VT(d_smull2, "smull2 v2.2d, v0.4s, v1.4s") VT(d_umull2, "umull2 v2.4s, v0.8h, v1.8h")
VT(s_addp, "addp d2, v0.2d") VT(s_dup, "mov s2, v0.s[3]") VT(s_dupd, "mov d2, v1.d[1]") VT(s_dupb, "mov b2, v0.b[15]")
/* floating point */
ST(f_fmovx, "fmov x3, d0") ST(f_fmovw, "fmov w3, s1") ST(f_fmovd, "fmov d2, x1") ST(f_fmovs, "fmov s2, w0")
ST(f_scvtf_dx, "scvtf d2, x0") ST(f_scvtf_sw, "scvtf s2, w1") ST(f_scvtf_sx, "scvtf s2, x0") ST(f_ucvtf_dx, "ucvtf d2, x1")
ST(f_ucvtf_sx, "ucvtf s2, x0") ST(f_ucvtf_dw, "ucvtf d2, w0")
ST(f_fcvtzs_xd, "fcvtzs x3, d0") ST(f_fcvtzs_ws, "fcvtzs w3, s1") ST(f_fcvtzu_xd, "fcvtzu x3, d1") ST(f_fcvtzu_ws, "fcvtzu w3, s0")
ST(f_fcvtzs_wd, "fcvtzs w3, d0") ST(f_fcvtns_xd, "fcvtns x3, d0") ST(f_fcvtas_wd, "fcvtas w3, d1") ST(f_fcvtms_xs, "fcvtms x3, s0")
ST(f_fcvtps_xd, "fcvtps x3, d1") ST(f_fcvtau_xd, "fcvtau x3, d0") ST(f_fcvtnu_ws, "fcvtnu w3, s1")
ST(f_fmovr, "fmov d2, d1") ST(f_fmovrs, "fmov s2, s0") ST(f_fabs, "fabs d2, d0") ST(f_fabss, "fabs s2, s1")
ST(f_fneg, "fneg d2, d1") ST(f_fnegs, "fneg s2, s0") ST(f_fsqrt, "fsqrt d2, d0") ST(f_fsqrts, "fsqrt s2, s1")
ST(f_fcvtsd, "fcvt s2, d0") ST(f_fcvtds, "fcvt d2, s1")
ST(f_frintn, "frintn d2, d0") ST(f_frintp, "frintp d2, d1") ST(f_frintm, "frintm s2, s0") ST(f_frintz, "frintz d2, d0")
ST(f_frinta, "frinta d2, d1") ST(f_frintx, "frintx s2, s1") ST(f_frinti, "frinti d2, d0") ST(f_frintas, "frinta s2, s0")
ST(f_fcmp, "fcmp d0, d1") ST(f_fcmps, "fcmp s0, s1") ST(f_fcmpz, "fcmp d1, #0.0") ST(f_fcmpe, "fcmpe s0, #0.0")
ST(f_fccmp, "fccmp d0, d1, #5, ne") ST(f_fccmps, "fccmp s1, s0, #12, hi")
ST(f_fmovi, "fmov d2, #-3.75") ST(f_fmovis, "fmov s2, #0.125")
ST(f_fmul, "fmul d2, d0, d1") ST(f_fmuls, "fmul s2, s0, s1") ST(f_fdiv, "fdiv d2, d0, d1") ST(f_fdivs, "fdiv s2, s1, s0")
ST(f_fadd, "fadd d2, d0, d1") ST(f_fadds, "fadd s2, s0, s1") ST(f_fsub, "fsub d2, d1, d0") ST(f_fsubs, "fsub s2, s0, s1")
ST(f_fmax, "fmax d2, d0, d1") ST(f_fmins, "fmin s2, s0, s1") ST(f_fmaxnm, "fmaxnm d2, d0, d1") ST(f_fminnms, "fminnm s2, s1, s0")
ST(f_fnmul, "fnmul d2, d0, d1") ST(f_fcsel, "fcsel d2, d0, d1, lt") ST(f_fcsels, "fcsel s2, s1, s0, eq")
ST(f_fmadd, "fmadd d2, d0, d1, d3") ST(f_fmsub, "fmsub d2, d0, d1, d3") ST(f_fnmadd, "fnmadd d2, d0, d1, d3")
ST(f_fnmsub, "fnmsub d2, d0, d1, d3") ST(f_fmadds, "fmadd s2, s0, s1, s3") ST(f_fnmsubs, "fnmsub s2, s1, s0, s3")

/* loads and stores of every SIMD size and addressing mode, on a fixed buffer */
static uint8_t buf[256] __attribute__((aligned(16)));
static void loads(void) {
  for (int i = 0; i < 256; i++) buf[i] = (uint8_t)(i * 37 + 11);
  v128 r[12];
  uint64_t base = (uint64_t)buf, post = 0, pre = 0;
  __asm__ volatile(
    "mov x9, %[b]\n"
    "ldr b0, [x9, #3]\n ldr h1, [x9, #6]\n ldr s2, [x9, #12]\n ldr d3, [x9, #24]\n ldr q4, [x9, #32]\n"
    "ldur q5, [x9, #7]\n ldur s6, [x9, #1]\n"
    "mov x10, #5\n ldr d7, [x9, x10, lsl #3]\n ldr q8, [x9, x10, lsl #4]\n"
    "ldp s9, s10, [x9, #8]\n ldp q11, q12, [x9, #64]\n"
    "str q0, [%[r]]\n str q1, [%[r], #16]\n str q2, [%[r], #32]\n str q3, [%[r], #48]\n str q4, [%[r], #64]\n"
    "str q5, [%[r], #80]\n str q6, [%[r], #96]\n str q7, [%[r], #112]\n str q8, [%[r], #128]\n"
    "stp q9, q10, [%[r], #144]\n str q11, [%[r], #176]\n"
    "add x11, x9, #128\n ldr q13, [x11], #16\n mov %[post], x11\n ldr d14, [x11, #8]!\n mov %[pre], x11\n"
    "st1 {v13.16b, v14.16b}, [x9], #32\n"
    "ld1 {v15.16b, v16.16b, v17.16b}, [x9]\n ld1r {v18.8h}, [x9]\n ld1 {v19.8b}, [x9], #8\n"
    "stp d15, d16, [x9, #96]\n str s17, [x9, #120]!\n str h18, [x9, #2]\n str b19, [x9, #5]\n"
    : [post] "=&r"(post), [pre] "=&r"(pre)
    : [b] "r"(base), [r] "r"(r)
    : "x9", "x10", "x11", "v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11", "v12",
      "v13", "v14", "v15", "v16", "v17", "v18", "v19", "memory");
  for (int i = 0; i < 12; i++) printf("ld %d %016llx%016llx\n", i, (unsigned long long)r[i].hi, (unsigned long long)r[i].lo);
  printf("ld post %lld pre %lld\n", (long long)(post - base), (long long)(pre - base));
  uint64_t h = 1469598103934665603ull;
  for (int i = 0; i < 256; i++) h = (h ^ buf[i]) * 1099511628211ull;
  printf("ld buf %016llx\n", (unsigned long long)h);
}

/* exclusives and ordered accesses, on one thread */
static void exclusives(void) {
  uint64_t word = 40, pair[2] __attribute__((aligned(16))) = {7, 9};
  uint32_t status = 9, status2 = 9;
  uint64_t got = 0, lo = 0, hi = 0, acq = 0;
  __asm__ volatile(
    "1: ldaxr %[got], [%[w]]\n add x9, %[got], #2\n stlxr %w[st], x9, [%[w]]\n cbnz %w[st], 1b\n"
    "ldxp %[lo], %[hi], [%[p]]\n add x9, %[lo], %[hi]\n stxp %w[st2], x9, %[lo], [%[p]]\n"
    "ldar %[acq], [%[w]]\n stlr %[acq], [%[p]]\n"
    : [got] "=&r"(got), [st] "=&r"(status), [lo] "=&r"(lo), [hi] "=&r"(hi), [st2] "=&r"(status2), [acq] "=&r"(acq)
    : [w] "r"(&word), [p] "r"(pair)
    : "x9", "memory");
  printf("excl %llu %u %llu %llu %u %llu word %llu pair %llu %llu\n", (unsigned long long)got, status, (unsigned long long)lo,
         (unsigned long long)hi, status2, (unsigned long long)acq, (unsigned long long)word, (unsigned long long)pair[0], (unsigned long long)pair[1]);
}

#define VLIST(X) X(c_dup8) X(c_dup16) X(c_dup32) X(c_dupd) X(c_dupe8) X(c_dupe32) X(c_dupe64) X(c_ins8) X(c_ins64) X(c_inse) X(c_inss) \
  X(m_movi8) X(m_movi32) X(m_movi16) X(m_movid) X(m_moviD) X(m_movimsl) X(m_mvni) X(m_mvnih) X(m_orr) X(m_bic) X(m_bic2s) X(m_fmovv) X(m_fmovd) \
  X(t_and) X(t_bic) X(t_orr) X(t_orn) X(t_eor) X(t_bsl) X(t_bit) X(t_bif) X(t_add8) X(t_add16) X(t_add32) X(t_add64) X(t_sub8) X(t_sub64) \
  X(t_cmeq8) X(t_cmeq64) X(t_cmtst) X(t_cmgt) X(t_cmgt64) X(t_cmhi) X(t_cmge) X(t_cmhs) X(t_umax) X(t_smax) X(t_umin) X(t_smin) X(t_mul16) X(t_mul32) \
  X(t_umaxp) X(t_umaxp8) X(t_uminp) X(t_smaxp) X(t_sminp) X(t_addp) X(t_addp64) X(t_addph) \
  X(r_rev64) X(r_rev64s) X(r_rev32) X(r_rev16) X(r_cnt) X(r_not) X(r_cmeqz) X(r_cmgtz) X(r_cmgez) X(r_cmlez) X(r_cmltz) X(r_neg) X(r_xtn) X(r_xtn2) X(r_xtns) \
  X(a_addv) X(a_addvh) X(a_addvs) X(a_umaxv) X(a_smaxv) X(a_uminv) X(a_sminv) X(a_uaddlv) X(a_uaddlv8) X(a_saddlv) X(a_uaddlvs) \
  X(h_ushr) X(h_ushr8) X(h_sshr) X(h_sshr32) X(h_ushr64) X(h_usra) X(h_ssra) X(h_shl) X(h_shl64) X(h_shrn) X(h_shrn2) X(h_shrns) X(h_ushll) X(h_ushll2) X(h_sshll) X(h_sshll2) \
  X(p_uzp1) X(p_uzp2) X(p_zip1) X(p_zip2) X(p_trn1) X(p_trn2) X(p_zip1d) X(p_uzp2s) X(x_ext) X(x_ext8) X(x_tbl) X(x_tbl8) X(x_tbl2) \
  X(d_uaddl) X(d_saddl2) X(d_uaddw) X(d_saddw2) X(d_usubl) X(d_ssubw) X(d_umull) X(d_smull2) X(d_umull2) X(s_addp) X(s_dup) X(s_dupd) X(s_dupb)
#define SLIST(X) X(i_rbit64) X(i_rbit32) X(i_rev16) X(i_rev32) X(i_rev64) X(i_revw) X(i_rev16w) X(i_clz64) X(i_clz32) X(i_cls64) X(i_cls32) \
  X(i_extr64) X(i_extr32) X(i_extr0) X(i_adc) X(i_adcs) X(i_adcw) X(i_sbc) X(i_sbcs) X(i_sbcw) X(i_ngc) \
  X(c_umov8) X(c_umov16) X(c_umov32) X(c_umov64) X(c_smov8) X(c_smov16w) X(c_smov32) \
  X(f_fmovx) X(f_fmovw) X(f_fmovd) X(f_fmovs) X(f_scvtf_dx) X(f_scvtf_sw) X(f_scvtf_sx) X(f_ucvtf_dx) X(f_ucvtf_sx) X(f_ucvtf_dw) \
  X(f_fcvtzs_xd) X(f_fcvtzs_ws) X(f_fcvtzu_xd) X(f_fcvtzu_ws) X(f_fcvtzs_wd) X(f_fcvtns_xd) X(f_fcvtas_wd) X(f_fcvtms_xs) X(f_fcvtps_xd) X(f_fcvtau_xd) X(f_fcvtnu_ws) \
  X(f_fmovr) X(f_fmovrs) X(f_fabs) X(f_fabss) X(f_fneg) X(f_fnegs) X(f_fsqrt) X(f_fsqrts) X(f_fcvtsd) X(f_fcvtds) \
  X(f_frintn) X(f_frintp) X(f_frintm) X(f_frintz) X(f_frinta) X(f_frintx) X(f_frinti) X(f_frintas) \
  X(f_fcmp) X(f_fcmps) X(f_fcmpz) X(f_fcmpe) X(f_fccmp) X(f_fccmps) X(f_fmovi) X(f_fmovis) \
  X(f_fmul) X(f_fmuls) X(f_fdiv) X(f_fdivs) X(f_fadd) X(f_fadds) X(f_fsub) X(f_fsubs) X(f_fmax) X(f_fmins) X(f_fmaxnm) X(f_fminnms) \
  X(f_fnmul) X(f_fcsel) X(f_fcsels) X(f_fmadd) X(f_fmsub) X(f_fnmadd) X(f_fnmsub) X(f_fmadds) X(f_fnmsubs)

int main(void) {
  fill();
#define RUNV(f) for (int i = 0; i < N; i++) { v128 o; f(&in_a[i], &in_b[i], &in_c[i], &o); printf(#f " %d %016llx%016llx\n", i, (unsigned long long)o.hi, (unsigned long long)o.lo); }
#define RUNS(f) for (int i = 0; i < N; i++) { sres o; f(&in_a[i], &in_b[i], &in_c[i], &o); printf(#f " %d %016llx %016llx%016llx %llx\n", i, (unsigned long long)o.x, (unsigned long long)o.v.hi, (unsigned long long)o.v.lo, (unsigned long long)o.nzcv); }
  VLIST(RUNV)
  SLIST(RUNS)
  loads();
  exclusives();
  return 0;
}
