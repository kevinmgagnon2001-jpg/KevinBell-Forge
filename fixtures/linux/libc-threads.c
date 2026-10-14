/*
 * Threads the ordinary way, statically linked against glibc (work item N7, fifth part):
 * pthread_create/join, a mutex-protected counter, a condition variable (producer and consumer),
 * a barrier, pthread_once, thread-local storage, distinct thread ids, and return values.
 * The output does not depend on how the threads interleave. Run on the real CPU to record it.
 */
#define _GNU_SOURCE
#include <pthread.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/syscall.h>

#define WORKERS 4

static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static long counter;
static __thread int mine = 7;
static pthread_once_t once = PTHREAD_ONCE_INIT;
static int once_runs;
static pthread_barrier_t barrier;
static long tids[WORKERS];

static void init_once(void) { once_runs++; }

static void *worker(void *arg) {
  long id = (long)arg;
  mine += (int)id; /* each thread has its own copy */
  pthread_once(&once, init_once);
  tids[id] = syscall(SYS_gettid);
  long sum = 0;
  for (long i = 1; i <= 1000 * (id + 1); i++) sum += i;
  for (int i = 0; i < 1000; i++) {
    pthread_mutex_lock(&lock);
    counter++;
    pthread_mutex_unlock(&lock);
  }
  pthread_barrier_wait(&barrier);
  long *out = malloc(sizeof *out);
  *out = sum * 10 + mine;
  return out;
}

/* A bounded queue between one producer and one consumer. */
static pthread_mutex_t qlock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t not_empty = PTHREAD_COND_INITIALIZER, not_full = PTHREAD_COND_INITIALIZER;
static int queue[4], qhead, qcount;

static void *producer(void *arg) {
  (void)arg;
  for (int i = 1; i <= 50; i++) {
    pthread_mutex_lock(&qlock);
    while (qcount == 4) pthread_cond_wait(&not_full, &qlock);
    queue[(qhead + qcount++) % 4] = i * i;
    pthread_cond_signal(&not_empty);
    pthread_mutex_unlock(&qlock);
  }
  return NULL;
}

static void *consumer(void *arg) {
  long total = 0;
  for (int i = 0; i < 50; i++) {
    pthread_mutex_lock(&qlock);
    while (qcount == 0) pthread_cond_wait(&not_empty, &qlock);
    total += queue[qhead];
    qhead = (qhead + 1) % 4;
    qcount--;
    pthread_cond_signal(&not_full);
    pthread_mutex_unlock(&qlock);
  }
  *(long *)arg = total;
  return NULL;
}

static void *square(void *arg) { return (void *)((long)arg * (long)arg); }

static void *forever(void *arg) {
  (void)arg;
  for (;;) sched_yield();
  return NULL;
}

int main(void) {
  pthread_t t[WORKERS];
  pthread_barrier_init(&barrier, NULL, WORKERS);
  for (long i = 0; i < WORKERS; i++)
    if (pthread_create(&t[i], NULL, worker, (void *)i)) { printf("pthread_create failed\n"); return 1; }
  for (int i = 0; i < WORKERS; i++) {
    void *ret;
    pthread_join(t[i], &ret);
    printf("worker %d returned %ld\n", i, *(long *)ret);
    free(ret);
  }
  printf("counter: %ld\n", counter);
  printf("once ran %d time(s)\n", once_runs);
  printf("main's thread-local value: %d\n", mine);
  long me = syscall(SYS_gettid);
  int distinct = 1;
  for (int i = 0; i < WORKERS; i++) {
    if (tids[i] == me) distinct = 0;
    for (int j = 0; j < i; j++) if (tids[i] == tids[j]) distinct = 0;
  }
  printf("thread ids distinct: %d, main is the process: %d\n", distinct, me == getpid());

  pthread_t p, c;
  long total = 0;
  pthread_create(&c, NULL, consumer, &total);
  pthread_create(&p, NULL, producer, NULL);
  pthread_join(p, NULL);
  pthread_join(c, NULL);
  printf("consumer got %ld (expected %d)\n", total, 50 * 51 * 101 / 6);

  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_JOINABLE);
  pthread_attr_setstacksize(&attr, 64 * 1024);
  pthread_t small;
  long arg = 3;
  int made = pthread_create(&small, &attr, square, (void *)arg) == 0;
  void *ret;
  pthread_join(small, &ret);
  printf("small stack thread: %d returned %ld\n", made, (long)ret);

  /* A detached thread still running when main returns: exit ends the whole process. */
  pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
  pthread_create(&small, &attr, forever, NULL);
  printf("main returns\n");
  return 0;
}
