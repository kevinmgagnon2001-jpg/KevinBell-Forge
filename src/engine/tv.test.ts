import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN, channelsWith, embedUrl, ensureTv, parseChannel, setTvOn, switchChannel, tvChannel, tvIsOn, tvOf, watchUrl } from "./tv.ts";

test("links people paste become channels; anything else is refused", () => {
  assert.equal(parseChannel("https://www.twitch.tv/watchmeforever")?.id, "twitch:watchmeforever");
  assert.equal(parseChannel("twitch.tv/SomeStreamer")?.ref, "somestreamer");
  assert.equal(parseChannel("https://m.twitch.tv/somestreamer")?.kind, "twitch");
  assert.equal(parseChannel("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")?.ref, "dQw4w9WgXcQ");
  assert.equal(parseChannel("https://youtu.be/dQw4w9WgXcQ")?.ref, "dQw4w9WgXcQ");
  assert.equal(parseChannel("https://www.youtube.com/live/jfKfPfyJRdk?si=x")?.ref, "jfKfPfyJRdk");
  for (const bad of ["", "hello", "https://twitch.tv/directory", "https://twitch.tv/a/b", "https://evil.example/watchmeforever", "javascript:alert(1)", "https://youtube.com/watch?v=short", "https://www.youtube.com/@someone"]) {
    assert.equal(parseChannel(bad), null, bad);
  }
});

test("players come only from Twitch and YouTube, with Twitch told which page embeds it", () => {
  const twitch = embedUrl(BUILT_IN[0], "tauri.localhost");
  assert.ok(twitch.startsWith("https://player.twitch.tv/?channel=watchmeforever&parent=tauri.localhost"));
  const yt = embedUrl(parseChannel("youtu.be/dQw4w9WgXcQ")!, "x");
  assert.ok(yt.startsWith("https://www.youtube.com/embed/dQw4w9WgXcQ?"));
  assert.equal(watchUrl(BUILT_IN[0]), "https://www.twitch.tv/watchmeforever");
});

test("the TV is in the lab once, turns on and changes channel round the list", () => {
  const world = ensureTv({ entities: {}, nextId: 1 });
  assert.equal(ensureTv(world), world);
  assert.equal(tvIsOn(tvOf(world)), false);
  const all = channelsWith([parseChannel("twitch.tv/somestreamer")!, BUILT_IN[0]]);
  assert.equal(all.length, 2, "no duplicates of built-in channels");
  let w = setTvOn(world, true);
  assert.equal(tvIsOn(tvOf(w)), true);
  w = switchChannel(w, all.length, 1);
  assert.equal(tvChannel(tvOf(w), all.length), 1);
  w = switchChannel(w, all.length, 1);
  assert.equal(tvChannel(tvOf(w), all.length), 0, "wraps round");
  w = switchChannel(setTvOn(w, false), all.length, -1);
  assert.equal(tvChannel(tvOf(w), all.length), 1, "wraps backwards");
  assert.equal(tvIsOn(tvOf(w)), true, "changing channel turns it on");
});
