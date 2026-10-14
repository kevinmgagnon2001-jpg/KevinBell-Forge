/**
 * Adjacency, live (work item 9): a visited island stays beside yours and keeps moving.
 *
 * After a portal handshake the island's entry is placed next to the visitor's own world
 * (placeVisited). A LiveVisit then keeps that copy in step with the host: every round it reports
 * where the visitor stands and looks (in the host's coordinates) and folds the host's changes into
 * the local world, including other visitors' presence markers, so two players see each other. Your
 * own walking goes through prediction.ts. When the host stops answering, or ends the session, its
 * half of the world is removed.
 */
import { validEntity, type SyncReply, type View } from "./island-content.ts";
import { Interpolator, Predictor, type MoveInput, type MoveState } from "./prediction.ts";
import type { Entity, Vec3, World } from "./types.ts";

/** Seconds on a steady clock (the visitor's; snapshots are timed when they arrive). */
const now = () => (globalThis.performance?.now() ?? Date.now()) / 1000;

export type SyncFn = (view: View, inputs?: MoveInput[]) => Promise<SyncReply | { error: string }>;

/** The local ids of a host's entities, by their id on the host. */
export function visitedIds(world: World, hostId: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of Object.values(world.entities)) {
    if (e.customData.island === hostId && e.customData.remoteId !== undefined) out.set(Number(e.customData.remoteId), e.id);
  }
  return out;
}

/** A host entity as it sits beside the visitor's world: offset, read-only, tagged with where it came from. */
function placed(remote: Entity, id: number, hostId: string, offset: Vec3): Entity {
  const p = remote.transform.position;
  return {
    ...remote,
    id,
    transform: { ...remote.transform, position: { x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z } },
    physics: null,
    tags: [...remote.tags.filter((t) => t !== "avatar"), "visited", "read-only"],
    customData: { ...remote.customData, island: hostId, remoteId: String(remote.id) },
  };
}

/**
 * Fold one sync reply into the local world: new entities appear, changed ones move, gone ones leave.
 * With `keepPresence`, other visitors' markers keep their current local position (they are moved
 * smoothly every frame instead; see LiveVisit.others).
 */
export function mergeVisited(world: World, hostId: string, offset: Vec3, reply: SyncReply, keepPresence = false): World {
  const ids = visitedIds(world, hostId);
  const entities = { ...world.entities };
  let nextId = world.nextId;
  for (const remote of [...reply.enter, ...reply.update]) {
    if (!validEntity(remote)) continue;
    const id = ids.get(remote.id) ?? nextId++;
    ids.set(remote.id, id);
    const next = placed(remote, id, hostId, offset);
    const was = entities[id];
    if (keepPresence && was && remote.tags.includes("presence")) next.transform = { ...next.transform, position: was.transform.position };
    entities[id] = next;
  }
  for (const gone of reply.leave) {
    const id = ids.get(gone);
    if (id !== undefined) delete entities[id];
  }
  return { ...world, entities, nextId };
}

/** Take a host's half of the world away (it stopped, or the visitor left). */
export function removeVisited(world: World, hostId: string): World {
  const entities: Record<number, Entity> = {};
  for (const e of Object.values(world.entities)) if (e.customData.island !== hostId) entities[e.id] = e;
  return { ...world, entities };
}

/**
 * What a round brought, as a change to apply to the world as it is when the answer lands (the local
 * world keeps moving while the request is out).
 */
/** Every visited island the app is keeping live, so the pilot can tell which one the architect stands on. */
export const liveVisits = new Set<LiveVisit>();

export type RoundResult = { status: "live"; apply: (world: World) => World; bytes: number } | { status: "gone"; apply: (world: World) => World; reason: string };

export class LiveVisit {
  readonly hostId: string;
  readonly offset: Vec3;
  private sync: SyncFn;
  private failures = 0;
  /** Rounds in a row the host may miss before its half is removed. */
  maxFailures: number;
  /** Set when the visitor walks on the visited island: their own movement, predicted. */
  predictor: Predictor | null = null;
  /** Where the walk started (host coordinates), sent until the host has answered with a position. */
  private start: MoveState | null = null;
  /** Numbers each walk on this island, so the host restarts its mover when a new one begins. */
  private walks = 0;
  /** Other visitors' markers, played back a little in the past so they move smoothly (host id -> track). */
  private tracks = new Map<number, Interpolator>();
  /** The island's footprint in local coordinates (x and z), from its entities; null until known. */
  bounds: { min: Vec3; max: Vec3 } | null = null;

  constructor(hostId: string, offset: Vec3, sync: SyncFn, maxFailures = 5) {
    this.hostId = hostId;
    this.offset = offset;
    this.sync = sync;
    this.maxFailures = maxFailures;
  }

  /** Start walking on the host with prediction, from a point in local coordinates. */
  walk(at: MoveState): Predictor {
    this.start = { position: this.toHost(at.position), yaw: at.yaw };
    this.predictor = new Predictor(this.start);
    this.walks += 1;
    return this.predictor;
  }

  /** Stop predicting (the visitor stepped off the island). */
  leave() {
    this.predictor = null;
    this.start = null;
  }

  /** Recompute the footprint from the island's entities in `world`, with a margin around them. */
  measure(world: World, margin = 1.5) {
    let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const e of Object.values(world.entities)) {
      if (e.customData.island !== this.hostId || e.tags.includes("presence")) continue;
      const p = e.transform.position;
      const k = e.transform.scale;
      x0 = Math.min(x0, p.x - k.x / 2);
      z0 = Math.min(z0, p.z - k.z / 2);
      x1 = Math.max(x1, p.x + k.x / 2);
      z1 = Math.max(z1, p.z + k.z / 2);
    }
    this.bounds = x0 <= x1 ? { min: { x: x0 - margin, y: 0, z: z0 - margin }, max: { x: x1 + margin, y: 0, z: z1 + margin } } : null;
  }

  /** Is this local point on the island? */
  contains(p: Vec3): boolean {
    const b = this.bounds;
    return !!b && p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z;
  }

  toHost(p: Vec3): Vec3 {
    return { x: p.x - this.offset.x, y: p.y - this.offset.y, z: p.z - this.offset.z };
  }

  toLocal(p: Vec3): Vec3 {
    return { x: p.x + this.offset.x, y: p.y + this.offset.y, z: p.z + this.offset.z };
  }

  /**
   * One round: report the view (local coordinates; converted here) and any unacknowledged inputs; the
   * result folds the answer into a world. Missing the host `maxFailures` times in a row, or a refused
   * session, removes its half.
   */
  async round(view: View): Promise<RoundResult> {
    // Until the host has walked us once, tell it where the walk started rather than where we are now.
    const hostView: View = this.start
      ? { ...view, position: this.start.position, yaw: this.start.yaw, walk: this.walks }
      : { ...view, position: this.toHost(view.position), ...(this.predictor ? { walk: this.walks } : {}) };
    const reply = await this.sync(hostView, this.predictor ? this.predictor.unacked() : undefined);
    if ("error" in reply) {
      this.failures += 1;
      const refused = /session|granted/.test(reply.error);
      if (refused || this.failures >= this.maxFailures) {
        return { status: "gone", apply: (w) => removeVisited(w, this.hostId), reason: refused ? reply.error : "the host stopped answering" };
      }
      return { status: "live", apply: (w) => w, bytes: 0 };
    }
    this.failures = 0;
    const t = now();
    for (const e of [...reply.enter, ...reply.update]) {
      if (!e.tags?.includes("presence") || !e.transform) continue;
      let track = this.tracks.get(e.id);
      if (!track) this.tracks.set(e.id, (track = new Interpolator(0.15)));
      track.push(t, this.toLocal(e.transform.position));
    }
    for (const id of reply.leave) this.tracks.delete(id);
    if (reply.you && this.predictor) {
      this.predictor.reconcile(reply.you.ack, reply.you.state);
      this.start = null;
    }
    return { status: "live", apply: (w) => mergeVisited(w, this.hostId, this.offset, reply, true), bytes: reply.bytes };
  }

  /** Where each other visitor's marker should be drawn now: local entity id -> local position. */
  others(world: World, at = now()): Map<number, Vec3> {
    const out = new Map<number, Vec3>();
    const ids = visitedIds(world, this.hostId);
    for (const [remote, track] of this.tracks) {
      const id = ids.get(remote);
      const p = track.at(at);
      if (id !== undefined && p) out.set(id, p);
    }
    return out;
  }
}
