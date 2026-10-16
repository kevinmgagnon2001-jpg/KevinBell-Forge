import { test } from "node:test";
import assert from "node:assert/strict";
import { bestOf, cleanBest, frameCamera, GAMES, gameById, moveForKey, moveForPad, nearestGame, withBest } from "./arcade.ts";
import { buildBreakout, buildMarble, buildTetris, labWorld, stepWorld } from "./manifold.ts";
import { executeProposal } from "./harness.ts";
import { solidOf, solidsOverlap } from "./physics.ts";

test("walk up to a game: in reach it is offered, across the room it is not", () => {
  const world = buildMarble(buildTetris(labWorld()));
  const tetris = gameById("tetris")!;
  const spot = tetris.spot(world, tetris.find(world)!);
  assert.equal(nearestGame(world, { x: spot.x, y: 0, z: spot.z + 2 })?.game.id, "tetris");
  assert.equal(nearestGame(world, { x: -4.4, y: 0, z: 1.5 })?.game.id, "marble");
  assert.equal(nearestGame(world, { x: 0.15, y: 0, z: -2.2 }), null);
  assert.equal(nearestGame(labWorld(), { x: spot.x, y: 0, z: spot.z }), null, "no game built, nothing to play");
});

test("tetris moves come from keys and pad buttons, and the game plays", () => {
  const tetris = gameById("tetris")!;
  assert.equal(moveForKey(tetris, "ArrowLeft")?.id, "left");
  assert.equal(moveForKey(tetris, "KeyD")?.id, "right");
  assert.equal(moveForKey(tetris, "Space")?.id, "drop");
  assert.equal(moveForPad(tetris, 14)?.id, "left");
  assert.equal(moveForPad(tetris, 0)?.id, "rotate");
  let world = buildTetris(labWorld());
  const board = () => tetris.find(world)!;
  assert.equal(tetris.status(world, board()), "0 lines");
  world = tetris.play(world, "drop");
  assert.equal(Object.values(world.entities).filter((e) => e.tags.includes("locked")).length, 4);
  assert.ok(tetris.clock!(world, board()).every > 0.1);
  // Every move id is unique and every game has a way to leave and come back.
  for (const game of GAMES) {
    assert.equal(new Set(game.moves.map((m) => m.id)).size, game.moves.length);
    assert.ok(game.restart(labWorld()));
  }
});

test("the marble run: release puts the ball back on top, and it rolls down", () => {
  const marble = gameById("marble")!;
  let world = buildMarble(labWorld());
  world = stepWorld(stepWorld(world, 210), 210);
  const rolled = Object.values(world.entities).find((e) => e.name === "Marble")!;
  // Down all three ramps (now that things collide, the exhibits were moved out of its way).
  assert.equal(marble.status(world, marble.find(world)!), "In the catch");
  world = marble.play(world, "release");
  const back = world.entities[rolled.id];
  assert.equal(back.transform.position.y, 2.62);
  assert.equal(back.physics!.velocity.x, 0);
});

test("the camera backs off until the whole game fits, wide screen or tall", () => {
  const world = buildTetris(labWorld());
  const tetris = gameById("tetris")!;
  const f = tetris.framing(world, tetris.find(world)!);
  const fits = (fov: number, aspect: number) => {
    const { eye, at } = frameCamera(f, fov, aspect);
    const d = Math.hypot(eye.x - at.x, eye.y - at.y, eye.z - at.z);
    const tan = Math.tan((fov * Math.PI) / 360);
    return tan * d * 2 >= f.height && tan * aspect * d * 2 >= f.width;
  };
  assert.ok(fits(42, 16 / 9));
  assert.ok(fits(70, 390 / 844), "a phone held upright");
  const wide = frameCamera(f, 42, 16 / 9);
  const tall = frameCamera(f, 42, 390 / 844);
  assert.ok(tall.eye.z > wide.eye.z, "farther back on a narrow screen");
});

test("Blocks: a cabinet you walk up to, played on its own screen", () => {
  const built = executeProposal(labWorld(), { kind: "tool_call", toolName: "build_play", arguments: { kind: "blocks" } });
  assert.ok(built.ok, built.result);
  const blocks = gameById("blocks")!;
  const cabinet = blocks.find(built.world)!;
  assert.ok(cabinet && blocks.screen);
  assert.equal(nearestGame(built.world, { x: cabinet.transform.position.x, y: 0, z: cabinet.transform.position.z + 1.5 })?.game.id, "blocks");
  // It stands clear of everything else in the lab.
  const solid = solidOf(cabinet)!;
  for (const other of Object.values(built.world.entities)) {
    if (other.tags.includes("blocks") || other.tags.includes("floor")) continue;
    const s = solidOf(other);
    if (s) assert.ok(!solidsOverlap(s, solid), other.name);
  }
});

test("a Hyper Breakout cabinet is built, found and played on its own screen", () => {
  const w = buildBreakout(labWorld());
  const game = gameById("breakout")!;
  const board = game.find(w)!;
  assert.ok(board && game.screen);
  assert.equal(nearestGame(w, board.transform.position)?.game.id, "breakout");
});

test("best scores: kept when beaten, ignored otherwise, cleaned from a save", () => {
  const w = labWorld();
  assert.equal(bestOf(w, "breakout"), 0);
  const a = withBest(w, "breakout", 420);
  assert.equal(bestOf(a, "breakout"), 420);
  assert.equal(withBest(a, "breakout", 100), a, "a lower score changes nothing");
  assert.deepEqual(cleanBest({ breakout: 420.7, tetris: 12, "bad id!": 3, neg: -1, str: "9" }), { breakout: 420, tetris: 12 });
  assert.equal(cleanBest(null), undefined);
});
