import assert from "node:assert/strict";
import test from "node:test";
import { bootWorld } from "./manifold.ts";
import type { BondedModel } from "./types.ts";
import { settleIntent } from "./turn.ts";

const model: BondedModel = { name: "demo-bonded", path: "models/test.gguf", loaded: true, validated: false };

test("a web note pulls an image onto the avatar and the critic can iterate", async () => {
  const world = bootWorld();
  const settled = await settleIntent({
    world,
    intent: "Pull a marble texture onto the avatar",
    label: "Gemma",
    model,
    scene: "1 ArchitectAvatar you",
    proposeTurn: async () => {
      throw new Error("field commands should not wait on the actor");
    },
    critiqueTurn: async () => ({ text: '{"pass":true}' }),
    research: async () => ({
      ok: true,
      query: "marble",
      summary: "Marble is a metamorphic rock.",
      title: "Marble",
      source: "https://en.wikipedia.org/wiki/Marble",
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Marble.jpg/512px-Marble.jpg",
    }),
  });
  assert.equal(settled.trace.ok, true, settled.trace.result);
  assert.equal(Object.keys(settled.trace.world.entities).length, 1);
  assert.match(settled.trace.world.entities[1].customData.src, /wikimedia/);
  assert.ok(settled.notes.some((note) => note.title === "Critic" && note.body.includes("agrees")));
});

test("a simple create stays a solid object and does not file a splat", async () => {
  let looked = 0;
  const settled = await settleIntent({
    world: bootWorld(),
    intent: "make a marble statue",
    label: "Gemma",
    model,
    scene: "1 ArchitectAvatar you",
    proposeTurn: async () => ({ text: "I cannot do that", toolCalls: [] }),
    critiqueTurn: null,
    research: async () => {
      looked += 1;
      throw new Error("should not search");
    },
  });
  assert.equal(looked, 0);
  assert.equal(settled.filed.length, 0);
  assert.equal(settled.trace.ok, true, settled.trace.result);
  const spawned = Object.values(settled.trace.world.entities).filter((entity) => !entity.tags.includes("architect"));
  assert.equal(spawned.length, 1);
  assert.notEqual(spawned[0].representation.kind, "gaussian");
  assert.notEqual(spawned[0].customData.neural, "splat");
});

test("a normal forge command does not search the web", async () => {
  let looked = 0;
  const settled = await settleIntent({
    world: bootWorld(),
    intent: "Create a small platform near the origin",
    label: "Gemma",
    model,
    scene: "1 ArchitectAvatar you",
    proposeTurn: async () => ({ text: "sure", toolCalls: [] }),
    critiqueTurn: null,
    research: async () => {
      looked += 1;
      throw new Error("should not search");
    },
  });
  assert.equal(looked, 0);
  assert.equal(settled.trace.ok, true, settled.trace.result);
  assert.equal(settled.filed.length, 0);
  assert.ok(Object.values(settled.trace.world.entities).some((entity) => /platform/i.test(entity.name)));
});

test("an explicit lookup can inject a tool snippet instead of only quoting wikipedia", async () => {
  const settled = await settleIntent({
    world: bootWorld(),
    intent: "Look up a spawn snippet and inject it",
    label: "Gemma",
    model,
    scene: "1 ArchitectAvatar you",
    proposeTurn: async () => {
      throw new Error("a lookup should not wait on the actor");
    },
    critiqueTurn: null,
    research: async () => ({
      ok: true,
      query: "spawn snippet",
      summary: 'Use {"tool":"spawn_entity","arguments":{"name":"Snippet","asset":"sphere","x":"1.4","y":"1","z":"1.2"}}',
      title: "Snippet",
      source: "https://api.duckduckgo.com/?q=spawn",
      imageUrl: "",
    }),
  });
  assert.equal(settled.trace.ok, true, settled.trace.result);
  assert.ok(Object.values(settled.trace.world.entities).some((entity) => entity.name === "Snippet"));
  assert.match(settled.trace.result, /Injected skill/);
});
