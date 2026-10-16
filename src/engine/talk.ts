/**
 * Talking with the townsfolk (after Generative Agents, and the Papers roadmap's talking NPCs): walk
 * up to someone and say something, typed or spoken. They answer in character from what they are
 * doing, their traits, the weather and their memory of the day, and they remember the talk.
 *
 *   personaPrompt   the prompt for the resident model, when one is loaded (Talk.tsx asks it).
 *   scriptedReply   the answer without a model: the same facts, in a voice set by their traits.
 *   cleanReply      a model's answer cut to a line or two, no stage directions.
 *   heard           the world after the talk: a "talked" memory in their stream.
 *   voiceOf         pitch and rate for on-device speech, steady per person.
 */
import type { Entity, World } from "./types.ts";
import { clock, dayOf, goalOf, hourOf, NPC_TAG, placesOf, remember, stepNow, type Mind, type Town } from "./town.ts";
import { weatherOf } from "./weather.ts";

export const TALK_REACH = 1.7;

const EMPTY: Mind = { traits: [], plan: [], memory: [] };

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
const pick = <T>(list: T[], key: string): T => list[hash(key) % list.length];

type Facts = {
  name: string;
  traits: string[];
  doing: string;
  place: string;
  time: string;
  hour: number;
  weather: string;
  raining: boolean;
  today: string[];
  next: string | null;
  metBefore: boolean;
  lastTopic: string | null;
};

/** "lunch" → "having lunch", "a morning jog" → "out for a morning jog": something you can be doing. */
export function activity(doing: string): string {
  const d = doing.trim();
  if (/^(a|an) (morning |evening )?(jog|walk|run|stroll)\b/.test(d)) return `out for ${d}`;
  if (/^an errand\b/.test(d)) return "running an errand";
  if (/^(lunch|dinner|breakfast|coffee|tea)\b/.test(d)) return `having ${d}`;
  if (/^(a|an) /.test(d)) return `having ${d}`;
  return d;
}

/** "home" → "at home", "the lamps" → "at the lamps", "Bench" → "by the Bench". */
export function placePhrase(place: string): string {
  if (/^home$/i.test(place)) return "at home";
  if (/^the /i.test(place)) return `at ${place}`;
  return `by the ${place}`;
}

function factsOf(world: World, who: Entity): Facts | null {
  const town = world.town;
  if (!town) return null;
  const mind = town.minds[who.id] ?? EMPTY;
  const hour = hourOf(town);
  const w = weatherOf(world);
  const raining = w.rain > 0.3 || w.snow > 0.3 || w.storm > 0.3;
  const goal = goalOf(who, mind, placesOf(world), hour, raining);
  const now = stepNow(mind, hour);
  const later = mind.plan.find((s) => s.from > hour);
  const since = dayOf(town) * 1440 - town.startHour * 60;
  const today = mind.memory.filter((m) => m.at >= since && m.kind !== "plan").slice(-5).map((m) => m.text);
  const talks = mind.memory.filter((m) => m.kind === "talked" && /\byou\b|the architect/i.test(m.text));
  const last = talks.at(-1)?.text.match(/about (.+)$/)?.[1] ?? null;
  return {
    name: who.name,
    traits: mind.traits,
    doing: mind.errand ? `on my way to ${mind.errand}` : `${activity(goal.doing || now.doing)} ${placePhrase(goal.place ?? now.place)}`,
    place: mind.errand ?? goal.place ?? now.place,
    time: clock(town, town.minutes),
    hour,
    weather: w.label || "clear",
    raining,
    today,
    next: later ? `${activity(later.doing)} ${placePhrase(later.place)}` : null,
    metBefore: talks.length > 0,
    lastTopic: last,
  };
}

/** The townsperson you are talking to, by id, if there is one. */
export function personOf(world: World, id: number): Entity | null {
  const e = world.entities[id];
  return e && e.tags.includes(NPC_TAG) ? e : null;
}

/** The prompt for the resident model: who they are, their day, and what was said. */
export function personaPrompt(world: World, id: number, said: string): string | null {
  const who = personOf(world, id);
  const f = who && factsOf(world, who);
  if (!f) return null;
  return [
    `You are ${f.name}, who lives in this little town. You are ${f.traits.join(" and ") || "friendly"}.`,
    `It is ${f.time}, ${f.weather}. Right now you are ${f.doing}.`,
    f.today.length ? `Earlier today you: ${f.today.join("; ")}.` : "Nothing much has happened yet today.",
    f.next ? `Later you plan to be ${f.next}.` : "",
    f.metBefore ? `You have talked with this person before${f.lastTopic ? `, about ${f.lastTopic}` : ""}.` : "You have not met this person before.",
    `The person in front of you (the one who builds this world) says: "${said.slice(0, 240)}"`,
    "Answer as yourself, out loud, in one or two short sentences. No stage directions, no quotes, no lists.",
  ]
    .filter(Boolean)
    .join("\n");
}

const has = (traits: string[], t: string) => traits.includes(t);

/** An answer without a model: what they know, said the way they would say it. */
export function scriptedReply(world: World, id: number, said: string): string {
  const who = personOf(world, id);
  const f = who && factsOf(world, who);
  if (!f) return "…";
  const q = said.trim().toLowerCase();
  const key = `${f.name}|${q}|${f.time.slice(0, 2)}`;
  const shy = has(f.traits, "shy");
  const chatty = has(f.traits, "chatty");
  const open = shy ? pick(["Oh! Um, hi.", "Oh, hello…", "Hi."], key) : chatty ? pick(["Hey you! Good to see you.", "Oh, hi there!", "Well hello!"], key) : pick(["Hi.", "Hey.", "Hello there."], key);
  const tail = chatty && f.today.length ? ` ${pick(["Guess what, earlier I", "Oh, and today I"], key)} ${f.today.at(-1)}.` : "";

  if (/^(hi|hey|hello|yo|good (morning|afternoon|evening)|howdy)\b/.test(q) || !q) {
    const greet = f.hour < 12 ? "Morning!" : f.hour < 18 ? "Afternoon." : "Evening.";
    const again = f.metBefore ? pick([" Back again?", " Nice to see you again."], key) : "";
    return `${shy ? open : greet}${again} I'm ${f.doing}.${tail}`.trim();
  }
  if (/\b(who are you|your name|what.?s your name)\b/.test(q)) {
    const self = f.traits.length ? ` People say I'm ${f.traits.join(" and ")}.` : "";
    return `${open} I'm ${f.name}.${self}`;
  }
  if (/\b(what are you (doing|up to)|what.?s up|busy)\b/.test(q)) return `${open} I'm ${f.doing}.${f.next ? ` After this, ${f.next}.` : ""}`;
  if (/\b(where are you (going|headed|off to)|plans?|later)\b/.test(q)) return f.next ? `Later I'll be ${f.next}.` : `Home, probably. It's ${f.time}.`;
  if (/\b(today|did you do|your day|been up to)\b/.test(q)) {
    if (!f.today.length) return `${open} Not much yet, honestly. It's only ${f.time}.`;
    return `Let's see… I ${f.today.slice(-3).join(", then ")}.`;
  }
  if (/\b(weather|rain|snow|cold|hot|sunny|storm)\b/.test(q)) {
    if (f.raining) return has(f.traits, "sporty") ? "A bit of rain never stopped me." : "I'd rather be indoors in this, to be honest.";
    return has(f.traits, "dreamy") ? "Look at that sky. I could watch it all day." : `It's ${f.weather}. Not bad at all.`;
  }
  if (/\b(how are you|how.?s it going|you ok|you good)\b/.test(q)) {
    const mood = has(f.traits, "busy") ? "Busy, always busy." : has(f.traits, "dreamy") ? "Half in a daydream, as usual." : has(f.traits, "night owl") && f.hour < 11 ? "Still waking up, honestly." : has(f.traits, "early bird") && f.hour > 20 ? "Tired! It's late for me." : "Good, thanks.";
    return `${mood} I'm ${f.doing}.`;
  }
  if (/\b(remember|last time|before)\b/.test(q)) return f.metBefore ? `Of course I remember you${f.lastTopic ? `, we talked about ${f.lastTopic}` : ""}.` : "Have we met? I don't think so.";
  if (/\b(bye|goodbye|see you|later|cya)\b/.test(q)) return shy ? "Bye…" : pick(["See you around!", "Take care!", "Bye now!"], key);
  if (/\?$/.test(q)) return has(f.traits, "curious") ? `Ooh, good question. I wonder that too. What do you think?` : shy ? "I… I'm not sure." : `Hmm, I don't know. I'm just ${f.doing}.`;
  return `${open} ${pick(["Right, right.", "Is that so?", "Huh, I'll think about that."], key)}${tail}`;
}

/** A model's answer cut to what a person says: no actions in asterisks, no quotes, a line or two. */
export function cleanReply(text: string): string {
  let t = text.replace(/\*[^*]*\*/g, " ").replace(/\([^)]*\)/g, " ").replace(/^["'“”\s]+|["'“”\s]+$/g, "");
  t = t.replace(/^[A-Z][a-z]+:\s*/, "").replace(/\s+/g, " ").trim();
  const sentences = t.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) ?? [t];
  let out = "";
  for (const s of sentences) {
    if ((out + s).length > 220) break;
    out += s;
  }
  return (out || t.slice(0, 220)).trim();
}

/** The world after a talk: they remember it (the topic is the first few words you said). */
export function heard(world: World, id: number, said: string): World {
  const town = world.town;
  const who = personOf(world, id);
  if (!town || !who) return world;
  const mind = town.minds[id] ?? EMPTY;
  const topic = said.trim().toLowerCase().replace(/[^\w\s']/g, "").split(/\s+/).slice(0, 5).join(" ") || "nothing much";
  const next: Town = { ...town, minds: { ...town.minds, [id]: remember(mind, { at: town.minutes, kind: "talked", importance: 6, text: `talked with you about ${topic}` }) } };
  return { ...world, town: next };
}

/** A voice for someone: pitch and rate, steady per person, nudged by their traits. */
export function voiceOf(who: Entity, traits: string[] = []): { pitch: number; rate: number; index: number } {
  const h = hash(who.name);
  const pitch = 0.8 + ((h % 1000) / 1000) * 0.6 + (has(traits, "shy") ? 0.1 : 0);
  const rate = 0.92 + (((h >>> 10) % 1000) / 1000) * 0.18 + (has(traits, "chatty") || has(traits, "busy") ? 0.08 : 0) - (has(traits, "dreamy") ? 0.08 : 0);
  return { pitch, rate, index: h >>> 20 };
}

/** The closest townsperson within reach of `at`, from their live positions. */
export function nearestPerson(world: World, at: { x: number; z: number }, live: Record<number, { x: number; z: number }>, reach = TALK_REACH): Entity | null {
  let best: { e: Entity; d: number } | null = null;
  for (const e of Object.values(world.entities)) {
    if (!e.tags.includes(NPC_TAG)) continue;
    const p = live[e.id] ?? e.transform.position;
    const d = Math.hypot(p.x - at.x, p.z - at.z);
    if (d <= reach && (!best || d < best.d)) best = { e, d };
  }
  return best?.e ?? null;
}

// ---------- mouth shapes ----------

/** A mouth key: when (seconds from the start of the line), how open (0..1), how round (0..1). */
export type MouthKey = { at: number; open: number; round: number };

/**
 * Mouth shapes for a line, from its letters (a light stand-in for visemes): each syllable opens by
 * its vowel (a and o wide, e and i half, u and o round), closes on b, m and p, and pauses at
 * commas and full stops. `rate` is the speaking rate (1 is normal).
 */
export function mouthTrack(text: string, rate = 1): MouthKey[] {
  const keys: MouthKey[] = [{ at: 0, open: 0, round: 0 }];
  const syllable = 0.17 / Math.max(0.4, rate);
  let t = 0.05;
  for (const token of text.toLowerCase().match(/[a-z']+|[.,!?;:…]/g) ?? []) {
    if (/^[.,!?;:…]$/.test(token)) {
      t += /[,;:]/.test(token) ? 0.18 : 0.32;
      keys.push({ at: t, open: 0, round: 0 });
      continue;
    }
    // Vowel groups are syllables; the consonant before each sets how it starts.
    const parts = token.match(/[^aeiouy]*[aeiouy]+/g) ?? [token];
    for (const part of parts) {
      const vowel = part.replace(/[^aeiouy]/g, "");
      const lips = /[bmp]$/.test(part.replace(/[aeiouy]+$/, ""));
      const open = /[ao]/.test(vowel) ? 0.95 : /[ei]/.test(vowel) ? 0.6 : 0.45;
      const round = /[ou]/.test(vowel) && !/a/.test(vowel) ? 0.8 : 0.1;
      if (lips) keys.push({ at: t + syllable * 0.15, open: 0, round: 0 });
      keys.push({ at: t + syllable * 0.5, open, round });
      t += syllable;
    }
    keys.push({ at: t, open: 0.15, round: 0 });
    t += syllable * 0.25;
  }
  keys.push({ at: t + 0.08, open: 0, round: 0 });
  return keys;
}

/** How open and round the mouth is `t` seconds into a track (closed outside it). */
export function mouthAt(track: MouthKey[], t: number): { open: number; round: number } {
  if (!track.length || t <= 0 || t >= track[track.length - 1].at) return { open: 0, round: 0 };
  let i = 1;
  while (i < track.length - 1 && track[i].at < t) i += 1;
  const a = track[i - 1];
  const b = track[i];
  const k = b.at > a.at ? Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at))) : 1;
  const s = k * k * (3 - 2 * k);
  return { open: a.open + (b.open - a.open) * s, round: a.round + (b.round - a.round) * s };
}
