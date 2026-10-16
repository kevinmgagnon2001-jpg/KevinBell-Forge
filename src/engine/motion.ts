/**
 * Moves: the avatar's motion, built and filled in. Two ideas from recent motion research, made small
 * enough to run every frame on a phone:
 *
 *   Building (after GENMO, which turns text, video or keyframes into motion): `composeMove` turns plain
 *   words ("wave with the left hand, then cheer twice, upper body only") into a move, from a vocabulary
 *   of primitives with modifiers; a model can also write keyframes itself (`moveFromKeys`), and every
 *   pose is clamped to joint limits before it is kept. Moves are saved in the world, so they travel
 *   with the save to your other devices.
 *
 *   Filling in (after MaskedMimic, which completes a full body from partial constraints): a move only
 *   says what it says. `inpaint` lays it over the live gait joint by joint, so the joints it leaves out
 *   keep walking; `legIk` pins each foot to the ground actually under it (stairs, kerbs, slopes) and
 *   the pelvis drops when one foot must reach down. Nothing here is learned: a trained model can take
 *   the generator's place behind the same `Pose` and constraint shapes later.
 *
 * Joints are Euler angles in radians on the figure in Avatar.tsx (facing +z): x swings a limb back
 * (positive) or forward (negative), z spreads it out to the side (positive on the left).
 */
import type { World } from "./types.ts";

export const JOINTS = ["root", "pelvis", "chest", "head", "hipL", "hipR", "kneeL", "kneeR", "shoulderL", "shoulderR", "elbowL", "elbowR"] as const;
export type Joint = (typeof JOINTS)[number];
export type Angles = { x: number; y: number; z: number };
/** A whole pose: every joint, and how far the pelvis is lifted (m). */
export type Pose = Record<Joint, Angles> & { lift: number };
/** Part of a pose: only what a move drives. */
export type PartPose = Partial<Record<Joint, Partial<Angles>>> & { lift?: number };

export const LEGS: Joint[] = ["root", "pelvis", "hipL", "hipR", "kneeL", "kneeR"];
const UPPER: Joint[] = ["chest", "head", "shoulderL", "shoulderR", "elbowL", "elbowR"];

/** How far each joint may turn, radians: [min, max] per axis. Keeps any written move humanly possible. */
export const LIMITS: Record<Joint, { x: [number, number]; y: [number, number]; z: [number, number] }> = {
  root: { x: [-1.6, 1.6], y: [-3.2, 3.2], z: [-0.6, 0.6] },
  pelvis: { x: [-0.6, 0.6], y: [-0.8, 0.8], z: [-0.4, 0.4] },
  chest: { x: [-0.5, 1.4], y: [-0.9, 0.9], z: [-0.5, 0.5] },
  head: { x: [-0.9, 0.8], y: [-1.3, 1.3], z: [-0.5, 0.5] },
  hipL: { x: [-2.2, 0.8], y: [-0.6, 0.6], z: [-0.3, 1.2] },
  hipR: { x: [-2.2, 0.8], y: [-0.6, 0.6], z: [-1.2, 0.3] },
  kneeL: { x: [0, 2.5], y: [0, 0], z: [0, 0] },
  kneeR: { x: [0, 2.5], y: [0, 0], z: [0, 0] },
  shoulderL: { x: [-3.1, 1.2], y: [-1.2, 1.2], z: [-0.4, 3.0] },
  shoulderR: { x: [-3.1, 1.2], y: [-1.2, 1.2], z: [-3.0, 0.4] },
  elbowL: { x: [-2.6, 0], y: [-1.2, 1.2], z: [-0.3, 0.3] },
  elbowR: { x: [-2.6, 0], y: [-1.2, 1.2], z: [-0.3, 0.3] },
};
const LIFT: [number, number] = [-0.5, 0.6];

const clamp = (v: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, v));

export function emptyPose(): Pose {
  const pose = { lift: 0 } as Pose;
  for (const j of JOINTS) pose[j] = { x: 0, y: 0, z: 0 };
  return pose;
}

/** Keep a written pose inside the joint limits; unknown joints and non-numbers are dropped. */
export function clampPart(part: PartPose): PartPose {
  const out: PartPose = {};
  for (const j of JOINTS) {
    const a = part[j];
    if (!a || typeof a !== "object") continue;
    const kept: Partial<Angles> = {};
    for (const axis of ["x", "y", "z"] as const) {
      const v = Number(a[axis]);
      if (a[axis] !== undefined && Number.isFinite(v)) kept[axis] = clamp(v, LIMITS[j][axis]);
    }
    if (Object.keys(kept).length) out[j] = kept;
  }
  if (part.lift !== undefined && Number.isFinite(Number(part.lift))) out.lift = clamp(Number(part.lift), LIFT);
  return out;
}

// ---------- moves ----------

export type MoveKey = { t: number; pose: PartPose };
/** One step of a move: the joints it drives, its keys over 0..1, and how long it takes. */
export type MoveSegment = { name: string; length: number; mask: Joint[]; keys: MoveKey[]; lift?: boolean };
export type Move = {
  id: string;
  name: string;
  /** Plays until stopped. */
  loop: boolean;
  segments: MoveSegment[];
  /** How it was made: the words, or "keys" when written as keyframes. */
  from: string;
};

const sw = (t: number, n = 1) => Math.sin(t * Math.PI * 2 * n);

/** Sample a function of t into keys. */
function keysOf(count: number, f: (t: number) => PartPose): MoveKey[] {
  return Array.from({ length: count + 1 }, (_, i) => ({ t: i / count, pose: f(i / count) }));
}

/** Ease in from rest and back out, so a move starts and ends where the body is. */
const env = (t: number) => Math.min(1, t / 0.18, (1 - t) / 0.18);

type Prim = { id: string; label: string; words: string[]; length: number; loop?: boolean; legs?: boolean; build: (amp: number) => MoveKey[] };

/** The vocabulary. Each is right-handed where it matters; "left" mirrors it. */
export const PRIMITIVES: Prim[] = [
  {
    id: "wave",
    label: "Wave",
    words: ["wave", "waving", "hello", "hi", "bye", "goodbye"],
    length: 1.6,
    build: (a) => keysOf(16, (t) => ({ shoulderR: { x: -0.4 * env(t), z: -2.5 * env(t) * a }, elbowR: { x: -0.5 * env(t), z: 0.35 * sw(t, 3) * env(t) * a }, head: { z: -0.08 * env(t) } })),
  },
  {
    id: "cheer",
    label: "Cheer",
    words: ["cheer", "celebrate", "yay", "hooray", "victory", "woo"],
    length: 1.2,
    legs: true,
    build: (a) => keysOf(12, (t) => ({ shoulderL: { x: -2.9 * env(t) * a, z: 0.3 * env(t) }, shoulderR: { x: -2.9 * env(t) * a, z: -0.3 * env(t) }, elbowL: { x: -0.25 - 0.35 * Math.abs(sw(t, 2)) }, elbowR: { x: -0.25 - 0.35 * Math.abs(sw(t, 2)) }, chest: { x: -0.15 * env(t) }, head: { x: -0.3 * env(t) }, lift: 0.18 * Math.abs(sw(t, 1)) * a })),
  },
  {
    id: "clap",
    label: "Clap",
    words: ["clap", "clapping", "applause", "applaud"],
    length: 1.4,
    build: (a) => keysOf(14, (t) => ({ shoulderL: { x: -1.2 * env(t), z: (0.35 - 0.3 * Math.abs(sw(t, 3))) * a * env(t), y: 0.5 * env(t) }, shoulderR: { x: -1.2 * env(t), z: -(0.35 - 0.3 * Math.abs(sw(t, 3))) * a * env(t), y: -0.5 * env(t) }, elbowL: { x: -1.1 * env(t) }, elbowR: { x: -1.1 * env(t) } })),
  },
  {
    id: "point",
    label: "Point",
    words: ["point", "pointing", "look there", "over there"],
    length: 1.4,
    build: () => keysOf(8, (t) => ({ shoulderR: { x: -1.5 * env(t) }, elbowR: { x: -0.05 }, head: { y: -0.1 * env(t) }, chest: { y: -0.15 * env(t) } })),
  },
  {
    id: "salute",
    label: "Salute",
    words: ["salute", "saluting", "sir", "attention"],
    length: 1.5,
    build: () => keysOf(8, (t) => ({ shoulderR: { x: -1.2 * env(t), z: -1.2 * env(t), y: -0.6 * env(t) }, elbowR: { x: -2.3 * env(t) }, chest: { x: -0.06 * env(t) }, head: { x: -0.05 * env(t) } })),
  },
  {
    id: "bow",
    label: "Bow",
    words: ["bow", "bowing", "thank you", "thanks", "greet"],
    length: 1.8,
    build: (a) => keysOf(10, (t) => ({ chest: { x: 0.9 * env(t) * a }, head: { x: 0.3 * env(t) }, shoulderL: { x: -0.2 * env(t) }, shoulderR: { x: -0.2 * env(t) } })),
  },
  {
    id: "shrug",
    label: "Shrug",
    words: ["shrug", "shrugging", "dunno", "no idea", "whatever"],
    length: 1.2,
    build: (a) => keysOf(8, (t) => ({ shoulderL: { z: 0.5 * env(t) * a, x: -0.3 * env(t) }, shoulderR: { z: -0.5 * env(t) * a, x: -0.3 * env(t) }, elbowL: { x: -1.4 * env(t), y: -0.6 * env(t) }, elbowR: { x: -1.4 * env(t), y: 0.6 * env(t) }, head: { z: 0.2 * env(t) } })),
  },
  {
    id: "flex",
    label: "Flex",
    words: ["flex", "flexing", "strong", "muscles", "strongman"],
    length: 1.6,
    build: (a) => keysOf(8, (t) => ({ shoulderL: { z: 1.5 * env(t) }, shoulderR: { z: -1.5 * env(t) }, elbowL: { x: -2.0 * env(t) * a }, elbowR: { x: -2.0 * env(t) * a }, chest: { x: -0.12 * env(t) } })),
  },
  {
    id: "think",
    label: "Think",
    words: ["think", "thinking", "hmm", "ponder", "wonder"],
    length: 2.2,
    build: () => keysOf(8, (t) => ({ shoulderR: { x: -0.9 * env(t), z: -0.25 * env(t) }, elbowR: { x: -2.3 * env(t) }, shoulderL: { x: -0.5 * env(t), z: 0.3 * env(t) }, elbowL: { x: -1.6 * env(t), y: 0.5 * env(t) }, head: { x: 0.15 * env(t), z: 0.12 * env(t) } })),
  },
  {
    id: "stretch",
    label: "Stretch",
    words: ["stretch", "stretching", "yawn", "warm up"],
    length: 2.4,
    build: (a) => keysOf(12, (t) => ({ shoulderL: { x: -3.0 * env(t) * a }, shoulderR: { x: -3.0 * env(t) * a }, elbowL: { x: -0.1 }, elbowR: { x: -0.1 }, chest: { z: 0.3 * sw(t, 1) * env(t), x: -0.2 * env(t) } })),
  },
  {
    id: "dance",
    label: "Dance",
    words: ["dance", "dancing", "boogie", "groove", "party"],
    length: 2,
    loop: true,
    legs: true,
    build: (a) =>
      keysOf(24, (t) => ({
        pelvis: { y: 0.3 * sw(t, 2) * a, z: 0.12 * sw(t, 2) },
        chest: { y: -0.35 * sw(t, 2) * a, z: -0.1 * sw(t, 2) },
        head: { z: 0.15 * sw(t, 4) },
        shoulderL: { x: -1.6 - 0.8 * sw(t, 2) * a, z: 0.4 },
        shoulderR: { x: -1.6 + 0.8 * sw(t, 2) * a, z: -0.4 },
        elbowL: { x: -1.2 },
        elbowR: { x: -1.2 },
        kneeL: { x: 0.35 + 0.3 * Math.max(0, sw(t, 4)) },
        kneeR: { x: 0.35 + 0.3 * Math.max(0, -sw(t, 4)) },
        hipL: { x: -0.2 },
        hipR: { x: -0.2 },
        lift: -0.06 - 0.05 * Math.abs(sw(t, 4)),
      })),
  },
  {
    id: "jacks",
    label: "Jumping jacks",
    words: ["jumping jacks", "jumping jack", "jacks", "exercise", "workout"],
    length: 0.9,
    loop: true,
    legs: true,
    build: (a) =>
      keysOf(12, (t) => {
        const open = Math.abs(sw(t, 0.5));
        return { shoulderL: { z: 2.8 * open * a }, shoulderR: { z: -2.8 * open * a }, hipL: { z: 0.35 * open }, hipR: { z: -0.35 * open }, lift: 0.22 * Math.abs(sw(t, 1)) * a };
      }),
  },
  {
    id: "sit",
    label: "Sit",
    words: ["sit", "sit down", "sitting", "rest", "chill"],
    length: 1.5,
    loop: true,
    legs: true,
    build: () => keysOf(6, (t) => {
      const down = Math.min(1, t / 0.35);
      return { hipL: { x: -1.55 * down }, hipR: { x: -1.55 * down }, kneeL: { x: 1.55 * down }, kneeR: { x: 1.55 * down }, chest: { x: 0.1 * down }, shoulderL: { x: -0.5 * down }, shoulderR: { x: -0.5 * down }, elbowL: { x: -0.6 * down }, elbowR: { x: -0.6 * down }, lift: -0.36 * down };
    }),
  },
  {
    id: "look",
    label: "Look around",
    words: ["look around", "looking around", "search", "scan"],
    length: 3,
    build: () => keysOf(12, (t) => ({ head: { y: 1.0 * sw(t, 1) * env(t), x: -0.1 * env(t) }, chest: { y: 0.3 * sw(t, 1) * env(t) } })),
  },
  {
    id: "facepalm",
    label: "Facepalm",
    words: ["facepalm", "face palm", "oh no", "embarrassed"],
    length: 1.8,
    build: () => keysOf(8, (t) => ({ shoulderR: { x: -1.1 * env(t), z: -0.1 }, elbowR: { x: -2.4 * env(t) }, head: { x: 0.45 * env(t) }, chest: { x: 0.12 * env(t) } })),
  },
];

const mirrorJoint = (j: Joint): Joint => (j.endsWith("L") ? ((j.slice(0, -1) + "R") as Joint) : j.endsWith("R") ? ((j.slice(0, -1) + "L") as Joint) : j);

/** The same pose on the other side: left and right swap, turns and side angles flip. */
export function mirrorPart(part: PartPose): PartPose {
  const out: PartPose = {};
  for (const j of JOINTS) {
    const a = part[j];
    if (!a) continue;
    out[mirrorJoint(j)] = { ...(a.x !== undefined ? { x: a.x } : {}), ...(a.y !== undefined ? { y: -a.y } : {}), ...(a.z !== undefined ? { z: -a.z } : {}) };
  }
  if (part.lift !== undefined) out.lift = part.lift;
  return out;
}

function maskOf(keys: MoveKey[]): Joint[] {
  const used = new Set<Joint>();
  for (const k of keys) for (const j of JOINTS) if (k.pose[j]) used.add(j);
  return JOINTS.filter((j) => used.has(j));
}

function findPrim(text: string): Prim | undefined {
  let best: { p: Prim; len: number; at: number } | undefined;
  for (const p of PRIMITIVES) {
    for (const word of [p.id, ...p.words]) {
      const at = text.search(new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}\\b`));
      if (at < 0) continue;
      if (!best || word.length > best.len || (word.length === best.len && at < best.at)) best = { p, len: word.length, at };
    }
  }
  return best?.p;
}

const COUNTS: Record<string, number> = { once: 1, twice: 2, thrice: 3, two: 2, three: 3, four: 4, five: 5 };

/** "a" .. "z" and digits, dashes between: a move's id from its name. */
export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

/**
 * Words to a move. Steps are split on "then" and commas; each names a primitive and may say left or
 * right, fast or slow, big or small, how many times, and "upper body" (keep walking while you do it).
 * "keep", "loop" or "forever" plays it until stopped. Returns null when no step names a primitive.
 */
export function composeMove(words: string, name?: string): Move | null {
  const text = words.toLowerCase().replace(/[’']/g, "");
  const parts = text.split(/\s*(?:,|;|\bthen\b|\band then\b|\bfollowed by\b)\s*/).filter(Boolean);
  const segments: MoveSegment[] = [];
  let loop = /\b(keep|loop|looping|forever|until i stop|nonstop|over and over)\b/.test(text);
  const upperAll = /\b(upper body|while walking|on the move|arms only)\b/.test(text);
  for (const part of parts) {
    const prim = findPrim(part);
    if (!prim) continue;
    const amp = /\b(big|huge|wild|crazy|hard)\b/.test(part) ? 1.25 : /\b(small|little|tiny|gentle|subtle)\b/.test(part) ? 0.65 : 1;
    const speed = /\b(fast|quick|quickly|rapid)\b/.test(part) ? 0.6 : /\b(slow|slowly|lazy)\b/.test(part) ? 1.6 : 1;
    const times = Number(part.match(/\b(\d)\s*(?:times|x)\b/)?.[1]) || COUNTS[part.match(/\b(once|twice|thrice|two|three|four|five)\b(?:\s*times)?/)?.[1] ?? ""] || 1;
    const left = /\bleft\b/.test(part);
    let keys = prim.build(amp).map((k) => ({ t: k.t, pose: clampPart(left ? mirrorPart(k.pose) : k.pose) }));
    if (upperAll || /\b(upper body|while walking|arms only)\b/.test(part)) {
      keys = keys.map((k) => {
        const pose: PartPose = {};
        for (const j of UPPER) if (k.pose[j]) pose[j] = k.pose[j];
        return { t: k.t, pose };
      });
    }
    const usesLift = keys.some((k) => k.pose.lift !== undefined);
    for (let i = 0; i < Math.min(times, 6); i += 1) {
      segments.push({ name: `${left ? "left " : ""}${prim.label.toLowerCase()}`, length: prim.length * speed, mask: maskOf(keys), keys, lift: usesLift });
    }
    if (prim.loop && parts.length === 1) loop = true;
  }
  if (!segments.length) return null;
  const label = name?.trim() || segments.map((s) => s.name).filter((n, i, all) => all.indexOf(n) === i).join(" then ");
  return { id: slug(label) || "move", name: label.slice(0, 48), loop, segments: segments.slice(0, 12), from: words.slice(0, 200) };
}

/**
 * A move a model wrote as keyframes: [{ "t": 0..1, "pose": { "shoulderR": { "z": -2.4 }, ... } }, ...]
 * over `length` seconds. Every pose is clamped to joint limits; unknown joints are dropped.
 */
export function moveFromKeys(name: string, keysJson: string, length = 1.5, loop = false): { move: Move } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(keysJson);
  } catch {
    return { error: "keys must be JSON: [{\"t\":0,\"pose\":{\"shoulderR\":{\"z\":-2.4}}}, ...]" };
  }
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 64) return { error: "keys must be a list of 2 to 64 keyframes" };
  const keys: MoveKey[] = [];
  for (const k of raw) {
    const t = Number((k as MoveKey)?.t);
    const pose = (k as MoveKey)?.pose;
    if (!Number.isFinite(t) || !pose || typeof pose !== "object") return { error: "each keyframe needs t (0..1) and pose" };
    keys.push({ t: Math.max(0, Math.min(1, t)), pose: clampPart(pose) });
  }
  keys.sort((a, b) => a.t - b.t);
  const mask = maskOf(keys);
  if (!mask.length && !keys.some((k) => k.pose.lift !== undefined)) return { error: `no known joints; joints are ${JOINTS.join(", ")}` };
  const label = name.trim() || "my move";
  return {
    move: {
      id: slug(label) || "move",
      name: label.slice(0, 48),
      loop,
      segments: [{ name: label, length: Math.max(0.2, Math.min(20, length)), mask, keys, lift: keys.some((k) => k.pose.lift !== undefined) }],
      from: "keys",
    },
  };
}

export const moveLength = (move: Move) => move.segments.reduce((sum, s) => sum + s.length, 0);

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * Where a move is at `time` seconds: the joints it drives right now, and how strongly (fading in at
 * the start and out at the end of a one-shot). `done` once a one-shot has finished.
 */
export function sampleMove(move: Move, time: number): { pose: PartPose; mask: Joint[]; weight: number; done: boolean } {
  const total = moveLength(move);
  if (total <= 0) return { pose: {}, mask: [], weight: 0, done: true };
  if (!move.loop && time >= total) return { pose: {}, mask: [], weight: 0, done: true };
  let t = move.loop ? ((time % total) + total) % total : Math.max(0, time);
  let seg = move.segments[0];
  for (const s of move.segments) {
    seg = s;
    if (t < s.length) break;
    t -= s.length;
  }
  const u = Math.min(1, Math.max(0, t / seg.length));
  const keys = seg.keys;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t < u) i += 1;
  const a = keys[i];
  const b = keys[Math.min(keys.length - 1, i + 1)];
  const span = b.t - a.t;
  const k = span > 1e-6 ? smoothstep(Math.max(0, Math.min(1, (u - a.t) / span))) : 0;
  const pose: PartPose = {};
  for (const j of seg.mask) {
    const pa = a.pose[j] ?? {};
    const pb = b.pose[j] ?? {};
    const out: Partial<Angles> = {};
    for (const axis of ["x", "y", "z"] as const) {
      if (pa[axis] === undefined && pb[axis] === undefined) continue;
      const va = pa[axis] ?? 0;
      const vb = pb[axis] ?? 0;
      out[axis] = va + (vb - va) * k;
    }
    pose[j] = out;
  }
  if (seg.lift) pose.lift = (a.pose.lift ?? 0) + ((b.pose.lift ?? 0) - (a.pose.lift ?? 0)) * k;
  const weight = move.loop ? Math.min(1, time / 0.25) : Math.min(1, time / 0.2, (total - time) / 0.25);
  return { pose, mask: seg.mask, weight: Math.max(0, weight), done: false };
}

/**
 * Masked inpainting, in miniature: the move's joints (only the axes it names) replace the generator's,
 * by `weight`; every joint it leaves out keeps the generator's motion.
 */
export function inpaint(base: Pose, layer: { pose: PartPose; mask: Joint[]; weight: number }): Pose {
  if (layer.weight <= 0) return base;
  const w = Math.min(1, layer.weight);
  const out = { ...base } as Pose;
  for (const j of layer.mask) {
    const a = layer.pose[j];
    if (!a) continue;
    const b = base[j];
    out[j] = {
      x: a.x === undefined ? b.x : b.x + (a.x - b.x) * w,
      y: a.y === undefined ? b.y : b.y + (a.y - b.y) * w,
      z: a.z === undefined ? b.z : b.z + (a.z - b.z) * w,
    };
  }
  if (layer.pose.lift !== undefined) out.lift = base.lift + (layer.pose.lift - base.lift) * w;
  return out;
}

/**
 * Two-bone leg IK in the leg's swing plane. `hip` and `knee` are the current angles; `raise` is how far
 * the ground under this foot is above (+) or below (-) where the leg now puts it. Returns the angles
 * that put the foot there, and how far short it falls (> 0 when the leg cannot reach down that far).
 */
export function legIk(hip: number, knee: number, raise: number, thigh: number, shin: number): { hip: number; knee: number; short: number } {
  // Where the ankle is now, relative to the hip: z forward, y up. x angles swing the leg back.
  const z = -thigh * Math.sin(hip) - shin * Math.sin(hip + knee);
  const y = -thigh * Math.cos(hip) - shin * Math.cos(hip + knee) + raise;
  const reach = thigh + shin - 1e-4;
  const want = Math.hypot(z, y);
  const d = Math.max(Math.abs(thigh - shin) + 1e-4, Math.min(reach, want));
  const bend = Math.acos(Math.max(-1, Math.min(1, (thigh * thigh + shin * shin - d * d) / (2 * thigh * shin))));
  const k = Math.PI - bend;
  const toward = Math.atan2(-z, -y);
  const beta = Math.acos(Math.max(-1, Math.min(1, (thigh * thigh + d * d - shin * shin) / (2 * thigh * d))));
  return { hip: toward - beta, knee: k, short: Math.max(0, want - reach) };
}

// ---------- the world's moves ----------

export const MAX_MOVES = 24;

/** Moves you can do: the primitives as one-step moves, then the world's own (newest win by id). */
export function movesOf(world: Pick<World, "moves">): Move[] {
  const base = PRIMITIVES.map((p) => composeMove(p.id, p.label)!).map((m) => ({ ...m, from: "built in" }));
  const own = world.moves ?? [];
  const ids = new Set(own.map((m) => m.id));
  return [...base.filter((m) => !ids.has(m.id)), ...own];
}

export function findMove(world: Pick<World, "moves">, query: string): Move | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  const all = movesOf(world);
  return all.find((m) => m.id === slug(q)) ?? all.find((m) => m.name.toLowerCase() === q) ?? (findPrim(q) ? all.find((m) => m.id === findPrim(q)!.id) : undefined);
}

/** Keep a move in the world (replacing one of the same id), newest last, at most MAX_MOVES. */
export function keepMove(world: World, move: Move): World {
  const rest = (world.moves ?? []).filter((m) => m.id !== move.id);
  return { ...world, moves: [...rest, move].slice(-MAX_MOVES) };
}

/** A saved list of moves, checked: anything malformed is dropped, every pose clamped again. */
export function cleanMoves(value: unknown): Move[] {
  if (!Array.isArray(value)) return [];
  const out: Move[] = [];
  for (const m of value.slice(-MAX_MOVES)) {
    if (!m || typeof m !== "object" || typeof m.id !== "string" || !Array.isArray(m.segments)) continue;
    const segments: MoveSegment[] = [];
    for (const s of m.segments.slice(0, 12)) {
      if (!s || !Array.isArray(s.keys) || s.keys.length < 2) continue;
      const keys = s.keys.slice(0, 64).map((k: MoveKey) => ({ t: Math.max(0, Math.min(1, Number(k?.t) || 0)), pose: clampPart(k?.pose ?? {}) }));
      segments.push({ name: String(s.name ?? "").slice(0, 48), length: Math.max(0.2, Math.min(20, Number(s.length) || 1)), mask: maskOf(keys), keys, lift: Boolean(s.lift) });
    }
    if (segments.length) out.push({ id: slug(m.id) || "move", name: String(m.name ?? m.id).slice(0, 48), loop: Boolean(m.loop), segments, from: String(m.from ?? "").slice(0, 200) });
  }
  return out;
}

// ---------- instant commands ----------

export type MoveCall = { tool: "make_move" | "do_move"; arguments: Record<string, string> };

/**
 * Plain requests about moves, as tool calls without waiting for a model:
 *   "make a move called victory: cheer then flex twice"  -> make_move
 *   "wave", "do a little dance", "salute with your left hand" -> do_move (built on the spot if new)
 *   "stop dancing", "stop the move"                         -> do_move stop
 * Only short, clear requests match; anything else is left to the model.
 */
export function moveIntent(intent: string, world: Pick<World, "moves">): MoveCall | null {
  const text = intent.trim().toLowerCase().replace(/[’']/g, "");
  if (/^(stop|cancel|end)\b.*\b(move|moving|dancing|dance|emote|that|it|waving|sitting|clapping)\b/.test(text) || /^(stand up|stop)$/.test(text)) {
    return { tool: "do_move", arguments: { move: "stop" } };
  }
  const make = text.match(/^(?:make|create|build|teach me|teach|invent|record)\s+(?:a|an|my|me a)?\s*(?:new\s+)?(?:move|emote|dance|animation|gesture)(?:\s+(?:called|named)\s+([a-z0-9 -]{1,32}?))?\s*(?::|-|that|which|where|to)\s+(.+)$/);
  if (make) {
    const words = make[2].trim();
    return { tool: "make_move", arguments: { words, ...(make[1] ? { name: make[1].trim() } : {}) } };
  }
  if (text.split(/\s+/).length > 9) return null;
  const own = (world.moves ?? []).find((m) => new RegExp(`\\b${m.name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, "\\s+")}\\b`).test(text));
  if (own && /^(do|perform|play|show|try)?\b/.test(text)) return { tool: "do_move", arguments: { move: own.id } };
  if (!findPrim(text)) return null;
  // A move word must lead the request ("wave", "do a little dance", "lets cheer"), not sit deep inside another one.
  const lead = text.replace(/^(?:(?:please|now|ok|okay|go|lets|let us|can you|could you)\s+)*(?:(?:do|perform|play|show me|show|try|give me|start)\s+)?(?:a|an|the|some|your|my)?\s*/, "");
  if (/^(build|make|add|spawn|create|place|put|paint|colou?r|move|turn|delete|remove|set|drop|throw|wrap)\b/.test(lead)) return null;
  if (!findPrim(lead.split(/\s+/).slice(0, 3).join(" "))) return null;
  return { tool: "do_move", arguments: { move: text } };
}
