#!/usr/bin/env node
/**
 * Compiles src/engine/guest/f80/f80.c (x87 80-bit soft-float) to WebAssembly and writes the exported
 * functions' types and bodies to src/engine/guest/f80/f80-wasm.ts, which the lowerer (wasm.ts) embeds
 * in every guest module. Run after changing f80.c:
 *
 *   node scripts/build-f80.mjs
 *
 * Needs clang with the wasm32 target and wasm-ld. Refuses bodies that touch memory, globals or tables,
 * or call anything: each must be a pure function of its arguments, so the embedded copies need no
 * linking and the guest module stays import-free.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const src = join(root, "src/engine/guest/f80/f80.c");
const out = join(root, "src/engine/guest/f80/f80-wasm.ts");
const dir = mkdtempSync(join(tmpdir(), "f80-"));
const wasmPath = join(dir, "f80.wasm");
execFileSync("clang", [
  "--target=wasm32", "-O2", "-nostdlib", "-fvisibility=hidden", "-mmultivalue", "-Xclang", "-target-abi", "-Xclang", "experimental-mv",
  "-Wl,--no-entry", "-Wl,--export-dynamic", "-o", wasmPath, src,
]);
const bin = readFileSync(wasmPath);
rmSync(dir, { recursive: true, force: true });

let at = 8;
const uleb = () => {
  let v = 0, shift = 0, b;
  do { b = bin[at++]; v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
  return v >>> 0;
};
const sections = new Map();
while (at < bin.length) {
  const id = bin[at++];
  const size = uleb();
  sections.set(id, { start: at, end: at + size });
  at += size;
}
function within(id, fn) {
  const s = sections.get(id);
  if (!s) return [];
  at = s.start;
  return fn();
}
const types = within(1, () => {
  const n = uleb();
  const list = [];
  for (let i = 0; i < n; i += 1) {
    if (bin[at++] !== 0x60) throw new Error("unexpected type form");
    const params = Array.from({ length: uleb() }, () => bin[at++]);
    const results = Array.from({ length: uleb() }, () => bin[at++]);
    list.push({ params, results });
  }
  return list;
});
const funcTypes = within(3, () => Array.from({ length: uleb() }, () => uleb()));
const exports = within(7, () => {
  const n = uleb();
  const list = [];
  for (let i = 0; i < n; i += 1) {
    const len = uleb();
    const name = bin.subarray(at, at + len).toString("utf8");
    at += len;
    const kind = bin[at++];
    const index = uleb();
    if (kind === 0) list.push({ name, index });
  }
  return list;
});
const bodies = within(10, () => {
  const n = uleb();
  const list = [];
  for (let i = 0; i < n; i += 1) {
    const size = uleb();
    list.push(Uint8Array.from(bin.subarray(at, at + size)));
    at += size;
  }
  return list;
});
if (bodies.length !== exports.length) throw new Error(`${bodies.length} functions for ${exports.length} exports: something was not inlined`);

/** Walk a body's instructions; throw on anything that is not a pure computation on locals. */
function check(name, body) {
  let p = 0;
  const leb = () => { let b; do { b = body[p++]; } while (b & 0x80); };
  const nLocals = (() => { let v = 0, s = 0, b; do { b = body[p++]; v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return v; })();
  for (let i = 0; i < nLocals; i += 1) { leb(); p += 1; }
  while (p < body.length) {
    const op = body[p++];
    if (op === 0x10 || op === 0x11 || (op >= 0x23 && op <= 0x26) || (op >= 0x28 && op <= 0x40) || op === 0xfd) {
      throw new Error(`${name}: instruction 0x${op.toString(16)} at ${p - 1} is not allowed (call, global, table or memory)`);
    }
    if (op === 0x02 || op === 0x03 || op === 0x04) { const t = body[p]; if (t === 0x40 || t >= 0x7b) p += 1; else leb(); }
    else if (op === 0x0c || op === 0x0d || op === 0x20 || op === 0x21 || op === 0x22) leb();
    else if (op === 0x0e) { let v = 0, s = 0, b; do { b = body[p++]; v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); for (let i = 0; i <= v; i += 1) leb(); }
    else if (op === 0x1c) { let v = 0, s = 0, b; do { b = body[p++]; v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); p += v; }
    else if (op === 0x41 || op === 0x42) leb();
    else if (op === 0x43) p += 4;
    else if (op === 0x44) p += 8;
    else if (op === 0xfc) { let v = 0, s = 0, b; do { b = body[p++]; v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); if (v > 7) throw new Error(`${name}: 0xfc ${v} is not allowed`); }
  }
}

const valName = { 0x7f: "I32", 0x7e: "I64" };
const funcs = exports
  .sort((a, b) => a.index - b.index)
  .map(({ name, index }) => {
    const body = bodies[index];
    check(name, body);
    const t = types[funcTypes[index]];
    for (const v of [...t.params, ...t.results]) if (!valName[v]) throw new Error(`${name}: only i32 and i64 values are expected`);
    return { name, params: t.params, results: t.results, body: Buffer.from(body).toString("base64") };
  });

const lines = [
  "/**",
  " * GENERATED by scripts/build-f80.mjs from f80.c (x87 80-bit soft-float, compiled to WebAssembly).",
  " * Do not edit: change f80.c and run `node scripts/build-f80.mjs`. Every body is a pure function of",
  " * its arguments (no memory, globals, tables or calls); the lowerer appends them to each module.",
  " */",
  "export type F80Func = { name: string; params: number[]; results: number[]; body: string };",
  "/** SHA-256 of the f80.c these were built from (a test checks it is current). */",
  `export const F80_SOURCE_SHA256 = ${JSON.stringify(createHash("sha256").update(readFileSync(src)).digest("hex"))};`,
  "",
  "export const F80_FUNCS: F80Func[] = [",
  ...funcs.map((f) => `  { name: ${JSON.stringify(f.name)}, params: [${f.params.join(", ")}], results: [${f.results.join(", ")}], body: ${JSON.stringify(f.body)} },`),
  "];",
  "",
];
writeFileSync(out, lines.join("\n"));
console.log(`${funcs.length} functions, ${funcs.reduce((n, f) => n + Buffer.from(f.body, "base64").length, 0)} bytes of code -> ${out}`);
