import assert from "node:assert/strict";
import test from "node:test";
import { classify } from "./hardware.ts";
import { ingest, sniff } from "./ingest.ts";
import { ensureAvatar, labWorld, restoreLab } from "./manifold.ts";

const bodies = (world: ReturnType<typeof labWorld>) =>
  Object.values(world.entities).filter((entity) => entity.tags.includes("architect"));

test("a saved world that lost its body gets one back", () => {
  const world = labWorld();
  const lost = {
    ...world,
    entities: Object.fromEntries(Object.entries(world.entities).filter(([, entity]) => !entity.tags.includes("architect"))),
  };
  assert.equal(bodies(ensureAvatar(lost)).length, 1);
  assert.equal(bodies(restoreLab(lost)).length, 1);
});

test("a NaN body position heals and a healthy world is untouched", () => {
  const world = labWorld();
  assert.equal(ensureAvatar(world), world);
  const broken = structuredClone(world);
  bodies(broken)[0].transform.position = { x: Number.NaN, y: 1, z: 0 };
  assert.ok(Number.isFinite(bodies(ensureAvatar(broken))[0].transform.position.x));
});

test("ingest validates wasm without running it", () => {
  const report = ingest(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), "m.wasm");
  assert.equal(report.route, "sandbox-vm");
  assert.equal(report.wasm?.valid, true);
  assert.equal(ingest(new Uint8Array([0, 0x61, 0x73, 0x6d, 9, 9, 9, 9]), "bad.wasm").route, "reject");
});

test("ingest identifies by magic bytes and routes native programs to an emulator", () => {
  assert.equal(sniff(new Uint8Array([0x7f, 0x45, 0x4c, 0x46]), "a.out"), "native");
  assert.equal(ingest(new Uint8Array([0x4d, 0x5a, 0x90, 0]), "setup.exe").route, "emulator");
  assert.equal(sniff(new Uint8Array([1, 2, 3, 4, 5]), "mystery"), "unknown");
});

test("hardware tiers", () => {
  const base = { webgl: true, webgl2: true, webgpu: false, software: false, renderer: "", cores: 8, memoryGb: 8, touch: false, dpr: 2 };
  assert.equal(classify({ ...base, webgl: false }), "none");
  assert.equal(classify({ ...base, software: true }), "low");
  assert.equal(classify({ ...base, touch: true }), "mid");
  assert.equal(classify(base), "high");
});
