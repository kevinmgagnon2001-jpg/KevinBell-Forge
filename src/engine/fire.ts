/**
 * Fire you can put out (Papers roadmap, phase 4): a coarse heat, fuel and wetness grid laid over the
 * world. Flammable things (wood, crates, hay, paper, the bench...) put fuel in the cells under them.
 * A cell burns while it is hot and has fuel; burning heats its neighbours (more downwind), so fire
 * creeps along a bench and jumps a small gap with the wind. Burning eats fuel; a thing whose fuel is
 * gone is charred. Rain wets everything a little; water (the spray, or "put out the fire") wets
 * cells a lot, and wet cells lose heat fast and will not light.
 *
 * Plain arrays, no renderer: Fire.tsx draws the flames, smoke and embers from burningCells().
 */
import type { Entity, World } from "./types.ts";
import { solidOf } from "./physics.ts";

export const FIRE = {
  /** Cell size, metres. */
  cell: 0.5,
  /** Cells across (the grid is size × size, centred on the plaza). */
  size: 80,
  /** Heat at which a cell with fuel catches. */
  ignite: 0.5,
  /** Fuel a burning cell eats per second at full heat (a cell starts with about 1 per metre of height). */
  burn: 0.07,
  /** Heat a burning cell passes to each neighbour per second. */
  spread: 0.6,
  /** Heat lost per second when not burning. */
  cool: 0.35,
} as const;

export type FireGrid = {
  originX: number;
  originZ: number;
  n: number;
  fuel: Float32Array;
  heat: Float32Array;
  wet: Float32Array;
  /** Height of the top of what burns in each cell (flames sit on it). */
  top: Float32Array;
  /** The entity whose fuel each cell holds (-1 for none). */
  owner: Int32Array;
};

export function emptyFire(): FireGrid {
  const n = FIRE.size;
  const half = (n * FIRE.cell) / 2;
  return {
    originX: -half,
    originZ: -half,
    n,
    fuel: new Float32Array(n * n),
    heat: new Float32Array(n * n),
    wet: new Float32Array(n * n),
    top: new Float32Array(n * n),
    owner: new Int32Array(n * n).fill(-1),
  };
}

/** Things that burn: marked flammable, made of wood or paper, or named like it. */
export function flammable(e: Entity): boolean {
  if (e.customData.flammable === "1") return true;
  if (e.customData.flammable === "0" || e.customData.charred === "1") return false;
  if (e.tags.some((t) => ["architect", "agent", "npc", "helm", "floor", "companion", "rope", "flag"].includes(t))) return false;
  const src = (e.customData.src ?? "").toLowerCase();
  if (/grain|wood|paper|hay|bark/.test(src)) return true;
  return /\b(wood|wooden|crate|log|logs|hay|straw|paper|bench|campfire|tree|plank|table|chair|barrel|fence|bonfire)\b/i.test(e.name.replace(/([a-z])([A-Z])/g, "$1 $2"));
}

const cellOf = (g: FireGrid, x: number, z: number): number => {
  const cx = Math.floor((x - g.originX) / FIRE.cell);
  const cz = Math.floor((z - g.originZ) / FIRE.cell);
  return cx < 0 || cz < 0 || cx >= g.n || cz >= g.n ? -1 : cz * g.n + cx;
};

/** The middle of a cell, across the ground. */
export function cellCentre(g: FireGrid, i: number): { x: number; z: number } {
  return { x: g.originX + ((i % g.n) + 0.5) * FIRE.cell, z: g.originZ + (Math.floor(i / g.n) + 0.5) * FIRE.cell };
}

/** Lay fuel from the world's flammable things (keeps the heat and wetness already there). */
export function fuelFrom(g: FireGrid, world: Pick<World, "entities">): void {
  g.fuel.fill(0);
  g.top.fill(0);
  g.owner.fill(-1);
  for (const e of Object.values(world.entities)) {
    if (!flammable(e)) continue;
    const s = solidOf({ ...e, tags: e.tags.filter((t) => t !== "fixture") });
    const p = e.transform.position;
    const box = s ?? { min: { x: p.x - 0.3, y: p.y - 0.3, z: p.z - 0.3 }, max: { x: p.x + 0.3, y: p.y + 0.3, z: p.z + 0.3 } };
    const height = Math.max(0.1, box.max.y - box.min.y);
    for (let x = box.min.x + FIRE.cell / 2; x < box.max.x + 1e-6; x += FIRE.cell / 2) {
      for (let z = box.min.z + FIRE.cell / 2; z < box.max.z + 1e-6; z += FIRE.cell / 2) {
        const i = cellOf(g, Math.min(x, box.max.x - 0.01), Math.min(z, box.max.z - 0.01));
        if (i < 0) continue;
        if (box.max.y >= g.top[i]) {
          g.fuel[i] = Math.max(g.fuel[i], 0.4 + height);
          g.top[i] = box.max.y;
          g.owner[i] = e.id;
        }
      }
    }
  }
}

/** Light a fire around (x, z), radius r metres. Wet cells resist. */
export function ignite(g: FireGrid, x: number, z: number, r = 0.4): number {
  let lit = 0;
  for (let i = 0; i < g.n * g.n; i += 1) {
    const c = cellCentre(g, i);
    if (Math.hypot(c.x - x, c.z - z) > r + FIRE.cell * 0.71) continue;
    if (g.fuel[i] <= 0 || g.wet[i] > 0.5) continue;
    g.heat[i] = Math.max(g.heat[i], 1);
    lit += 1;
  }
  return lit;
}

/** Light everything that belongs to a thing. */
export function igniteThing(g: FireGrid, id: number): number {
  let lit = 0;
  for (let i = 0; i < g.n * g.n; i += 1) {
    if (g.owner[i] !== id || g.wet[i] > 0.5) continue;
    g.heat[i] = 1;
    lit += 1;
  }
  return lit;
}

/** Water on (x, z), radius r: wets and cools. Returns how many burning cells it hit (for steam). */
export function douse(g: FireGrid, x: number, z: number, r: number, amount: number): number {
  let hissed = 0;
  const c0 = cellOf(g, x, z);
  if (c0 < 0) return 0;
  const span = Math.ceil(r / FIRE.cell) + 1;
  const cx = c0 % g.n;
  const cz = Math.floor(c0 / g.n);
  for (let dz = -span; dz <= span; dz += 1) {
    for (let dx = -span; dx <= span; dx += 1) {
      const xi = cx + dx;
      const zi = cz + dz;
      if (xi < 0 || zi < 0 || xi >= g.n || zi >= g.n) continue;
      const i = zi * g.n + xi;
      const c = cellCentre(g, i);
      if (Math.hypot(c.x - x, c.z - z) > r + FIRE.cell * 0.5) continue;
      if (g.heat[i] >= FIRE.ignite && g.fuel[i] > 0) hissed += 1;
      g.wet[i] = Math.min(1, g.wet[i] + amount);
      g.heat[i] = Math.max(0, g.heat[i] - amount * 1.6);
    }
  }
  return hissed;
}

export const isBurning = (g: FireGrid, i: number) => g.heat[i] >= FIRE.ignite && g.fuel[i] > 0;

/** Cells burning now. */
export function burningCells(g: FireGrid): number[] {
  const out: number[] = [];
  for (let i = 0; i < g.n * g.n; i += 1) if (isBurning(g, i)) out.push(i);
  return out;
}

export type FireStep = { burnedOut: number[]; burning: number };

/**
 * One step. Wind (m/s across the ground) pushes the spread downwind; rain (0..1) wets everything.
 * Returns the things whose last fuel burned this step (to char them).
 */
export function stepFire(g: FireGrid, dt: number, weather: { wind: { x: number; z: number }; rain: number }): FireStep {
  const n = g.n;
  const h = Math.min(0.1, Math.max(0, dt));
  const add = new Float32Array(n * n);
  const owners = new Set<number>();
  let burning = 0;
  const wl = Math.hypot(weather.wind.x, weather.wind.z);
  for (let i = 0; i < n * n; i += 1) {
    if (!isBurning(g, i)) continue;
    burning += 1;
    if (g.owner[i] >= 0) owners.add(g.owner[i]);
    const x = i % n;
    const z = Math.floor(i / n);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dz) continue;
        const xi = x + dx;
        const zi = z + dz;
        if (xi < 0 || zi < 0 || xi >= n || zi >= n) continue;
        const d = Math.hypot(dx, dz);
        // Downwind neighbours get more; upwind ones less.
        const along = wl > 0.01 ? (dx * weather.wind.x + dz * weather.wind.z) / (d * wl) : 0;
        const bias = 1 + along * Math.min(1.5, wl / 4);
        add[zi * n + xi] += (FIRE.spread / d) * Math.max(0.1, bias) * h;
      }
    }
    // Downwind, a strong wind carries sparks two cells on.
    if (wl > 3) {
      const xi = x + Math.round((weather.wind.x / wl) * 2);
      const zi = z + Math.round((weather.wind.z / wl) * 2);
      if (xi >= 0 && zi >= 0 && xi < n && zi < n) add[zi * n + xi] += FIRE.spread * 0.35 * h;
    }
  }
  const burnedOut: number[] = [];
  for (let i = 0; i < n * n; i += 1) {
    const wet = g.wet[i];
    if (isBurning(g, i)) {
      g.heat[i] = Math.min(1, g.heat[i] + 0.5 * h) - wet * 2.5 * h;
      g.fuel[i] = Math.max(0, g.fuel[i] - FIRE.burn * g.heat[i] * h);
      if (g.fuel[i] <= 0) g.heat[i] = Math.min(g.heat[i], 0.4);
    } else {
      g.heat[i] = Math.max(0, g.heat[i] - (FIRE.cool + wet * 2.5) * h);
      // Only fuel takes the heat it is given; bare ground stays cool.
      if (g.fuel[i] > 0 && wet < 0.5) g.heat[i] = Math.min(1, g.heat[i] + add[i]);
    }
    g.wet[i] = Math.max(0, Math.min(1, wet - 0.06 * h + weather.rain * 0.25 * h));
  }
  // Things that had fire and now have no fuel left anywhere are burnt out.
  for (const id of owners) {
    let left = 0;
    for (let i = 0; i < n * n; i += 1) if (g.owner[i] === id) left += g.fuel[i];
    if (left <= 0.001) burnedOut.push(id);
  }
  return { burnedOut, burning };
}

// ---------- tools and words ----------

export type FireCall = { tool: "set_fire" | "put_out_fire" | "make_campfire"; arguments: Record<string, string> };

/** set_fire: light a thing (by name) or the nearest flammable thing in front of you. */
export function setFire(world: World, args: Record<string, string>): { ok: boolean; detail: string; world: World } {
  const q = (args.thing ?? "").trim().toLowerCase().replace(/^(the|a|an|my)\s+/, "");
  const all = Object.values(world.entities);
  let target = q ? (all.find((e) => e.name.toLowerCase() === q) ?? all.find((e) => q.length > 2 && e.name.toLowerCase().includes(q))) : undefined;
  if (!target) {
    const me = all.find((e) => e.tags.includes("architect"))?.transform.position ?? { x: 0, y: 0, z: 0 };
    target = all.filter(flammable).sort((a, b) => Math.hypot(a.transform.position.x - me.x, a.transform.position.z - me.z) - Math.hypot(b.transform.position.x - me.x, b.transform.position.z - me.z))[0];
  }
  if (!target) return { ok: false, detail: "nothing here burns; try a campfire", world };
  const seq = String((Number(target.customData.ignite) || 0) + 1);
  const lit = { ...target, customData: { ...target.customData, flammable: "1", ignite: seq } };
  return { ok: true, detail: `${target.name} catches fire. Rain puts it out, or hold H (or the water bubble) to spray it.`, world: { ...world, entities: { ...world.entities, [target.id]: lit } } };
}

/** put_out_fire: water everywhere a fire is (the renderer douses every burning cell). */
export function putOutFire(world: World): { ok: boolean; detail: string; world: World } {
  const seq = String(Math.max(0, ...Object.values(world.entities).map((e) => Number(e.customData.douse) || 0)) + 1);
  const entities = { ...world.entities };
  for (const e of Object.values(entities)) if (e.customData.ignite || e.customData.flammable === "1") entities[e.id] = { ...e, customData: { ...e.customData, douse: seq } };
  return { ok: true, detail: "Water hisses over the flames; the fire goes out in a cloud of steam.", world: { ...world, entities } };
}

/** make_campfire: crossed logs in front of you, burning. */
export function makeCampfire(world: World): { ok: boolean; detail: string; world: World } {
  const me = Object.values(world.entities).find((e) => e.tags.includes("architect"));
  const yaw = Number(me?.customData.yaw) || 0;
  const x = (me?.transform.position.x ?? 0) + Math.sin(yaw) * 2;
  const z = (me?.transform.position.z ?? 0) + Math.cos(yaw) * 2;
  const id = world.nextId;
  const entities = { ...world.entities };
  for (let k = 0; k < 3; k += 1) {
    const a = (k * Math.PI) / 3;
    entities[id + k] = {
      id: id + k,
      name: "Campfire log",
      transform: { position: { x, y: 0.09, z }, rotation: { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) }, scale: { x: 0.16, y: 0.16, z: 0.9 } },
      representation: { kind: "mesh", assetId: "cube" },
      physics: null,
      tags: ["spawned", "campfire"],
      customData: { color: "#5a3a22", flammable: "1", ignite: "1" },
    };
  }
  return { ok: true, detail: "A campfire crackles in front of you. Walk close and feel it light your face.", world: { ...world, entities, nextId: id + 3 } };
}

export function fireIntent(intent: string): FireCall | null {
  const t = intent.trim().toLowerCase();
  if (t.split(/\s+/).length > 12) return null;
  if (/\b(put out|extinguish|douse|stop) (the |that |all the )?(fires?|flames?|blaze)\b|\bfire out\b/.test(t)) return { tool: "put_out_fire", arguments: {} };
  if (/\b(campfire|bonfire|camp fire)\b/.test(t) && /\b(make|build|light|start|add|put)\b/.test(t)) return { tool: "make_campfire", arguments: {} };
  const m = t.match(/^(?:set|light)\s+(?:fire to\s+)?(.+?)(?:\s+on fire|\s+alight|\s+ablaze)?$/);
  if (m && /\b(fire|light|alight|ablaze|burn)\b/.test(t)) {
    const thing = m[1].replace(/^(the|a|an)\s+/, "").replace(/\s*(on fire|alight|ablaze)$/, "");
    return { tool: "set_fire", arguments: /^(something|it|a fire|fire)$/.test(thing) ? {} : { thing } };
  }
  if (/^burn (the |a )?(.+)$/.test(t)) return { tool: "set_fire", arguments: { thing: t.replace(/^burn (the |a )?/, "") } };
  return null;
}
