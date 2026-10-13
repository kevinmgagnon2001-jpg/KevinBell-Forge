/**
 * Replication: the host island runs every mechanic. Each visitor gets only what their camera can
 * see, at the detail their screen and device need, inside a bandwidth budget, and after the first
 * frame only what changed.
 *
 *   visitor  --inputs-->  host (authority)
 *   visitor  <--deltas--  host (visible entities only, level of detail per entity)
 *
 * Detail levels follow the cluster level-of-detail idea (Nanite-style): 0 is full detail, higher
 * numbers are coarser cluster cuts, and "proxy" is a single box or splat that just holds the place.
 *
 * Large islands split into zones. Each zone is simulated by one of the owner's machines; entities
 * near a border are also sent to the neighbour zone as read-only "ghosts", so the seam is invisible.
 */
import type { Tier } from "./hardware.ts";

export type V3 = { x: number; y: number; z: number };

export type RepEntity = {
  id: number;
  position: V3;
  radius: number;
  version: number; // bumps whenever the host changes the entity
  /** Bytes to send this entity at each detail level, finest first. The last level is the proxy. */
  cost: number[];
  /** Always send, whatever the camera does (the visitor's own avatar, nearby sounds, held items). */
  always?: boolean;
};

export type Viewer = {
  id: string;
  position: V3;
  forward: V3; // need not be normalized
  fovDeg: number;
  range: number;
  tier: Tier;
  /** Bytes this visitor may receive per update. */
  budget: number;
  /** Things within this distance are sent even behind the camera, so turning around is instant. */
  nearRadius?: number;
};

export type Pick = { id: number; lod: number; bytes: number; priority: number };
export type Selection = { picks: Pick[]; bytes: number; dropped: number[] };

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: V3) => Math.hypot(a.x, a.y, a.z);

/** Coarsest detail a device will ever ask for first. Weak devices start coarser. */
const TIER_BIAS: Record<Tier, number> = { high: 0, mid: 1, low: 2, none: 3 };

/** Is any part of the entity's bounding sphere inside the view cone and range? */
export function visible(entity: RepEntity, viewer: Viewer): boolean {
  if (entity.always) return true;
  const to = sub(entity.position, viewer.position);
  const dist = len(to);
  if (dist - entity.radius > viewer.range) return false;
  if (dist <= (viewer.nearRadius ?? 0) + entity.radius) return true;
  if (dist <= entity.radius) return true; // camera is inside it
  const f = len(viewer.forward) || 1;
  const cos = dot(to, viewer.forward) / (dist * f);
  const half = ((viewer.fovDeg / 2) * Math.PI) / 180;
  // Widen the cone by the angle the sphere itself covers.
  const spread = Math.asin(Math.min(1, entity.radius / dist));
  return Math.acos(Math.max(-1, Math.min(1, cos))) <= half + spread;
}

/** Roughly how much of the screen the entity covers. Bigger and closer matters more. */
export function screenSize(entity: RepEntity, viewer: Viewer): number {
  const dist = Math.max(0.001, len(sub(entity.position, viewer.position)) - entity.radius);
  return entity.radius / dist;
}

/** Ideal detail level from screen size and device tier (0 = finest). */
export function idealLod(entity: RepEntity, viewer: Viewer): number {
  const levels = entity.cost.length;
  const size = screenSize(entity, viewer);
  // Every halving of on-screen size drops one level.
  const bySize = size >= 0.5 ? 0 : Math.ceil(Math.log2(0.5 / size));
  return Math.min(levels - 1, bySize + TIER_BIAS[viewer.tier]);
}

/**
 * Choose what this visitor receives. Everything visible gets at least its proxy if the budget allows;
 * leftover budget then sharpens the most important entities first, never past their ideal level.
 */
export function selectForViewer(entities: RepEntity[], viewer: Viewer): Selection {
  const seen = entities
    .filter((e) => e.cost.length > 0 && visible(e, viewer))
    .map((e) => ({ e, priority: e.always ? Number.POSITIVE_INFINITY : screenSize(e, viewer), ideal: idealLod(e, viewer) }))
    .sort((a, b) => b.priority - a.priority || a.e.id - b.e.id);

  let bytes = 0;
  const chosen = new Map<number, { lod: number; ideal: number; e: RepEntity; priority: number }>();
  const dropped: number[] = [];

  // Pass 1: proxies, most important first.
  for (const item of seen) {
    const proxy = item.e.cost.length - 1;
    const cost = item.e.cost[proxy];
    if (bytes + cost > viewer.budget && !item.e.always) {
      dropped.push(item.e.id);
      continue;
    }
    bytes += cost;
    chosen.set(item.e.id, { lod: proxy, ideal: item.ideal, e: item.e, priority: item.priority });
  }

  // Pass 2: sharpen, most important first, one level at a time until the ideal or the budget.
  let improved = true;
  while (improved) {
    improved = false;
    for (const item of seen) {
      const pick = chosen.get(item.e.id);
      if (!pick || pick.lod <= pick.ideal) continue;
      const extra = pick.e.cost[pick.lod - 1] - pick.e.cost[pick.lod];
      if (bytes + extra > viewer.budget) continue;
      bytes += extra;
      pick.lod -= 1;
      improved = true;
    }
  }

  const picks = [...chosen.values()]
    .map((p) => ({ id: p.e.id, lod: p.lod, bytes: p.e.cost[p.lod], priority: p.priority }))
    .sort((a, b) => a.id - b.id);
  return { picks, bytes, dropped: dropped.sort((a, b) => a - b) };
}

// ---------- only what changed ----------

export type Known = Map<number, { version: number; lod: number }>;
export type Delta = {
  enter: { id: number; lod: number }[];
  update: { id: number; lod: number }[];
  leave: number[];
};

/** Compare what the visitor already has with what they should have now. */
export function diff(known: Known, selection: Selection, versions: Map<number, number>): { delta: Delta; next: Known } {
  const next: Known = new Map();
  const delta: Delta = { enter: [], update: [], leave: [] };
  for (const pick of selection.picks) {
    const version = versions.get(pick.id) ?? 0;
    next.set(pick.id, { version, lod: pick.lod });
    const had = known.get(pick.id);
    if (!had) delta.enter.push({ id: pick.id, lod: pick.lod });
    else if (had.version !== version || had.lod !== pick.lod) delta.update.push({ id: pick.id, lod: pick.lod });
  }
  for (const id of known.keys()) if (!next.has(id)) delta.leave.push(id);
  delta.leave.sort((a, b) => a - b);
  return { delta, next };
}

// ---------- big islands: zones across the owner's machines ----------

export type ZoneKey = string; // "x,z"
export type Machine = { id: string; capacity: number }; // capacity in "entities it can simulate"

export function zoneOf(position: V3, size: number): ZoneKey {
  return `${Math.floor(position.x / size)},${Math.floor(position.z / size)}`;
}

/** Spread zones over machines by load. Heaviest zones go first to whichever machine has the most room left. */
export function assignZones(load: Map<ZoneKey, number>, machines: Machine[]): Map<ZoneKey, string> {
  const room = new Map(machines.map((m) => [m.id, m.capacity]));
  const out = new Map<ZoneKey, string>();
  const zones = [...load.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  for (const [zone, weight] of zones) {
    let best: string | null = null;
    for (const m of machines) {
      if (best === null || (room.get(m.id) ?? 0) > (room.get(best) ?? 0)) best = m.id;
    }
    if (best === null) break;
    out.set(zone, best);
    room.set(best, (room.get(best) ?? 0) - weight);
  }
  return out;
}

/** Zones (other than its own) that should hold a read-only ghost of this entity, because it is near their border. */
export function ghostZones(position: V3, radius: number, size: number, margin: number): ZoneKey[] {
  const own = zoneOf(position, size);
  const reach = radius + margin;
  const out = new Set<ZoneKey>();
  for (const dx of [-reach, 0, reach]) {
    for (const dz of [-reach, 0, reach]) {
      const key = zoneOf({ x: position.x + dx, y: position.y, z: position.z + dz }, size);
      if (key !== own) out.add(key);
    }
  }
  return [...out].sort();
}
