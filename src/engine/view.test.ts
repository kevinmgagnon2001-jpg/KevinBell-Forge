import { test } from "node:test";
import assert from "node:assert/strict";
import { fovFor, horizontalFov, isPhoneLandscape, isRotation, nextRotation, VIEW_FOV } from "./view.ts";

const S26_PORTRAIT = 412 / 891;
const S26_LANDSCAPE = 891 / 412;

test("wide screens keep each view's own angle", () => {
  for (const mode of ["first", "third", "bench"] as const) {
    assert.equal(fovFor(mode, S26_LANDSCAPE), VIEW_FOV[mode].base);
    assert.equal(fovFor(mode, 16 / 9), VIEW_FOV[mode].base);
  }
});

test("an upright phone widens the view, up to the cap", () => {
  const first = fovFor("first", S26_PORTRAIT);
  assert.equal(first, VIEW_FOV.first.cap);
  // The old fixed 68° showed ~35° across in portrait; now it is much wider.
  assert.ok(horizontalFov(68, S26_PORTRAIT) < 36);
  assert.ok(horizontalFov(first, S26_PORTRAIT) > 50);
  // A square screen sits in between.
  const square = fovFor("third", 1);
  assert.ok(square > VIEW_FOV.third.base && square <= VIEW_FOV.third.cap);
  assert.equal(Math.round(horizontalFov(square, 1)), VIEW_FOV.third.wide);
  assert.equal(fovFor("third", Number.NaN), VIEW_FOV.third.base);
});

test("rotation settings", () => {
  assert.equal(nextRotation("auto"), "portrait");
  assert.equal(nextRotation("landscape"), "auto");
  assert.equal(nextRotation("system"), "auto");
  assert.ok(isRotation("system"));
  assert.ok(!isRotation("sideways"));
  assert.ok(isPhoneLandscape(891, 412, true));
  assert.ok(!isPhoneLandscape(412, 891, true));
  assert.ok(!isPhoneLandscape(1280, 800, false));
  assert.ok(!isPhoneLandscape(1280, 800, true));
});
