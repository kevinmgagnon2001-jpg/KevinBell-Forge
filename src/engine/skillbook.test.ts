import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanRecent, readTweak, skillIntent } from "./skillbook.ts";
import { executeProposal } from "./harness.ts";
import { labWorld } from "./manifold.ts";
import type { World } from "./types.ts";

const call = (world: World, tool: string, args: Record<string, string>) => executeProposal(world, { kind: "tool_call", toolName: tool, arguments: args });
const spawn = (world: World, name: string, x = 4, z = 4) => call(world, "spawn_entity", { name, asset: "cube", x: String(x), y: "0.5", z: String(z), color: "blue" });

test("tweaks: size, colour, side, count, in any order", () => {
  assert.deepEqual(readTweak("but taller").scale, [1, 1.5, 1]);
  assert.deepEqual(readTweak("much bigger").scale, [2, 2, 2]);
  const t = readTweak("another one, red, to the left, 3 times");
  assert.equal(t.color, "#e15a4a");
  assert.equal(t.side, "left");
  assert.equal(t.times, 3);
  assert.equal(readTweak("twice").times, 2);
  assert.equal(readTweak("again 40 times").times, 8, "capped");
  assert.equal(readTweak("again").scale, null);
});

test("every change that works is remembered; failures and look-ups are not", () => {
  let w = spawn(labWorld(), "Box").world;
  assert.equal(w.recent!.length, 1);
  assert.deepEqual(w.recent![0].made, [w.nextId - 1]);
  w = call(w, "query_scene", { tag: "spawned" }).world;
  w = call(w, "set_color", { id: "99999", color: "red" }).world;
  assert.equal(w.recent!.length, 1);
  assert.equal(cleanRecent([{ tool: "x", args: { a: "1", b: 2 }, made: [1, "2"] }, null])[0].args.b, undefined);
});

test("do that again, but taller: a copy beside the first, stretched from the ground up", () => {
  const first = spawn(labWorld(), "Pillar");
  const id = first.world.nextId - 1;
  const again = call(first.world, "repeat", { words: "do that again but taller" });
  assert.ok(again.ok, again.result);
  const copy = again.world.entities[again.world.nextId - 1];
  const orig = again.world.entities[id];
  assert.notEqual(copy.id, id);
  assert.ok(Math.hypot(copy.transform.position.x - orig.transform.position.x, copy.transform.position.z - orig.transform.position.z) > 1, "not on top of the first");
  assert.ok(Math.abs(copy.transform.scale.y - orig.transform.scale.y * 1.5) < 1e-9);
  assert.ok(Math.abs(copy.transform.position.y - copy.transform.scale.y / 2 - (orig.transform.position.y - orig.transform.scale.y / 2)) < 1e-9, "same ground");
  const three = call(again.world, "repeat", { words: "3 more, red" });
  assert.equal(three.world.nextId - again.world.nextId, 3);
  const made = [0, 1, 2].map((k) => three.world.entities[again.world.nextId + k]);
  assert.ok(made.every((e) => e.customData.color === "#e15a4a"));
  for (let a = 0; a < made.length; a += 1) for (let b = a + 1; b < made.length; b += 1) assert.ok(Math.hypot(made[a].transform.position.x - made[b].transform.position.x, made[a].transform.position.z - made[b].transform.position.z) > 0.9, "copies do not overlap");
  assert.ok(!call(labWorld(), "repeat", {}).ok, "nothing to repeat yet");
  const undone = call(three.world, "undo", {});
  assert.equal(undone.world.nextId, again.world.nextId, "one undo takes back all the copies");
});

test("a skill is a short program: saved, run in front of you, steps act on their own copies", () => {
  let w = spawn(labWorld(), "Post", 5, 5).world;
  const post = w.nextId - 1;
  w = spawn(w, "Lamp", 5, 5).world;
  const lamp = w.nextId - 1;
  w = call(w, "edit_entity", { id: String(lamp), y: "2.2", x: "5", z: "5", color: "amber" }).world;
  const saved = call(w, "save_skill", { name: "Street lamp", count: "3" });
  assert.ok(saved.ok, saved.result);
  const skill = saved.world.skills.find((s) => s.name === "street_lamp")!;
  assert.equal(skill.steps.length, 3);
  assert.equal(skill.steps[2].arguments.id, "@1", "the edit refers to the lamp the skill makes, not the old one");
  const ran = call(saved.world, "repeat", { skill: "street lamp", words: "bigger" });
  assert.ok(ran.ok, ran.result);
  const madeLamp = ran.world.entities[ran.world.nextId - 1];
  const madePost = ran.world.entities[ran.world.nextId - 2];
  assert.equal(madeLamp.customData.color, "#e2b340");
  assert.equal(ran.world.entities[lamp].customData.color, w.entities[lamp].customData.color, "the old lamp is untouched");
  assert.ok(Math.abs(madeLamp.transform.position.x - madePost.transform.position.x) < 1e-9, "the group keeps its shape");
  assert.ok(madeLamp.transform.scale.x > w.entities[post].transform.scale.x * 1.4);
  // Called by name like a tool, it runs where it was saved.
  const byName = call(saved.world, "street_lamp", {});
  assert.ok(byName.ok, byName.result);
  assert.ok(!call(saved.world, "save_skill", { name: "spawn_entity" }).ok);
  assert.ok(call(saved.world, "list_skills", {}).result.includes("street lamp"));
});

test("instant commands", () => {
  const w = spawn(labWorld(), "Box").world;
  const saved = call(w, "save_skill", { name: "box" }).world;
  assert.deepEqual(skillIntent("Do that again, but taller", w), { tool: "repeat", arguments: { words: "do that again, but taller" } });
  assert.equal(skillIntent("another one", w)?.tool, "repeat");
  assert.equal(skillIntent("again", labWorld()), null, "nothing to repeat");
  assert.deepEqual(skillIntent("remember that as tower", w), { tool: "save_skill", arguments: { name: "tower", count: "1" } });
  assert.deepEqual(skillIntent("save the last 3 things as campfire", w), { tool: "save_skill", arguments: { name: "campfire", count: "3" } });
  assert.deepEqual(skillIntent("build a box to the left", saved), { tool: "repeat", arguments: { skill: "box", words: " to the left" } });
  assert.equal(skillIntent("what skills do you know", w)?.tool, "list_skills");
  assert.equal(skillIntent("build a tower", w), null);
  assert.equal(skillIntent("paint the cube red", w), null);
});

test("edit_entity stretches one axis", () => {
  const w = spawn(labWorld(), "Box").world;
  const id = w.nextId - 1;
  const e = w.entities[id];
  const tall = call(w, "edit_entity", { id: String(id), sy: "2" }).world.entities[id];
  assert.equal(tall.transform.scale.y, e.transform.scale.y * 2);
  assert.equal(tall.transform.scale.x, e.transform.scale.x);
});
