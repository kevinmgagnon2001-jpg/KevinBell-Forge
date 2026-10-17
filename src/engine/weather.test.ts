import { test } from "node:test";
import assert from "node:assert/strict";
import { applyWeatherArgs, blendSky, cleanWeather, clockHour, DEFAULT_WEATHER, labelOf, readWeather, skyFor, sunAt, weatherIntent, weatherOf } from "./weather.ts";
import { executeProposal } from "./harness.ts";
import { labWorld } from "./manifold.ts";
import type { World } from "./types.ts";

const call = (world: World, tool: string, args: Record<string, string>) => executeProposal(world, { kind: "tool_call", toolName: tool, arguments: args });

test("phrases become weather: time words, weather words, moods, clock times", () => {
  const dusk = readWeather("make it rain at dusk")!;
  assert.ok(dusk.rain > 0.5 && dusk.hour > 18 && dusk.hour < 19.5);
  assert.equal(dusk.label, "rain at dusk");
  const fog = readWeather("foggy morning")!;
  assert.ok(fog.fog > 0.5 && fog.hour > 7 && fog.hour < 10 && fog.rain === 0);
  const tokyo = readWeather("rainy tokyo alley")!;
  assert.equal(tokyo.mood, "neon");
  assert.ok(tokyo.rain > 0.4 && (tokyo.hour > 20 || tokyo.hour < 4), "a neon alley is wet, at night");
  const blizzard = readWeather("blizzard at midnight")!;
  assert.ok(blizzard.snow === 1 && blizzard.rain === 0 && blizzard.hour === 0);
  assert.equal(readWeather("light rain")!.rain < readWeather("heavy rain")!.rain, true);
  assert.equal(readWeather("build a tower"), null);
  assert.equal(clockHour("set the time to 7pm"), 19);
  assert.equal(clockHour("7:30 am"), 7.5);
  assert.equal(clockHour("18:45"), 18.75);
  assert.equal(clockHour("12am"), 0);
  assert.equal(clockHour("a 3 m cube"), null);
});

test("what a phrase does not mention stays; stop turns off what it names", () => {
  const wet = readWeather("rain at night")!;
  const misty = readWeather("add some fog", wet)!;
  assert.ok(misty.rain > 0.5 && misty.hour === wet.hour && misty.fog > 0, "fog is added to the rainy night");
  const dry = readWeather("stop the rain", misty)!;
  assert.equal(dry.rain, 0);
  assert.ok(dry.fog > 0, "the fog was not named, so it stays");
  assert.deepEqual(readWeather("back to normal weather", misty), DEFAULT_WEATHER);
  assert.ok(readWeather("speed up time")!.flow > 0);
  const scene = readWeather("foggy morning", readWeather("rainy tokyo alley")!)!;
  assert.ok(scene.rain === 0 && scene.mood === "" && scene.label === "foggy morning", "a whole new scene starts fresh");
});

test("instant commands: weather requests run without a model, builds are left alone", () => {
  assert.deepEqual(weatherIntent("Make it rain at dusk"), { tool: "set_weather", arguments: { words: "make it rain at dusk" } });
  assert.ok(weatherIntent("foggy morning"));
  assert.ok(weatherIntent("set the time to 7pm"));
  assert.ok(weatherIntent("stop the snow"));
  assert.equal(weatherIntent("build a rain machine"), null);
  assert.equal(weatherIntent("paint the cube night blue"), null);
  assert.equal(weatherIntent("good day"), null, "a weak word alone is not a request");
  assert.equal(weatherIntent("wave"), null);
  assert.equal(weatherIntent("spawn a red ball at 3"), null);
});

test("set_weather changes the world, logs, and undoes", () => {
  const world = labWorld();
  const rained = call(world, "set_weather", { words: "rain at dusk" });
  assert.ok(rained.ok, rained.result);
  assert.ok(weatherOf(rained.world).rain > 0.5);
  const tuned = call(rained.world, "set_weather", { fog: "0.9", mood: "eerie" });
  assert.ok(tuned.ok && tuned.world.weather!.fog === 0.9 && tuned.world.weather!.mood === "eerie" && tuned.world.weather!.rain > 0.5);
  assert.ok(!call(world, "set_weather", { mood: "sparkly" }).ok);
  assert.ok(!call(world, "set_weather", { words: "a sandwich" }).ok);
  const undone = call(tuned.world, "undo", {});
  assert.equal(undone.world.weather!.fog, rained.world.weather!.fog);
  const back = call(undone.world, "undo", {});
  assert.equal(back.world.weather, undefined, "undo returns to the lab's own sky");
});

test("the sky: the old lab look at 16:30, night is dark with stars, fog closes in", () => {
  const sun = sunAt(16.5);
  assert.ok(Math.abs(sun[0] + 0.5) < 0.03 && Math.abs(sun[1] - 0.36) < 0.03 && Math.abs(sun[2] + 0.79) < 0.03, `sun ${sun}`);
  const day = skyFor(DEFAULT_WEATHER);
  assert.ok(Math.abs(day.sunIntensity - 2.3) < 0.15 && day.stars < 0.05 && day.fogFar > 300);
  const night = skyFor({ ...DEFAULT_WEATHER, hour: 1, cloud: 0 });
  assert.ok(night.stars > 0.8 && night.lamps > 0.8 && night.sunIntensity < 0.6, "moonlight, fainter than any day");
  assert.ok(night.top[0] + night.top[1] + night.top[2] < 0.2);
  assert.ok(sunAt(1)[1] < 0 && sunAt(12.8)[1] > 0.5 && sunAt(6.3)[1] < 0.05);
  const fog = skyFor({ ...DEFAULT_WEATHER, fog: 1 });
  assert.ok(fog.fogFar < 60 && fog.fogNear < 5);
  const half = blendSky(day, night, 0.5);
  assert.ok(half.stars > 0.3 && half.stars < 0.6);
  assert.ok(Math.abs(Math.hypot(...half.sunDir) - 1) < 1e-9);
});

test("saved weather is checked on load", () => {
  assert.equal(cleanWeather(null), undefined);
  const w = cleanWeather({ hour: 30, rain: 5, mood: "laser", fog: "x" })!;
  assert.equal(w.hour, 6);
  assert.equal(w.rain, 1);
  assert.equal(w.mood, "");
  assert.equal(w.fog, DEFAULT_WEATHER.fog);
  assert.equal(labelOf(w), w.label);
  assert.ok("weather" in applyWeatherArgs(labWorld(), { hour: "25" }));
});
