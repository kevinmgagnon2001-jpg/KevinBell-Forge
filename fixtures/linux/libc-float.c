#include <stdio.h>
#include <math.h>
int main(void) {
  double x = 0; for (int i = 1; i <= 20; i++) x += 1.0 / (i * i);
  printf("sum=%.6f sqrt2=%.9f pi~%.4f big=%e int=%d\n", x, sqrt(2.0), 4 * atan(1.0), 6.02e23, (int)(x * 1000));
  float f = 1.5f; f *= 3.25f; printf("float %g %.3f\n", f, (double)f / 7);
  return 0;
}
