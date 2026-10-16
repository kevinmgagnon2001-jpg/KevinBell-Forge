import { test } from "node:test";
import assert from "node:assert/strict";
import { ledgeAhead, PARKOUR, sampleTraverse, twoBone, type Traverse } from "./parkour.ts";
import { WALK, type Solid } from "./physics.ts";

const flat = () => 0;
let nextId = 1;
/** A box standing on the ground: centre x, z; size w (x), d (z), height h; raised by `y`. */
const box = (x: number, z: number, w: number, d: number, h: number, y = 0): Solid => ({
  id: nextId++,
  min: { x: x - w / 2, y, z: z - d / 2 },
  max: { x: x + w / 2, y: y + h, z: z + d / 2 },
  dynamic: false,
  round: false,
  slide: "",
});
const feet = { x: 0, y: 0, z: 0 };
const north = { x: 0, z: 1 };
/** A wide obstacle across the path whose near face is 0.4 m ahead of the feet. */
const across = (depth: number, h: number, y = 0) => box(0, WALK.radius + 0.2 + depth / 2, 3, depth, h, y);

test("kerbs are stepped onto, not vaulted; open ground and far things are nothing", () => {
  assert.equal(ledgeAhead(feet, north, 5, [across(0.5, 0.3)], flat), null);
  assert.equal(ledgeAhead(feet, north, 5, [], flat), null);
  assert.equal(ledgeAhead(feet, north, 5, [box(0, 3, 3, 0.4, 0.9)], flat), null, "too far ahead");
  assert.equal(ledgeAhead(feet, { x: 0, z: -1 }, 5, [across(0.4, 0.9)], flat), null, "behind you");
});

test("a low thin wall taken running is vaulted, landing on the far side still going", () => {
  const wall = across(0.35, 0.9);
  const v = ledgeAhead(feet, north, 6, [wall], flat)!;
  assert.equal(v.kind, "vault");
  assert.ok(Math.abs(v.top - 0.9) < 1e-9);
  assert.ok(v.to.z - WALK.radius > wall.max.z, "lands clear of the far face");
  assert.equal(v.to.y, 0);
  assert.ok(Math.abs(v.hand.z - wall.min.z) < 0.02, "hands on the near edge");
});

test("walking up to a deep crate climbs onto it; running at it vaults only if it is thin", () => {
  const crate = across(1.2, 1);
  assert.equal(ledgeAhead(feet, north, 1.2, [crate], flat)!.kind, "mantle");
  assert.equal(ledgeAhead(feet, north, 7, [crate], flat)!.kind, "mantle", "too deep to vault");
  const thin = across(0.4, 1);
  assert.equal(ledgeAhead(feet, north, 1.2, [thin], flat)!.kind, "vault", "too thin to stand on, so over it");
  const m = ledgeAhead(feet, north, 1.2, [crate], flat)!;
  assert.ok(Math.abs(m.to.y - 1) < 1e-9 && m.to.z - WALK.radius > crate.min.z, "ends standing on top");
});

test("a head-high ledge is climbed from a hang; a wall too tall is not", () => {
  const ledge = across(2, 1.9);
  const c = ledgeAhead(feet, north, 2, [ledge], flat)!;
  assert.equal(c.kind, "climb");
  assert.ok(c.duration > 1);
  assert.equal(ledgeAhead(feet, north, 2, [across(2, PARKOUR.climbMax + 0.3)], flat), null);
});

test("no climb into a ceiling, and no vault into a wall behind", () => {
  const ledge = across(2, 1.6);
  const roof = box(0, 1.5, 3, 3, 0.3, 2.2);
  assert.equal(ledgeAhead(feet, north, 2, [ledge, roof], flat), null, "no head room on top");
  const wall = across(0.35, 0.9);
  const behind = box(0, wall.max.z + 0.3, 3, 0.3, 3);
  assert.equal(ledgeAhead(feet, north, 6, [wall, behind], flat), null, "nowhere to land, nowhere to stand");
});

test("stacked boxes are one obstacle, measured to the real top", () => {
  const low = across(1.2, 0.8);
  const upper = box(0, (low.min.z + low.max.z) / 2, 3, 1.2, 0.8, 0.8);
  const t = ledgeAhead(feet, north, 2, [low, upper], flat)!;
  assert.equal(t.kind, "climb");
  assert.ok(Math.abs(t.top - 1.6) < 1e-9);
});

test("it works at an angle and on raised ground", () => {
  const dir = { x: Math.SQRT1_2, z: Math.SQRT1_2 };
  const crate = box(1.1, 1.1, 1.2, 1.2, 1.1, 0.5);
  const t = ledgeAhead({ x: 0, y: 0.5, z: 0 }, dir, 1, [crate], () => 0.5)!;
  assert.equal(t.kind, "mantle");
  assert.ok(Math.abs(t.top - 1.6) < 1e-9 && Math.abs(t.yaw - Math.PI / 4) < 1e-9);
});

function overlapsFootprint(tr: Traverse, p: { x: number; z: number }, s: Solid): boolean {
  const r = WALK.radius - 0.02;
  return s.min.x < p.x + r && s.max.x > p.x - r && s.min.z < p.z + r && s.max.z > p.z - r;
}

test("the moves run smoothly from start to end and never pass through the obstacle", () => {
  const cases: [Solid, number][] = [
    [across(0.35, 0.9), 6],
    [across(1.2, 1), 1.2],
    [across(2, 1.9), 2],
  ];
  for (const [solid, speed] of cases) {
    const tr = ledgeAhead(feet, north, speed, [solid], flat)!;
    const a = sampleTraverse(tr, 0);
    const b = sampleTraverse(tr, 1);
    assert.ok(Math.hypot(a.x - tr.from.x, a.y - tr.from.y, a.z - tr.from.z) < 1e-6, `${tr.kind} starts at the feet`);
    assert.ok(Math.hypot(b.x - tr.to.x, b.y - tr.to.y, b.z - tr.to.z) < 1e-6, `${tr.kind} ends where it said`);
    let last = a;
    for (let i = 1; i <= 200; i += 1) {
      const p = sampleTraverse(tr, i / 200);
      const jump = Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z);
      assert.ok(jump < 0.08, `${tr.kind} has no jumps (${jump.toFixed(3)} at ${i})`);
      if (overlapsFootprint(tr, p, solid)) assert.ok(p.y >= solid.max.y - 0.01, `${tr.kind} is above the top while over it (${p.y.toFixed(2)} at ${i})`);
      last = p;
    }
  }
});

test("two bones reach a point in reach, and say how short they fall otherwise", () => {
  const a = 0.27;
  const b = 0.25;
  for (const bend of [1, -1] as const) {
    for (const [z, y] of [[0.2, 0.3], [0.35, -0.1], [0, -0.4], [-0.1, 0.4]]) {
      const s = twoBone(z, y, a, b, bend);
      const ez = -a * Math.sin(s.root) - b * Math.sin(s.root + s.bend);
      const ey = -a * Math.cos(s.root) - b * Math.cos(s.root + s.bend);
      assert.ok(Math.hypot(ez - z, ey - y) < 1e-6, `reaches (${z}, ${y}) bending ${bend}`);
      assert.ok(Math.sign(s.bend) === bend || Math.abs(s.bend) < 1e-6);
    }
  }
  assert.ok(Math.abs(twoBone(0, 1, a, b, -1).short - (1 - a - b)) < 1e-9);
});
