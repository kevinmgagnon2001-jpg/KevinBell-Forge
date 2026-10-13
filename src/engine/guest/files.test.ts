import assert from "node:assert/strict";
import test from "node:test";
import { AT_REMOVEDIR, GuestFiles, MAX_OPEN, normalizePath, O_APPEND, O_CLOEXEC, O_CREAT, O_DIRECTORY, O_EXCL, O_RDWR, O_TRUNC, O_WRONLY } from "./files.ts";

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
