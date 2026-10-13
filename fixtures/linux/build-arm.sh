#!/bin/sh
# ARM64 hardware oracle (work item N6). Run ON an ARM64 Linux machine (CI: ubuntu-24.04-arm):
# builds the glibc fixtures natively with gcc, static, and runs them on the real CPU to record what
# they print (<name>.arm.expected), their exit code and, for the file programs, the tree they leave.
#   sh fixtures/linux/build-arm.sh <out-dir>
set -e
[ "$(uname -m)" = "aarch64" ] || { echo "run this on an ARM64 machine"; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"
out="$(mkdir -p "$1" && cd "$1" && pwd)"
cd "$here"
gcc -static -O2 -s libc-demo.c -o "$out/libc-demo-aarch64.elf"
gcc -static -O2 -s libc-float.c -o "$out/libc-float-aarch64.elf" -lm
gcc -static -O2 -s libc-files.c -o "$out/libc-files-aarch64.elf"
gcc -static -O2 -s libc-dirs.c -o "$out/libc-dirs-aarch64.elf"
set +e
for p in libc-demo libc-float; do
  printf 'abc' | "$out/$p-aarch64.elf" > "$out/$p.arm.expected"; echo $? > "$out/$p.arm.exitcode"
done
dump_tree() {
  (cd "$1" && find . -mindepth 1 \( -name prog -o -name stdout -o -name exitcode \) -prune -o -print | LC_ALL=C sort | while read -r p; do
    if [ -d "$p" ]; then echo "d ${p#.}"; else echo "f ${p#.} $(wc -c < "$p")"; cat "$p"; echo; fi
  done)
}
for p in libc-files libc-dirs; do
  d="$(mktemp -d)"; cp files-in.txt "$d/in.txt"; cp "$out/$p-aarch64.elf" "$d/prog"
  (cd "$d" && ./prog < /dev/null > stdout; echo $? > exitcode)
  cp "$d/stdout" "$out/$p.arm.expected"; cp "$d/exitcode" "$out/$p.arm.exitcode"; dump_tree "$d" > "$out/$p.arm.tree"; rm -rf "$d"
done
ls -l "$out"
