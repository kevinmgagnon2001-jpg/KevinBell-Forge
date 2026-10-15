import assert from "node:assert/strict";
import test from "node:test";
import { AUTO, autoStart, autoStep, frameStats, LADDER, startRung, type AutoState } from "./perf.ts";

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
