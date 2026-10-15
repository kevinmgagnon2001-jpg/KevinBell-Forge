import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_SAMPLE, gaugeIntent, gaugeLevel, gaugeMood, gauges, gaugeText, MESHES, RIGS, SKINS, statById, STATS } from "./gauges.ts";
import { executeProposal } from "./harness.ts";
import { emptyWorld, labWorld, restoreLab } from "./manifold.ts";
import { toolByName } from "./os.ts";
import type { World } from "./types.ts";

const call = (world: World, tool: string, args: Record<string, string>) => executeProposal(world, { kind: "tool_call", toolName: tool, arguments: args });

test("every stat's default mesh exists, and ids are unique", () => {
  const meshes = new Set(MESHES.map((m) => m.id));
  for (const stat of STATS) assert.ok(meshes.has(stat.mesh), stat.id);
  for (const list of [STATS, MESHES, SKINS, RIGS]) assert.equal(new Set(list.map((x) => x.id)).size, list.length);
  for (const rig of RIGS) for (const part of rig.parts) assert.ok(statById(part.stat), `${rig.id} ${part.stat}`);
});

test("readings: levels, moods and text, unknown when the device does not say", () => {
  const heat = statById("heat")!;
  assert.equal(gaugeLevel(heat, EMPTY_SAMPLE), null);
  assert.equal(gaugeMood(heat, null), "unknown");
  assert.equal(gaugeText(heat, EMPTY_SAMPLE), "no reading");
  const hot = { ...EMPTY_SAMPLE, tempC: 47 };
  assert.equal(gaugeLevel(heat, hot), 0.9);
  assert.equal(gaugeMood(heat, gaugeLevel(heat, hot)), "danger");
  assert.equal(gaugeText(heat, hot), "47 °C");
  // Frame rate tops out at the screen's refresh: 60 fps on a 120 Hz phone is half way.
  const fps = statById("fps")!;
  assert.equal(gaugeLevel(fps, { ...EMPTY_SAMPLE, fps: 60, refresh: 120 }), 0.5);
  assert.equal(gaugeMood(fps, 0.2), "danger");
  const battery = statById("battery")!;
  assert.equal(gaugeMood(battery, gaugeLevel(battery, { ...EMPTY_SAMPLE, battery: 80 })), "calm");
});

test("the lab opens with the engine room, and restoring the lab keeps one of each", () => {
  const lab = labWorld();
  const room = gauges(lab);
  assert.equal(room.length, RIGS[0].parts.length);
  assert.deepEqual(room.map((g) => g.customData.stat).sort(), RIGS[0].parts.map((p) => p.stat).sort());
  assert.ok(room.every((g) => g.customData.skin === "brass"));
  assert.equal(gauges(restoreLab(lab)).length, room.length);
});

test("tools: place, restyle and rigs, with clear errors", () => {
  let world = emptyWorld();
  const placed = call(world, "place_gauge", { stat: "heat", skin: "neon" });
  assert.ok(placed.ok, placed.result);
  world = placed.world;
  const [g] = gauges(world);
  assert.equal(g.customData.mesh, "thermometer");
  assert.equal(g.name, "Heat Thermometer");

  const restyled = call(world, "style_gauge", { id: String(g.id), mesh: "boiler", skin: "copper" });
  assert.ok(restyled.ok, restyled.result);
  const after = restyled.world.entities[g.id];
  assert.equal(after.customData.mesh, "boiler");
  assert.equal(after.customData.skin, "copper");
  assert.equal(after.name, "Heat Boiler");

  assert.match(call(world, "place_gauge", { stat: "vibes" }).result, /stat must be/);
  assert.match(call(world, "style_gauge", { id: "*", skin: "plaid" }).result, /skin must be/);

  // A rig restyles the heat gauge it finds and adds the rest.
  const rig = call(world, "build_gauge_rig", { rig: "cyber" });
  assert.ok(rig.ok, rig.result);
  assert.equal(gauges(rig.world).length, 4);
  assert.ok(gauges(rig.world).every((x) => x.customData.skin === "neon"));
  // Undo takes the whole rig back.
  assert.equal(gauges(call(rig.world, "undo", {}).world).length, 1);
  for (const tool of ["place_gauge", "style_gauge", "build_gauge_rig"]) assert.ok(toolByName(tool), tool);
});

test("instant commands: plain requests become tool calls without a model", () => {
  const lab = labWorld();
  assert.deepEqual(gaugeIntent("build the engine room", emptyWorld()), { tool: "build_gauge_rig", arguments: { rig: "engine-room" } });
  assert.deepEqual(gaugeIntent("set up a cyberpunk room", lab), { tool: "build_gauge_rig", arguments: { rig: "cyber", skin: "neon" } });
  assert.deepEqual(gaugeIntent("add a neon thermometer for the heat", lab), { tool: "place_gauge", arguments: { stat: "heat", mesh: "thermometer", skin: "neon" } });
  assert.deepEqual(gaugeIntent("add a boiler gauge for memory", lab), { tool: "place_gauge", arguments: { stat: "memory", mesh: "boiler" } });
  assert.deepEqual(gaugeIntent("make the gauges steampunk", lab), { tool: "style_gauge", arguments: { id: "*", skin: "brass" } });
  const heatId = gauges(lab).find((g) => g.customData.stat === "heat")!.id;
  assert.deepEqual(gaugeIntent("switch the heat gauge to copper", lab), { tool: "style_gauge", arguments: { id: String(heatId), skin: "copper" } });
  assert.deepEqual(gaugeIntent("turn every gauge into a tesla coil", lab), { tool: "style_gauge", arguments: { id: "*", mesh: "coil" } });
  // Not about gauges: the model decides.
  assert.equal(gaugeIntent("paint the cube named Clay teal", lab), null);
  assert.equal(gaugeIntent("walk forward", lab), null);
  assert.equal(gaugeIntent("make it hot pink", lab), null);
});
