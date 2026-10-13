/**
 * Island content: what a visitor receives after a portal handshake.
 *
 *   1. Entry. The island's starting world, as canonical JSON. Its SHA-256 and size are in the signed
 *      manifest, so the visitor can prove it got exactly what the owner published.
 *   2. Sync. Live state from the host's simulation. The host is the only authority: each visitor
 *      sends where it is looking and gets back only what it can see, inside its byte budget, and only
 *      what changed since last time (replication.ts). The visitor's own position is shown to others
 *      as a read-only presence entity.
 *
 * Portals are entities too: a ring in the world that holds a forge:// address. Walking into one asks
 * the visitor's app to open that portal.
 */
import { canonical, normalizeAddress, sha256, type Capability, type IslandManifest } from "./island.ts";
import { diff, selectForViewer, type Delta, type Known, type RepEntity, type Viewer } from "./replication.ts";
import type { Entity, Vec3, World } from "./types.ts";
import type { Tier } from "./hardware.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();
export const MAX_ENTITIES = 5000;
export const PRESENCE_BASE = 1_000_000;

// ---------- entry ----------

export type IslandEntry = { forge: "island-world"; version: 1; entities: Entity[] };

export function entryFromWorld(world: World): IslandEntry {
  const entities = Object.values(world.entities)
    .filter((e) => !e.tags.includes("avatar")) // the owner's own avatar is shown through presence, not the entry
    .sort((a, b) => a.id - b.id)
    .slice(0, MAX_ENTITIES);
  return { forge: "island-world", version: 1, entities };
}

export function encodeEntry(entry: IslandEntry): Uint8Array {
  return enc.encode(canonical(entry));
}

export async function entryInfo(bytes: Uint8Array): Promise<IslandManifest["entry"]> {
  return { kind: "world", sha256: await sha256(bytes), bytes: bytes.length };
}

const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const vec = (v: unknown): v is Vec3 => !!v && typeof v === "object" && finite((v as Vec3).x) && finite((v as Vec3).y) && finite((v as Vec3).z);

/** Structural check on an entity that came from someone else's machine. */
export function validEntity(value: unknown): value is Entity {
  if (!value || typeof value !== "object") return false;
  const e = value as Entity;
  if (!Number.isInteger(e.id) || e.id < 0 || typeof e.name !== "string" || e.name.length > 120) return false;
  if (!e.transform || !vec(e.transform.position) || !vec(e.transform.scale)) return false;
  const r = e.transform.rotation;
  if (!r || !finite(r.x) || !finite(r.y) || !finite(r.z) || !finite(r.w)) return false;
  if (!e.representation || typeof (e.representation as { kind?: unknown }).kind !== "string") return false;
  if (!Array.isArray(e.tags) || e.tags.length > 32 || !e.tags.every((t) => typeof t === "string" && t.length <= 40)) return false;
  if (!e.customData || typeof e.customData !== "object") return false;
  const data = Object.entries(e.customData);
  if (data.length > 32 || !data.every(([k, v]) => typeof k === "string" && typeof v === "string" && k.length <= 40 && v.length <= 2000)) return false;
  return true;
}

export async function verifyEntry(manifest: IslandManifest, bytes: Uint8Array): Promise<{ ok: true; entry: IslandEntry } | { ok: false; reason: string }> {
  if (manifest.entry.kind !== "world") return { ok: false, reason: "entry is not a world" };
  if (bytes.length !== manifest.entry.bytes) return { ok: false, reason: "entry size does not match the manifest" };
  if ((await sha256(bytes)) !== manifest.entry.sha256) return { ok: false, reason: "entry hash does not match the manifest" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(dec.decode(bytes));
  } catch {
    return { ok: false, reason: "entry is not JSON" };
  }
  const entry = parsed as IslandEntry;
  if (entry?.forge !== "island-world" || entry.version !== 1 || !Array.isArray(entry.entities)) return { ok: false, reason: "entry is not an island world" };
  if (entry.entities.length > MAX_ENTITIES || !entry.entities.every(validEntity)) return { ok: false, reason: "entry holds a malformed entity" };
  return { ok: true, entry };
}

/** Put a visited island's entities into a local world, offset so they sit beside the visitor's own. Read-only by tag. */
export function placeVisited(world: World, entry: IslandEntry, hostId: string, offset: Vec3): World {
  const entities = { ...world.entities };
  let nextId = world.nextId;
  for (const remote of entry.entities) {
    const id = nextId++;
    const p = remote.transform.position;
    entities[id] = {
      ...remote,
      id,
      transform: { ...remote.transform, position: { x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z } },
      physics: null,
      tags: [...remote.tags.filter((t) => t !== "avatar"), "visited", "read-only"],
      customData: { ...remote.customData, island: hostId, remoteId: String(remote.id) },
    };
  }
  return { ...world, entities, nextId };
}

// ---------- portals in the world ----------

export function makePortal(world: World, address: string, at: Vec3, label?: string): World {
  const normalized = normalizeAddress(address);
  if (!normalized) throw new Error("bad portal address");
  const id = world.nextId;
  const portal: Entity = {
    id,
    name: label ?? `Portal to ${normalized.replace(/^forge:\/\//, "")}`,
    transform: { position: { ...at }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
    representation: { kind: "mesh", assetId: "portal" },
    physics: null,
    tags: ["portal"],
    customData: { portal: normalized, color: "#7c5cff", asset: "portal" },
  };
  return { ...world, entities: { ...world.entities, [id]: portal }, nextId: id + 1 };
}

/** The portal the avatar is standing in, if any. */
export function portalAt(world: World, position: Vec3, reach = 1.1): { id: number; address: string } | null {
  for (const e of Object.values(world.entities)) {
    if (!e.tags.includes("portal") || !e.customData.portal) continue;
    const p = e.transform.position;
    const dx = p.x - position.x;
    const dz = p.z - position.z;
    if (Math.hypot(dx, dz) <= reach && Math.abs(p.y - position.y) < 3) return { id: e.id, address: e.customData.portal };
  }
  return null;
}

// ---------- host side: sessions and live sync ----------

export type View = { position: Vec3; forward: Vec3; fovDeg?: number; range?: number; tier?: Tier; budget?: number };
export type SyncReply = {
  tick: number;
  enter: Entity[];
  update: Entity[];
  leave: number[];
  bytes: number;
  dropped: number;
};

type Session = { visitorId: string; grant: Capability[]; expires: number; known: Known; view: View | null };

function randomToken(): string {
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(18));
  return Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
}

const proxyOf = (e: Entity): Entity => ({
  id: e.id,
  name: e.name,
  transform: e.transform,
  representation: { kind: "mesh", assetId: "proxy" },
  physics: null,
  tags: [...e.tags, "proxy"],
  customData: e.customData.color ? { color: e.customData.color } : {},
});

/**
 * The host's view of everyone visiting. Holds the authoritative world; visitors only read it and
 * report where they are.
 */
export class IslandHost {
  world: World;
  private sessions = new Map<string, Session>();
  private versions = new Map<number, number>();
  private stamp = new Map<number, string>();
  private ttlMs: number;

  constructor(world: World, ttlMs = 10 * 60 * 1000) {
    this.world = world;
    this.ttlMs = ttlMs;
    this.refreshVersions();
  }

  open(visitorId: string, grant: Capability[], now = Date.now()): string {
    for (const [token, s] of this.sessions) if (s.expires < now) this.close(token);
    const token = randomToken();
    this.sessions.set(token, { visitorId, grant, expires: now + this.ttlMs, known: new Map(), view: null });
    return token;
  }

  session(token: string | null | undefined, now = Date.now()): Session | null {
    if (!token) return null;
    const s = this.sessions.get(token);
    if (!s || s.expires < now) return null;
    s.expires = now + this.ttlMs;
    return s;
  }

  close(token: string) {
    const s = this.sessions.get(token);
    if (!s) return;
    this.sessions.delete(token);
    const id = this.presenceId(s.visitorId);
    if (this.world.entities[id]) {
      const { [id]: _gone, ...rest } = this.world.entities;
      this.world = { ...this.world, entities: rest };
      this.refreshVersions();
    }
  }

  get visitors(): number {
    return this.sessions.size;
  }

  /** Bump an entity's version whenever its content changes, so deltas know what to resend. */
  refreshVersions() {
    const seen = new Set<number>();
    for (const e of Object.values(this.world.entities)) {
      seen.add(e.id);
      const s = canonical(e);
      if (this.stamp.get(e.id) !== s) {
        this.stamp.set(e.id, s);
        this.versions.set(e.id, (this.versions.get(e.id) ?? 0) + 1);
      }
    }
    for (const id of [...this.stamp.keys()]) if (!seen.has(id)) {
      this.stamp.delete(id);
      this.versions.delete(id);
    }
  }

  setWorld(world: World) {
    this.world = world;
    this.refreshVersions();
  }

  private presenceId(visitorId: string): number {
    let h = 2166136261;
    for (const ch of visitorId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return PRESENCE_BASE + (h % 1_000_000);
  }

  /** One sync round for one visitor. */
  sync(token: string, view: View): SyncReply | { error: string; status: number } {
    const s = this.session(token);
    if (!s) return { error: "no session (handshake again)", status: 401 };
    if (!s.grant.includes("render")) return { error: "render was not granted", status: 403 };
    if (!vec(view?.position) || !vec(view?.forward)) return { error: "view is malformed", status: 400 };
    s.view = view;
    if (s.grant.includes("input")) {
      // Presence: the visitor appears to others as a read-only marker the host owns.
      const id = this.presenceId(s.visitorId);
      const marker: Entity = {
        id,
        name: `Visitor ${s.visitorId.slice(0, 6)}`,
        transform: { position: { ...view.position }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 0.6, y: 1.7, z: 0.6 } },
        representation: { kind: "mesh", assetId: "visitor" },
        physics: null,
        tags: ["visitor", "presence"],
        customData: { visitor: s.visitorId, color: "#5cc8ff" },
      };
      this.world = { ...this.world, entities: { ...this.world.entities, [id]: marker } };
      this.refreshVersions();
    }
    const mine = this.presenceId(s.visitorId);
    const reps: RepEntity[] = Object.values(this.world.entities)
      .filter((e) => e.id !== mine)
      .map((e) => {
        const full = canonical(e).length;
        const proxy = canonical(proxyOf(e)).length;
        const r = Math.max(e.transform.scale.x, e.transform.scale.y, e.transform.scale.z) / 2 || 0.5;
        return { id: e.id, position: e.transform.position, radius: r, version: this.versions.get(e.id) ?? 0, cost: [full, proxy] };
      });
    const viewer: Viewer = {
      id: s.visitorId,
      position: view.position,
      forward: view.forward,
      fovDeg: Math.min(170, Math.max(20, view.fovDeg ?? 75)),
      range: Math.min(10_000, Math.max(1, view.range ?? 200)),
      tier: view.tier ?? "mid",
      budget: Math.min(4_000_000, Math.max(1024, view.budget ?? 64_000)),
      nearRadius: 4,
    };
    const selection = selectForViewer(reps, viewer);
    const { delta, next } = diff(s.known, selection, this.versions);
    s.known = next;
    const body = (id: number, lod: number) => {
      const e = this.world.entities[id];
      return lod === 0 ? e : proxyOf(e);
    };
    return {
      tick: this.world.tick,
      enter: delta.enter.map((d) => body(d.id, d.lod)),
      update: delta.update.map((d) => body(d.id, d.lod)),
      leave: delta.leave,
      bytes: selection.bytes,
      dropped: selection.dropped.length,
    };
  }
}

/** Visitor side: fold a sync reply into the local mirror of the island. */
export function applySync(mirror: Map<number, Entity>, reply: SyncReply): Map<number, Entity> {
  const next = new Map(mirror);
  for (const e of [...reply.enter, ...reply.update]) if (validEntity(e)) next.set(e.id, e);
  for (const id of reply.leave) next.delete(id);
  return next;
}

export type { Delta };
