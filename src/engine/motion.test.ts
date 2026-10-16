import { test } from "node:test";
import assert from "node:assert/strict";
import { clampPart, cleanMoves, composeMove, emptyPose, inpaint, legIk, LIMITS, mirrorPart, moveFromKeys, moveIntent, moveLength, movesOf, PRIMITIVES, sampleMove } from "./motion.ts";
import { executeProposal } from "./harness.ts";
import { labWorld } from "./manifold.ts";
import type { World } from "./types.ts";

const call = (world: World, tool: string, args: Record<string, string>) => executeProposal(world, { kind: "tool_call", toolName: tool, arguments: args });

test("building: words become a move, step by step, with modifiers", () => {
  const move = composeMove("wave with the left hand, then cheer twice")!;
  assert.equal(move.segments.length, 3);
  assert.equal(move.segments[0].name, "left wave");
  // Left mirrors the right-handed wave onto the left arm.
  assert.ok(move.segments[0].mask.includes("shoulderL") && !move.segments[0].mask.includes("shoulderR"));
  assert.ok(Math.abs(moveLength(move) - (1.6 + 1.2 * 2)) < 1e-9);
  assert.equal(move.loop, false);
  assert.ok(composeMove("keep dancing")!.loop);
  // Fast is shorter; upper body keeps the legs free for walking.
  assert.ok(moveLength(composeMove("fast clap")!) < moveLength(composeMove("clap")!));
  const upper = composeMove("dance upper body")!;
  assert.ok(!upper.segments[0].mask.some((j) => j.startsWith("hip") || j.startsWith("knee")));
  assert.equal(composeMove("make a sandwich"), null);
  assert.equal(PRIMITIVES.length, new Set(PRIMITIVES.map((p) => p.id)).size);
});

test("written keyframes are clamped to what a body can do", () => {
  const made = moveFromKeys("kick", JSON.stringify([{ t: 0, pose: { kneeR: { x: 9 } } }, { t: 1, pose: { hipR: { x: -5 }, wings: { x: 1 } } }]), 1, false);
  assert.ok("move" in made);
  if (!("move" in made)) return;
  const [a, b] = made.move.segments[0].keys;
  assert.equal(a.pose.kneeR?.x, LIMITS.kneeR.x[1]);
  assert.equal(b.pose.hipR?.x, LIMITS.hipR.x[0]);
  assert.equal((b.pose as Record<string, unknown>).wings, undefined);
  assert.ok("error" in moveFromKeys("x", "not json"));
  assert.deepEqual(clampPart({ elbowL: { x: 1 } }), { elbowL: { x: 0 } }, "elbows do not bend backwards");
  assert.deepEqual(mirrorPart({ shoulderR: { x: -1, z: -2 } }), { shoulderL: { x: -1, z: 2 } });
});

test("filling in: a move drives its joints, the walk keeps the rest", () => {
  const walking = emptyPose();
  walking.hipL = { x: -0.4, y: 0, z: 0 };
  walking.shoulderR = { x: 0.3, y: 0, z: 0 };
  const wave = composeMove("wave")!;
  const mid = sampleMove(wave, 0.8);
  assert.equal(mid.weight, 1);
  const out = inpaint(walking, mid);
  assert.equal(out.hipL.x, -0.4, "the legs keep walking");
  assert.ok(out.shoulderR.z < -1.5, "the arm is up");
  // It fades in, fades out, and ends.
  assert.ok(sampleMove(wave, 0.05).weight < 0.5);
  assert.ok(sampleMove(wave, moveLength(wave) - 0.05).weight < 0.5);
  assert.ok(sampleMove(wave, moveLength(wave) + 0.1).done);
  assert.ok(!sampleMove(composeMove("keep dancing")!, 50).done);
});

test("legs reach the ground under each foot", () => {
  const T = 0.33;
  const S = 0.31;
  const ankle = (hip: number, knee: number) => ({ z: -T * Math.sin(hip) - S * Math.sin(hip + knee), y: -T * Math.cos(hip) - S * Math.cos(hip + knee) });
  // A step 15 cm up under a straight leg: the knee bends, the foot lands 15 cm higher, same place.
  const up = legIk(0, 0, 0.15, T, S);
  const a = ankle(up.hip, up.knee);
  assert.ok(up.knee > 0.5 && up.hip < 0);
  assert.ok(Math.abs(a.y - (-(T + S) + 0.15)) < 1e-3 && Math.abs(a.z) < 1e-3);
  assert.equal(up.short, 0);
  // Ground below a straight leg cannot be reached: it says by how much, so the pelvis can drop.
  assert.ok(Math.abs(legIk(0, 0, -0.1, T, S).short - 0.1) < 1e-3);
});

test("tools and instant commands: make, do, stop; saved moves are checked again", () => {
  let world = labWorld();
  const made = call(world, "make_move", { name: "victory", words: "cheer then flex twice" });
  assert.ok(made.ok, made.result);
  world = made.world;
  assert.ok(movesOf(world).some((m) => m.id === "victory"));
  const done = call(world, "do_move", { move: "victory" });
  assert.ok(done.ok, done.result);
  const me = Object.values(done.world.entities).find((e) => e.tags.includes("architect"))!;
  assert.equal(me.customData.move, "victory");
  const again = call(done.world, "do_move", { move: "victory" }).world;
  assert.equal(Object.values(again.entities).find((e) => e.tags.includes("architect"))!.customData.moveSeq, "2", "doing it again restarts it");
  const stopped = call(done.world, "do_move", { move: "stop" }).world;
  assert.equal(Object.values(stopped.entities).find((e) => e.tags.includes("architect"))!.customData.move, undefined);
  // New words are built on the spot and kept; a plain built-in is not duplicated.
  const spot = call(world, "do_move", { move: "salute with the left hand" });
  assert.ok(spot.ok && spot.world.moves!.some((m) => m.name === "left salute"));
  assert.equal(call(world, "do_move", { move: "wave" }).world.moves!.length, world.moves!.length);
  assert.match(call(world, "do_move", { move: "make a sandwich" }).result, /no move/);

  assert.deepEqual(moveIntent("wave", world), { tool: "do_move", arguments: { move: "wave" } });
  assert.deepEqual(moveIntent("do a little dance", world), { tool: "do_move", arguments: { move: "do a little dance" } });
  assert.deepEqual(moveIntent("make a move called hype: jumping jacks then cheer", world), { tool: "make_move", arguments: { words: "jumping jacks then cheer", name: "hype" } });
  assert.deepEqual(moveIntent("stop dancing", world), { tool: "do_move", arguments: { move: "stop" } });
  assert.deepEqual(moveIntent("victory", world), { tool: "do_move", arguments: { move: "victory" } });
  assert.equal(moveIntent("build a dance floor", world), null);
  assert.equal(moveIntent("paint the cube teal", world), null);
  assert.equal(moveIntent("make the gauges neon", world), null);

  // A tampered save cannot bend a knee backwards.
  const bad = cleanMoves([{ id: "Bad Move", name: "bad", segments: [{ name: "x", length: 1, keys: [{ t: 0, pose: { kneeL: { x: -3 } } }, { t: 1, pose: {} }] }] }, { nope: true }]);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].id, "bad-move");
  assert.equal(bad[0].segments[0].keys[0].pose.kneeL?.x, 0);
});
