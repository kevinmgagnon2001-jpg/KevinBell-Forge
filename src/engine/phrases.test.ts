import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPhrases, forget, phraseFor, readPhraseRequest, teach } from "./phrases.ts";

test("teach, use, forget and list phrases", () => {
  const t = readPhraseRequest("When I say party, light a campfire then make it rain");
  assert.deepEqual(t, { kind: "teach", say: "party", does: "light a campfire then make it rain" });
  assert.deepEqual(readPhraseRequest('when i say "lights out" do make it midnight'), { kind: "teach", say: "lights out", does: "make it midnight" });
  assert.deepEqual(readPhraseRequest("teach tower as stack 6 crates on the bench"), { kind: "teach", say: "tower", does: "stack 6 crates on the bench" });
  let phrases = teach(undefined, "party", "light a campfire");
  phrases = teach(phrases, "party", "fill the plaza with people");
  assert.equal(phrases.length, 1, "teaching again replaces");
  assert.equal(phraseFor(phrases, "Party!"), "fill the plaza with people");
  assert.equal(phraseFor(phrases, "a party"), null);
  assert.deepEqual(readPhraseRequest("forget party"), { kind: "forget", say: "party" });
  assert.equal(forget(phrases, "party").length, 0);
  assert.deepEqual(readPhraseRequest("my phrases"), { kind: "list" });
  assert.equal(readPhraseRequest("make a red cube"), null);
  assert.deepEqual(cleanPhrases([{ say: "A", does: "b" }, { say: 1 }, null]), [{ say: "a", does: "b" }]);
});
