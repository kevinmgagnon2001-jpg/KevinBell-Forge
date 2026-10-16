import { test } from "node:test";
import assert from "node:assert/strict";
import { seedOf, soundIntent, soundRecipe, SOUND_KINDS, setSound, recipeOf } from "./sounds.ts";
import { RATE, render } from "./synth.ts";
import { executeProposal } from "./harness.ts";
import { labWorld } from "./manifold.ts";
import type { World } from "./types.ts";

const call = (world: World, tool: string, args: Record<string, string>) => executeProposal(world, { kind: "tool_call", toolName: tool, arguments: args });

test("words to a recipe: the sound named first, shaped by the rest", () => {
  const ghost = soundRecipe("creak like a ghost ship")!;
  assert.equal(ghost.kind, "creak");
  assert.ok(ghost.pitch < 1 && ghost.echo > 0.4 && !ghost.loop);
  assert.equal(soundRecipe("a deep hum")!.kind, "hum");
  assert.ok(soundRecipe("a deep hum")!.pitch < 1 && soundRecipe("a deep hum")!.loop);
  const sad = soundRecipe("slow sad music")!;
  assert.equal(sad.mode, "minor");
  assert.ok(Math.abs(sad.length - (16 * 60) / sad.tempo) < 1e-9);
  assert.equal(soundRecipe("a sandwich"), null);
  assert.equal(seedOf("x"), seedOf("x"));
  assert.ok(soundRecipe("chime once")!.loop === false && soundRecipe("keep chiming always")!.loop === true);
});

test("every kind renders, deterministically, without clipping or silence", () => {
  for (const kind of SOUND_KINDS) {
    const r = soundRecipe(kind === "music" ? "music" : kind)!;
    assert.equal(r.kind, kind, kind);
    const a = render(r);
    const b = render(r);
    assert.deepEqual(a.slice(0, 2000), b.slice(0, 2000), `${kind} is deterministic`);
    let peak = 0;
    let energy = 0;
    for (const v of a) {
      assert.ok(Number.isFinite(v));
      peak = Math.max(peak, Math.abs(v));
      energy += v * v;
    }
    assert.ok(peak <= 0.9 + 1e-6 && peak > 0.2, `${kind} peak ${peak}`);
    assert.ok(energy / a.length > 1e-4, `${kind} is audible`);
    assert.ok(a.length <= 25 * RATE);
  }
});

test("loops meet themselves at the seam", () => {
  const hum = render(soundRecipe("hum")!);
  assert.ok(Math.abs(hum[hum.length - 1] - hum[0]) < 0.2);
});

test("set_sound: on an entity, on the scene, and off again; undoable", () => {
  const world = labWorld();
  const clay = Object.values(world.entities).find((e) => e.name === "Clay")!;
  const ran = call(world, "set_sound", { id: String(clay.id), words: "creak like a ghost ship" });
  assert.ok(ran.ok, ran.result);
  assert.equal(recipeOf(ran.world.entities[clay.id])!.kind, "creak");
  const off = call(ran.world, "set_sound", { id: String(clay.id), words: "none" });
  assert.equal(off.world.entities[clay.id].customData.sound, undefined);
  const score = call(world, "set_sound", { id: "scene", words: "calm" });
  assert.ok(score.ok && score.world.score === "calm");
  assert.equal(call(score.world, "undo", {}).world.score, undefined);
  assert.ok(!setSound(world, { id: "999", words: "hum" }).ok);
  assert.ok(!setSound(world, { id: String(clay.id), words: "a sandwich" }).ok);
});

test("instant commands: sounds, the score, sparkle", () => {
  const world = labWorld();
  const clay = Object.values(world.entities).find((e) => e.name === "Clay")!;
  assert.deepEqual(soundIntent("Make Clay creak like a ghost ship", world, null), { tool: "set_sound", arguments: { id: String(clay.id), words: "creak like a ghost ship" } });
  assert.deepEqual(soundIntent("score this scene", world, null), { tool: "set_sound", arguments: { id: "scene", words: "music " } });
  assert.equal(soundIntent("play some sad music", world, null)?.arguments.id, "scene");
  assert.deepEqual(soundIntent("stop the music", world, null), { tool: "set_sound", arguments: { id: "scene", words: "none" } });
  assert.deepEqual(soundIntent("make clay sparkle", world, null), { tool: "edit_entity", arguments: { id: String(clay.id), finish: "glint" } });
  assert.deepEqual(soundIntent("make it glitter", world, clay.id), { tool: "edit_entity", arguments: { id: String(clay.id), finish: "glint" } });
  assert.equal(soundIntent("make it hum", world, null), null, "nothing selected, no name");
  assert.equal(soundIntent("build a fire pit", world, null), null);
  const glinty = call(world, "edit_entity", { id: String(clay.id), finish: "glint" });
  assert.equal(glinty.world.entities[clay.id].customData.finish, "glint");
  assert.equal(call(glinty.world, "edit_entity", { id: String(clay.id), finish: "plain" }).world.entities[clay.id].customData.finish, undefined);
});
