import assert from "node:assert/strict";
import test from "node:test";
import { GuestFiles, MAX_OPEN, normalizePath, O_APPEND, O_CREAT, O_EXCL, O_RDWR, O_TRUNC, O_WRONLY } from "./files.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

test("paths stay inside the tree", () => {
  assert.equal(normalizePath("in.txt"), "/in.txt");
  assert.equal(normalizePath("/a/./b//c/../d"), "/a/b/d");
  assert.equal(normalizePath("../../../etc/passwd"), "/etc/passwd");
  const files = new GuestFiles({ "notes/a.txt": "x" });
  assert.equal(files.open("../../../etc/passwd", 0), -2n);
  assert.equal(files.open("/notes", 0), -21n, "a directory is not a file");
  assert.deepEqual(files.statPath("notes"), { dir: true, size: 4096 });
  assert.equal(files.open("../notes/./a.txt", 0), 3n);
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
