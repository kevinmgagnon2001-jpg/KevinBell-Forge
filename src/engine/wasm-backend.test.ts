import assert from "node:assert/strict";
import test from "node:test";
import { encode, readProgram, SAMPLE, step, type IrOp, type Reg } from "./isa.ts";
import { labWorld } from "./manifold.ts";
import { lowerToWasm, runOnWasm } from "./wasm-backend.ts";

test("the sample program runs on wasm and agrees with the reference stepper", () => {
  assert.equal(WebAssembly.validate(lowerToWasm(SAMPLE) as BufferSource), true);
  assert.equal(runOnWasm(SAMPLE), 11);
  assert.equal(runOnWasm(SAMPLE), (step(SAMPLE) as { x0: number }).x0);
});

test("machine bytes from either architecture lower to wasm and give the same answer", () => {
  const world = labWorld();
  for (const arch of ["x86_64", "aarch64"] as const) {
    const bytes = SAMPLE.flatMap((op) => encode(op, arch) ?? []);
    const evidence = readProgram(bytes, world, arch);
    assert.equal(evidence.gaps.length, 0);
    assert.equal(runOnWasm(evidence.ops), 11, arch);
  }
});

test("random programs match the reference stepper, including 32-bit wraparound and negative seeds", () => {
  const regs: Reg[] = ["x0", "x1", "x2", "x3"];
  let seedState = 12345;
  const rand = (n: number) => {
    seedState = (Math.imul(seedState, 1664525) + 1013904223) >>> 0;
    return seedState % n;
  };
  for (let round = 0; round < 300; round += 1) {
    const ops: IrOp[] = [];
    const length = rand(12);
    for (let i = 0; i < length; i += 1) {
      const kind = rand(3);
      if (kind === 0) ops.push({ op: "mov", rd: regs[rand(4)], imm: rand(0x10000) });
      else ops.push({ op: kind === 1 ? "add" : "sub", rd: regs[rand(4)], rn: regs[rand(4)], imm: rand(256) });
    }
    if (rand(2)) ops.push({ op: "ret" });
    if (rand(4) === 0) ops.push({ op: "mov", rd: "x0", imm: 7 }); // dead code after ret must not run
    const seed = [0, 1, -1, 2147483647, -2147483648, 4000000000][rand(6)];
    const want = (step(ops, seed) as { x0: number }).x0;
    assert.equal(runOnWasm(ops, seed), want, JSON.stringify({ ops, seed }));
  }
});
