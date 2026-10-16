import { test } from "node:test";
import assert from "node:assert/strict";
import { BALL, bricksFor, FIELD, LIVES, newBreakout, PADDLE, stepBreakout, type BreakoutInput } from "./breakout.ts";

const idle: BreakoutInput = { target: null, move: 0, launch: false };
const dt = 1 / 60;

test("every level's wall fits the field and does not overlap", () => {
  for (let level = 1; level <= 12; level += 1) {
    const bricks = bricksFor(level, 5);
    assert.ok(bricks.length >= 10, `level ${level} has bricks`);
    for (const b of bricks) {
      assert.ok(b.x >= 0 && b.x + b.w <= FIELD.width + 1e-9 && b.y > 0 && b.y + b.h < PADDLE.y - 0.3);
      assert.ok(b.hp >= 1 && b.hp <= 3);
      assert.ok(Number.isInteger(b.tone) && b.tone >= 0 && b.tone < 6, "a palette colour");
    }
    for (let i = 0; i < bricks.length; i += 1)
      for (let j = i + 1; j < bricks.length; j += 1) {
        const a = bricks[i];
        const c = bricks[j];
        assert.ok(a.x + a.w <= c.x + 1e-9 || c.x + c.w <= a.x + 1e-9 || a.y + a.h <= c.y + 1e-9 || c.y + c.h <= a.y + 1e-9, "no overlap");
      }
  }
  assert.deepEqual(bricksFor(3, 9), bricksFor(3, 9), "the same seed builds the same wall");
});

test("the ball waits on the paddle, follows it, and launches upward", () => {
  const s = newBreakout(1);
  stepBreakout(s, { ...idle, move: 1 }, 0.2);
  assert.ok(s.paddle.x > 0.5);
  assert.ok(Math.abs(s.balls[0].x - s.paddle.x) < 1e-9 && s.balls[0].stuck);
  stepBreakout(s, { ...idle, launch: true }, dt);
  assert.ok(!s.balls[0].stuck && s.balls[0].vy < 0);
});

test("a ball that hits the paddle goes back up, angled by where it landed", () => {
  const s = newBreakout(1);
  s.bricks = [];
  s.bricks.push({ x: 0, y: 0, w: 0.01, h: 0.01, hp: 9, max: 3, tone: 0 }); // keep the level from clearing
  s.balls = [{ x: s.paddle.x + 0.06, y: PADDLE.y - 0.05, vx: 0, vy: BALL.speed, stuck: false }];
  for (let i = 0; i < 10; i += 1) stepBreakout(s, idle, dt);
  assert.ok(s.balls[0].vy < 0, "bounced up");
  assert.ok(s.balls[0].vx > 0, "to the right, landing right of centre");
});

test("bricks take hits, break, and score; a cleared wall is the next level", () => {
  const s = newBreakout(2);
  const tough = { x: 0.4, y: 0.5, w: 0.2, h: 0.04, hp: 2, max: 2, tone: 1 };
  s.bricks = [tough];
  s.balls = [{ x: 0.5, y: 0.62, vx: 0, vy: -0.8, stuck: false }];
  const seen: string[] = [];
  for (let i = 0; i < 240 && s.level === 1; i += 1) {
    for (const e of stepBreakout(s, idle, dt)) seen.push(e.kind);
    // Bounce it back up from below without the paddle.
    if (s.balls[0] && s.balls[0].y > 0.9) s.balls[0].vy = -Math.abs(s.balls[0].vy);
  }
  assert.ok(seen.includes("hit") && seen.includes("break") && seen.includes("level"), seen.join(","));
  assert.equal(s.level, 2);
  assert.ok(s.score > 0 && s.best === s.score);
  assert.ok(s.bricks.length > 0 && s.balls[0].stuck);
});

test("the ball never leaves the sides or the top, and never goes through a brick", () => {
  const s = newBreakout(7);
  stepBreakout(s, { ...idle, launch: true }, dt);
  for (let i = 0; i < 60 * 60 && !s.over; i += 1) {
    // A perfect player: the paddle under the lowest ball.
    const low = s.balls.reduce((a, b) => (b.y > a.y ? b : a), s.balls[0]);
    stepBreakout(s, { target: low.x, move: 0, launch: true }, dt);
    for (const b of s.balls) {
      assert.ok(b.x >= BALL.r - 1e-9 && b.x <= FIELD.width - BALL.r + 1e-9 && b.y >= BALL.r - 1e-9);
      for (const k of s.bricks) assert.ok(!(b.x > k.x + 0.004 && b.x < k.x + k.w - 0.004 && b.y > k.y + 0.004 && b.y < k.y + k.h - 0.004), "inside a brick");
    }
  }
  assert.ok(s.score > 200, `a good player scores: ${s.score}`);
});

test("missing the ball costs a life; three and it is over, keeping the best", () => {
  const s = newBreakout(3, 50);
  const events: string[] = [];
  for (let life = 0; life < LIVES; life += 1) {
    stepBreakout(s, { ...idle, launch: true }, dt);
    for (let i = 0; i < 60 * 20 && s.lives === LIVES - life && !s.over; i += 1) {
      // Keep the paddle far from the ball.
      const b = s.balls[0];
      for (const e of stepBreakout(s, { target: b && b.x < 0.5 ? 0.95 : 0.05, move: 0, launch: false }, dt)) events.push(e.kind);
    }
  }
  assert.ok(s.over);
  assert.equal(s.lives, 0);
  assert.ok(events.includes("lost") && events.includes("over"));
  assert.equal(s.best, Math.max(50, s.score));
  assert.deepEqual(stepBreakout(s, { ...idle, launch: true }, dt), [], "nothing happens once over");
});

test("capsules: three balls, a wide paddle, slow time", () => {
  const s = newBreakout(4);
  s.balls = [{ x: 0.3, y: 0.8, vx: 0.2, vy: -0.7, stuck: false }];
  s.drops = [{ x: s.paddle.x, y: PADDLE.y - 0.01, kind: "multi" }];
  stepBreakout(s, idle, dt);
  assert.equal(s.balls.length, 3);
  s.drops = [{ x: s.paddle.x, y: PADDLE.y - 0.01, kind: "wide" }];
  stepBreakout(s, idle, dt);
  for (let i = 0; i < 60; i += 1) stepBreakout(s, idle, dt);
  assert.ok(s.paddle.w > PADDLE.w + 0.05);
  s.drops = [{ x: s.paddle.x, y: PADDLE.y - 0.01, kind: "slow" }];
  stepBreakout(s, idle, dt);
  assert.ok(s.slow > 0);
});
