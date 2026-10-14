import assert from "node:assert/strict";
import test from "node:test";
import { classify, qualityFor, type HardwareProfile } from "./hardware.ts";

const base = { webgl: true, webgl2: true, webgpu: false, software: false, renderer: "", cores: 8, memoryGb: 8, touch: false, dpr: 1 };
const profile = (over: Partial<typeof base>): HardwareProfile => {
  const p = { ...base, ...over };
  return { ...p, tier: classify(p) };
};

test("scenery follows the hardware: full on a desktop GPU, lighter on phones, none without a GPU", () => {
  assert.equal(qualityFor(profile({})).scenery, "full");
  assert.equal(qualityFor(profile({ touch: true })).scenery, "lite");
  assert.equal(qualityFor(profile({ cores: 2 })).scenery, "min");
  assert.equal(qualityFor(profile({ software: true, renderer: "SwiftShader" })).scenery, "off");
  assert.equal(qualityFor(profile({ software: true })).shadows, false);
});
