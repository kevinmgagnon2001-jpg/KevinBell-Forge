/**
 * Sounds for things, from words: "make the door creak like a ghost ship", "give the orb a hum",
 * "the lamp chimes", "score this scene". After Fugatto and V2A (a sound from a description, a score
 * for a scene), done on the device: the words pick a recipe (a kind of sound plus pitch, length,
 * echo, loudness, looping) and the page synthesises it with Web Audio (sound-player.ts). Nothing is
 * downloaded or sent anywhere, and the same words and seed always make the same sound, so a saved
 * world sounds the same on every device. A cloud generator could later fill the same recipe slot.
 *
 * Kept on the entity as customData.sound (the words) and soundSeed; a scene's score is World.score.
 */
import type { Entity, World } from "./types.ts";

export const SOUND_KINDS = ["creak", "chime", "hum", "whoosh", "drip", "beep", "crackle", "engine", "thunder", "squeak", "knock", "bubble", "music", "rain", "wind", "purr", "zap", "pop", "choir"] as const;
export type SoundKind = (typeof SOUND_KINDS)[number];

export type Recipe = {
  kind: SoundKind;
  /** Multiplies the kind's own pitch. */
  pitch: number;
  /** Seconds (one-shots) or loop length. */
  length: number;
  /** 0..0.8: echo feedback. */
  echo: number;
  /** 0..1. */
  gain: number;
  loop: boolean;
  /** Music only: major, minor or eerie. */
  mode: "major" | "minor" | "eerie";
  /** Beats per minute (music) or speed of a pattern. */
  tempo: number;
  seed: number;
};

const WORDS: Record<SoundKind, string[]> = {
  creak: ["creak", "creaky", "creaks", "creaking", "groan", "groans"],
  chime: ["chime", "chimes", "chiming", "ringing", "ding", "bell", "bells", "ring", "rings", "jingle", "tinkle"],
  hum: ["hum", "hums", "humming", "drone", "buzz", "buzzing", "electric"],
  whoosh: ["whoosh", "swish", "swoosh", "woosh", "rush"],
  drip: ["drip", "drips", "dripping", "drop", "plink", "leak"],
  beep: ["beep", "beeps", "boop", "bleep", "chirp", "chirps"],
  crackle: ["crackle", "crackles", "fire", "sizzle", "embers"],
  engine: ["engine", "motor", "vroom", "rumble"],
  thunder: ["thunder", "boom", "explosion", "rumbling"],
  squeak: ["squeak", "squeaky", "squeaks"],
  knock: ["knock", "knocks", "thud", "thump", "tap", "footsteps", "steps"],
  bubble: ["bubble", "bubbles", "bubbling", "gurgle", "boil", "boiling"],
  music: ["music", "song", "tune", "melody", "score", "soundtrack", "theme", "lullaby", "jam", "play something"],
  rain: ["rain", "patter", "shower", "storm sounds"],
  wind: ["wind", "windy", "breeze", "howl", "howling", "gust"],
  purr: ["purr", "purrs", "purring", "snore", "snoring"],
  zap: ["zap", "laser", "pew", "blaster", "spark", "sparks"],
  pop: ["pop", "pops", "click", "clicks", "snap", "bloop"],
  choir: ["choir", "angelic", "heavenly", "aah", "chant", "singing", "sing", "sings"],
};

/** Each kind's own nature: does it loop by default, and how long. */
const BASE: Record<SoundKind, { loop: boolean; length: number; tempo: number }> = {
  creak: { loop: false, length: 1.4, tempo: 1 },
  chime: { loop: false, length: 2.6, tempo: 1 },
  hum: { loop: true, length: 2, tempo: 1 },
  whoosh: { loop: false, length: 1.1, tempo: 1 },
  drip: { loop: true, length: 3, tempo: 1 },
  beep: { loop: false, length: 1.2, tempo: 8 },
  crackle: { loop: true, length: 4, tempo: 1 },
  engine: { loop: true, length: 2, tempo: 1 },
  thunder: { loop: false, length: 4.5, tempo: 1 },
  squeak: { loop: false, length: 0.5, tempo: 1 },
  knock: { loop: false, length: 1, tempo: 3 },
  bubble: { loop: true, length: 3, tempo: 1 },
  music: { loop: true, length: 16, tempo: 84 },
  rain: { loop: true, length: 4, tempo: 1 },
  wind: { loop: true, length: 6, tempo: 1 },
  purr: { loop: true, length: 2.4, tempo: 1 },
  zap: { loop: false, length: 0.45, tempo: 1 },
  pop: { loop: false, length: 0.25, tempo: 1 },
  choir: { loop: true, length: 8, tempo: 1 },
};

const has = (text: string, word: string) => new RegExp(`(^|[^a-z])${word.replace(/ /g, "\\s+")}([^a-z]|$)`).test(text);

/** A stable number from words, so the same words make the same sound. */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}

/** Words to a recipe, or null when they name no sound. */
export function soundRecipe(words: string, seed = seedOf(words)): Recipe | null {
  const text = words.toLowerCase().replace(/[’']/g, "");
  // The first kind named in the words wins ("creak like a ghost ship" is a creak, not a ship).
  let kind: SoundKind | null = null;
  let at = Infinity;
  for (const k of SOUND_KINDS) {
    for (const word of WORDS[k]) {
      const m = text.match(new RegExp(`(^|[^a-z])${word.replace(/ /g, "\\s+")}([^a-z]|$)`));
      if (m && m.index! < at) {
        at = m.index!;
        kind = k;
      }
    }
  }
  if (!kind) return null;
  const base = BASE[kind];
  let pitch = 1;
  let echo = 0.12;
  let gain = 0.7;
  let length = base.length;
  let tempo = base.tempo;
  let mode: Recipe["mode"] = "major";
  if (/\b(ghost|ghostly|haunted|spooky|eerie|creepy|ominous|horror|dungeon)\b/.test(text)) {
    pitch *= 0.7;
    echo = 0.55;
    length *= 1.6;
    mode = "eerie";
  }
  if (/\b(ship|cave|cathedral|church|hall|canyon|well|space)\b/.test(text)) echo = Math.max(echo, 0.45);
  if (/\b(deep|low|big|huge|giant|heavy|bass)\b/.test(text)) pitch *= 0.6;
  if (/\b(high|tiny|little|small|squeaky|bright)\b/.test(text) && kind !== "squeak") pitch *= 1.6;
  if (/\b(sad|melancholy|minor|dark|lonely|rainy)\b/.test(text)) mode = mode === "eerie" ? "eerie" : "minor";
  if (/\b(happy|cheerful|bright|sunny|upbeat|major)\b/.test(text)) mode = "major";
  if (/\b(slow|lazy|calm|gentle|sleepy|lullaby|chill)\b/.test(text)) {
    tempo *= 0.7;
    length *= 1.3;
  }
  if (/\b(fast|quick|frantic|upbeat|energetic|action)\b/.test(text)) {
    tempo *= 1.4;
    length *= 0.8;
  }
  if (/\b(loud|loudly|booming)\b/.test(text)) gain = 1;
  if (/\b(quiet|quietly|soft|softly|faint|whisper)\b/.test(text)) gain = 0.35;
  // Music loops on its bar grid: four bars of four beats.
  if (kind === "music") length = (16 * 60) / tempo;
  const loop = /\b(keep|always|constantly|forever|loop|all the time|nonstop|continuous)\b/.test(text) ? true : /\b(once|one time)\b/.test(text) ? false : base.loop;
  return { kind, pitch: Math.max(0.25, Math.min(4, pitch)), length: Math.max(0.15, Math.min(24, length)), echo: Math.min(0.8, echo), gain, loop, mode, tempo, seed };
}

// ---------- the tool ----------

/** set_sound: give an entity (or the scene's score, id "scene") a sound from words; "none" removes it. */
export function setSound(world: World, args: Record<string, string>): { ok: boolean; detail: string; world: World } {
  const words = (args.words ?? "").trim().slice(0, 120);
  const off = /^(none|off|silence|silent|quiet|nothing|stop|mute)$/i.test(words);
  const target = (args.id ?? "").trim();
  if (target === "scene" || target === "score") {
    if (off) return { ok: true, detail: "The score stops.", world: { ...world, score: undefined } };
    const recipe = soundRecipe(/\b(music|song|tune|melody|score|soundtrack|theme|lullaby)\b/i.test(words) ? words : `music ${words}`);
    if (!recipe) return { ok: false, detail: "say what kind of music: calm, sad, happy, spooky, fast", world };
    return { ok: true, detail: `The scene has a score now: ${describe(recipe)}. Say "stop the music" to end it.`, world: { ...world, score: words || "music" } };
  }
  const id = Number(target);
  const entity = Number.isSafeInteger(id) ? world.entities[id] : undefined;
  if (!entity) return { ok: false, detail: `entity ${target || "?"} not found`, world };
  if (off) {
    const { sound: _s, soundSeed: _d, ...rest } = entity.customData;
    return { ok: true, detail: `${entity.name} is quiet.`, world: { ...world, entities: { ...world.entities, [id]: { ...entity, customData: rest } } } };
  }
  const recipe = soundRecipe(words);
  if (!recipe) return { ok: false, detail: `no sound in '${words}'; try ${SOUND_KINDS.slice(0, 10).join(", ")}…`, world };
  const next: Entity = { ...entity, customData: { ...entity.customData, sound: words, soundSeed: String(recipe.seed) } };
  return {
    ok: true,
    detail: `${entity.name} has a sound: ${describe(recipe)}.${recipe.loop ? " You hear it as you come near." : " It plays when you walk up to it or tap it."}`,
    world: { ...world, entities: { ...world.entities, [id]: next } },
  };
}

export function describe(r: Recipe): string {
  const tone = r.pitch < 0.8 ? "low " : r.pitch > 1.3 ? "high " : "";
  const space = r.echo > 0.4 ? " with a long echo" : "";
  const music = r.kind === "music" ? ` (${r.mode}, ${Math.round(r.tempo)} bpm)` : "";
  return `${tone}${r.kind}${music}${space}${r.loop ? ", looping" : ""}`;
}

export function recipeOf(entity: Entity): Recipe | null {
  const words = entity.customData.sound;
  if (!words) return null;
  const seed = Number(entity.customData.soundSeed);
  return soundRecipe(words, Number.isFinite(seed) ? seed : undefined);
}

// ---------- instant commands ----------

const STOP_WORDS = new Set(["the", "a", "an", "it", "that", "this", "make", "let", "give", "sound", "like", "and", "of", "to", "my", "some", "play", "on"]);

/** The entity a sentence is about: by name, else the selected one. */
export function targetOf(text: string, world: Pick<World, "entities">, selected: number | null): Entity | null {
  const lower = text.toLowerCase();
  const named = Object.values(world.entities)
    .filter((e) => !e.tags.includes("helm") && e.name.length >= 2 && !STOP_WORDS.has(e.name.toLowerCase()))
    .filter((e) => has(lower, e.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length);
  if (named.length) return named[0];
  if (/\b(it|this|that|the selected)\b/.test(lower) && selected != null) return world.entities[selected] ?? null;
  return null;
}

export type SoundCall = { tool: "set_sound" | "edit_entity"; arguments: Record<string, string> };

/**
 * "make the door creak like a ghost ship", "give the orb a hum", "score this scene", "play some sad
 * music", "stop the music", "silence the door", "make it sparkle" (a glint finish, edit_entity).
 */
export function soundIntent(intent: string, world: Pick<World, "entities">, selected: number | null): SoundCall | null {
  const text = intent.trim().toLowerCase().replace(/[’']/g, "");
  if (text.split(/\s+/).length > 14) return null;
  if (/^(stop|end|kill|turn off|no more)\b.*\b(music|score|song|soundtrack)\b/.test(text)) return { tool: "set_sound", arguments: { id: "scene", words: "none" } };
  if (/^(score|soundtrack)\b/.test(text) || /^(play|put on|start|give me|add)\b.*\b(music|song|tune|melody|score|soundtrack|lullaby)\b/.test(text)) {
    return { tool: "set_sound", arguments: { id: "scene", words: text.replace(/^(score|soundtrack)\s+(this|the)\s+scene\s*/, "music ") } };
  }
  // Sparkle: a glint finish on a body.
  const shiny = text.match(/^(?:make|let|give)\s+(.+?)\s+(?:sparkle|sparkly|glitter|glittery|glint|glinty|shimmer|twinkle)\b/) ?? text.match(/^(?:sparkle|glitter)\s+(?:up\s+)?(.+)$/);
  if (shiny) {
    const target = targetOf(shiny[1], world, selected);
    if (target && !target.tags.includes("architect")) return { tool: "edit_entity", arguments: { id: String(target.id), finish: "glint" } };
    return null;
  }
  const unshine = text.match(/^(?:stop|no more)\s+(?:the\s+)?(?:sparkle|sparkling|glitter|glint)\b(?:\s+on)?\s*(.*)$/);
  if (unshine) {
    const target = targetOf(unshine[1] || "it", world, selected);
    return target ? { tool: "edit_entity", arguments: { id: String(target.id), finish: "plain" } } : null;
  }
  if (/^(silence|mute|hush|quiet)\b/.test(text)) {
    const target = targetOf(text.replace(/^\S+\s*/, ""), world, selected);
    return target ? { tool: "set_sound", arguments: { id: String(target.id), words: "none" } } : null;
  }
  if (!soundRecipe(text)) return null;
  if (!/^(make|let|give|have|add|put)\b/.test(text) && !/\b(sound|sounds|noise)\b/.test(text)) return null;
  if (/\b(build|spawn|create|place)\b/.test(text)) return null;
  const target = targetOf(text, world, selected);
  if (!target) return null;
  // The words after the target name are the sound ("creak like a ghost ship").
  const after = text.slice(text.indexOf(target.name.toLowerCase()) + target.name.length).replace(/^\s*(a|an|some)\s+/, "").trim();
  return { tool: "set_sound", arguments: { id: String(target.id), words: soundRecipe(after) ? after : text } };
}
