/**
 * Renders a sound recipe (sounds.ts) to samples: small procedural synthesis, no files. The same recipe
 * always gives the same samples (seeded noise). Mono, 22.05 kHz, peak-normalised to the recipe's gain.
 * Loops are cross-faded at the seam so they repeat without a click.
 */
import type { Recipe } from "./sounds.ts";

export const RATE = 22050;
const TAU = Math.PI * 2;

function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RBJ biquad, as a per-sample function. */
function biquad(kind: "low" | "high" | "band", freq: number, q: number) {
  const w = (TAU * Math.min(freq, RATE * 0.45)) / RATE;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0: number, b1: number, b2: number;
  if (kind === "low") [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  else if (kind === "high") [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  else [b0, b1, b2] = [alpha, 0, -alpha];
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (x: number) => {
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

const env = (t: number, length: number, attack: number, release: number) => Math.max(0, Math.min(1, t / attack, (length - t) / release));
const tri = (p: number) => 1 - 4 * Math.abs(((p / TAU + 0.25) % 1) - 0.5);
const note = (root: number, semis: number) => root * 2 ** (semis / 12);

type Voice = (out: Float32Array, r: Recipe, rand: () => number) => void;

const VOICES: Record<Recipe["kind"], Voice> = {
  creak(out, r, rand) {
    // Stick-slip: a train of clicks whose rate wanders, rung through two wooden resonances.
    const a = biquad("band", 520 * r.pitch, 6);
    const b = biquad("band", 1350 * r.pitch, 8);
    const len = out.length / RATE;
    let next = 0;
    let rate = 70 * r.pitch;
    let drift = 0;
    for (let i = 0; i < out.length; i += 1) {
      const t = i / RATE;
      drift += (rand() - 0.5) * 0.004;
      drift *= 0.9995;
      rate = Math.max(18, 70 * r.pitch * (1 + Math.sin(t * 2.1 + r.seed) * 0.45 + drift * 40));
      let x = 0;
      if (i >= next) {
        x = 1;
        next = i + RATE / rate * (0.85 + rand() * 0.3);
      }
      const v = a(x) * 1.2 + b(x) * 0.7;
      out[i] = v * env(t, len, 0.12, 0.35);
    }
  },
  chime(out, r, rand) {
    const base = [880, 1046, 1175, 1318, 1568][Math.floor(rand() * 5)] * r.pitch;
    const partials = [
      [1, 1, 1.4],
      [2.76, 0.5, 2.6],
      [5.4, 0.25, 4.2],
      [8.93, 0.12, 6],
    ];
    for (let i = 0; i < out.length; i += 1) {
      const t = i / RATE;
      let v = 0;
      for (const [k, amp, decay] of partials) v += Math.sin(TAU * base * k * t) * amp * Math.exp(-t * decay);
      out[i] = v * Math.min(1, t / 0.002);
    }
  },
  hum(out, r) {
    const f = 55 * r.pitch;
    for (let i = 0; i < out.length; i += 1) {
      const t = i / RATE;
      const trem = 0.85 + 0.15 * Math.sin(TAU * 3 * t);
      out[i] = (Math.sin(TAU * f * t) + 0.5 * Math.sin(TAU * 2 * f * t) + 0.25 * Math.sin(TAU * 3 * f * t + 0.3) + 0.1 * Math.sin(TAU * 5 * f * t)) * trem;
    }
  },
  whoosh(out, r, rand) {
    const len = out.length / RATE;
    let f = biquad("band", 400, 1.2);
    for (let i = 0; i < out.length; i += 1) {
      const t = i / RATE;
      const u = t / len;
      if (i % 64 === 0) f = rebuild(f, "band", (300 + Math.sin(u * Math.PI) * 2200) * r.pitch, 1.4);
      out[i] = f(rand() * 2 - 1) * Math.sin(u * Math.PI) ** 2;
    }
  },
  drip(out, r, rand) {
    plinks(out, rand, 0.5 + rand() * 0.6, (t) => 900 * r.pitch * (1 + t * 18), 0.06, 35);
  },
  beep(out, r, rand) {
    const step = RATE / r.tempo;
    const freqs = Array.from({ length: 16 }, () => [523, 659, 784, 988, 1175, 1397][Math.floor(rand() * 6)] * r.pitch);
    for (let i = 0; i < out.length; i += 1) {
      const n = Math.floor(i / step);
      const t = (i % step) / RATE;
      const on = t < (step / RATE) * 0.7 && (n === 0 || freqs[(n * 7) % 16] > 600 * r.pitch);
      out[i] = on ? Math.sign(Math.sin(TAU * freqs[n % 16] * t)) * 0.4 * Math.min(1, t / 0.004) : 0;
    }
  },
  crackle(out, r, rand) {
    const low = biquad("low", 180 * r.pitch, 0.7);
    let burst = 0;
    let level = 0;
    for (let i = 0; i < out.length; i += 1) {
      if (rand() < 0.0012) {
        burst = Math.floor(RATE * (0.002 + rand() * 0.01));
        level = 0.4 + rand() * 0.8;
      }
      const pop = burst > 0 ? (rand() * 2 - 1) * level : 0;
      burst -= 1;
      level *= 0.9993;
      out[i] = low(rand() * 2 - 1) * 1.6 + pop;
    }
  },
  engine(out, r, rand) {
    const f = 38 * r.pitch;
    const low = biquad("low", 420 * r.pitch, 0.9);
    let phase = 0;
    for (let i = 0; i < out.length; i += 1) {
      const t = i / RATE;
      phase += (TAU * f * (1 + 0.04 * Math.sin(TAU * 7 * t))) / RATE;
      const saw = ((phase / TAU) % 1) * 2 - 1;
      out[i] = low(saw + (rand() - 0.5) * 0.3);
    }
  },
  thunder(out, r, rand) {
    const len = out.length / RATE;
    const low = biquad("low", 140 * r.pitch, 0.8);
    const lower = biquad("low", 70 * r.pitch, 0.7);
    let brown = 0;
    for (let i = 0; i < out.length; i += 1) {
      const t = i / RATE;
      brown = brown * 0.985 + (rand() * 2 - 1) * 0.15;
      const rumble = 0.6 + 0.4 * Math.sin(TAU * 1.3 * t + Math.sin(TAU * 0.4 * t) * 3);
      const crack = t < 0.15 ? (rand() * 2 - 1) * (1 - t / 0.15) * 0.6 : 0;
      out[i] = (lower(low(brown)) * 6 * rumble + crack) * Math.exp(-t * (3.2 / len)) * Math.min(1, t / 0.01);
    }
  },
  squeak(out, r) {
    const len = out.length / RATE;
    let phase = 0;
    for (let i = 0; i < out.length; i += 1) {
      const t = i / RATE;
      const f = (1200 + 1400 * Math.sin((t / len) * Math.PI * 0.8)) * r.pitch * (1 + 0.03 * Math.sin(TAU * 30 * t));
      phase += (TAU * f) / RATE;
      out[i] = Math.sin(phase) * Math.sin((t / len) * Math.PI);
    }
  },
  knock(out, r, rand) {
    const hits = 2 + Math.floor(rand() * 2);
    const gap = 0.22 / Math.max(0.5, r.tempo / 3);
    for (let i = 0; i < out.length; i += 1) {
      const t = i / RATE;
      let v = 0;
      for (let h = 0; h < hits; h += 1) {
        const u = t - h * gap;
        if (u < 0 || u > 0.25) continue;
        v += (Math.sin(TAU * 110 * r.pitch * u) * 0.9 + (rand() * 2 - 1) * Math.exp(-u * 300) * 0.5) * Math.exp(-u * 28);
      }
      out[i] = v;
    }
  },
  bubble(out, r, rand) {
    plinks(out, rand, 4 + rand() * 4, (t) => 300 * r.pitch * (1 + t * 30), 0.05, 50);
  },
  music(out, r, rand) {
    // Four bars of four beats: a pad on a progression and a pentatonic melody, both from the seed.
    const beat = 60 / r.tempo;
    const root = 196 * r.pitch;
    const progressions = {
      major: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]],
      minor: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]],
      eerie: [[0, 3, 6], [1, 5, 8], [0, 3, 7], [-1, 3, 6]],
    } as const;
    const scale = r.mode === "major" ? [0, 2, 4, 7, 9, 12, 14, 16] : r.mode === "minor" ? [0, 3, 5, 7, 10, 12, 15, 17] : [0, 1, 3, 6, 7, 12, 13, 15];
    const chords = progressions[r.mode];
    const melody = Array.from({ length: 16 }, () => (rand() < 0.22 ? null : scale[Math.floor(rand() * scale.length)]));
    for (let i = 0; i < out.length; i += 1) {
      const t = i / RATE;
      const b = t / beat;
      const bar = Math.floor(b / 4) % 4;
      const inBar = (b % 4) * beat;
      let v = 0;
      for (const s of chords[bar]) v += tri(TAU * note(root / 2, s) * t) * 0.16 * Math.min(1, inBar / 0.4, (4 * beat - inBar) / 0.3 + 0.2);
      const n = Math.floor(b) % 16;
      const step = melody[n];
      const u = (b % 1) * beat;
      if (step != null) v += (Math.sin(TAU * note(root * 2, step) * t) + 0.3 * Math.sin(TAU * note(root * 4, step) * t)) * 0.3 * Math.exp(-u * 3.5) * Math.min(1, u / 0.01);
      out[i] = v;
    }
  },
  rain(out, r, rand) {
    const hiss = biquad("high", 900, 0.6);
    const soft = biquad("low", 5000 * Math.min(1.5, r.pitch), 0.7);
    for (let i = 0; i < out.length; i += 1) {
      const drop = rand() < 0.004 ? (rand() * 2 - 1) * 2 : 0;
      out[i] = soft(hiss(rand() * 2 - 1) * 0.6 + drop);
    }
  },
  wind(out, r, rand) {
    let brown = 0;
    let f = biquad("band", 300, 0.8);
    for (let i = 0; i < out.length; i += 1) {
      const t = i / RATE;
      brown = brown * 0.98 + (rand() * 2 - 1) * 0.2;
      const gust = 0.55 + 0.45 * Math.sin(TAU * 0.13 * t + Math.sin(TAU * 0.07 * t) * 2);
      if (i % 128 === 0) f = rebuild(f, "band", (250 + gust * 600) * r.pitch, 1.6);
      out[i] = f(brown) * gust * 3;
    }
  },
  purr(out, r, rand) {
    const low = biquad("low", 300 * r.pitch, 0.8);
    for (let i = 0; i < out.length; i += 1) {
      const t = i / RATE;
      const breath = 0.5 + 0.5 * Math.sin(TAU * (1 / 1.2) * t);
      const flutter = Math.max(0, Math.sin(TAU * 26 * r.pitch * t)) ** 3;
      out[i] = low(rand() * 2 - 1) * flutter * breath * 3;
    }
  },
  zap(out, r) {
    const len = out.length / RATE;
    let phase = 0;
    for (let i = 0; i < out.length; i += 1) {
      const t = i / RATE;
      phase += (TAU * 2200 * r.pitch * Math.exp(-t * 9)) / RATE;
      out[i] = (Math.sin(phase) + 0.4 * Math.sign(Math.sin(phase * 0.5))) * (1 - t / len);
    }
  },
  pop(out, r, rand) {
    let phase = 0;
    for (let i = 0; i < out.length; i += 1) {
      const t = i / RATE;
      phase += (TAU * (100 + 700 * Math.exp(-t * 60)) * r.pitch) / RATE;
      out[i] = (Math.sin(phase) + (t < 0.003 ? rand() - 0.5 : 0)) * Math.exp(-t * 30);
    }
  },
  choir(out, r) {
    // Three voices on a chord, through two vowel formants ("aah"), with a slow vibrato.
    const roots = [note(220 * r.pitch, 0), note(220 * r.pitch, r.mode === "major" ? 4 : 3), note(220 * r.pitch, 7)];
    const f1 = biquad("band", 750, 4);
    const f2 = biquad("band", 1150, 5);
    const phases = [0, 0, 0];
    for (let i = 0; i < out.length; i += 1) {
      const t = i / RATE;
      let saw = 0;
      roots.forEach((f, k) => {
        phases[k] += (TAU * f * (1 + 0.006 * Math.sin(TAU * (5 + k * 0.3) * t))) / RATE;
        saw += ((phases[k] / TAU) % 1) * 2 - 1;
      });
      out[i] = f1(saw) * 1.2 + f2(saw) * 0.8;
    }
  },
};

function rebuild(_f: ReturnType<typeof biquad>, kind: "low" | "high" | "band", freq: number, q: number) {
  // A swept filter: a fresh one per block is plenty for these sweeps (state restarts are inaudible at this level).
  return biquad(kind, freq, q);
}

/** Drops and bubbles: short sine blips with a rising pitch, a few per second. */
function plinks(out: Float32Array, rand: () => number, perSecond: number, pitch: (t: number) => number, length: number, decay: number) {
  const starts: number[] = [];
  for (let i = 0; i < out.length; i += 1) if (rand() < perSecond / RATE) starts.push(i);
  if (!starts.length) starts.push(Math.floor(out.length * 0.2));
  for (const s of starts) {
    const scale = 0.7 + rand() * 0.6;
    let phase = 0;
    for (let i = s; i < Math.min(out.length, s + length * RATE * 3); i += 1) {
      const t = (i - s) / RATE;
      phase += (TAU * pitch(t) * scale) / RATE;
      out[i] += Math.sin(phase) * Math.exp(-t * decay);
    }
  }
}

/** Samples for a recipe. Loops come back cross-faded; one-shots fade out at the end. */
export function render(r: Recipe): Float32Array {
  const rand = rng(r.seed + 1);
  const fade = r.loop ? Math.min(0.4, r.length * 0.15) : 0;
  const n = Math.max(1, Math.floor((r.length + fade) * RATE));
  const raw = new Float32Array(n);
  VOICES[r.kind](raw, r, rand);
  // Echo: a feedback delay, the room or the hull.
  if (r.echo > 0.01) {
    const d = Math.floor(RATE * (0.18 + r.echo * 0.25));
    for (let i = d; i < n; i += 1) raw[i] += raw[i - d] * r.echo;
  }
  let out = raw;
  if (r.loop) {
    const f = Math.floor(fade * RATE);
    const body = n - f;
    out = raw.slice(0, body);
    // The tail fades into the head, so the end runs straight into the start.
    for (let i = 0; i < f; i += 1) {
      const k = i / f;
      out[i] = raw[i] * k + raw[body + i] * (1 - k);
    }
  } else {
    const tail = Math.min(n, Math.floor(0.03 * RATE));
    for (let i = 0; i < tail; i += 1) out[n - 1 - i] *= i / tail;
  }
  let peak = 0;
  for (let i = 0; i < out.length; i += 1) {
    if (!Number.isFinite(out[i])) out[i] = 0;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  if (peak > 0) {
    const k = (0.9 * r.gain) / peak;
    for (let i = 0; i < out.length; i += 1) out[i] *= k;
  }
  return out;
}
