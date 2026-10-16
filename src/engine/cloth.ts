/**
 * Cloth: capes and flags (Papers roadmap: soft bodies and cloth, in a light version of Vertex
 * Block Descent's targets: a grid of particles solved by position-based dynamics). Links across,
 * down and on the diagonals hold its shape, skip-one links resist folding, long-range tethers keep
 * it from stretching, and wind pushes each little triangle by how squarely it meets it, so a flag
 * ripples instead of just leaning.
 *
 *   makeCloth    a grid, hanging from its top edge (a cape) or its left edge (a flag).
 *   stepCloth    one frame: pins where they are held now, gravity, wind, colliders (capsules for a
 *                body, the land), and the links.
 *   capeOf / flagOf   who wears a cape, where flags fly (entity customData).
 */
import type { Entity, World } from "./types.ts";
import { IDENTITY, V3 } from "./types.ts";

type P = { x: number; y: number; z: number };

export type Cloth = {
  cols: number;
  rows: number;
  pos: Float64Array;
  prev: Float64Array;
  /** Index of each held particle, in the order pins are given to stepCloth. */
  pinned: number[];
  links: { a: number; b: number; rest: number; stiff: number }[];
  /** Rest distance between neighbours. */
  cell: number;
};

/** An upright capsule (a body): a segment from `a` to `b` with a radius. */
export type Capsule = { a: P; b: P; r: number };

export type ClothWorld = {
  ground: (x: number, z: number) => number;
  wind?: P;
  capsules?: Capsule[];
  /** Seconds, for the gusts. */
  time?: number;
};

const SUBSTEPS = 3;
const ITERATIONS = 5;

/**
 * A cloth `width` by `height` metres in `cols` by `rows` particles, laid out from `origin` along
 * `across` (unit) and down. `pin` "top" holds the top row (a cape: only its two corners and the
 * middle, so it gathers), "left" holds the left column (a flag on a pole).
 */
export function makeCloth(width: number, height: number, cols: number, rows: number, origin: P, across: P, pin: "top" | "left"): Cloth {
  const pos = new Float64Array(cols * rows * 3);
  const dx = width / (cols - 1);
  const dy = height / (rows - 1);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = (r * cols + c) * 3;
      pos[i] = origin.x + across.x * c * dx;
      pos[i + 1] = origin.y - r * dy + across.y * c * dx;
      pos[i + 2] = origin.z + across.z * c * dx;
    }
  }
  const links: Cloth["links"] = [];
  const id = (r: number, c: number) => r * cols + c;
  const add = (a: number, b: number, stiff: number) => {
    const d = Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
    links.push({ a, b, rest: d, stiff });
  };
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (c + 1 < cols) add(id(r, c), id(r, c + 1), 1);
      if (r + 1 < rows) add(id(r, c), id(r + 1, c), 1);
      if (r + 1 < rows && c + 1 < cols) {
        // Cloth hardly resists shear, so it drapes and folds.
        add(id(r, c), id(r + 1, c + 1), 0.004);
        add(id(r, c + 1), id(r + 1, c), 0.004);
      }
      if (c + 2 < cols) add(id(r, c), id(r, c + 2), 0.12);
      if (r + 2 < rows) add(id(r, c), id(r + 2, c), 0.12);
    }
  }
  const pinned = pin === "top" ? [...new Set([0, Math.floor((cols - 1) / 2), cols - 1])] : Array.from({ length: rows }, (_, r) => id(r, 0));
  return { cols, rows, pos, prev: Float64Array.from(pos), pinned, links, cell: Math.min(dx, dy) };
}

function solve(pos: Float64Array, inv: Float64Array, a: number, b: number, rest: number, stiff: number) {
  const wa = inv[a];
  const wb = inv[b];
  const w = wa + wb;
  if (w <= 0) return;
  const ax = a * 3;
  const bx = b * 3;
  const dx = pos[bx] - pos[ax];
  const dy = pos[bx + 1] - pos[ax + 1];
  const dz = pos[bx + 2] - pos[ax + 2];
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-9) return;
  const k = ((d - rest) / d / w) * stiff;
  pos[ax] += dx * k * wa;
  pos[ax + 1] += dy * k * wa;
  pos[ax + 2] += dz * k * wa;
  pos[bx] -= dx * k * wb;
  pos[bx + 1] -= dy * k * wb;
  pos[bx + 2] -= dz * k * wb;
}

function pushOutOfCapsule(pos: Float64Array, i: number, cap: Capsule, pad: number) {
  const x = pos[i * 3];
  const y = pos[i * 3 + 1];
  const z = pos[i * 3 + 2];
  const abx = cap.b.x - cap.a.x;
  const aby = cap.b.y - cap.a.y;
  const abz = cap.b.z - cap.a.z;
  const len2 = abx * abx + aby * aby + abz * abz || 1;
  const t = Math.max(0, Math.min(1, ((x - cap.a.x) * abx + (y - cap.a.y) * aby + (z - cap.a.z) * abz) / len2));
  const cx = cap.a.x + abx * t;
  const cy = cap.a.y + aby * t;
  const cz = cap.a.z + abz * t;
  const dx = x - cx;
  const dy = y - cy;
  const dz = z - cz;
  const d = Math.hypot(dx, dy, dz);
  const room = cap.r + pad;
  if (d >= room || d < 1e-9) return;
  const k = room / d;
  pos[i * 3] = cx + dx * k;
  pos[i * 3 + 1] = cy + dy * k;
  pos[i * 3 + 2] = cz + dz * k;
}

/** One frame. `pins` are where the held particles are now (same order as cloth.pinned). */
export function stepCloth(cloth: Cloth, pins: P[], dt: number, world: ClothWorld): void {
  const { cols, rows, pos, prev, links } = cloth;
  const n = cols * rows;
  const h = Math.min(0.1, Math.max(0, dt)) / SUBSTEPS;
  if (h <= 0) return;
  const inv = new Float64Array(n).fill(1);
  for (const i of cloth.pinned) inv[i] = 0;
  const wind = world.wind ?? { x: 0, y: 0, z: 0 };
  const time = world.time ?? 0;
  const force = new Float64Array(n * 3);
  for (let step = 0; step < SUBSTEPS; step += 1) {
    // Wind on each triangle, by how squarely it meets it (with a gusty flutter that travels along).
    force.fill(0);
    for (let r = 0; r < rows - 1; r += 1) {
      for (let c = 0; c < cols - 1; c += 1) {
        const a = r * cols + c;
        const b = a + 1;
        const d = a + cols;
        const ux = pos[b * 3] - pos[a * 3];
        const uy = pos[b * 3 + 1] - pos[a * 3 + 1];
        const uz = pos[b * 3 + 2] - pos[a * 3 + 2];
        const vx = pos[d * 3] - pos[a * 3];
        const vy = pos[d * 3 + 1] - pos[a * 3 + 1];
        const vz = pos[d * 3 + 2] - pos[a * 3 + 2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const gust = 1 + 0.45 * Math.sin(time * 5.3 - c * 0.9 + r * 0.35) + 0.25 * Math.sin(time * 11.7 + c * 1.7);
        // Relative wind: the air against the cloth's own motion.
        const mx = (pos[a * 3] - prev[a * 3]) / h;
        const my = (pos[a * 3 + 1] - prev[a * 3 + 1]) / h;
        const mz = (pos[a * 3 + 2] - prev[a * 3 + 2]) / h;
        const rx = wind.x * gust - mx;
        const ry = wind.y * gust - my;
        const rz = wind.z * gust - mz;
        const along = (rx * nx + ry * ny + rz * nz) * 0.9;
        // Air sliding over the cloth drags it downwind (holds a flag out), and the wake behind a
        // flag sheds in waves that travel to its free edge (the flutter).
        const speed = Math.hypot(wind.x, wind.y, wind.z);
        const wave = speed * 0.3 * Math.sin(time * 9 - c * 1.1 + r * 0.2) * (c / (cols - 1));
        for (const i of [a, b, d]) {
          force[i * 3] += nx * (along + wave) + rx * 2;
          force[i * 3 + 1] += ny * (along + wave) + ry * 2;
          force[i * 3 + 2] += nz * (along + wave) + rz * 2;
        }
      }
    }
    for (let i = 0; i < n; i += 1) {
      if (!inv[i]) continue;
      for (let k = 0; k < 3; k += 1) {
        const at = pos[i * 3 + k];
        const v = (at - prev[i * 3 + k]) * 0.995;
        prev[i * 3 + k] = at;
        pos[i * 3 + k] = at + v + ((k === 1 ? -9.81 : 0) + force[i * 3 + k] / 3) * h * h;
      }
    }
    pins.forEach((p, k) => {
      const i = cloth.pinned[k];
      if (i == null) return;
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      prev[i * 3] = p.x;
      prev[i * 3 + 1] = p.y;
      prev[i * 3 + 2] = p.z;
    });
    for (let it = 0; it < ITERATIONS; it += 1) {
      if (it % 2 === 0) for (const l of links) solve(pos, inv, l.a, l.b, l.rest, l.stiff);
      else for (let j = links.length - 1; j >= 0; j -= 1) solve(pos, inv, links[j].a, links[j].b, links[j].rest, links[j].stiff);
    }
    // Tethers from the nearest pin: never further than the cloth between them.
    for (let i = 0; i < n; i += 1) {
      if (!inv[i]) continue;
      const r = Math.floor(i / cols);
      const c = i % cols;
      let best = -1;
      let bestD = Infinity;
      for (const p of cloth.pinned) {
        const pr = Math.floor(p / cols);
        const pc = p % cols;
        const along = Math.hypot(r - pr, c - pc);
        if (along < bestD) {
          bestD = along;
          best = p;
        }
      }
      if (best < 0) continue;
      const most = bestD * cloth.cell * 1.08 + 0.02;
      const dx = pos[i * 3] - pos[best * 3];
      const dy = pos[i * 3 + 1] - pos[best * 3 + 1];
      const dz = pos[i * 3 + 2] - pos[best * 3 + 2];
      const d = Math.hypot(dx, dy, dz);
      if (d > most) {
        const k = most / d;
        pos[i * 3] = pos[best * 3] + dx * k;
        pos[i * 3 + 1] = pos[best * 3 + 1] + dy * k;
        pos[i * 3 + 2] = pos[best * 3 + 2] + dz * k;
      }
    }
    for (let i = 0; i < n; i += 1) {
      if (!inv[i]) continue;
      for (const cap of world.capsules ?? []) pushOutOfCapsule(pos, i, cap, 0.02);
      const floor = world.ground(pos[i * 3], pos[i * 3 + 2]) + 0.01;
      if (pos[i * 3 + 1] < floor) {
        pos[i * 3 + 1] = floor;
        prev[i * 3] += (pos[i * 3] - prev[i * 3]) * 0.5;
        prev[i * 3 + 2] += (pos[i * 3 + 2] - prev[i * 3 + 2]) * 0.5;
      }
    }
  }
}

/** The longest any link is stretched, as a share of its rest length (1 is not stretched). */
export function worstStretch(cloth: Cloth): number {
  let worst = 0;
  for (const l of cloth.links) {
    if (l.stiff < 1) continue;
    const a = l.a * 3;
    const b = l.b * 3;
    const d = Math.hypot(cloth.pos[a] - cloth.pos[b], cloth.pos[a + 1] - cloth.pos[b + 1], cloth.pos[a + 2] - cloth.pos[b + 2]);
    worst = Math.max(worst, d / l.rest);
  }
  return worst;
}

// ---------- capes and flags in the world ----------

export const CAPE_COLORS: Record<string, string> = {
  violet: "#5b2a9e",
  night: "#1d1638",
  crimson: "#8e1f35",
  teal: "#11686b",
  gold: "#a27618",
  white: "#e9e4f2",
};

/** A flag: an entity standing for its pole; the cloth hangs from the pole's top. */
export const FLAG_TAG = "flag";

const avatarOf = (world: World) => Object.values(world.entities).find((e) => e.tags.includes("architect"));

/** wear_cape: put a cape on (color, or "none" to take it off). */
export function wearCape(world: World, args: Record<string, string>): { ok: boolean; detail: string; world: World } {
  const me = avatarOf(world);
  if (!me) return { ok: false, detail: "no body to wear it", world };
  const want = (args.color ?? "").trim().toLowerCase();
  if (/^(none|off|away|no|remove)$/.test(want)) {
    const { cape: _c, ...rest } = me.customData;
    return { ok: true, detail: "You take the cape off.", world: { ...world, entities: { ...world.entities, [me.id]: { ...me, customData: rest } } } };
  }
  const color = CAPE_COLORS[want] ?? (/^#[0-9a-f]{6}$/i.test(want) ? want : CAPE_COLORS.violet);
  return {
    ok: true,
    detail: "You put on a cape. It swings as you walk, streams behind you when you run and fly, and catches the wind.",
    world: { ...world, entities: { ...world.entities, [me.id]: { ...me, customData: { ...me.customData, cape: color } } } },
  };
}

/** raise_flag: a pole with a flag, in front of you (or at x, z). */
export function raiseFlag(world: World, args: Record<string, string>): { ok: boolean; detail: string; world: World } {
  const me = avatarOf(world);
  const yaw = Number(me?.customData.yaw) || 0;
  const num = (v: string | undefined) => (v != null && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const x = num(args.x) ?? (me?.transform.position.x ?? 0) + Math.sin(yaw) * 2.6;
  const z = num(args.z) ?? (me?.transform.position.z ?? 0) + Math.cos(yaw) * 2.6;
  const height = Math.max(1.5, Math.min(8, num(args.height) ?? 3.6));
  const id = world.nextId;
  const pole: Entity = {
    id,
    name: args.name?.trim() || "Flag",
    transform: { position: V3(x, height / 2, z), rotation: { ...IDENTITY }, scale: V3(0.07, height, 0.07) },
    representation: { kind: "mesh", assetId: "pillar" },
    physics: null,
    tags: ["spawned", FLAG_TAG],
    customData: { color: "#c9ccd4", flag: (args.style ?? "").trim().toLowerCase() || "4d" },
  };
  return {
    ok: true,
    detail: `A ${height.toFixed(1)} m flagpole stands in front of you, its flag flying in the wind.`,
    world: { ...world, entities: { ...world.entities, [id]: pole }, nextId: id + 1 },
  };
}

export type ClothCall = { tool: "wear_cape" | "raise_flag"; arguments: Record<string, string> };

/** Plain requests: "give me a cape", "a red cape", "take the cape off", "raise a flag". */
export function clothIntent(intent: string): ClothCall | null {
  const text = intent.trim().toLowerCase();
  if (text.split(/\s+/).length > 12) return null;
  if (/\bcape\b|\bcloak\b/.test(text)) {
    if (/\b(take|remove|lose|drop)\b.*\b(off|cape|cloak)\b|\bno (cape|cloak)\b/.test(text)) return { tool: "wear_cape", arguments: { color: "none" } };
    const named = Object.keys(CAPE_COLORS).find((c) => new RegExp(`\\b${c}\\b`).test(text));
    const red = /\b(red|scarlet)\b/.test(text) ? "crimson" : /\b(blue|black|dark)\b/.test(text) ? "night" : /\b(green)\b/.test(text) ? "teal" : /\b(purple|violet)\b/.test(text) ? "violet" : undefined;
    return { tool: "wear_cape", arguments: { color: named ?? red ?? "violet" } };
  }
  if (/\b(flag|banner|pennant)\b/.test(text) && /\b(raise|put|plant|add|make|fly|hoist|place|give)\b/.test(text) && !/\b(delete|remove|paint)\b/.test(text)) {
    const style = /\b(rainbow|pride)\b/.test(text) ? "rainbow" : /\b(pirate|black)\b/.test(text) ? "pirate" : /\b(white|surrender)\b/.test(text) ? "white" : "4d";
    return { tool: "raise_flag", arguments: { style } };
  }
  return null;
}
