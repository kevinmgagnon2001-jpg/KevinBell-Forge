import assert from "node:assert/strict";
import test from "node:test";
import { acceptLowering, compatCommand, encode, flagshipFixture, hex, readProgram, SAMPLE } from "./isa.ts";
import { labWorld } from "./manifold.ts";
import { runHarness } from "./vm.ts";

test("the same program lowers to x86 and arm and runs once", () => {
  const world = labWorld();
  const x86 = SAMPLE.flatMap((op) => encode(op, "x86_64") ?? []);
  const arm = SAMPLE.flatMap((op) => encode(op, "aarch64") ?? []);
  assert.equal(hex(x86), "48 b8 09 00 00 00 48 83 c0 02 c3");
  assert.equal(hex(arm), "20 01 80 d2 00 08 00 91 c0 03 5f d6");
  const translated = runHarness(world, "translate x86 to arm", { kind: "message", arguments: {}, message: "no" });
  assert.equal(translated.ok, true, translated.result);
  assert.match(translated.result, /round-trip held/);
  assert.match(translated.result, /x0 = 11/);
  assert.match(translated.result, /00 08 00 91/);
  assert.equal(Object.values(translated.world.entities).filter((entity) => entity.customData.method === "compat").length, 1);
  const unknown = compatCommand(world, { command: "translate", hex: "0f 0b", arch: "x86_64" });
  assert.match(unknown.detail, /no x86 lowering/);
  assert.match(unknown.detail, /not executed/);
});

test("sub stays a gap until the flagship fixture passes, and a wrong lowering is refused", () => {
  const world = labWorld();
  const sub = encode({ op: "sub", rd: "x0", rn: "x0", imm: 4 }, "x86_64");
  assert.ok(sub);
  const blocked = readProgram(sub, world, "x86_64");
  assert.equal(blocked.ops.length, 0);
  assert.match(blocked.gaps[0]?.reason ?? "", /not in the local map/);
  const forged = acceptLowering(world, {
    op: "sub",
    x86: encode({ op: "add", rd: "x0", rn: "x0", imm: 4 }, "x86_64") ?? [],
    arm: encode({ op: "add", rd: "x0", rn: "x0", imm: 4 }, "aarch64") ?? [],
  });
  assert.equal(forged.ok, false);
  assert.equal(forged.world.compat?.includes("sub") ?? false, false);
  const row = flagshipFixture();
  assert.ok(row);
  const learned = runHarness(world, "learn the missing opcode", { kind: "message", arguments: {}, message: "no" });
  assert.equal(learned.ok, true, learned.result);
  assert.equal(learned.world.compat?.includes("sub"), true);
  const ran = compatCommand(learned.world, { command: "translate", hex: hex(sub), arch: "x86_64" });
  assert.equal(ran.ok, true, ran.detail);
  assert.match(ran.detail, /aarch64/);
  const arm = encode({ op: "sub", rd: "x0", rn: "x0", imm: 4 }, "aarch64");
  assert.ok(arm);
  assert.match(ran.detail, new RegExp(hex(arm).replace(/ /g, " ")));
  const again = acceptLowering(learned.world, { op: "sub", ...row });
  assert.match(again.detail, /already in the local map/);
});
