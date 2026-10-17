/**
 * World events: weather, time of day and mood, set live from a sentence ("make it rain at dusk",
 * "foggy morning", "rainy Tokyo alley", "snow at midnight", "clear skies"). After Genie 3's idea of
 * promptable world events, done in the engine rather than by a model: a phrase picks from a table of
 * presets (time words, weather words, mood words, a clock time), and a model may set the numbers
 * itself for phrases the table does not know (set_weather's numeric arguments).
 *
 * The world keeps only the `Weather` (saved, shared with linked devices, undone like any change).
 * `skyFor` turns it into what the renderer needs (sky and fog colours, sun direction and strength,
 * stars, lamp glow, rain and snow amounts), and `blendSky` eases one sky into the next so a change
 * crossfades instead of snapping. Everything here is pure and deterministic.
 */
import type { World } from "./types.ts";

export type Weather = {
  /** Short name for the log and the HUD ("rain at dusk"). */
  label: string;
  /** Hour of the day, 0..24. */
  hour: number;
  /** 0..1 each. */
  cloud: number;
  rain: number;
  snow: number;
  fog: number;
  wind: number;
  /** Thunder and lightning, 0..1. */
  storm: number;
  /** A colour cast over the light and fog, by name (see MOODS), or "" for none. */
  mood: string;
  /** In-game minutes that pass per real second (0: the clock stands still). */
  flow: number;
};

/** The look the lab has always had: late afternoon, a clear sky, warm haze. */
export const DEFAULT_WEATHER: Weather = { label: "clear afternoon", hour: 16.5, cloud: 0.15, rain: 0, snow: 0, fog: 0, wind: 0.2, storm: 0, mood: "", flow: 0 };

type Part = Partial<Weather>;
type Word = { words: string[]; set: Part };

/** Times of day. The first matching word wins. */
export const TIMES: Word[] = [
  { words: ["midnight"], set: { hour: 0 } },
  { words: ["dawn", "daybreak", "sunrise", "first light"], set: { hour: 6.1 } },
  { words: ["morning"], set: { hour: 8.5 } },
  { words: ["noon", "midday", "lunchtime", "high noon"], set: { hour: 12.5 } },
  { words: ["afternoon"], set: { hour: 15.5 } },
  { words: ["golden hour"], set: { hour: 17.6 } },
  { words: ["dusk", "sunset", "sundown", "evening", "twilight"], set: { hour: 18.7 } },
  { words: ["night", "nighttime", "tonight", "late"], set: { hour: 22.5 } },
  { words: ["day", "daytime", "daylight"], set: { hour: 12 } },
];

/** Weather. Several may combine ("windy and rainy"). */
export const KINDS: Word[] = [
  { words: ["clear", "sunny", "blue sky", "blue skies", "fair", "nice weather"], set: { cloud: 0.1, rain: 0, snow: 0, fog: 0, storm: 0 } },
  { words: ["cloudy", "overcast", "grey", "gray", "gloomy"], set: { cloud: 0.85 } },
  { words: ["drizzle", "drizzly", "light rain", "sprinkle"], set: { cloud: 0.75, rain: 0.3, snow: 0 } },
  { words: ["rain", "rainy", "raining", "rains", "wet", "shower", "showers", "downpour", "pouring"], set: { cloud: 0.85, rain: 0.75, snow: 0 } },
  { words: ["storm", "stormy", "thunder", "thunderstorm", "lightning"], set: { cloud: 1, rain: 1, snow: 0, storm: 1, wind: 0.9 } },
  { words: ["snow", "snowy", "snowing", "snows", "snowfall", "flurries", "winter", "wintry"], set: { cloud: 0.8, snow: 0.7, rain: 0 } },
  { words: ["blizzard"], set: { cloud: 1, snow: 1, rain: 0, wind: 1, fog: 0.5 } },
  { words: ["fog", "foggy", "mist", "misty", "haze", "hazy"], set: { fog: 0.75 } },
  { words: ["windy", "wind", "breezy", "gusty", "gale"], set: { wind: 0.85 } },
  { words: ["calm", "still"], set: { wind: 0.05 } },
  // Last, so it wins over "cloudy" inside it.
  { words: ["partly cloudy", "some clouds", "scattered clouds", "fair weather clouds", "puffy clouds", "fluffy clouds"], set: { cloud: 0.45, rain: 0, snow: 0 } },
];

/** Moods: a cast over the light, and sometimes their own weather. */
export const MOODS: (Word & { id: string; tint: [number, number, number] })[] = [
  { id: "neon", words: ["neon", "cyberpunk", "tokyo", "blade runner", "synthwave", "vaporwave"], set: { mood: "neon" }, tint: [0.85, 0.3, 1] },
  { id: "eerie", words: ["eerie", "spooky", "creepy", "haunted", "horror", "ghostly", "ominous"], set: { mood: "eerie", fog: 0.55 }, tint: [0.45, 0.9, 0.55] },
  { id: "cozy", words: ["cozy", "cosy", "warm", "snug", "homely"], set: { mood: "cozy" }, tint: [1, 0.62, 0.32] },
  { id: "dreamy", words: ["dreamy", "magical", "fairytale", "fairy tale", "ethereal", "pastel"], set: { mood: "dreamy", fog: 0.3 }, tint: [1, 0.6, 0.9] },
  { id: "cold", words: ["cold", "icy", "frosty", "chilly", "bleak"], set: { mood: "cold" }, tint: [0.55, 0.75, 1] },
  { id: "apocalyptic", words: ["apocalyptic", "apocalypse", "wildfire", "smoky", "mars", "martian"], set: { mood: "apocalyptic", fog: 0.45, cloud: 0.6 }, tint: [1, 0.42, 0.12] },
];

const has = (text: string, word: string) => new RegExp(`(^|[^a-z])${word.replace(/ /g, "\\s+")}([^a-z]|$)`).test(text);
const pick = (list: Word[], text: string) => list.find((w) => w.words.some((word) => has(text, word)));
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const wrapHour = (h: number) => ((h % 24) + 24) % 24;

/** "7pm", "7:30 am", "18:45", "at 6" (a bare hour after "at" reads as the next one on a 12 h clock, evening if ambiguous). */
export function clockHour(text: string): number | null {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/) ?? text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/) ?? text.match(/\bat\s+(\d{1,2})(?!\s*(?:m\b|metres|meters|%|x\b))\b/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minutes = Number(m[2] ?? 0);
  const half = m[3]?.replace(/\./g, "");
  if (hour > 24 || minutes > 59) return null;
  if (half === "pm" && hour < 12) hour += 12;
  if (half === "am" && hour === 12) hour = 0;
  if (!half && m[2] === undefined && hour >= 1 && hour <= 11) hour += hour < 6 ? 12 : 0;
  return wrapHour(hour + minutes / 60);
}

const WEATHER_WORDS = [...TIMES, ...KINDS, ...MOODS].flatMap((w) => w.words);
/** Words too common to mean weather on their own ("good day", "keep still"): they need "make it", "set" and the like. */
const WEAK = new Set(["day", "daytime", "late", "still", "calm", "warm", "cold", "wind", "grey", "gray", "fair", "plain", "wet", "evening", "morning", "night", "tonight", "winter", "mars", "pastel", "magical", "chilly", "bleak", "haze"]);

/**
 * A sentence to a weather change, on top of the current weather (what it does not mention stays).
 * Returns null when the sentence says nothing about weather, light or time.
 */
export function readWeather(phrase: string, from: Weather = DEFAULT_WEATHER): Weather | null {
  const text = phrase.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9:. ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  // A whole scene ("foggy morning", "snow at midnight": a time and a weather) starts fresh; a part
  // of one ("add some fog", "at 7pm") changes only what it names.
  const scene = !!pick(TIMES, text) || clockHour(text) != null ? KINDS.some((k) => k.words.some((word) => has(text, word))) : false;
  let next: Weather = { ...(scene ? DEFAULT_WEATHER : from), flow: 0 };
  let said = false;
  const stop = /\b(stop|end|no more|clear up|clear away|get rid of|turn off|without)\b/.test(text);
  if (/\b(reset|normal|default|back to normal|as it was|usual)\b/.test(text) && /\b(weather|sky|light|lighting|time|day)\b/.test(text)) return { ...DEFAULT_WEATHER };
  if (stop) {
    // "stop the rain", "clear up the fog": switch off what is named (or all of it).
    const named = KINDS.filter((k) => k.words.some((word) => has(text, word)));
    const off: Part = {};
    for (const kind of named.length ? named : KINDS.slice(1, 7)) {
      for (const key of Object.keys(kind.set) as (keyof Weather)[]) if (key !== "cloud" && key !== "wind") (off as Record<string, number>)[key] = 0;
    }
    if (named.some((k) => k.set.rain || k.set.snow || k.set.storm) || !named.length) off.cloud = Math.min(from.cloud, 0.35);
    next = { ...next, ...off };
    said = true;
  } else {
    const named: Part = {};
    for (const kind of KINDS) {
      if (kind.words.some((word) => has(text, word))) {
        Object.assign(named, kind.set);
        said = true;
      }
    }
    // "heavy rain", "a little fog": the size word scales only what this phrase names.
    const scale = /\b(heavy|hard|lots of|torrential|pouring|big|thick|dense)\b/.test(text) ? 1.3 : /\b(light|little|bit of|gentle|soft|some|thin)\b/.test(text) ? 0.55 : 1;
    for (const key of ["rain", "snow", "fog"] as const) if (named[key] != null) named[key] = clamp01(named[key]! * scale);
    next = { ...next, ...named };
  }
  const time = pick(TIMES, text);
  const clock = clockHour(text);
  if (clock != null) {
    next.hour = clock;
    said = true;
  } else if (time) {
    next.hour = time.set.hour!;
    said = true;
  }
  const mood = MOODS.find((m) => m.words.some((word) => has(text, word)));
  if (mood) {
    next = { ...next, ...mood.set };
    said = true;
    // A neon city is a wet one at night unless told otherwise.
    if (mood.id === "neon" && clock == null && !time) next.hour = 22.5;
    if (mood.id === "neon" && /\b(alley|street|city|tokyo)\b/.test(text) && !has(text, "dry")) next = { ...next, rain: Math.max(next.rain, 0.55), cloud: Math.max(next.cloud, 0.8), fog: Math.max(next.fog, 0.25) };
  } else if (/\b(no mood|normal light|plain)\b/.test(text)) {
    next.mood = "";
  }
  if (/\b(speed up time|time flies|let (the )?(day|time|hours) (go by|pass|flow|roll)|day night cycle|day and night|timelapse|time lapse|fast forward)\b/.test(text)) {
    next.flow = /\bfast|timelapse|time lapse|flies\b/.test(text) ? 60 : 20;
    said = true;
  } else if (/\b(freeze|stop|pause) (the )?(time|clock)\b/.test(text)) {
    next.flow = 0;
    said = true;
  }
  if (!said) return null;
  next.label = labelOf(next);
  return next;
}

/** A name for a weather, for the log: "rain at dusk", "foggy morning, eerie". */
export function labelOf(w: Weather): string {
  const h = wrapHour(w.hour);
  const time =
    h < 4.5 || h >= 23.5 ? "midnight" : h < 6.8 ? "dawn" : h < 11 ? "morning" : h < 14 ? "noon" : h < 17.2 ? "afternoon" : h < 19.6 ? "dusk" : "night";
  const sky = w.storm > 0.5 ? "a storm" : w.snow > 0.05 ? (w.snow > 0.85 ? "a blizzard" : "snow") : w.rain > 0.05 ? (w.rain < 0.4 ? "drizzle" : "rain") : w.fog > 0.4 ? "fog" : w.cloud > 0.7 ? "clouds" : "clear";
  const at = { midnight: "at midnight", dawn: "at dawn", morning: "in the morning", noon: "at noon", afternoon: "in the afternoon", dusk: "at dusk", night: "at night" }[time];
  const base = sky === "clear" ? `clear ${time}` : sky === "fog" ? `foggy ${time}` : sky === "clouds" ? `overcast ${time}` : `${sky} ${at}`;
  return [base, w.mood, w.flow ? "time passing" : ""].filter(Boolean).join(", ");
}

/** Checked, clamped copy of a saved weather (anything missing takes the default). */
export function cleanWeather(value: unknown): Weather | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const num = (key: keyof Weather, lo = 0, hi = 1) => {
    const v = Number(raw[key]);
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : (DEFAULT_WEATHER[key] as number);
  };
  const mood = typeof raw.mood === "string" && MOODS.some((m) => m.id === raw.mood) ? raw.mood : "";
  const w: Weather = { label: "", hour: wrapHour(num("hour", -48, 48)), cloud: num("cloud"), rain: num("rain"), snow: num("snow"), fog: num("fog"), wind: num("wind"), storm: num("storm"), mood, flow: num("flow", 0, 240) };
  w.label = typeof raw.label === "string" && raw.label.length <= 80 ? raw.label : labelOf(w);
  return w;
}

export const weatherOf = (world: Pick<World, "weather">): Weather => world.weather ?? DEFAULT_WEATHER;

// ---------- the sky a weather makes ----------

export type RGB = [number, number, number];
export type Sky = {
  top: RGB;
  horizon: RGB;
  below: RGB;
  sun: RGB;
  fog: RGB;
  light: RGB;
  hemiSky: RGB;
  hemiGround: RGB;
  /** Unit vector toward the sun (or the moon at night, for the shadow-casting light). */
  lightDir: [number, number, number];
  /** Unit vector toward the sun, for the sky's sun disc and glow. */
  sunDir: [number, number, number];
  sunIntensity: number;
  hemiIntensity: number;
  fogNear: number;
  fogFar: number;
  /** 0..1: how much of the starfield and the moon show. */
  stars: number;
  /** 0..1: lamp posts and other night lights. */
  lamps: number;
  /** 0..1: how wet the ground looks. */
  wet: number;
  rain: number;
  snow: number;
  wind: number;
  storm: number;
  cloudShade: RGB;
  cloudOpacity: number;
  /** How bright the environment reflections are. */
  env: number;
};

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const grey = (a: RGB): RGB => {
  const l = a[0] * 0.3 + a[1] * 0.55 + a[2] * 0.15;
  return [l, l, l];
};
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Light at a few sun heights (sine of elevation), from deep night to full day. */
const STOPS: { at: number; top: string; horizon: string; below: string; sun: string; fog: string; light: string; hemiSky: string; hemiGround: string; sunI: number; hemiI: number }[] = [
  { at: -0.35, top: "#03060f", horizon: "#0b1322", below: "#05070b", sun: "#3a4a6a", fog: "#0b111c", light: "#7d93c4", hemiSky: "#2b3d62", hemiGround: "#10131a", sunI: 0.35, hemiI: 0.42 },
  { at: -0.08, top: "#0d1a3a", horizon: "#3b3550", below: "#1a1a22", sun: "#ff8a5c", fog: "#2b2a3a", light: "#a8a6d6", hemiSky: "#45507a", hemiGround: "#1b1a20", sunI: 0.45, hemiI: 0.4 },
  { at: 0.06, top: "#29468a", horizon: "#f09a62", below: "#6e5a52", sun: "#ff9f5a", fog: "#c08a6e", light: "#ffb27a", hemiSky: "#9fb0d8", hemiGround: "#4a3a30", sunI: 1.35, hemiI: 0.6 },
  // Late afternoon: the look the lab always had (Scenery.tsx SKY).
  { at: 0.36, top: "#2763c2", horizon: "#f3cfa6", below: "#8f8a84", sun: "#ffd9a8", fog: "#d9c4ad", light: "#ffe4c4", hemiSky: "#c4d8f5", hemiGround: "#5d5040", sunI: 2.3, hemiI: 0.75 },
  { at: 0.95, top: "#1f5fcf", horizon: "#bcd6f0", below: "#8f9096", sun: "#fff6e6", fog: "#c9d6e2", light: "#fff7ec", hemiSky: "#d4e4fa", hemiGround: "#6a5d4c", sunI: 2.7, hemiI: 0.85 },
];

/** Where the sun is at an hour: rises in the east around 6, highest at 12:30, sets in the west around 19. */
export function sunAt(hour: number): [number, number, number] {
  const h = wrapHour(hour);
  // 16.5 h lands on the lab's old sun (-0.5, 0.36, -0.79).
  const elevation = Math.asin(0.58 * Math.sin((Math.PI * (h - 6.3)) / 13));
  const azimuth = -2.134 + ((h - 16.5) / 12) * Math.PI * 0.95;
  const c = Math.cos(elevation);
  return [Math.cos(azimuth) * c, Math.sin(elevation), Math.sin(azimuth) * c];
}

/** What the renderer draws for a weather. */
export function skyFor(w: Weather): Sky {
  const sunDir = sunAt(w.hour);
  const height = sunDir[1];
  let i = 0;
  while (i < STOPS.length - 2 && height > STOPS[i + 1].at) i += 1;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  const t = smooth(a.at, b.at, height);
  const m = (key: "top" | "horizon" | "below" | "sun" | "fog" | "light" | "hemiSky" | "hemiGround") => mix(hex(a[key]), hex(b[key]), t);
  let top = m("top");
  let horizon = m("horizon");
  const below = m("below");
  let sun = m("sun");
  let fog = m("fog");
  let light = m("light");
  let hemiSky = m("hemiSky");
  let hemiGround = m("hemiGround");
  let sunIntensity = a.sunI + (b.sunI - a.sunI) * t;
  let hemiIntensity = a.hemiI + (b.hemiI - a.hemiI) * t;
  const night = 1 - smooth(-0.12, 0.05, height);

  // Clouds, rain and snow grey the sky and soften the sun.
  const overcast = clamp01(Math.max(w.cloud - 0.3, 0) / 0.7 + w.rain * 0.4 + w.snow * 0.3 + w.storm * 0.4);
  const dim = 1 - overcast * 0.55 - w.storm * 0.2;
  top = mix(top, mul(grey(top), 0.85), overcast * 0.85);
  horizon = mix(horizon, mul(grey(horizon), 0.9), overcast * 0.8);
  sun = mix(sun, grey(sun), overcast * 0.7);
  fog = mix(fog, mul(grey(fog), 0.92), overcast * 0.75);
  light = mix(light, grey(light), overcast * 0.6);
  hemiSky = mix(hemiSky, grey(hemiSky), overcast * 0.7);
  if (w.snow > 0) {
    // Snow brightens the ground light and cools everything.
    hemiGround = mix(hemiGround, mul(hex("#dfe7f2"), 0.6 + 0.4 * (1 - night)), w.snow * 0.7);
    fog = mix(fog, mul(hex("#e3e9f2"), 1 - night * 0.8), w.snow * 0.5);
  }
  sunIntensity *= Math.max(0.15, dim);
  hemiIntensity *= 1 - overcast * 0.15;

  // Mood: a cast over light and fog, strongest where it is darkest (neon lights a night city).
  const mood = MOODS.find((x) => x.id === w.mood);
  if (mood) {
    const cast = mood.id === "neon" ? 0.25 + 0.45 * night : 0.28;
    hemiSky = mix(hemiSky, mul(mood.tint, 0.55 + 0.45 * (1 - night)), cast);
    hemiGround = mix(hemiGround, mul(mood.id === "neon" ? [0.1, 0.75, 1] : mood.tint, 0.4), cast * 0.8);
    fog = mix(fog, mul(mood.tint, 0.35 + 0.5 * (1 - night)), cast * 0.7);
    horizon = mix(horizon, mul(mood.tint, 0.4 + 0.5 * (1 - night)), cast * 0.6);
    light = mix(light, mood.tint, cast * 0.5);
    if (mood.id === "neon") hemiIntensity += 0.35 * night;
  }

  // Fog: from the lab's 45..340 m on a clear day down to a few metres in thick fog.
  const thick = clamp01(w.fog + w.rain * 0.18 + w.snow * 0.28);
  const fogNear = 45 * (1 - thick) ** 2 + 2;
  const fogFar = 340 * (1 - thick * 0.92) ** 1.6 + 18;

  // At night the moon takes the shadow light: opposite the sun, high, faint and blue.
  const moonUp = night > 0.5;
  const lightDir: [number, number, number] = moonUp ? normalize([-sunDir[0] * 0.6 + 0.2, 0.75, -sunDir[2] * 0.6 + 0.3]) : height < 0.04 ? normalize([sunDir[0], 0.04, sunDir[2]]) : sunDir;
  if (moonUp) {
    light = mix(light, hex("#9fb4e6"), 0.6);
    // Moonlight bright enough to read shapes by, blue, with crisp shadows.
    sunIntensity = 0.55 * (1 - overcast * 0.7);
  }
  return {
    top,
    horizon,
    below,
    sun,
    fog,
    light,
    hemiSky,
    hemiGround,
    lightDir,
    sunDir,
    sunIntensity,
    hemiIntensity,
    fogNear,
    fogFar,
    stars: night * (1 - overcast) * (1 - thick * 0.8),
    lamps: clamp01(night * 1.1 + overcast * 0.4 + thick * 0.3 + (w.mood === "neon" ? 0.4 : 0)),
    wet: clamp01(w.rain * 1.4 + w.storm * 0.5),
    rain: w.rain,
    snow: w.snow,
    wind: w.wind,
    storm: w.storm,
    cloudShade: mix(mix(hex("#fff4ea"), hex("#5d6470"), overcast), hex("#1a2030"), night * 0.8),
    cloudOpacity: clamp01(0.55 + w.cloud * 0.45),
    env: 0.55 * (0.25 + 0.75 * (1 - night)) * (1 - overcast * 0.35),
  };
}

function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Ease from one sky toward another (t = 0 keeps a, 1 gives b). Directions are blended and renormalised. */
export function blendSky(a: Sky, b: Sky, t: number): Sky {
  const out = { ...b } as Sky;
  for (const key of Object.keys(b) as (keyof Sky)[]) {
    const x = a[key];
    const y = b[key];
    if (typeof x === "number" && typeof y === "number") (out as Record<string, unknown>)[key] = lerp(x, y, t);
    else if (Array.isArray(x) && Array.isArray(y)) (out as Record<string, unknown>)[key] = x.map((v, i) => lerp(v, y[i], t));
  }
  out.sunDir = normalize(out.sunDir);
  out.lightDir = normalize(out.lightDir);
  return out;
}

// ---------- instant commands ----------

/**
 * Plain requests about the weather or the time, as a set_weather call without waiting for a model:
 * "make it rain", "rain at dusk", "foggy morning", "set the time to 7pm", "stop the rain",
 * "rainy tokyo alley". Requests to build something ("build a rain machine") are left alone.
 */
export function weatherIntent(intent: string): { tool: "set_weather"; arguments: Record<string, string> } | null {
  const text = intent.toLowerCase().replace(/[’']/g, "").trim();
  if (!WEATHER_WORDS.some((word) => has(text, word)) && clockHour(text) == null && !/\b(speed up time|time lapse|timelapse|day night cycle|time flies)\b/.test(text)) return null;
  if (/^(?:(?:please|can you|could you)\s+)?(build|spawn|add|place|put|create|paint|colou?r|draw|delete|remove|wave|dance|do)\b/.test(text) && !/\b(weather|sky)\b/.test(text)) return null;
  if (/\b(cube|box|ball|sphere|tower|statue|gauge|meter|machine|portal|tetris|marble|move|emote)\b/.test(text)) return null;
  const words = text.split(/\s+/).length;
  const strong = WEATHER_WORDS.some((word) => !WEAK.has(word) && has(text, word)) || clockHour(text) != null;
  const asks = /\b(make it|let it|set|turn|change|switch|give me|i want|bring|start|stop|it is|its|now|weather|sky|time|clock|o clock)\b/.test(text);
  if (words > 9 || (!asks && (words > 5 || !strong))) return null;
  if (!readWeather(text)) return null;
  return { tool: "set_weather", arguments: { words: text } };
}

/** Apply set_weather's arguments: words read as a phrase, then any numbers given override. */
export function applyWeatherArgs(world: World, args: Record<string, string>): { weather: Weather } | { error: string } {
  const from = weatherOf(world);
  let next: Weather = { ...from };
  const words = (args.words ?? args.preset ?? "").trim();
  if (words) {
    const read = readWeather(words, from);
    if (!read && !Object.keys(args).some((k) => k !== "words" && k !== "preset")) return { error: `could not read '${words}' as weather; try rain, snow, fog, storm, clear, dawn, noon, dusk, night, 7pm, or a mood (${MOODS.map((m) => m.id).join(", ")})` };
    if (read) next = read;
  }
  const num = (key: string) => {
    const v = args[key];
    if (v == null || v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  for (const key of ["cloud", "rain", "snow", "fog", "wind", "storm"] as const) {
    const n = num(key);
    if (n != null) next[key] = clamp01(n);
  }
  const hour = num("hour");
  if (hour != null) next.hour = wrapHour(hour);
  const flow = num("flow");
  if (flow != null) next.flow = Math.max(0, Math.min(240, flow));
  if (args.mood != null) {
    const mood = args.mood.trim().toLowerCase();
    if (mood && mood !== "none" && !MOODS.some((m) => m.id === mood)) return { error: `mood must be ${MOODS.map((m) => m.id).join(", ")} or none` };
    next.mood = mood === "none" ? "" : mood;
  }
  next.label = labelOf(next);
  return { weather: next };
}
