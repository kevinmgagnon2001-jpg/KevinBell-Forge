import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { b64url } from "./island.ts";
import { emptyRegistry, loadRegistry, proposeSkill, route, type Skill } from "./skills.ts";

// (func $fact (param i64) (result i64) (local i64) ...) : iterative factorial, no imports
const FACT = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x06, 0x01, 0x60, 0x01, 0x7e, 0x01, 0x7e,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x08, 0x01, 0x04, 0x66, 0x61, 0x63, 0x74, 0x00, 0x00,
  0x0a, 0x29, 0x01, 0x27, 0x01, 0x01, 0x7e,
  0x42, 0x01, 0x21, 0x01,
  0x02, 0x40, 0x03, 0x40,
  0x20, 0x00, 0x42, 0x02, 0x53, 0x0d, 0x01,
  0x20, 0x01, 0x20, 0x00, 0x7e, 0x21, 0x01,
  0x20, 0x00, 0x42, 0x01, 0x7d, 0x21, 0x00,
  0x0c, 0x00, 0x0b, 0x0b,
  0x20, 0x01, 0x0b,
]);
// (func $spin (param i64) (result i64) loop br 0 end unreachable)
const SPIN = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x06, 0x01, 0x60, 0x01, 0x7e, 0x01, 0x7e,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x08, 0x01, 0x04, 0x66, 0x61, 0x63, 0x74, 0x00, 0x00,
  0x0a, 0x0a, 0x01, 0x08, 0x00, 0x03, 0x40, 0x0c, 0x00, 0x0b, 0x00, 0x0b,
]);

const factorial = (module: Uint8Array, expect = 120): Skill => ({
  name: "factorial",
  version: 1,
  description: "Factorial of a whole number n (n!).",
  examples: ["what is 5 factorial", "factorial of 10"],
  schema: { type: "object", properties: { n: { type: "integer", minimum: 0, maximum: 20 } }, required: ["n"] },
  impl: { kind: "wasm", module: b64url(module), export: "fact" },
  fixtures: [
    { args: { n: 5 }, expect },
    { args: { n: 0 }, expect: 1 },
  ],
  author: "cloud model",
});

test("a cloud-written skill is installed only after its fixtures pass, then runs offline through the router", async () => {
  const wrong = await proposeSkill(emptyRegistry(), factorial(FACT, 121));
  assert.equal(wrong.ok, false);
  assert.match(!wrong.ok ? wrong.reason : "", /fixture 1 expected 121 but got 120/);

  const accepted = await proposeSkill(emptyRegistry(), factorial(FACT));
  assert.equal(accepted.ok, true, !accepted.ok ? accepted.reason : "");

  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("offline"))) as typeof fetch;
  try {
    const ran = await route(accepted.registry, "what is 10 factorial?");
    assert.deepEqual(ran, { status: "ran", skill: "factorial", args: { n: 10 }, value: 3628800 });
    const outOfRange = await route(accepted.registry, "factorial of 99");
    assert.equal(outOfRange.status, "needs");
    const unknown = await route(accepted.registry, "book me a flight");
    assert.equal(unknown.status, "none");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a skill compiled for ARM Linux is accepted and runs on this machine", async () => {
  const elf = new Uint8Array(readFileSync(new URL("../../fixtures/skills/gcd-aarch64.elf", import.meta.url)));
  const gcd: Skill = {
    name: "gcd",
    version: 1,
    description: "Greatest common divisor of two integers a and b.",
    examples: ["gcd of 12 and 18", "greatest common divisor"],
    schema: { type: "object", properties: { a: { type: "integer" }, b: { type: "integer" } }, required: ["a", "b"] },
    impl: { kind: "linux", elf: b64url(elf) },
    fixtures: [{ args: { a: 12, b: 18 }, expect: 6 }, { args: { a: 17, b: 5 }, expect: 1 }],
  };
  const accepted = await proposeSkill(emptyRegistry(), gcd);
  assert.equal(accepted.ok, true, !accepted.ok ? accepted.reason : "");
  const ran = await route(accepted.registry, "greatest common divisor of 1071 and 462");
  assert.deepEqual(ran, { status: "ran", skill: "gcd", args: { a: 1071, b: 462 }, value: 21 });
});

test("the sandbox refuses imports, stops runaway code, and the router never trusts the picker", async () => {
  const withImport = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
    0x02, 0x0b, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x03, 0x6e, 0x65, 0x74, 0x00, 0x00,
  ]);
  const imp = await proposeSkill(emptyRegistry(), factorial(withImport));
  assert.match(!imp.ok ? imp.reason : "", /imports/);

  const spin = await proposeSkill(emptyRegistry(), factorial(SPIN));
  assert.match(!spin.ok ? spin.reason : "", /stopped after/);

  const installed = await proposeSkill(emptyRegistry(), factorial(FACT));
  assert.ok(installed.ok);
  const lying = await route(installed.registry, "anything", () => ({ skill: "factorial", args: { n: "rm -rf /" } }));
  assert.equal(lying.status, "needs");
  const ghost = await route(installed.registry, "anything", () => ({ skill: "shell", args: {} }));
  assert.equal(ghost.status, "none");
});

test("a saved registry is re-verified on load and versions only move forward", async () => {
  const installed = await proposeSkill(emptyRegistry(), factorial(FACT));
  assert.ok(installed.ok);
  const saved = JSON.parse(JSON.stringify(installed.registry));
  const loaded = await loadRegistry(saved);
  assert.deepEqual(loaded.dropped, []);
  saved.skills.factorial.impl.module = b64url(SPIN);
  const tampered = await loadRegistry(saved);
  assert.deepEqual(tampered.dropped, ["factorial"]);
  const again = await proposeSkill(installed.registry, factorial(FACT));
  assert.match(!again.ok ? again.reason : "", /already installed/);
});
