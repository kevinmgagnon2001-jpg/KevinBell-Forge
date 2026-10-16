import { test } from "node:test";
import assert from "node:assert/strict";
import { activity, cleanReply, heard, mouthAt, mouthTrack, nearestPerson, personaPrompt, placePhrase, scriptedReply, voiceOf } from "./talk.ts";
import { executeProposal } from "./harness.ts";
import { labWorld } from "./manifold.ts";
import { NPC_TAG } from "./town.ts";
import type { World } from "./types.ts";

const town = (): World => executeProposal(labWorld(), { kind: "tool_call", toolName: "fill_town", arguments: { count: "4", seed: "3" } }).world;
const firstPerson = (w: World) => Object.values(w.entities).find((e) => e.tags.includes(NPC_TAG))!;

test("the prompt puts the model in their shoes: name, traits, what they are doing, what you said", () => {
  const w = town();
  const who = firstPerson(w);
  const p = personaPrompt(w, who.id, "what are you up to?")!;
  assert.match(p, new RegExp(`You are ${who.name}`));
  for (const t of w.town!.minds[who.id].traits) assert.ok(p.includes(t));
  assert.match(p, /Right now you are/);
  assert.match(p, /what are you up to\?/);
  assert.equal(personaPrompt(w, 99999, "hi"), null);
});

test("without a model they still answer from what they know", () => {
  const w = town();
  const who = firstPerson(w);
  const doing = scriptedReply(w, who.id, "What are you doing?");
  assert.match(doing, /I'm /);
  assert.match(scriptedReply(w, who.id, "who are you?"), new RegExp(who.name));
  assert.ok(scriptedReply(w, who.id, "hello").length > 3);
  assert.ok(scriptedReply(w, who.id, "bye").length > 1);
  assert.equal(scriptedReply(w, who.id, "nice weather"), scriptedReply(w, who.id, "nice weather"), "the same words get the same answer");
});

test("they remember talking with you", () => {
  let w = town();
  const who = firstPerson(w);
  assert.match(scriptedReply(w, who.id, "do you remember me?"), /met/);
  w = heard(w, who.id, "The tall tower by the lake!");
  const memory = w.town!.minds[who.id].memory.at(-1)!;
  assert.equal(memory.kind, "talked");
  assert.match(memory.text, /talked with you about the tall tower by the/);
  assert.match(scriptedReply(w, who.id, "do you remember me?"), /tall tower/);
  assert.match(personaPrompt(w, who.id, "hi")!, /talked with this person before/);
});

test("a model's answer is cut to what a person says", () => {
  assert.equal(cleanReply('"*waves* Hi there! (smiling) Lovely day."'), "Hi there! Lovely day.");
  assert.equal(cleanReply("Mia: Sure thing."), "Sure thing.");
  const long = cleanReply("One. ".repeat(80));
  assert.ok(long.length <= 220 && long.endsWith("."));
});

test("each person has their own steady voice, and the nearest one in reach is found", () => {
  const w = town();
  const [a, b] = Object.values(w.entities).filter((e) => e.tags.includes(NPC_TAG));
  assert.deepEqual(voiceOf(a), voiceOf(a));
  assert.notDeepEqual(voiceOf(a), voiceOf(b));
  const v = voiceOf(a);
  assert.ok(v.pitch > 0.5 && v.pitch < 2 && v.rate > 0.5 && v.rate < 1.5);
  const live = { [a.id]: { x: 1, z: 1 }, [b.id]: { x: 9, z: 9 } };
  assert.equal(nearestPerson(w, { x: 1.5, z: 1 }, live)?.id, a.id);
  assert.equal(nearestPerson(w, { x: 5, z: 5 }, live), null);
});

test("plans read as things you can be doing, somewhere", () => {
  assert.equal(activity("lunch"), "having lunch");
  assert.equal(activity("a morning jog"), "out for a morning jog");
  assert.equal(activity("an errand"), "running an errand");
  assert.equal(activity("a quiet afternoon"), "having a quiet afternoon");
  assert.equal(activity("winding down"), "winding down");
  assert.equal(placePhrase("home"), "at home");
  assert.equal(placePhrase("the lamps"), "at the lamps");
  assert.equal(placePhrase("Bench"), "by the Bench");
});

test("mouth shapes follow the words: open on vowels, shut on b m p, still between lines", () => {
  const track = mouthTrack("Hello, my name is Bob.");
  const end = track[track.length - 1].at;
  assert.ok(end > 0.8 && end < 4, `about as long as saying it: ${end.toFixed(2)} s`);
  for (let i = 1; i < track.length; i += 1) assert.ok(track[i].at >= track[i - 1].at, "in time order");
  let most = 0;
  for (let t = 0; t < end; t += 0.01) most = Math.max(most, mouthAt(track, t).open);
  assert.ok(most > 0.8, "opens wide somewhere");
  assert.ok(track.some((k) => k.open === 0 && k.at > 0.1 && k.at < end - 0.1), "closes between");
  assert.ok(track.some((k) => k.round > 0.5), "rounds for o");
  assert.deepEqual(mouthAt(track, -1), { open: 0, round: 0 });
  assert.deepEqual(mouthAt(track, end + 1), { open: 0, round: 0 });
  const fast = mouthTrack("Hello, my name is Bob.", 1.5);
  assert.ok(fast[fast.length - 1].at < end, "a faster voice is quicker");
});
