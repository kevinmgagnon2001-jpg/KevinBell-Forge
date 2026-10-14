#!/bin/sh
# Rebuilds the Linux fixtures. Needs gcc, clang (with the aarch64 target), as, ld and ld.lld.
# The x86-64 binaries run on the build machine to record the expected output.
set -e
cd "$(dirname "$0")"
BASE="-static -nostdlib -ffreestanding -fno-pic -fno-stack-protector -fno-asynchronous-unwind-tables -mgeneral-regs-only -fno-builtin -s"
as hello-x86_64.s -o /tmp/hx.o && ld -static -n -s /tmp/hx.o -o hello-x86_64.elf
clang --target=aarch64-linux-gnu -c hello-aarch64.s -o /tmp/ha.o && ld.lld -static -n -s /tmp/ha.o -o hello-aarch64.elf
# The same C program from two compilers, two architectures and several optimization levels.
gcc -O2 $BASE -no-pie workload.c -o workload-x86_64.elf
gcc -O0 $BASE -no-pie workload.c -o workload-x86_64-gcc-O0.elf
gcc -Os $BASE -no-pie workload.c -o workload-x86_64-gcc-Os.elf
gcc -O3 $BASE -no-pie workload.c -o workload-x86_64-gcc-O3.elf
clang -O1 $BASE -no-pie workload.c -o workload-x86_64-clang-O1.elf
clang --target=aarch64-linux-gnu -O2 $BASE -fuse-ld=lld workload.c -o workload-aarch64.elf
clang --target=aarch64-linux-gnu -O0 $BASE -fuse-ld=lld workload.c -o workload-aarch64-clang-O0.elf
clang --target=aarch64-linux-gnu -O3 $BASE -fuse-ld=lld workload.c -o workload-aarch64-clang-O3.elf
./hello-x86_64.elf > hello.expected
set +e
printf 'abc' | ./workload-x86_64.elf > workload.expected; echo $? > workload.exitcode
for f in workload-x86_64-*.elf; do printf 'abc' | ./$f | cmp -s - workload.expected || echo "MISMATCH on hardware: $f"; done
ls -l *.elf

# glibc, linked statically: printf, malloc, qsort, strings, thread-local storage, SSE2, floating point.
gcc -static -O2 -no-pie -s libc-demo.c -o libc-demo-x86_64.elf
gcc -static -O2 -no-pie -s libc-float.c -o libc-float-x86_64.elf -lm
printf 'abc' | ./libc-demo-x86_64.elf > libc-demo.expected 2> libc-demo.stderr
./libc-float-x86_64.elf > libc-float.expected
ls -l libc-*.elf

# Files (work item N7): the same program with raw system calls on both architectures, and glibc stdio.
# Each runs in a fresh directory holding only in.txt; the files it leaves behind are recorded too.
gcc -O2 $BASE -no-pie files.c -o files-x86_64.elf
clang --target=aarch64-linux-gnu -O2 $BASE -fuse-ld=lld files.c -o files-aarch64.elf
gcc -static -O2 -no-pie -s libc-files.c -o libc-files-x86_64.elf
run_in_tree() {
  dir="$(mktemp -d)"; cp files-in.txt "$dir/in.txt"; cp "$1" "$dir/prog"
  (cd "$dir" && ./prog > stdout; echo $? > exitcode)
  echo "$dir"
}
d="$(run_in_tree files-x86_64.elf)"
cp "$d/stdout" files.expected; cp "$d/exitcode" files.exitcode; cp "$d/out.txt" files.out.txt; rm -rf "$d"
d="$(run_in_tree libc-files-x86_64.elf)"
cp "$d/stdout" libc-files.expected; cp "$d/report.txt" libc-files.report.txt; rm -rf "$d"
ls -l files-*.elf libc-files-*.elf

# Directories, descriptors and pipes (N7, second part): the same raw-syscall program on both
# architectures and a glibc one. The tree each leaves behind is recorded as "d /path" for a directory
# and "f /path <size>" followed by the contents and a newline for a file.
gcc -O2 $BASE -no-pie dirs.c -o dirs-x86_64.elf
clang --target=aarch64-linux-gnu -O2 $BASE -fuse-ld=lld dirs.c -o dirs-aarch64.elf
gcc -static -O2 -no-pie -s libc-dirs.c -o libc-dirs-x86_64.elf
dump_tree() {
  (cd "$1" && find . -mindepth 1 \( -name prog -o -name stdout -o -name exitcode \) -prune -o -print | LC_ALL=C sort | while read -r p; do
    if [ -L "$p" ]; then echo "l ${p#.} $(readlink "$p")"; elif [ -d "$p" ]; then echo "d ${p#.}"; else echo "f ${p#.} $(wc -c < "$p")"; cat "$p"; echo; fi
  done)
}
for prog in dirs libc-dirs; do
  d="$(run_in_tree $prog-x86_64.elf)"
  cp "$d/stdout" $prog.expected; cp "$d/exitcode" $prog.exitcode; dump_tree "$d" > $prog.tree; rm -rf "$d"
done
ls -l dirs-*.elf libc-dirs-*.elf

# Mapped files, renames and readiness (N7, third part): file-backed mmap, msync, ftruncate,
# rename/renameat2, ppoll/pselect6. The same raw-syscall program on both architectures and a glibc one.
gcc -O2 $BASE -no-pie mapio.c -o mapio-x86_64.elf
clang --target=aarch64-linux-gnu -O2 $BASE -fuse-ld=lld mapio.c -o mapio-aarch64.elf
gcc -static -O2 -no-pie -s libc-mapio.c -o libc-mapio-x86_64.elf
for prog in mapio libc-mapio; do
  d="$(run_in_tree $prog-x86_64.elf)"
  cp "$d/stdout" $prog.expected; cp "$d/exitcode" $prog.exitcode; dump_tree "$d" > $prog.tree; rm -rf "$d"
done
ls -l mapio-*.elf libc-mapio-*.elf

# Symbolic and hard links (N7, fourth part). Links appear in the tree as "l /path target".
gcc -O2 $BASE -no-pie links.c -o links-x86_64.elf
clang --target=aarch64-linux-gnu -O2 $BASE -fuse-ld=lld links.c -o links-aarch64.elf
gcc -static -O2 -no-pie -s libc-links.c -o libc-links-x86_64.elf
for prog in links libc-links; do
  d="$(run_in_tree $prog-x86_64.elf)"
  cp "$d/stdout" $prog.expected; cp "$d/exitcode" $prog.exitcode; dump_tree "$d" > $prog.tree; rm -rf "$d"
done
ls -l links-*.elf libc-links-*.elf

# Threads (N7, fifth part): glibc pthreads. The output does not depend on the interleaving.
gcc -static -O2 -no-pie -s -pthread libc-threads.c -o libc-threads-x86_64.elf
./libc-threads-x86_64.elf > libc-threads.expected; echo $? > libc-threads.exitcode
ls -l libc-threads-*.elf
gcc -static -O2 -no-pie -s -pthread libc-spin.c -o libc-spin-x86_64.elf
./libc-spin-x86_64.elf > libc-spin.expected; echo $? > libc-spin.exitcode

# SSE2 integer (N8): every packed-integer form over special and random inputs, and zlib as a real
# program that uses them (needs libz.a).
gcc -static -O1 -no-pie -s sse2.c -o sse2-x86_64.elf
./sse2-x86_64.elf > sse2.expected; echo $? > sse2.exitcode
gcc -static -O2 -no-pie -s zlib-demo.c -o zlib-demo-x86_64.elf -lz
./zlib-demo-x86_64.elf > zlib-demo.expected

# x87 floating point (N8): 80-bit arithmetic, conversions, compares and rounding modes as raw bits;
# 8/16-bit rotates; sqlite as a real program that needs x87 (needs libsqlite3.a).
gcc -static -O1 -no-pie -s x87.c -o x87-x86_64.elf -lm
./x87-x86_64.elf > x87.expected; echo $? > x87.exitcode
gcc -static -O1 -no-pie -s rotate.c -o rotate-x86_64.elf
./rotate-x86_64.elf > rotate.expected
gcc -static -O2 -no-pie -s sqlite-demo.c -o sqlite-demo-x86_64.elf -lsqlite3 -lm
./sqlite-demo-x86_64.elf > sqlite-demo.expected
