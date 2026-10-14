import assert from "node:assert/strict";
import test from "node:test";
import { AT_REMOVEDIR, GuestFiles, MAX_OPEN, normalizePath, O_APPEND, O_CLOEXEC, O_CREAT, O_DIRECTORY, O_EXCL, O_RDWR, O_TRUNC, O_WRONLY, RENAME_EXCHANGE } from "./files.ts";
import { ABI, LinuxShim } from "./linux.ts";
import { GuestState } from "./machine.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

test("paths stay inside the tree", () => {
  assert.equal(normalizePath("in.txt"), "/in.txt");
  assert.equal(normalizePath("/a/./b//c/../d"), "/a/b/d");
  assert.equal(normalizePath("../../../etc/passwd"), "/etc/passwd");
  const files = new GuestFiles({ "notes/a.txt": "x" });
  assert.equal(files.open("../../../etc/passwd", 0), -2n);
  assert.equal(files.open("/notes", O_WRONLY), -21n, "a directory cannot be written");
  assert.deepEqual(files.statPath("notes"), { kind: "dir", size: 4096 });
  assert.equal(files.open("../notes/./a.txt", 0), 3n);
  assert.equal(files.open("notes/a.txt/..", 0), -20n, "a file is not a directory, even on the way through");
});

test("read, write, seek, append, truncate and holes behave like Linux", () => {
  const files = new GuestFiles({ "f": "abcdef" });
  const fd = Number(files.open("f", O_RDWR));
  assert.equal(dec.decode(files.read(fd, 4) as Uint8Array), "abcd");
  assert.equal(files.write(fd, enc.encode("XY")), 2n);
  assert.equal(files.lseek(fd, 10n, 0), 10n);
  assert.equal(files.write(fd, enc.encode("!")), 1n);
  assert.deepEqual(files.snapshot()["/f"], Uint8Array.from([97, 98, 99, 100, 88, 89, 0, 0, 0, 0, 33]));
  assert.equal(files.lseek(fd, -1n, 0), -22n);
  assert.equal(files.lseek(fd, 0n, 7), -22n);
  const ap = Number(files.open("f", O_WRONLY | O_APPEND));
  files.lseek(ap, 0n, 0);
  files.write(ap, enc.encode("end"));
  assert.equal(dec.decode(files.snapshot()["/f"]).slice(-4), "!end");
  assert.equal(files.read(ap, 1), -9n, "write-only");
  assert.equal(files.open("f", O_WRONLY | O_TRUNC), 5n);
  assert.equal(files.snapshot()["/f"].length, 0);
  assert.equal(files.open("f", O_WRONLY | O_CREAT | O_EXCL), -17n);
});

test("descriptors: lowest free first, a cap, and unlink keeps open contents", () => {
  const files = new GuestFiles({ "a": "data" });
  const fds: bigint[] = [];
  for (let i = 0; i < MAX_OPEN; i += 1) fds.push(files.open("a", 0));
  assert.equal(fds[0], 3n);
  assert.equal(files.open("a", 0), -24n);
  files.close(10);
  assert.equal(files.open("a", 0), 10n);
  assert.equal(files.close(10), 0n);
  assert.equal(files.close(10), -9n);
  assert.equal(files.unlink("a"), 0n);
  assert.equal(files.statPath("a"), -2n);
  assert.equal(dec.decode(files.read(3, 10) as Uint8Array), "data");
  assert.deepEqual(files.snapshot(), {});
});

test("directories: made, listed, walked relative to a descriptor, removed only when empty", () => {
  const files = new GuestFiles({ "src/main.c": "int main;", "empty/": "" });
  assert.deepEqual(Object.keys(files.snapshot()), ["/empty/", "/src/", "/src/main.c"]);
  assert.equal(files.mkdirAt(-100, "src/lib"), 0n);
  assert.equal(files.mkdirAt(-100, "src/lib"), -17n);
  assert.equal(files.mkdirAt(-100, "nope/lib"), -2n);
  const dir = Number(files.openAt(-100, "src", O_DIRECTORY));
  assert.equal(files.openAt(dir, "lib/x.h", O_WRONLY | O_CREAT), 4n);
  const names: string[] = [];
  const buf = files.getdents(dir, 4096) as Uint8Array;
  const v = new DataView(buf.buffer);
  for (let at = 0; at < buf.length; at += v.getUint16(at + 16, true)) {
    const end = buf.indexOf(0, at + 19);
    names.push(`${dec.decode(buf.subarray(at + 19, end))}:${buf[at + 18]}`);
  }
  assert.deepEqual(names, [".:4", "..:4", "lib:4", "main.c:8"]);
  assert.equal((files.getdents(dir, 4096) as Uint8Array).length, 0, "at the end");
  assert.equal(files.unlinkAt(-100, "src/lib", AT_REMOVEDIR), -39n);
  assert.equal(files.unlinkAt(dir, "lib/x.h", 0), 0n);
  assert.equal(files.unlinkAt(dir, "lib", AT_REMOVEDIR), 0n);
  assert.equal(files.unlinkAt(-100, "/", AT_REMOVEDIR), -16n);
  assert.equal(files.unlinkAt(-100, "src/main.c", AT_REMOVEDIR), -20n);
});

test("descriptors: dup shares the offset, dup3 replaces, close-on-exec stays with the descriptor", () => {
  const files = new GuestFiles({ "f": "abcdef" });
  const a = Number(files.open("f", O_RDWR));
  const b = Number(files.dup(a));
  files.read(a, 2);
  assert.equal(dec.decode(files.read(b, 2) as Uint8Array), "cd");
  assert.equal(files.dup3(a, 1, O_CLOEXEC), 1n, "stdout now goes to f");
  files.lseek(a, 0n, 2);
  files.write(1, enc.encode("!"));
  assert.equal(dec.decode(files.snapshot()["/f"]), "abcdef!");
  assert.equal(files.stdout.bytes().length, 0);
  assert.equal(files.fcntl(1, 1, 0n), 1n);
  assert.equal(files.fcntl(a, 1, 0n), 0n);
  assert.equal(files.dup3(a, a, 0), -22n);
  assert.equal(files.dup2(a, a), BigInt(a));
});

test("pipes: bytes in order, end of file once the writers close, EPIPE once the readers do", () => {
  const files = new GuestFiles();
  const [r, w] = files.pipe(0) as [number, number];
  assert.deepEqual([r, w], [3, 4]);
  assert.equal(files.read(r, 1), -11n, "empty with a writer open: would wait forever");
  files.write(w, enc.encode("ping"));
  assert.equal(dec.decode(files.read(r, 10) as Uint8Array), "ping");
  assert.equal(files.write(w, new Uint8Array(70000)), 65536n, "a pipe holds 64 KiB");
  assert.equal(files.write(w, enc.encode("x")), -11n);
  files.close(w);
  assert.equal((files.read(r, 70000) as Uint8Array).length, 65536);
  assert.equal((files.read(r, 1) as Uint8Array).length, 0, "end of file");
  const [r2, w2] = files.pipe(0) as [number, number];
  files.close(r2);
  assert.equal(files.write(w2, enc.encode("x")), -32n);
  assert.equal(files.lseek(w2, 0n, 0), -29n);
});

test("rename moves whole directories; descriptors follow, and one on a replaced directory finds nothing", () => {
  const files = new GuestFiles({ "a/x.txt": "x", "a/b/y.txt": "y", "empty/": "", "f": "file" });
  const inA = Number(files.openAt(-100, "a/b", O_DIRECTORY));
  const onEmpty = Number(files.openAt(-100, "empty", O_DIRECTORY));
  assert.equal(files.renameAt(-100, "a", -100, "empty", 0), 0n);
  assert.deepEqual(Object.keys(files.snapshot()), ["/empty/", "/empty/b/", "/empty/b/y.txt", "/empty/x.txt", "/f"]);
  assert.equal(dec.decode(files.read(Number(files.openAt(inA, "y.txt", 0)), 9) as Uint8Array), "y");
  assert.equal(files.openAt(onEmpty, "new.txt", O_WRONLY | O_CREAT), -2n, "its directory is gone");
  assert.equal(files.renameAt(-100, "f", -100, "empty", RENAME_EXCHANGE), 0n);
  assert.deepEqual(Object.keys(files.snapshot()), ["/empty", "/f/", "/f/b/", "/f/b/y.txt", "/f/x.txt"]);
  assert.equal(files.renameAt(-100, "f", -100, "f/b/c", 0), -22n);
  assert.equal(files.renameAt(-100, "f/b", -100, "f", 0), -39n, "onto its own non-empty parent");
});

/** Calls one system call on a bare shim, the way an engine would. */
function syscaller(arch: "x86_64" | "aarch64") {
  const mem = new Uint8Array(1 << 22);
  const state = new GuestState(mem);
  const shim = new LinuxShim(arch, 0x100000n, 0x300000n, undefined, { "data.bin": "0123456789" });
  const abi = ABI[arch];
  const nr = (name: string) => Number(Object.entries(abi.names).find(([, n]) => n === name)![0]);
  const call = (name: string, ...args: bigint[]) => {
    state.setReg(abi.nr, BigInt(nr(name)));
    args.forEach((v, i) => state.setReg(abi.args[i], v));
    shim.handle(state);
    return BigInt.asIntN(64, state.reg(abi.ret));
  };
  const str = (at: number, s: string) => mem.set(enc.encode(s + "\0"), at);
  return { mem, shim, call, str };
}

test("shared mappings: two views of one file and the file agree at every system call; private ones keep their own copy", () => {
  for (const arch of ["x86_64", "aarch64"] as const) {
    const { mem, shim, call, str } = syscaller(arch);
    str(0x2000, "data.bin");
    const fd = call(arch === "x86_64" ? "open" : "openat", ...(arch === "x86_64" ? [0x2000n, 2n] : [-100n, 0x2000n, 2n]));
    assert.equal(fd, 3n);
    const one = Number(call("mmap", 0n, 4096n, 3n, 1n, fd, 0n));
    const two = Number(call("mmap", 0n, 4096n, 3n, 1n, fd, 0n));
    const priv = Number(call("mmap", 0n, 4096n, 3n, 2n, fd, 0n));
    assert.notEqual(one, two);
    mem[one] = 65; // 'A' through the first view
    mem[two + 1] = 66; // 'B' through the second
    call("getpid");
    assert.equal(dec.decode(mem.subarray(one, one + 4)), "AB23");
    assert.equal(dec.decode(mem.subarray(two, two + 4)), "AB23");
    assert.equal(dec.decode(mem.subarray(priv, priv + 4)), "0123", "a private copy does not follow");
    assert.equal(call("munmap", BigInt(two), 4096n), 0n);
    mem[two + 2] = 67; // no longer mapped: the file never sees it
    mem[one + 3] = 68;
    call("getpid");
    assert.equal(dec.decode(shim.files.snapshot()["/data.bin"]), "AB2D456789");
    assert.equal(call("mmap", 0n, 4096n, 3n, 0n, fd, 0n), -22n);
    assert.equal(call("mmap", 0n, 4096n, 3n, 1n, fd, 1n), -22n);
  }
});

test("poll and select report the readiness Linux does", () => {
  const { mem, call } = syscaller("x86_64");
  assert.equal(call("pipe2", 0x2000n, 0n), 0n);
  const v = new DataView(mem.buffer);
  const [r, w] = [v.getInt32(0x2000, true), v.getInt32(0x2004, true)];
  const fds = [[r, 1], [w, 4], [99, 1], [-1, 1]];
  fds.forEach(([fd, ev], i) => {
    v.setInt32(0x3000 + i * 8, fd, true);
    v.setInt16(0x3004 + i * 8, ev, true);
  });
  assert.equal(call("poll", 0x3000n, 4n, -1n), 2n);
  assert.deepEqual([0, 1, 2, 3].map((i) => v.getInt16(0x3006 + i * 8, true)), [0, 4, 0x20, 0]);
  v.setBigUint64(0x4000, 1n << BigInt(r), true);
  assert.equal(call("select", BigInt(r + 1), 0x4000n, 0n, 0n, 0n), 0n);
  assert.equal(v.getBigUint64(0x4000, true), 0n);
  v.setBigUint64(0x4000, 1n << 50n, true);
  assert.equal(call("select", 51n, 0x4000n, 0n, 0n, 0n), -9n);
});
