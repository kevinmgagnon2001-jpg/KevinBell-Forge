/**
 * Random-program agreement. Each case is one random program written as x86-64 and as AArch64,
 * assembled by the real toolchains, with the expected output taken from running the x86-64 build
 * on real hardware (scripts/gen-compat-corpus.ts). Every case must give that output four ways:
 * x86 and ARM machine code, each through the reference interpreter and through WebAssembly.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runLinux } from "./linux.ts";

type Case = { id: number; x86: string; arm: string; expected: string };
const corpus = JSON.parse(readFileSync(new URL("../../../fixtures/compat-corpus.json", import.meta.url), "utf8")) as { cases: Case[] };

test(`random programs: x86, ARM, interpreter and WebAssembly all match the CPU (${corpus.cases.length} programs)`, () => {
  assert.ok(corpus.cases.length >= 100);
  for (const c of corpus.cases) {
    for (const arch of ["x86", "arm"] as const) {
      for (const engine of ["interpreter", "wasm"] as const) {
        const bytes = new Uint8Array(Buffer.from(c[arch], "base64"));
        const r = runLinux(bytes, { engine, memBytes: 8 * 1024 * 1024 });
        assert.equal(r.ok, true, `case ${c.id} ${arch} ${engine}: ${r.detail}`);
        assert.equal(Buffer.from(r.stdoutBytes).toString("hex"), c.expected, `case ${c.id} ${arch} ${engine}`);
      }
    }
  }
});

