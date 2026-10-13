/**
 * x86-64 programs exercising what glibc needs (SSE2, adc/sbb, rotates, bit tests, bsf/tzcnt,
 * cmpxchg/xadd, bswap, high-byte registers, 8/16-bit arithmetic, fs: thread-local storage, string
 * moves). Expected bytes come from running each program on real hardware (scripts/gen-x86-corpus.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runLinux } from "./linux.ts";

type Case = { id: number; elf: string; expected: string; asm: string };
const corpus = JSON.parse(readFileSync(new URL("../../../fixtures/x86-corpus.json", import.meta.url), "utf8")) as { cases: Case[] };

test(`x86 extended instruction set: interpreter and WebAssembly match the CPU (${corpus.cases.length} programs)`, () => {
  assert.ok(corpus.cases.length >= 100);
  for (const c of corpus.cases) {
    for (const engine of ["interpreter", "wasm"] as const) {
      const r = runLinux(new Uint8Array(Buffer.from(c.elf, "base64")), { engine, memBytes: 8 * 1024 * 1024 });
      assert.equal(r.ok, true, `case ${c.id} ${engine}: ${r.detail}`);
      assert.equal(Buffer.from(r.stdoutBytes).toString("hex"), c.expected, `case ${c.id} ${engine}`);
    }
  }
});
