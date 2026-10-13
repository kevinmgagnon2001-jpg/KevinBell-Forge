import assert from "node:assert/strict";
import test from "node:test";
import { propose, sceneRefs } from "./bonded.ts";
import { executeProposal } from "./harness.ts";
import { bootWorld } from "./manifold.ts";
import { DEFAULT_MODEL_PATH, TOOL_NAMES } from "./os.ts";
import { DEFAULT_RESIDENT_ID, RESIDENT_MODELS, isResidentId, residentById } from "./resident-catalog.ts";
import { interpretResident, parseResidentReply, residentPrompt } from "./resident-parse.ts";
import type { BondedModel } from "./types.ts";

const model: BondedModel = {
  name: "demo-bonded",
  path: DEFAULT_MODEL_PATH,
  loaded: true,
  validated: false,
};

test("Gemma is the out-of-the-box resident", () => {
  const resident = residentById(DEFAULT_RESIDENT_ID);
  assert.equal(resident.family, "Gemma");
  assert.equal(resident.outOfTheBox, true);
  assert.match(resident.repo, /gemma/i);
  assert.equal(RESIDENT_MODELS.filter((item) => item.outOfTheBox).length, 1);
  assert.ok(RESIDENT_MODELS.some((item) => item.family !== "Gemma"));
});

test("Spark-X2.5-4B is a selectable resident", () => {
  const spark = residentById("spark-x2.5-4b");
  assert.equal(isResidentId("spark-x2.5-4b"), true);
  assert.equal(spark.label, "Spark-X2.5-4B");
  assert.equal(spark.family, "Spark");
  assert.equal(spark.outOfTheBox, false);
  assert.equal(spark.repo, "PollardWeights/Spark-X2.5-4B-Pollard");
  assert.equal(spark.file, "Spark-X2.5-4B-Pollard-IQ3_S.gguf");
  assert.equal(spark.size, "1.9 GB");
  assert.equal(residentById(DEFAULT_RESIDENT_ID).id, "gemma-3-270m");
});

test("parseResidentReply reads a tool call and refuses prose", () => {
  const call = parseResidentReply(
    'Sure\n{"tool":"spawn_entity","arguments":{"name":"Court","x":0,"y":0,"z":0,"asset":"platform"}}',
  );
  assert.equal(call.kind, "tool_call");
  assert.equal(call.toolName, "spawn_entity");
  assert.equal(call.arguments.name, "Court");
  assert.equal(call.arguments.asset, "platform");

  const flat = parseResidentReply('{"tool":"query_scene","tag":"spawned"}');
  assert.equal(flat.toolName, "query_scene");
  assert.equal(flat.arguments.tag, "spawned");

  const note = parseResidentReply('{"tool":null,"message":"need a name"}');
  assert.equal(note.kind, "message");
  assert.equal(note.message, "need a name");

  const prose = parseResidentReply("I cannot do that.");
  assert.equal(prose.kind, "message");
  assert.equal(prose.toolName, undefined);
});

test("parseResidentReply skips thought garbage and keeps the tool call", () => {
  const call = parseResidentReply(
    '<|channel>thought\nramble {not json more junk\n<channel|>{"tool":"spawn_entity","name":"Beacon","x":3,"y":1.2,"z":-2,"asset":"gaussian"}',
  );
  assert.equal(call.kind, "tool_call");
  assert.equal(call.toolName, "spawn_entity");
  assert.equal(call.arguments.name, "Beacon");
  assert.equal(call.arguments.asset, "gaussian");
});

test("resident prompt asks the model to choose and keeps the command last", () => {
  const prompt = residentPrompt("1 Architect avatar none 0.0,1.0,0.0", "Create a platform named Court at 0, 0, 0");
  assert.match(prompt, /Choose the one tool/);
  assert.match(prompt, /set_color recolors/);
  assert.match(prompt, /Never spawn to edit/);
  const command = prompt.indexOf("Command: Create a platform named Court at 0, 0, 0");
  assert.ok(command > prompt.indexOf("set_color"));
  assert.equal(prompt.includes('"name":"Court"'), false);
  assert.equal(prompt.includes("Use spawn_entity"), false);
});

test("garbage from the model does not hide the command", () => {
  const world = bootWorld();
  const intent = "Create a platform named Court at 0, 0, 0";
  const proposal = interpretResident(
    world,
    "Gemma 3 270M",
    intent,
    "asdfkj ¤¤¤ ◌◌ the mitochondria is the powerhouse",
    [],
    model,
  );
  assert.equal(proposal.kind, "tool_call");
  assert.equal(proposal.toolName, "spawn_entity");
  assert.equal(proposal.arguments.name, "Court");
  assert.match(proposal.message ?? "", /harness read the command/);
  assert.equal((proposal.message ?? "").includes("mitochondria"), false);

  const executed = executeProposal(world, proposal);
  assert.equal(executed.ok, true, executed.result);
  assert.ok(Object.values(executed.world.entities).some((entity) => entity.name === "Court"));
});

test("the model keeps the tool it chose, even when the words also sound like a spawn", () => {
  let world = bootWorld();
  world = executeProposal(world, {
    kind: "tool_call",
    toolName: "spawn_entity",
    arguments: { name: "Court", x: "0", y: "0", z: "0", asset: "platform" },
  }).world;
  const court = Object.values(world.entities).find((entity) => entity.name === "Court");
  assert.ok(court);
  const proposal = interpretResident(
    world,
    "Gemma 3 270M",
    "make Court blue",
    "",
    [{ name: "set_color", arguments: `{"id":${court.id},"color":"blue"}` }],
    model,
  );
  assert.equal(proposal.toolName, "set_color");
  assert.match(proposal.message ?? "", /chose set_color/);
  assert.equal((proposal.message ?? "").includes("harness"), false);
  const painted = executeProposal(world, proposal);
  assert.equal(Object.keys(painted.world.entities).length, Object.keys(world.entities).length);
  assert.equal(painted.world.entities[court.id].customData.color, "#4c8df5");
});

test("a spawn of an object already in the scene edits it instead", () => {
  let world = bootWorld();
  world = executeProposal(world, {
    kind: "tool_call",
    toolName: "spawn_entity",
    arguments: { name: "Court", x: "0", y: "0", z: "0", asset: "platform" },
  }).world;
  const before = Object.keys(world.entities).length;
  const proposal = interpretResident(
    world,
    "Gemma 3 270M",
    "edit Court and paint it teal",
    '{"tool":"spawn_entity","name":"Court","x":0,"y":0,"z":0,"asset":"platform","color":"teal"}',
    [],
    model,
  );
  assert.equal(proposal.toolName, "set_color");
  const next = executeProposal(world, proposal);
  assert.equal(Object.keys(next.world.entities).length, before);
  const court = Object.values(next.world.entities).find((entity) => entity.name === "Court");
  assert.equal(court?.customData.color, "#2fbfc2");
});
test("a real tool call from the model is kept", () => {
  const world = bootWorld();
  const proposal = interpretResident(
    world,
    "Gemma 3 270M",
    "Create a platform named Court at 0, 0, 0",
    "",
    [{ name: "spawn_entity", arguments: '{"name":"Court","x":0,"y":0,"z":0,"asset":"platform"}' }],
    model,
  );
  assert.equal(proposal.toolName, "spawn_entity");
  assert.match(proposal.message ?? "", /chose spawn_entity/);
  assert.equal((proposal.message ?? "").includes("harness"), false);

  const direct = propose(model, "Create a platform named Court at 0, 0, 0", sceneRefs(world.entities), TOOL_NAMES);
  assert.equal(direct.toolName, "spawn_entity");
});
