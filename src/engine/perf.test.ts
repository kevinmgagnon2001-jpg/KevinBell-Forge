import assert from "node:assert/strict";
import test from "node:test";
import { heatFloor, AUTO, autoStart, autoStep, frameStats, isPauseGap, LADDER, startRung, type AutoState } from "./perf.ts";

const run = (state: AutoState, from: number, to: number, fps: number, thermal = 0, every = 500) => {
  let s = state;
  for (let t = from; t <= to; t += every) s = autoStep(s, { now: t, fps, thermal });
  return s;
};

test("the hardware tier picks where it starts on the ladder", () => {
  assert.equal(LADDER[startRung({ dpr: [1, 2], antialias: true, powerPreference: "high-performance", shadows: true, scenery: "full" })].name, "11");
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
  s = autoStep(s, { now: AUTO.severeEvery + 1000, fps: 60, thermal: 3 });
  assert.equal(s.rung, 1, "severe heat: soon");
  s = run(s, AUTO.severeEvery + 2000, AUTO.severeEvery + 2000 + AUTO.heatEvery + 1000, 60, 2);
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

test("a frame spanning a pause (another app, the lock screen) is not a slow frame", () => {
  assert.equal(isPauseGap(8.3, false), false);
  assert.equal(isPauseGap(240, false), false, "a real hitch still counts");
  assert.equal(isPauseGap(8.3, true), true, "the first frame back is skipped");
  assert.equal(isPauseGap(300_000, false), true, "minutes away, even without a visibility event");
});

test("issue #25: severe heat with good frames stops at its floor, not at Plain", () => {
  let s = autoStart(0, 0);
  s = run(s, 0, 60000, 60, 3, 1000);
  assert.equal(LADDER[s.rung].name, "Low", "held at the severe floor");
  assert.ok(s.rung === heatFloor(3));
  // Each step waited its turn: 11 -> Low is four steps, at least 8 s apart.
  let t = autoStart(0, 0);
  t = run(t, 0, 20000, 60, 3, 1000);
  assert.ok(t.rung <= 2, `two steps in 20 s at most, got ${t.rung}`);
  // Critical heat has no floor; poor frames still step down past the floor.
  assert.equal(run(autoStart(0, 0), 0, 120000, 60, 4, 1000).rung, LADDER.length - 1);
  assert.equal(run(autoStart(0, 0), 0, 200000, 20, 3, 1000).rung, LADDER.length - 1);
  // Moderate heat at a good frame rate keeps High.
  assert.equal(LADDER[run(autoStart(0, 0), 0, 300000, 60, 2, 1000).rung].name, "High");
});
