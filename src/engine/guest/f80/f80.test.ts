import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { F80_SOURCE_SHA256 } from "./f80-wasm.ts";
import { f80Call } from "./f80.ts";

test("the embedded x87 soft-float was built from the current f80.c (run scripts/build-f80.mjs after changing it)", () => {
  const sha = createHash("sha256").update(readFileSync(new URL("./f80.c", import.meta.url))).digest("hex");
  assert.equal(F80_SOURCE_SHA256, sha);
});

test("the soft-float answers through the interpreter's loader", () => {
  // 1/3 in extended precision, and 2 + 2
  assert.deepEqual(f80Call("f80_div", [1n << 63n, 0x3fffn, 3n << 62n, 0x4000n, 0x37fn]), [0xaaaaaaaaaaaaaaabn, 0x3ffdn]);
  assert.deepEqual(f80Call("f80_add", [1n << 63n, 0x4000n, 1n << 63n, 0x4000n, 0x37fn]), [1n << 63n, 0x4001n]);
  assert.equal(f80Call("f80_to_f64", [1n << 63n, 0x3fffn, 0x37fn])[0], 0x3ff0000000000000n);
});
