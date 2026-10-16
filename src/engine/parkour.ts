/**
 * Vault and climb, chosen by what is in front of you (after PARC, in a light, procedural version:
 * no network, just a ledge probe and hand-placed curves).
 *
 *   step     up to WALK.step: the walker already steps onto it (physics.ts).
 *   vault    knee to waist high and thin, taken at speed (or too thin to stand on): one hand on the
 *            top, legs tucked to the side, over and down the far side, still running.
 *   mantle   up to about chest high with room on top: hands on the edge, push up, a knee, stand.
 *   climb    up to about 2.3 m: jump to a hang with the hands on the ledge, pull up, knee over.
 *
 * ledgeAhead probes the world's solids (the same boxes the walker collides with) and returns a
 * Traverse: where it starts and ends, where the hands go, and how long it takes. sampleTraverse gives
 * the feet along it; twoBone solves an arm (or leg) to reach a point, for the hands on the ledge.
 */
import { WALK, type Solid } from "./physics.ts";

export const PARKOUR = {
  /** How far ahead the probe looks at most (from the body's edge), m. */
  reach: 0.6,
  /** Tallest thing vaulted, above the feet. */
  vaultMax: 1.2,
  /** Deepest thing vaulted (along the run). */
  vaultDepth: 0.9,
  /** Ground speed from which a thin obstacle is vaulted rather than climbed onto. */
  vaultSpeed: 3,
  /** Tallest thing mantled (hands at chest height); above it is a climb from a hang. */
  mantleMax: 1.25,
  /** Tallest ledge reached from a jump, above the feet. */
  climbMax: 2.3,
  /** Furthest drop at the far side of a vault. */
  vaultDrop: 2,
} as const;

export type TraverseKind = "vault" | "mantle" | "climb";

type P = { x: number; y: number; z: number };

export type Traverse = {
  kind: TraverseKind;
  /** Feet at the start and at the end. */
  from: P;
  to: P;
  /** The near edge of the top, where the hands go (at the top's height). */
  hand: P;
  /** Height of the top. */
  top: number;
  /** Facing during the move (toward the obstacle). */
  yaw: number;
  /** The way it goes, unit, across the ground. */
  dir: { x: number; z: number };
  /** Distances along `dir` from the start: touching the near face, clear of the far face. */
  near: number;
  far: number;
  /** Seconds. */
  duration: number;
};

const EPS = 1e-4;

type Box = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

function hits(s: Solid, b: Box): boolean {
  return s.min.x < b.maxX - EPS && s.max.x > b.minX + EPS && s.min.y < b.maxY - EPS && s.max.y > b.minY + EPS && s.min.z < b.maxZ - EPS && s.max.z > b.minZ + EPS;
}

function body(x: number, y: number, z: number, tall: number = WALK.height): Box {
  const r = WALK.radius;
  return { minX: x - r, maxX: x + r, minY: y, maxY: y + tall, minZ: z - r, maxZ: z + r };
}

/** The walker would fit here, standing (or crouched to `tall`), touching nothing. */
function fits(x: number, y: number, z: number, solids: Solid[], tall?: number): boolean {
  const box = body(x, y + 0.002, z, tall);
  return !solids.some((s) => hits(s, box));
}

/** Highest top under the walker's footprint at or below `limit` (the land if nothing is). */
function supportAt(x: number, z: number, limit: number, solids: Solid[], ground: (x: number, z: number) => number): number {
  const r = WALK.radius;
  let best = ground(x, z);
  for (const s of solids) {
    if (s.max.y > limit + EPS || s.max.y <= best) continue;
    if (s.min.x < x + r - EPS && s.max.x > x - r + EPS && s.min.z < z + r - EPS && s.max.z > z - r + EPS) best = s.max.y;
  }
  return best;
}

/** Where a ray across the ground enters and leaves a box grown by `grow`; null when it misses. */
function slab(x: number, z: number, dx: number, dz: number, s: Solid, grow: number): { enter: number; exit: number } | null {
  let enter = -Infinity;
  let exit = Infinity;
  for (const [o, d, lo, hi] of [
    [x, dx, s.min.x - grow, s.max.x + grow],
    [z, dz, s.min.z - grow, s.max.z + grow],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (o <= lo || o >= hi) return null;
      continue;
    }
    const a = (lo - o) / d;
    const b = (hi - o) / d;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
  }
  return enter < exit ? { enter, exit } : null;
}

/**
 * What can be done about the obstacle ahead, walking from `feet` along `dir` at `speed`. Looks
 * `reach` past the body's edge (capped at PARKOUR.reach). Null when there is nothing to vault or
 * climb: open ground, a kerb you just step onto, a wall too tall, or no room to come out.
 */
export function ledgeAhead(feet: P, dir: { x: number; z: number }, speed: number, solids: Solid[], ground: (x: number, z: number) => number, reach: number = PARKOUR.reach): Traverse | null {
  const len = Math.hypot(dir.x, dir.z);
  if (len < 1e-6) return null;
  const dx = dir.x / len;
  const dz = dir.z / len;
  const r = WALK.radius;
  const start = { ...body(feet.x, feet.y, feet.z), minY: feet.y + 0.02, maxY: feet.y + WALK.height - 0.02 };
  // As the walker does: what you already stand inside does not count.
  const blocking = solids.filter((s) => !s.dynamic && !hits(s, start));
  const look = Math.min(PARKOUR.reach, Math.max(0, reach));

  // The nearest box in the way: it rises above a step, reaches down into the body, and is close.
  let hit: { s: Solid; enter: number; exit: number } | null = null;
  for (const s of blocking) {
    if (s.max.y - feet.y <= WALK.step + 0.01 || s.min.y >= feet.y + WALK.height - 0.05) continue;
    const span = slab(feet.x, feet.z, dx, dz, s, r);
    if (!span || span.enter < -0.05 || span.enter > look) continue;
    if (!hit || span.enter < hit.enter) hit = { s, ...span };
  }
  if (!hit) return null;

  // The real top: boxes stacked flush on it count as one obstacle.
  let top = hit.s.max.y;
  let exit = hit.exit;
  const edge = Math.max(0, hit.enter) + r;
  const inside = (t: number) => ({ x: feet.x + dx * t, z: feet.z + dz * t });
  for (let grown = true; grown; ) {
    grown = false;
    for (const s of blocking) {
      if (Math.abs(s.min.y - top) > 0.02 || s.max.y - feet.y > PARKOUR.climbMax + 0.01) continue;
      const span = slab(feet.x, feet.z, dx, dz, s, r);
      if (!span || span.enter > hit.enter + r + 0.05 || span.exit < edge + r) continue;
      top = s.max.y;
      exit = Math.max(exit, span.exit);
      grown = true;
    }
  }
  const h = top - feet.y;
  if (h <= WALK.step + 0.01 || h > PARKOUR.climbMax + 0.01) return null;
  // Boxes just as high and touching along the run (a wall of crates) make the obstacle deeper.
  for (let grown = true; grown; ) {
    grown = false;
    for (const s of blocking) {
      if (s.max.y < top - 0.02 || s.min.y > feet.y + WALK.step) continue;
      const span = slab(feet.x, feet.z, dx, dz, s, r);
      if (!span || span.enter > exit - 2 * r + 0.02 || span.exit <= exit) continue;
      exit = span.exit;
      grown = true;
    }
  }

  const near = Math.max(0, hit.enter - 0.01);
  const depth = exit - hit.enter - 2 * r;
  const yaw = Math.atan2(dx, dz);
  const handAt = inside(near + r);
  const hand = { x: handAt.x, y: top, z: handAt.z };
  const from = { ...feet };
  const contact = inside(near);
  const base = { from, hand, top, yaw, dir: { x: dx, z: dz }, near };

  // Room to come up past the face (nothing overhangs the edge), crouched as you go over.
  const clearOver = fits(contact.x, top + 0.05, contact.z, blocking, 0.95);
  if (!clearOver) return null;

  // Standing on top: far enough in to stand, the top holds, and head room.
  const standT = near + 2 * r + 0.08;
  const stand = inside(standT);
  const canStand = depth >= 2 * r + 0.06 && Math.abs(supportAt(stand.x, stand.z, top + 0.01, blocking, ground) - top) < 0.03 && fits(stand.x, top, stand.z, blocking);

  // A vault: low, thin, and clear on the far side.
  if (h <= PARKOUR.vaultMax && depth <= PARKOUR.vaultDepth && (speed >= PARKOUR.vaultSpeed || !canStand)) {
    const farT = exit + 0.18;
    const land = inside(farT);
    const landY = supportAt(land.x, land.z, top - 0.05, blocking, ground);
    const overMid = inside((near + exit) / 2);
    const clear = fits(overMid.x, top + 0.05, overMid.z, blocking, 0.95) && fits(inside(exit).x, top + 0.05, inside(exit).z, blocking, 0.95);
    if (landY <= feet.y + WALK.step && landY >= feet.y - PARKOUR.vaultDrop && clear && fits(land.x, landY, land.z, blocking)) {
      const pace = Math.max(speed, 3.5);
      return { ...base, kind: "vault", to: { x: land.x, y: landY, z: land.z }, far: farT, duration: Math.max(0.42, Math.min(0.9, (farT + 0.4) / pace + 0.18)) };
    }
  }
  if (!canStand) return null;
  const kind: TraverseKind = h <= PARKOUR.mantleMax ? "mantle" : "climb";
  return {
    ...base,
    kind,
    to: { x: stand.x, y: top, z: stand.z },
    far: standT,
    duration: kind === "mantle" ? 0.42 + 0.28 * h : 0.7 + 0.32 * h,
  };
}

const ease = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};
const out = (t: number) => 1 - (1 - Math.max(0, Math.min(1, t))) ** 2;
const into = (t: number) => Math.max(0, Math.min(1, t)) ** 2;
const span = (s: number, a: number, b: number) => (s - a) / (b - a);

/** The phases of each move, as shares of its time (also used to pose the body, Avatar.tsx). */
export const PHASES = {
  vault: { reach: 0.3, over: 0.7 },
  mantle: { reach: 0.22, up: 0.72 },
  climb: { reach: 0.22, hang: 0.34, up: 0.78 },
} as const;

/** Hanging from the ledge, the hands overhead are this far above the feet. */
export const HANG = 1.72;

/** The feet `s` (0..1) of the way through a move. */
export function sampleTraverse(tr: Traverse, s: number): P {
  const k = Math.max(0, Math.min(1, s));
  const { from, to, dir, near, top } = tr;
  const at = (d: number, y: number) => ({ x: from.x + dir.x * d, y, z: from.z + dir.z * d });
  if (tr.kind === "vault") {
    const ph = PHASES.vault;
    const over = top + 0.06;
    // In to the face rising, across the top in a low arc, then out and down, still going.
    if (k < ph.reach) return at(near * span(k, 0, ph.reach), from.y + (over - from.y) * out(span(k, 0, ph.reach)));
    if (k < ph.over) {
      const u = span(k, ph.reach, ph.over);
      return at(near + (tr.far - 0.18 - near) * u, over + Math.sin(u * Math.PI) * 0.08);
    }
    const u = span(k, ph.over, 1);
    return at(tr.far - 0.18 + 0.18 * u, over + (to.y - over) * into(u));
  }
  if (tr.kind === "mantle") {
    const ph = PHASES.mantle;
    // Step in and plant the hands, push up (a little hop at the start), then step onto the top.
    if (k < ph.reach) return at(near * ease(span(k, 0, ph.reach)), from.y);
    if (k < ph.up) return at(near, from.y + (top - from.y) * ease(span(k, ph.reach, ph.up)));
    return at(near + (tr.far - near) * ease(span(k, ph.up, 1)), top);
  }
  const ph = PHASES.climb;
  const hang = Math.max(from.y, top - HANG);
  // Jump to a hang under the ledge, hang a beat, pull up, and knee over onto the top.
  if (k < ph.reach) return at(near * ease(span(k, 0, ph.reach)), from.y + (hang - from.y) * out(span(k, 0, ph.reach)));
  if (k < ph.hang) return at(near, hang - Math.sin(span(k, ph.reach, ph.hang) * Math.PI) * 0.04);
  if (k < ph.up) return at(near, hang + (top - hang) * ease(span(k, ph.hang, ph.up)));
  return at(near + (tr.far - near) * ease(span(k, ph.up, 1)), top);
}

/**
 * Two bones from a joint reaching a point (z forward, y up, from the joint), the way the figure's
 * limbs hang: angles about x, the limb pointing down at 0. `bend` +1 folds the second bone back (a
 * knee), -1 forward (an elbow). Returns the first joint's angle, the second's, and how short it falls.
 */
export function twoBone(z: number, y: number, a: number, b: number, bend: 1 | -1): { root: number; bend: number; short: number } {
  const want = Math.hypot(z, y);
  const d = Math.max(Math.abs(a - b) + 1e-4, Math.min(a + b - 1e-4, want));
  const inner = Math.acos(Math.max(-1, Math.min(1, (a * a + b * b - d * d) / (2 * a * b))));
  const toward = Math.atan2(-z, -y);
  const beta = Math.acos(Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))));
  return { root: toward - bend * beta, bend: bend * (Math.PI - inner), short: Math.max(0, want - (a + b)) };
}
