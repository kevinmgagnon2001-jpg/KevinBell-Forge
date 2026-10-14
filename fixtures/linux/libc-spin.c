/*
 * Threads that wait by spinning, with no system call in the loop (work item N7): a flag handed back
 * and forth with C11 atomics, and a spinlock guarding a counter. A scheduler that switched threads
 * only at system calls would never get out of the first loop. Run on the real CPU to record it.
 */
#include <pthread.h>
#include <stdatomic.h>
#include <stdio.h>

static atomic_int turn;
static atomic_flag spin = ATOMIC_FLAG_INIT;
static long counter;

static void *ping(void *arg) {
  long me = (long)arg;
  for (int round = 0; round < 20; round++) {
    while (atomic_load(&turn) != me) {} /* no system call while waiting */
    atomic_store(&turn, 1 - me);
  }
  return NULL;
}

static void *add(void *arg) {
  (void)arg;
  for (int i = 0; i < 2000; i++) {
    while (atomic_flag_test_and_set(&spin)) {}
    counter++;
    atomic_flag_clear(&spin);
  }
  return NULL;
}

int main(void) {
  pthread_t a, b;
  pthread_create(&a, NULL, ping, (void *)0);
  pthread_create(&b, NULL, ping, (void *)1);
  pthread_join(a, NULL);
  pthread_join(b, NULL);
  printf("ping-pong finished, turn %d\n", atomic_load(&turn));
  pthread_t t[3];
  for (int i = 0; i < 3; i++) pthread_create(&t[i], NULL, add, NULL);
  for (int i = 0; i < 3; i++) pthread_join(t[i], NULL);
  printf("counter %ld\n", counter);
  return 0;
}
