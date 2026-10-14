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
import { Predictor, type MoveInput, type MoveState } from "./prediction.ts";
import type { Entity, Vec3, World } from "./types.ts";

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

/** Fold one sync reply into the local world: new entities appear, changed ones move, gone ones leave. */
export function mergeVisited(world: World, hostId: string, offset: Vec3, reply: SyncReply): World {
  const ids = visitedIds(world, hostId);
  const entities = { ...world.entities };
  let nextId = world.nextId;
  for (const remote of [...reply.enter, ...reply.update]) {
    if (!validEntity(remote)) continue;
    const id = ids.get(remote.id) ?? nextId++;
    ids.set(remote.id, id);
    entities[id] = placed(remote, id, hostId, offset);
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
    return this.predictor;
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
    const hostView: View = this.start ? { ...view, position: this.start.position, yaw: this.start.yaw } : { ...view, position: this.toHost(view.position) };
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
    if (reply.you && this.predictor) {
      this.predictor.reconcile(reply.you.ack, reply.you.state);
      this.start = null;
    }
    return { status: "live", apply: (w) => mergeVisited(w, this.hostId, this.offset, reply), bytes: reply.bytes };
  }
}
