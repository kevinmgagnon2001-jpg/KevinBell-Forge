import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { aheadKey, AOT_VERSION, compileAhead, decodeAhead, encodeAhead, type AheadBuild } from "./aot.ts";
import { lift } from "./lift.ts";
import { prepareLinux, runLinux } from "./linux.ts";
import { lowerProgram } from "./wasm.ts";

const path = (name: string) => new URL(`../../../fixtures/linux/${name}`, import.meta.url);
const fixture = (name: string) => new Uint8Array(readFileSync(path(name)));

// Small and large, both architectures, glibc included.
const PROGRAMS = ["hello-x86_64.elf", "hello-aarch64.elf", "libc-demo-x86_64.elf", "libc-demo-aarch64.elf", "zlib-demo-x86_64.elf", "zlib-demo-aarch64.elf"].filter((name) => existsSync(path(name)));

test("a build made ahead of time runs like the usual path, and needs no lifting while it runs", () => {
  assert.ok(PROGRAMS.length >= 4, "fixtures present");
  for (const name of PROGRAMS) {
    const bytes = fixture(name);
    const usual = runLinux(bytes, { engine: "wasm", stdin: "abc" });
    const build = compileAhead(bytes);
    const ahead = runLinux(bytes, { engine: "wasm", stdin: "abc", ahead: build });
    assert.equal(ahead.stdout, usual.stdout, `${name}: same output`);
    assert.equal(ahead.exitCode, usual.exitCode, `${name}: same exit code`);
    assert.equal(ahead.stop, usual.stop, name);
    assert.ok(ahead.relifts <= usual.relifts, `${name}: ahead ${ahead.relifts} relifts, usual ${usual.relifts}`);
    assert.equal(ahead.relifts, 0, `${name}: the static pass found all the code it ran`);
    assert.ok(build.insns > 0 && build.passes >= 1);
  }
});

test("code the build missed falls back to lifting, and the run still finishes correctly", () => {
  const bytes = fixture("libc-demo-x86_64.elf");
  const prepared = prepareLinux(bytes);
  assert.ok(prepared.ok);
  // A deliberately partial build: a few hundred instructions from the entry point.
  lift(prepared.program, prepared.fetch, [prepared.entry], 300);
  const partial: AheadBuild = {
    v: AOT_VERSION,
    arch: prepared.arch,
    memBytes: prepared.memBytes,
    bytes: lowerProgram(prepared.program, prepared.memBytes, { importMemory: true }).bytes,
    roots: [prepared.entry],
    insns: prepared.program.insns.size,
    gaps: 0,
    passes: 1,
  };
  const usual = runLinux(bytes, { engine: "wasm", stdin: "abc" });
  const report = runLinux(bytes, { engine: "wasm", stdin: "abc", ahead: partial });
  assert.ok(report.relifts > 0, "it had to lift");
  assert.equal(report.stdout, usual.stdout);
  assert.equal(report.exitCode, usual.exitCode);
});

test("a build for another memory size or architecture is ignored", () => {
  const bytes = fixture("hello-x86_64.elf");
  const arm = compileAhead(fixture("hello-aarch64.elf"));
  const report = runLinux(bytes, { engine: "wasm", ahead: arm });
  assert.equal(report.stdout, runLinux(bytes, { engine: "wasm" }).stdout);
  const small = compileAhead(bytes, { memBytes: 32 * 1024 * 1024 });
  assert.equal(runLinux(bytes, { engine: "wasm", ahead: small }).exitCode, 0);
});

test("the cache file round-trips, and damaged or old files are refused", async () => {
  const build = compileAhead(fixture("hello-aarch64.elf"));
  const file = encodeAhead(build);
  const back = decodeAhead(file);
  assert.ok(back);
  assert.deepEqual(back.roots, build.roots);
  assert.deepEqual(back.bytes, build.bytes);
  assert.equal(back.insns, build.insns);
  assert.equal(decodeAhead(file.slice(0, file.length - 10)), null, "cut short");
  const old = file.slice();
  const header = new TextDecoder().decode(old.subarray(8, 8 + new DataView(old.buffer).getUint32(4, true)));
  old.set(new TextEncoder().encode(header.replace(`"v":${AOT_VERSION}`, `"v":${AOT_VERSION + 1}`).slice(0, header.length)), 8);
  assert.equal(decodeAhead(old), null, "another format version");
  assert.equal(decodeAhead(new Uint8Array([1, 2, 3])), null);
  const key = await aheadKey(fixture("hello-aarch64.elf"));
  assert.match(key, new RegExp(`^[0-9a-f]{64}-m16-v${AOT_VERSION}$`));
  assert.equal(key, await aheadKey(fixture("hello-aarch64.elf")));
  assert.notEqual(key, await aheadKey(fixture("hello-x86_64.elf")));
});
