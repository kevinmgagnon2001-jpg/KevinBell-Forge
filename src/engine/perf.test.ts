import assert from "node:assert/strict";
import test from "node:test";
import { AUTO, autoStart, autoStep, effectiveDpr, frameStats, LADDER, renderSize, startRung, upscaleOverride, type AutoState } from "./perf.ts";

const run = (state: AutoState, from: number, to: number, fps: number, thermal = 0, every = 500) => {
  let s = state;
  for (let t = from; t <= to; t += every) s = autoStep(s, { now: t, fps, thermal });
  return s;
};

test("the hardware tier picks where it starts on the ladder", () => {
  assert.equal(LADDER[startRung({ dpr: [1, 2], antialias: true, powerPreference: "high-performance", shadows: true, scenery: "full" })].name, "Ultra");
  assert.equal(LADDER[startRung({ dpr: [1, 1.5], antialias: true, powerPreference: "default", shadows: true, scenery: "lite" })].name, "Medium");
  assert.equal(LADDER[startRung({ dpr: [1, 1], antialias: false, powerPreference: "low-power", shadows: false, scenery: "off" })].name, "Plain");
});

test("a struggling frame rate steps down one rung at a time, not on a single bad moment", () => {
  let s = autoStart(1, 0);
  s = run(s, 0, AUTO.lowFor - 1000, 20);
  assert.equal(s.rung, 1, "not yet");
  s = autoStep(s, { now: AUTO.lowFor + 10, fps: 20, thermal: 0 });
  assert.equal(s.rung, 2);
  s = autoStep(s, { now: AUTO.lowFor + 500, fps: 20, thermal: 0 });
  assert.equal(s.rung, 2, "the clock starts again after a step");
  s = run(s, 6000, 30000, 20);
  assert.equal(s.rung, LADDER.length - 1, "bottoms out");
  s = run(s, 30000, 40000, 20);
  assert.equal(s.rung, LADDER.length - 1);
});

test("plenty of room climbs back up slowly, never above the device's best, and backs off after a mistake", () => {
  let s = autoStart(1, 0);
  s = { ...s, rung: 3 };
  s = run(s, 0, AUTO.highFor + AUTO.settle, 60);
  assert.equal(s.rung, 2, "one step up");
  const up = s.lastUp;
  // It was too much: frames drop right after, so it steps back down and stays put a while.
  s = run(s, up + 500, up + 500 + AUTO.lowFor + 500, 20);
  assert.equal(s.rung, 3);
  s = run(s, up + 6000, up + 6000 + AUTO.backoff - 10000, 60, 0, 1000);
  assert.equal(s.rung, 3, "no climbing during the back-off");
  s = run(autoStart(1, 0), 0, 1e6, 60, 0, 1000);
  assert.equal(s.rung, 1, "never above the ceiling");
});

test("a hot phone steps down even when frames are fine, and does not climb while warm", () => {
  let s = autoStart(0, 0);
  s = autoStep(s, { now: 5000, fps: 60, thermal: 3 });
  assert.equal(s.rung, 1, "severe heat: now");
  s = run(s, 6000, 6000 + AUTO.heatEvery + 1000, 60, 2);
  assert.equal(s.rung, 2, "moderate heat: one step after a while");
  s = { ...s, ceiling: 0 };
  s = run(s, 100000, 400000, 60, 1, 1000);
  assert.equal(s.rung, 2, "light heat: holds");
});

test("frame stats", () => {
  assert.deepEqual(frameStats([]), { fps: 0, avg: 0, worst: 0 });
  const s = frameStats([16, 16, 16, 50]);
  assert.equal(Math.round(s.fps), 41);
  assert.equal(s.worst, 50);
});

test("each rung down shades fewer pixels (or keeps them and drops a feature)", () => {
  for (let i = 1; i < LADDER.length; i += 1) {
    assert.ok(effectiveDpr(LADDER[i]) <= effectiveDpr(LADDER[i - 1]), `${LADDER[i].name} shades no more than ${LADDER[i - 1].name}`);
    assert.ok(LADDER[i].scale > 0 && LADDER[i].scale <= 1);
  }
  // Upscaled rungs keep the output sharp: High draws at 77 % of a 2x screen, not at 1.5x like before.
  assert.equal(LADDER[1].dpr, 2);
  assert.ok(LADDER[1].scale < 1);
});

test("render size and the address override", () => {
  assert.deepEqual(renderSize(2340, 1080, 0.67), { width: 1568, height: 724 });
  assert.deepEqual(renderSize(100, 50, 0.01), { width: 25, height: 13 });
  assert.deepEqual(renderSize(100, 50, Number.NaN), { width: 100, height: 50 });
  assert.equal(upscaleOverride("?upscale=0.5"), 0.5);
  assert.equal(upscaleOverride("?upscale=off"), 1);
  assert.equal(upscaleOverride("?upscale=9"), 1);
  assert.equal(upscaleOverride("?scenery=lite"), null);
  assert.equal(upscaleOverride("?upscale=abc"), null);
});
