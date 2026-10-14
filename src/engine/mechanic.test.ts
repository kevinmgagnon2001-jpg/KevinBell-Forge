import assert from "node:assert/strict";
import test from "node:test";
import { b64url, generateIdentity } from "./island.ts";
import {
  BUILT_IN,
  CAR,
  checkMechanic,
  checkMover,
  compileRecipe,
  DEFAULT_RULES,
  MoverRuntime,
  packMechanic,
  PLANE,
  stepUnderRules,
  WALK,
  type MechanicInput,
} from "./mechanic.ts";
import { step as walkStep } from "./prediction.ts";

const idle: MechanicInput = { forward: 0, strafe: 0, turn: 0, steer: 0, lift: 0, dt: 1 / 60, action: 0 };
const start = () => [0, 0.45, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

function drive(recipe: typeof CAR, input: Partial<MechanicInput>, seconds: number, from = start()) {
  const rt = new MoverRuntime(compileRecipe(recipe));
  let s = from;
  for (let t = 0; t < seconds; t += 1 / 60) s = rt.step(s, { ...idle, ...input }) as number[];
  return s;
}

// ---------- hand-made modules, to try the checker ----------

const u32 = (n: number): number[] => {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
};
const sec = (id: number, body: number[]) => [id, ...u32(body.length), ...body];
const str = (s: string) => [...u32(s.length), ...Array.from(new TextEncoder().encode(s))];

function module(opts: { code?: number[]; imports?: boolean; memory?: number[]; globals?: number[]; start?: boolean; exports?: number[][]; funcs?: number } = {}) {
  const code = opts.code ?? [0x0b];
  const body = [0x00, ...code];
  const funcs = opts.funcs ?? 1;
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...sec(1, [1, 0x60, 0, 0]),
    ...(opts.imports ? sec(2, [1, ...str("env"), ...str("f"), 0x00, 0]) : []),
    ...sec(3, [funcs, ...Array(funcs).fill(0)]),
    ...sec(5, opts.memory ?? [1, 0x01, 1, 1]),
    ...(opts.globals ? sec(6, opts.globals) : []),
    ...sec(7, [...u32((opts.exports ?? [[...str("memory"), 0x02, 0], [...str("step"), 0x00, opts.imports ? 1 : 0]]).length), ...(opts.exports ?? [[...str("memory"), 0x02, 0], [...str("step"), 0x00, opts.imports ? 1 : 0]]).flat()]),
    ...(opts.start ? sec(8, [0]) : []),
    ...sec(10, [funcs, ...Array.from({ length: funcs }, () => [...u32(body.length), ...body]).flat()]),
  ]);
}

test("the checker accepts plain arithmetic and refuses anything that could run long, reach out or keep secrets", () => {
  assert.deepEqual(checkMover(module()), { ok: true });
  // i32.const 0; f64.load; drop
  assert.equal(checkMover(module({ code: [0x41, 0, 0x2b, 3, 0, 0x1a, 0x0b] })).ok, true);
  // A forward branch out of a block is fine.
  assert.equal(checkMover(module({ code: [0x02, 0x40, 0x0c, 0, 0x0b, 0x0b] })).ok, true);

  const refused = (bytes: Uint8Array, why: RegExp) => {
    const r = checkMover(bytes);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, why);
  };
  refused(module({ code: [0x03, 0x40, 0x0c, 0, 0x0b, 0x0b] }), /loops/);
  refused(module({ code: [0x10, 0, 0x0b] }), /calls/);
  refused(module({ imports: true }), /imports nothing/);
  refused(module({ code: [0x41, 1, 0x40, 0, 0x1a, 0x0b] }), /memory.grow/);
  refused(module({ memory: [1, 0x00, 1] }), /fixed size/);
  refused(module({ memory: [1, 0x01, 1, 2] }), /one page/);
  refused(module({ globals: [1, 0x7c, 1, 0x44, 0, 0, 0, 0, 0, 0, 0, 0, 0x0b] }), /mutable globals/);
  refused(module({ start: true }), /start function/);
  refused(module({ exports: [[...str("step"), 0x00, 0]] }), /exactly `memory` and `step`/);
  refused(module({ funcs: 2 }), /exactly one function/);
  refused(module({ code: [0xfc, 11, 0, 0x0b] }), /bulk memory/);
  refused(new Uint8Array(20_000), /at most 16 KB/);
  refused(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), /not a WebAssembly module/);
});

test("the built-in mechanics compile to modules the checker accepts", () => {
  for (const recipe of BUILT_IN) {
    const bytes = compileRecipe(recipe);
    assert.deepEqual(checkMover(bytes), { ok: true }, recipe.name);
    assert.ok(bytes.length < 16 * 1024);
  }
});

test("Walk, as a carried mechanic, moves exactly like the engine's own walking", () => {
  const rt = new MoverRuntime(compileRecipe(WALK));
  let mine = { position: { x: 0.5, y: 0.45, z: -1 }, yaw: 0.2 };
  let slots = [0.5, 0.45, -1, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
  for (let i = 0; i < 400; i += 1) {
    const input = { seq: i + 1, forward: rnd(), strafe: rnd(), turn: rnd() * 0.2, dt: 1 / 60 };
    mine = walkStep(mine, input);
    slots = rt.step(slots, { ...idle, ...input }) as number[];
  }
  assert.ok(Math.abs(slots[0] - mine.position.x) < 1e-9, `x ${slots[0]} vs ${mine.position.x}`);
  assert.ok(Math.abs(slots[2] - mine.position.z) < 1e-9);
  assert.ok(Math.abs(slots[3] - mine.yaw) < 1e-12);
});

test("sin and cos in recipes are accurate everywhere, not just near zero", () => {
  const rt = new MoverRuntime(compileRecipe({ name: "trig", look: "walker", set: [["vx", "sin(x)"], ["vz", "cos(x)"]] }));
  for (let x = -50; x <= 50; x += 0.37) {
    const out = rt.step([x, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], idle) as number[];
    assert.ok(Math.abs(out[6] - Math.sin(x)) < 1e-12, `sin(${x})`);
    assert.ok(Math.abs(out[8] - Math.cos(x)) < 1e-12, `cos(${x})`);
  }
});

test("the car: W drives forward, A steers left like walking turns left, S brakes then reverses", () => {
  const ahead = drive(CAR, { forward: 1 }, 2);
  assert.ok(ahead[5] > 10, `speed ${ahead[5]}`);
  assert.ok(ahead[2] > 5 && Math.abs(ahead[0]) < 1e-9, "straight ahead is +z at yaw 0");
  // Steering does nothing standing still.
  assert.equal(drive(CAR, { steer: 1 }, 1)[3], 0);
  // A while rolling forward turns the same way walking's A (turn > 0) does: yaw goes up.
  const left = drive(CAR, { forward: 1, steer: 1 }, 2);
  assert.ok(left[3] > 0.2, `yaw ${left[3]}`);
  assert.ok(walkStep({ position: { x: 0, y: 0, z: 0 }, yaw: 0 }, { seq: 1, forward: 0, strafe: 0, turn: 0.1, dt: 0.1 }).yaw > 0);
  const right = drive(CAR, { forward: 1, steer: -1 }, 2);
  assert.ok(right[3] < -0.2);
  // Braking from speed, then reversing.
  const stopped = drive(CAR, { forward: -1 }, 1.2, ahead);
  assert.ok(stopped[5] < ahead[5] - 10);
  const reversing = drive(CAR, { forward: -1 }, 3);
  assert.ok(reversing[5] < -3 && reversing[2] < 0);
  // Coasting comes to rest.
  const coast = drive(CAR, {}, 30, ahead);
  assert.equal(coast[5], 0);
});

test("the plane: needs speed to climb, banks with A/D, and never goes below the ground", () => {
  const slow = drive(PLANE, { lift: 1 }, 3);
  assert.ok(slow[1] <= 0.45 + 1e-9, "no lift without airspeed");
  const fast = drive(PLANE, { forward: 1 }, 8);
  assert.ok(fast[5] > 20, `airspeed ${fast[5]}`);
  const climbing = drive(PLANE, { lift: 1 }, 2, fast);
  assert.ok(climbing[1] > 5, `altitude ${climbing[1]}`);
  const banked = drive(PLANE, { steer: 1 }, 1, climbing);
  assert.ok(banked[3] > climbing[3] + 0.3);
  const dive = drive(PLANE, { lift: -1, forward: -1 }, 20, climbing);
  assert.ok(dive[1] >= 0.45 - 1e-12);
});

test("recipes with mistakes are refused with a reason", () => {
  assert.throws(() => compileRecipe({ name: "x", look: "car", set: [["forward", "1"]] }), /not a state name/);
  assert.throws(() => compileRecipe({ name: "x", look: "car", set: [["x", "x + nope"]] }), /unknown name nope/);
  assert.throws(() => compileRecipe({ name: "x", look: "car", set: [["x", "tan(x)"]] }), /unknown function tan/);
  assert.throws(() => compileRecipe({ name: "x", look: "car", set: [["x", "min(x)"]] }), /takes 2 arguments/);
  assert.throws(() => compileRecipe({ name: "x", look: "car", set: [["x", "(x + 1"]] }), /expected "\)"/);
  assert.throws(() => compileRecipe({ name: "x", look: "car", vars: ["a", "b", "c", "d", "e", "f", "g", "h"], set: [["x", "1"]] }), /at most 7/);
  assert.throws(() => compileRecipe({ name: "x", look: "boat" as never, set: [["x", "1"]] }), /look must be/);
  assert.throws(() => compileRecipe({ name: "x", look: "car", set: [["x", "(".repeat(60) + "1" + ")".repeat(60)]] }), /nested too deeply/);
});

test("a package keeps its author and refuses to run if anything in it was changed", async () => {
  const kevin = await generateIdentity();
  const pkg = await packMechanic(PLANE, kevin, "Kevin");
  assert.equal(pkg.author.name, "Kevin");
  assert.ok(pkg.fixtures.length >= 4);
  const ok = await checkMechanic(JSON.parse(JSON.stringify(pkg)));
  assert.equal(ok.ok, true);

  const reason = async (p: unknown) => {
    const r = await checkMechanic(p);
    return r.ok ? "accepted" : r.reason;
  };
  // A different module, hash not updated.
  const otherBytes = compileRecipe(CAR);
  assert.match(await reason({ ...pkg, wasm: b64url(otherBytes) }), /does not match its hash/);
  // Name changed after signing.
  assert.match(await reason({ ...pkg, name: "Not a plane" }), /signature/);
  // Claimed by someone else.
  const mallory = await generateIdentity();
  assert.match(await reason({ ...pkg, author: { ...pkg.author, key: mallory.publicKey } }), /author id does not match/);
  // A fixture this engine computes differently (re-signed, so only the fixture is wrong).
  const forged = await packMechanic(PLANE, kevin, "Kevin");
  forged.fixtures[2].expect[0] += 1e-9;
  const { signature: _drop, ...body } = forged;
  const { signText } = await import("./device-link.ts");
  const { canonical } = await import("./island.ts");
  const resigned = { ...body, signature: await signText(kevin.privateKey, `mechanic|${canonical(body)}`) };
  assert.match(await reason(resigned), /fixture 3 gives a different result/);
  // Not a package at all.
  assert.match(await reason({ hello: 1 }), /not a mechanic package/);
});

test("an island's rules hold whoever wrote the mechanic: speed limit, floor, ceiling and walls", () => {
  const rocket = new MoverRuntime(compileRecipe({ name: "Rocket", look: "hover", set: [["x", "x + 1000 * dt"], ["y", "y - 50"]] }));
  const s = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const out = stepUnderRules(rocket, s, { ...idle, dt: 0.1 }, [], { maxSpeed: 20, floor: 0.45, ceiling: 100 });
  assert.ok(Math.hypot(out[0], out[1] - 1, out[2]) <= 20 * 0.1 + 1e-9, "no faster than the island allows");
  assert.equal(out[1], 0.45);
  const walled = stepUnderRules(rocket, s, { ...idle, dt: 0.1 }, [{ min: { x: 0.5, y: 0, z: -5 }, max: { x: 1, y: 3, z: 5 } }], DEFAULT_RULES);
  assert.ok(walled[0] < 0.5 - 0.3 + 1e-9, `a wall stops it (x ${walled[0]})`);
  // A frame longer than 0.1 s is treated as 0.1 s.
  const long = stepUnderRules(rocket, s, { ...idle, dt: 5 }, [], DEFAULT_RULES);
  assert.ok(long[0] <= 60 * 0.1 + 1e-9);
});
