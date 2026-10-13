import { autoColor, normalizeColor } from "./color.ts";
import { IDENTITY, V3, type Entity, type PhysicsBody, type Representation, type Vec3, type World } from "./types.ts";

export const GRAVITY = -9.81;
export const DELTA_TIME = 1 / 60;

export function createAvatar(): Entity {
  return {
    id: 1,
    name: "ArchitectAvatar",
    transform: {
      position: V3(0, 1, 0),
      rotation: { ...IDENTITY },
      scale: V3(1, 1, 1),
    },
    representation: {
      kind: "hybrid",
      meshId: "avatar_body",
      gsId: "avatar_detail",
    },
    physics: null,
    tags: ["avatar", "architect"],
    customData: { color: "#d7b899", role: "you", yaw: "0" },
  };
}

export function emptyWorld(): World {
  return {
    entities: {},
    nextId: 1,
    tick: 0,
    gravity: GRAVITY,
    deltaTime: DELTA_TIME,
    eventLog: [],
    events: [],
    undo: [],
    skills: [],
    compat: [],
  };
}

export function bootWorld(): World {
  const avatar = createAvatar();
  return {
    ...emptyWorld(),
    entities: { [avatar.id]: avatar },
    nextId: avatar.id + 1,
  };
}

function sized(entity: Entity, x: number, y: number, z: number, sx: number, sy: number, sz: number): Entity {
  return {
    ...entity,
    transform: {
      ...entity.transform,
      position: V3(x, y, z),
      scale: V3(sx, sy, sz),
    },
  };
}

function withYaw(entity: Entity, yaw: number): Entity {
  return { ...entity, customData: { ...entity.customData, yaw: String(yaw) } };
}

/**
 * The opening room. Every prop is a real entity, so the forge can edit it.
 * One neural sample is the splat exhibit. Everything else is solid.
 */
export function labWorld(): World {
  const avatar = withYaw(
    {
      ...createAvatar(),
      tags: ["avatar", "architect", "lab"],
      transform: {
        ...createAvatar().transform,
        position: V3(0.15, 0.78, -2.2),
      },
    },
    0,
  );

  const make = (id: number, args: Record<string, string>, x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
    sized(makeSpawned(id, args), x, y, z, sx, sy, sz);

  const deck = make(2, { name: "LabDeck", asset: "platform", color: "#2c313a", tags: "lab,fixture,floor", kinematic: "true", physics: "true" }, 0, 0.08, 0.4, 12, 0.16, 9);
  const bench = make(3, { name: "Bench", asset: "platform", color: "#1c2128", tags: "lab,fixture,desk", kinematic: "true", physics: "true" }, 0.15, 0.36, 4.15, 2.8, 0.56, 1.15);
  const terminal = make(4, { name: "ForgeTerminal", asset: "card", color: "#10141a", tags: "lab,terminal,fixture" }, 0.15, 1.18, 3.72, 1.25, 0.86, 0.08);
  terminal.customData = { ...terminal.customData, role: "terminal", note: "This screen is the live manifold." };

  const clay = make(5, { name: "Clay", asset: "cube", color: "#c46a4a", tags: "lab,exhibit,material", kinematic: "true", physics: "true" }, -4.7, 0.52, -1.7, 0.72, 0.72, 0.72);
  const steel = make(6, { name: "Steel", asset: "cube", color: "#d5d8de", tags: "lab,exhibit,material", kinematic: "true", physics: "true" }, -4.7, 0.52, 0.15, 0.72, 0.72, 0.72);
  const gold = make(7, { name: "Gold", asset: "cube", color: "#d4a24a", tags: "lab,exhibit,material", kinematic: "true", physics: "true" }, -4.7, 0.52, 2.05, 0.72, 0.72, 0.72);
  const column = make(8, { name: "Column", asset: "pillar", color: "#9aa3af", tags: "lab,exhibit,shape", kinematic: "true", physics: "true" }, 4.55, 1.28, -2.15, 0.42, 2.4, 0.42);
  const sample = make(9, { name: "Sample", asset: "sphere", color: "#6ea2e0", tags: "lab,exhibit,shape", kinematic: "true", physics: "true" }, 4.9, 0.56, 0.35, 0.78, 0.78, 0.78);
  const halo = make(10, { name: "Halo", asset: "ring", color: "#e7e2da", tags: "lab,exhibit,shape", kinematic: "true", physics: "true" }, 4.35, 1.15, 2.55, 1.05, 1.05, 1.05);
  const pad = make(11, { name: "DropPad", asset: "platform", color: "#3a3f48", tags: "lab,exhibit,physics", kinematic: "true", physics: "true" }, -1.55, 0.14, -2.35, 1.6, 0.12, 1.6);
  const orb = make(12, { name: "DropOrb", asset: "sphere", color: "#f0d48a", tags: "lab,exhibit,physics", physics: "true" }, -1.55, 2.35, -2.35, 0.7, 0.7, 0.7);
  const neural = make(13, { name: "NeuralBay", asset: "gaussian", color: "#9fd4d6", tags: "lab,exhibit,neural" }, 1.7, 1.25, -2.7, 1, 1, 1);
  neural.customData = {
    ...neural.customData,
    neural: "splat",
    palette: "#d5e7f7,#7eb6e8,#4c8df5,#1d4e89",
    seed: "11",
    count: "220",
    shape: "column",
  };
  const helm = makeHelm(14, avatar);

  const entities = [avatar, deck, bench, terminal, clay, steel, gold, column, sample, halo, pad, orb, neural, helm];
  return {
    ...emptyWorld(),
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    nextId: 15,
  };
}

/** The wearable computer. It stays on the architect's head. */
export function makeHelm(id: number, anchor?: Entity): Entity {
  const yaw = Number(anchor?.customData.yaw) || 0;
  const p = anchor?.transform.position ?? { x: 0.15, y: 0.78, z: -2.2 };
  const faceX = Math.sin(yaw);
  const faceZ = Math.cos(yaw);
  const helm = sized(
    makeSpawned(id, {
      name: "Helm",
      asset: "helm",
      color: "#d4a24a",
      tags: "lab,helm,terminal,worn",
    }),
    p.x + faceX * 0.16,
    p.y + 0.62,
    p.z + faceZ * 0.16,
    1,
    1,
    1,
  );
  helm.customData = {
    ...helm.customData,
    role: "terminal",
    note: "Visor. The helm is the computer worn by the architect.",
    yaw: String(yaw),
  };
  return helm;
}

export function ensureHelm(world: World): World {
  if (Object.values(world.entities).some((entity) => entity.tags.includes("helm"))) return seatArchitect(world);
  const avatar = Object.values(world.entities).find((entity) => entity.tags.includes("architect"));
  const helm = makeHelm(world.nextId, avatar);
  return seatArchitect({ ...world, nextId: world.nextId + 1, entities: { ...world.entities, [helm.id]: helm } });
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

/**
 * The body must always exist and sit at a real position. A saved world can lose it,
 * or carry NaN from a bad frame. Without a body the pilot has nothing to follow, so
 * third person shows no avatar and first person never gets a camera.
 */
export function ensureAvatar(world: World): World {
  const existing = Object.values(world.entities).find((entity) => entity.tags.includes("architect"));
  if (!existing) {
    const seed = Object.values(labWorld().entities).find((entity) => entity.tags.includes("architect"));
    if (!seed) return world;
    const id = world.nextId;
    return {
      ...world,
      nextId: id + 1,
      entities: { ...world.entities, [id]: { ...seed, id } },
    };
  }
  const p = existing.transform.position;
  if (finite(p.x) && finite(p.y) && finite(p.z)) return world;
  return {
    ...world,
    entities: {
      ...world.entities,
      [existing.id]: withYaw({ ...existing, transform: { ...existing.transform, position: V3(0.15, 0.78, -2.2) } }, 0),
    },
  };
}

/** Put the body on the deck, facing the exhibits, and bring back any opening prop that was lost. */
export function restoreLab(input: World): World {
  const world = ensureHelm(ensureAvatar(input));
  const fresh = labWorld();
  const names = new Set(Object.values(world.entities).map((entity) => entity.name));
  let nextId = world.nextId;
  const entities = { ...world.entities };
  for (const entity of Object.values(fresh.entities)) {
    if (entity.tags.includes("architect") || names.has(entity.name)) continue;
    entities[nextId] = { ...entity, id: nextId };
    nextId += 1;
  }
  const avatar = Object.values(entities).find((entity) => entity.tags.includes("architect"));
  if (avatar) {
    entities[avatar.id] = withYaw(
      { ...avatar, transform: { ...avatar.transform, position: V3(0.15, 0.78, -2.2) } },
      0,
    );
  }
  const helm = Object.values(entities).find((entity) => entity.tags.includes("helm"));
  if (helm) {
    entities[helm.id] = {
      ...helm,
      transform: { ...helm.transform, position: V3(0.15, 1.4, -2.04) },
      customData: { ...helm.customData, yaw: "0" },
    };
  }
  return { ...world, entities, nextId };
}
export function seatArchitect(world: World): World {
  const avatar = Object.values(world.entities).find((entity) => entity.tags.includes("architect"));
  if (!avatar) return world;
  const p = avatar.transform.position;
  const yaw = Number(avatar.customData.yaw) || 0;
  const oldRim = Math.hypot(p.x + 2.2, p.z - 2.05) < 1.2 && Math.abs(yaw - 0.35) < 0.4;
  const offDeck = Math.abs(p.x) > 5.6 || p.z < -4.2 || p.z > 4.6 || p.y > 4.5 || p.y < 0.3;
  if (!oldRim && !offDeck) return world;
  const next = withYaw(
    { ...avatar, transform: { ...avatar.transform, position: V3(0.15, 0.78, -2.2) } },
    0,
  );
  const entities = { ...world.entities, [avatar.id]: next };
  const helm = Object.values(entities).find((entity) => entity.tags.includes("helm"));
  if (helm) {
    entities[helm.id] = {
      ...helm,
      transform: { ...helm.transform, position: V3(0.15, 1.4, -2.04) },
      customData: { ...helm.customData, yaw: "0" },
    };
  }
  return { ...world, entities };
}

function num(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultScale(asset: string): Vec3 {
  switch (asset) {
    case "platform":
      return V3(3.2, 0.16, 3.2);
    case "pillar":
      return V3(0.42, 2.4, 0.42);
    case "sphere":
      return V3(0.8, 0.8, 0.8);
    case "ring":
      return V3(1.15, 1.15, 1.15);
    case "gaussian":
      return V3(1, 1, 1);
    case "card":
      return V3(1.15, 1.35, 0.08);
    case "gem":
    case "crystal":
      return V3(0.85, 0.85, 0.85);
    case "knot":
      return V3(0.9, 0.9, 0.9);
    case "vase":
      return V3(0.9, 1.15, 0.9);
    default:
      return V3(1, 1, 1);
  }
}

function defaultName(asset: string): string {
  switch (asset) {
    case "platform":
      return "Platform";
    case "gaussian":
      return "Splat";
    case "pillar":
      return "Pillar";
    case "sphere":
      return "Sphere";
    case "ring":
      return "Ring";
    case "card":
      return "Card";
    case "helm":
      return "Helm";
    case "gem":
      return "Gem";
    case "knot":
      return "Knot";
    case "vase":
      return "Vase";
    case "crystal":
      return "Crystal";
    default:
      return "Cube";
  }
}

/** Sit a y=0 spawn on the grid instead of burying its center. */
function presentY(asset: string, scale: Vec3, y: number): number {
  if (Math.abs(y) > 1e-6) return y;
  if (asset === "gaussian") return 1.2;
  if (asset === "ring") return 0.85;
  if (asset === "card") return 0.78;
  if (asset === "vase") return 0.7;
  return scale.y / 2;
}

function representationFor(asset: string, name: string): Representation {
  if (asset === "gaussian") {
    return { kind: "gaussian", proxyId: name.toLowerCase(), particleCount: 280 };
  }
  return { kind: "mesh", assetId: asset };
}

export function restyle(entity: Entity, asset: string): Entity {
  return {
    ...entity,
    representation: representationFor(asset, entity.name),
    transform: { ...entity.transform, scale: defaultScale(asset) },
  };
}

const STEP = 0.7;

/** Walk or turn a body. Forward follows its yaw, so left and right stay consistent. */
export function steer(entity: Entity, move: string): Entity {
  let yaw = Number(entity.customData.yaw) || 0;
  if (move === "turn-left") yaw += 0.45;
  if (move === "turn-right") yaw -= 0.45;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const p = entity.transform.position;
  let x = p.x;
  let y = p.y;
  let z = p.z;
  if (move === "forward") {
    x += fx * STEP;
    z += fz * STEP;
  } else if (move === "back") {
    x -= fx * STEP;
    z -= fz * STEP;
  } else if (move === "left") {
    x -= fz * STEP;
    z += fx * STEP;
  } else if (move === "right") {
    x += fz * STEP;
    z -= fx * STEP;
  } else if (move === "up") {
    y += 0.45;
  } else if (move === "down") {
    y = Math.max(0.4, y - 0.45);
  }
  return {
    ...entity,
    transform: { ...entity.transform, position: { x, y, z } },
    customData: { ...entity.customData, yaw: String(Math.round(yaw * 1000) / 1000) },
  };
}

export function createAgent(id: number, name: string, role: string, slot: number): Entity {
  const angle = -0.4 + slot * 0.7;
  const tint = role === "critic" ? "#c4b5fd" : role === "scout" ? "#86efac" : "#93c5fd";
  return {
    id,
    name,
    transform: {
      position: V3(Math.cos(angle) * 1.8 - 0.4, 0.78, Math.sin(angle) * 1.4 + 1.4),
      rotation: { ...IDENTITY },
      scale: V3(0.92, 0.92, 0.92),
    },
    representation: { kind: "hybrid", meshId: "agent_body", gsId: "agent_detail" },
    physics: null,
    tags: ["agent", role],
    customData: { color: tint, role, yaw: "0" },
  };
}

export function makeSpawned(id: number, args: Record<string, string>): Entity {
  const asset = (args.asset || "cube").trim() || "cube";
  const name = (args.name || "").trim() || defaultName(asset);
  const scale = defaultScale(asset);
  const requestedY = num(args.y, 0);
  const physicsOn = args.physics === "true";
  const tags = args.tags
    ? args.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : ["spawned", asset];

  const physics: PhysicsBody | null = physicsOn
    ? {
        mass: num(args.mass, 1),
        velocity: V3(num(args.vx, 0), num(args.vy, 0), num(args.vz, 0)),
        angularVelocity: V3(),
        isKinematic: args.kinematic === "true",
        solver: (args.solver || "rigid").trim() || "rigid",
      }
    : null;

  const color = normalizeColor(args.color) ?? autoColor(id, asset);

  return {
    id,
    name,
    transform: {
      position: V3(num(args.x, 0), presentY(asset, scale, requestedY), num(args.z, 0)),
      rotation: { ...IDENTITY },
      scale,
    },
    representation: representationFor(asset, name),
    physics,
    tags: tags.length ? tags : ["spawned"],
    customData: { color },
  };
}

function assetKind(entity: Entity): string {
  if (entity.representation.kind === "mesh") return entity.representation.assetId;
  if (entity.representation.kind === "gaussian") return "gaussian";
  return entity.representation.kind;
}

/** Default 0,0,0 and 0,1,0 spawns stack in the middle of a platform. */
function piledOnCenter(args: Record<string, string>): boolean {
  const x = num(args.x, 0);
  const y = num(args.y, 0);
  const z = num(args.z, 0);
  if (Math.hypot(x, z) > 0.2) return false;
  return Math.abs(y) < 0.2 || Math.abs(y - 1) < 0.2;
}

export function seatOffCenter(world: World, entity: Entity, args: Record<string, string>): Entity {
  if (assetKind(entity) === "platform" || entity.tags.includes("architect")) return entity;
  if (!piledOnCenter(args)) return entity;
  const platforms = Object.values(world.entities).filter((item) => assetKind(item) === "platform");
  const host = platforms[0];
  if (!host) return entity;
  const taken = Object.values(world.entities).filter(
    (item) => !item.tags.includes("architect") && assetKind(item) !== "platform",
  );
  const half = Math.min(host.transform.scale.x, host.transform.scale.z) / 2;
  const radius = Math.max(0.75, half * 0.62);
  const angle = taken.length * 2.399963;
  const deck = host.transform.position.y + host.transform.scale.y / 2;
  return {
    ...entity,
    transform: {
      ...entity.transform,
      position: {
        x: host.transform.position.x + Math.cos(angle) * radius,
        y: Math.max(entity.transform.position.y, deck + entity.transform.scale.y / 2),
        z: host.transform.position.z + Math.sin(angle) * radius,
      },
    },
  };
}

function deckUnder(entity: Entity, others: Entity[]): { top: number; slide: string } | null {
  const p = entity.transform.position;
  let best: { top: number; slide: string } | null = null;
  for (const other of others) {
    if (other.id === entity.id) continue;
    if (assetKind(other) !== "platform") continue;
    const op = other.transform.position;
    const os = other.transform.scale;
    const top = op.y + os.y / 2;
    if (Math.abs(p.x - op.x) > os.x / 2 + 0.35) continue;
    if (Math.abs(p.z - op.z) > os.z / 2 + 0.35) continue;
    if (p.y + 0.35 < top) continue;
    if (!best || top > best.top) best = { top, slide: other.customData.slide || "" };
  }
  return best;
}

function floorY(entity: Entity): number {
  return Math.max(0.02, entity.transform.scale.y / 2);
}

export function integrate(entity: Entity, dt: number, gravity: number, others: Entity[] = []): Entity {
  const phys = entity.physics;
  if (!phys || phys.isKinematic) return entity;
  const deck = deckUnder(entity, others);
  const velocity = {
    x: phys.velocity.x,
    y: phys.velocity.y + gravity * dt,
    z: phys.velocity.z,
  };
  if (deck?.slide) {
    const [sx, sz] = deck.slide.split(",").map((part) => Number(part.trim()));
    if (Number.isFinite(sx)) velocity.x = sx;
    if (Number.isFinite(sz)) velocity.z = sz;
  }
  const p = entity.transform.position;
  let y = p.y + velocity.y * dt;
  const floor = Math.max(floorY(entity), deck ? deck.top + entity.transform.scale.y / 2 : 0);
  if (y < floor) {
    y = floor;
    if (velocity.y < 0) velocity.y = 0;
  }
  return {
    ...entity,
    physics: { ...phys, velocity },
    transform: {
      ...entity.transform,
      position: {
        x: p.x + velocity.x * dt,
        y,
        z: p.z + velocity.z * dt,
      },
    },
  };
}

export function stepWorld(world: World, count = 1): World {
  const steps = Math.max(0, Math.min(240, count));
  let current = world;
  for (let i = 0; i < steps; i += 1) {
    const bodies = Object.values(current.entities);
    const next: Record<number, Entity> = {};
    for (const entity of bodies) {
      next[entity.id] = integrate(entity, current.deltaTime, current.gravity, bodies);
    }
    current = { ...current, entities: next, tick: current.tick + 1 };
    if (current.tick % 28 === 0) current = playTetris(current, "down");
  }
  return current;
}

export function queryByTag(entities: Record<number, Entity>, tag: string): Entity[] {
  return Object.values(entities)
    .filter((entity) => entity.tags.some((item) => item === tag))
    .sort((a, b) => a.id - b.id);
}

export function recordEvent(world: World, msg: string): World {
  const eventLog = [...world.eventLog, msg];
  if (eventLog.length > 256) eventLog.splice(0, 64);
  return { ...world, eventLog };
}

const CELL = 0.36;
const COLS = 10;
const PIECES = ["I", "O", "T", "S", "Z", "J", "L"] as const;
type PieceName = (typeof PIECES)[number];

const SHAPE: Record<PieceName, Array<[number, number]>> = {
  O: [[0, 0], [1, 0], [0, 1], [1, 1]],
  I: [[0, 0], [1, 0], [2, 0], [3, 0]],
  T: [[0, 0], [1, 0], [2, 0], [1, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[1, 0], [1, 1], [1, 2], [0, 2]],
  L: [[0, 0], [0, 1], [0, 2], [1, 2]],
};

const PIECE_COLOR: Record<PieceName, string> = {
  O: "#e2c14a",
  I: "#6ec8e0",
  T: "#b07ad6",
  S: "#6fbf73",
  Z: "#d65b5b",
  J: "#5b7fd6",
  L: "#e08a3c",
};

function isPiece(value: string): value is PieceName {
  return (PIECES as readonly string[]).includes(value);
}

function gridPos(originX: number, originZ: number, gx: number, gy: number): Vec3 {
  return V3(originX + gx * CELL, 0.28 + gy * CELL, originZ);
}

function boardOf(world: World): Entity | undefined {
  return Object.values(world.entities).find((entity) => entity.customData.play === "tetris");
}

function rngNext(state: number): { roll: number; state: number } {
  let x = (state + 0x6d2b79f5) >>> 0;
  let t = Math.imul(x ^ (x >>> 15), x | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { roll: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: x };
}

function takePiece(bag: string, seed: number): { piece: PieceName; bag: string; seed: number } {
  let rest = bag.split("").filter(isPiece);
  let nextSeed = seed;
  if (!rest.length) {
    rest = [...PIECES];
    for (let i = rest.length - 1; i > 0; i -= 1) {
      const rolled = rngNext(nextSeed);
      nextSeed = rolled.state;
      const j = Math.floor(rolled.roll * (i + 1));
      const swap = rest[i];
      rest[i] = rest[j];
      rest[j] = swap;
    }
  }
  const piece = rest[0] ?? "O";
  return { piece, bag: rest.slice(1).join(""), seed: nextSeed };
}

function occupied(entities: Record<number, Entity>, gx: number, gy: number): boolean {
  if (gx < 0 || gx >= COLS || gy < 0) return true;
  return Object.values(entities).some((entity) => {
    if (!entity.tags.includes("locked")) return false;
    return Number(entity.customData.gx) === gx && Number(entity.customData.gy) === gy;
  });
}

function placeLive(entity: Entity, originX: number, originZ: number, gx: number, gy: number): Entity {
  return {
    ...entity,
    customData: { ...entity.customData, gx: String(gx), gy: String(gy) },
    transform: { ...entity.transform, position: gridPos(originX, originZ, gx, gy) },
  };
}

function spawnPiece(
  entities: Record<number, Entity>,
  nextId: number,
  originX: number,
  originZ: number,
  piece: PieceName,
): { nextId: number; ok: boolean } {
  const cells = SHAPE[piece].map(([dx, dy]) => [3 + dx, 12 + dy] as [number, number]);
  if (cells.some(([gx, gy]) => occupied(entities, gx, gy))) return { nextId, ok: false };
  let id = nextId;
  for (const [gx, gy] of cells) {
    const cube = makeSpawned(id, {
      name: "Piece",
      asset: "cube",
      color: PIECE_COLOR[piece],
      tags: "tetris,live",
    });
    entities[id] = {
      ...cube,
      transform: {
        ...cube.transform,
        position: gridPos(originX, originZ, gx, gy),
        scale: V3(CELL * 0.92, CELL * 0.92, CELL * 0.92),
      },
      customData: { ...cube.customData, gx: String(gx), gy: String(gy), piece },
    };
    id += 1;
  }
  return { nextId: id, ok: true };
}

type LiveCell = { id: number; gx: number; gy: number };

function liveCells(entities: Record<number, Entity>): LiveCell[] {
  return Object.values(entities)
    .filter((entity) => entity.tags.includes("live"))
    .map((entity) => ({ id: entity.id, gx: Number(entity.customData.gx), gy: Number(entity.customData.gy) }));
}

function fits(entities: Record<number, Entity>, cells: LiveCell[]): boolean {
  return cells.every((cell) => !occupied(entities, cell.gx, cell.gy));
}

function writeCells(entities: Record<number, Entity>, cells: LiveCell[], originX: number, originZ: number) {
  for (const cell of cells) {
    const entity = entities[cell.id];
    if (entity) entities[cell.id] = placeLive(entity, originX, originZ, cell.gx, cell.gy);
  }
}

function lockCells(entities: Record<number, Entity>, cells: LiveCell[], originX: number, originZ: number): number {
  for (const cell of cells) {
    const entity = entities[cell.id];
    if (!entity) continue;
    entities[cell.id] = {
      ...placeLive(entity, originX, originZ, cell.gx, cell.gy),
      name: "Block",
      tags: entity.tags.filter((tag) => tag !== "live").concat("locked"),
    };
  }
  let cleared = 0;
  for (let gy = 0; gy < 18; gy += 1) {
    const row = Object.values(entities).filter((entity) => entity.tags.includes("locked") && Number(entity.customData.gy) === gy);
    if (row.length < COLS) continue;
    cleared += 1;
    const gone = new Set(row.map((entity) => entity.id));
    for (const id of gone) delete entities[id];
    for (const entity of Object.values(entities)) {
      if (!entity.tags.includes("locked")) continue;
      const above = Number(entity.customData.gy);
      if (above > gy) entities[entity.id] = placeLive(entity, originX, originZ, Number(entity.customData.gx), above - 1);
    }
    gy -= 1;
  }
  return cleared;
}

function rotated(cells: LiveCell[]): LiveCell[] {
  const cx = cells.reduce((sum, cell) => sum + cell.gx, 0) / cells.length;
  const cy = cells.reduce((sum, cell) => sum + cell.gy, 0) / cells.length;
  return cells.map((cell) => ({
    id: cell.id,
    gx: Math.round(cx - (cell.gy - cy)),
    gy: Math.round(cy + (cell.gx - cx)),
  }));
}

export function playTetris(world: World, move: string): World {
  const board = boardOf(world);
  if (!board || board.customData.over === "1") return world;
  const originX = Number(board.customData.originX) || 5.55;
  const originZ = Number(board.customData.originZ) || 1.35;
  const entities = { ...world.entities };
  let nextId = world.nextId;
  const live = liveCells(entities);
  if (!live.length) {
    const drawn = takePiece(board.customData.bag || "", Number(board.customData.seed) || 1);
    const spawned = spawnPiece(entities, nextId, originX, originZ, drawn.piece);
    entities[board.id] = {
      ...board,
      customData: { ...board.customData, bag: drawn.bag, seed: String(drawn.seed), over: spawned.ok ? "" : "1" },
    };
    return { ...world, entities, nextId: spawned.nextId };
  }
  const shift = (cells: LiveCell[], dx: number, dy: number): LiveCell[] => cells.map((cell) => ({ ...cell, gx: cell.gx + dx, gy: cell.gy + dy }));
  let next = live;
  if (move === "left") next = shift(live, -1, 0);
  if (move === "right") next = shift(live, 1, 0);
  if (move === "down" || move === "drop") next = shift(live, 0, -1);
  if (move === "rotate") {
    const spun = rotated(live);
    const kicks = [
      [0, 0],
      [-1, 0],
      [1, 0],
      [-2, 0],
      [2, 0],
      [0, 1],
    ];
    const kicked = kicks
      .map(([dx, dy]) => spun.map((cell) => ({ ...cell, gx: cell.gx + dx, gy: cell.gy + dy })))
      .find((cells) => fits(entities, cells));
    if (!kicked) return world;
    next = kicked;
  }
  if (move === "drop") {
    let falling = live;
    let guard = 0;
    while (guard < 24 && fits(entities, shift(falling, 0, -1))) {
      falling = shift(falling, 0, -1);
      guard += 1;
    }
    const lines = lockCells(entities, falling, originX, originZ);
    const drawn = takePiece(entities[board.id]?.customData.bag || board.customData.bag || "", Number(entities[board.id]?.customData.seed || board.customData.seed) || 1);
    const spawned = spawnPiece(entities, nextId, originX, originZ, drawn.piece);
    const fresh = entities[board.id] ?? board;
    const linesNow = Number(fresh.customData.lines) || 0;
    entities[board.id] = {
      ...fresh,
      customData: {
        ...fresh.customData,
        bag: drawn.bag,
        seed: String(drawn.seed),
        lines: String(linesNow + lines),
        over: spawned.ok ? "" : "1",
      },
    };
    return { ...world, entities, nextId: spawned.nextId };
  }
  if (!fits(entities, next)) {
    if (move !== "down") return world;
    const lines = lockCells(entities, live, originX, originZ);
    const drawn = takePiece(board.customData.bag || "", Number(board.customData.seed) || 1);
    const spawned = spawnPiece(entities, nextId, originX, originZ, drawn.piece);
    const linesNow = Number(board.customData.lines) || 0;
    entities[board.id] = {
      ...board,
      customData: {
        ...board.customData,
        bag: drawn.bag,
        seed: String(drawn.seed),
        lines: String(linesNow + lines),
        over: spawned.ok ? "" : "1",
      },
    };
    return { ...world, entities, nextId: spawned.nextId };
  }
  writeCells(entities, next, originX, originZ);
  return { ...world, entities, nextId };
}

function withoutTag(world: World, tag: string): { entities: Record<number, Entity>; nextId: number } {
  const entities: Record<number, Entity> = {};
  for (const entity of Object.values(world.entities)) {
    if (!entity.tags.includes(tag)) entities[entity.id] = entity;
  }
  return { entities, nextId: world.nextId };
}

export function buildTetris(world: World): World {
  const fresh = withoutTag(world, "tetris");
  const entities = { ...fresh.entities };
  let id = fresh.nextId;
  const originX = 5.55;
  const originZ = 1.35;
  const centerX = originX + ((COLS - 1) * CELL) / 2;
  const board = sized(
    makeSpawned(id, {
      name: "Tetris",
      asset: "platform",
      color: "#1c2430",
      tags: "tetris,play,fixture",
      physics: "true",
      kinematic: "true",
    }),
    centerX,
    0.1,
    originZ,
    COLS * CELL + 0.4,
    0.16,
    0.9,
  );
  board.customData = {
    ...board.customData,
    play: "tetris",
    originX: String(originX),
    originZ: String(originZ),
    bag: "OITSZJL",
    seed: "11",
    lines: "0",
  };
  entities[id] = board;
  id += 1;
  const wall = (name: string, x: number) => {
    const entity = sized(
      makeSpawned(id, {
        name,
        asset: "pillar",
        color: "#2a3342",
        tags: "tetris,fixture",
        physics: "true",
        kinematic: "true",
      }),
      x,
      2.15,
      originZ,
      0.16,
      4.1,
      0.7,
    );
    entities[id] = entity;
    id += 1;
  };
  wall("WellLeft", originX - CELL * 0.85);
  wall("WellRight", originX + COLS * CELL - CELL * 0.15);
  const spawned = spawnPiece(entities, id, originX, originZ, "O");
  return { ...world, entities, nextId: spawned.nextId };
}

export function buildMarble(world: World): World {
  const fresh = withoutTag(world, "marble");
  const entities = { ...fresh.entities };
  let id = fresh.nextId;
  const pads: { name: string; x: number; y: number; z: number; sx: number; sz: number; slide: string; color: string }[] = [
    { name: "StartRamp", x: -5.6, y: 2.05, z: 2.55, sx: 1.35, sz: 2.4, slide: "0,-1.7", color: "#3a4658" },
    { name: "MidRamp", x: -5.6, y: 1.32, z: 0.4, sx: 1.35, sz: 2.55, slide: "0,-1.7", color: "#334155" },
    { name: "LowRamp", x: -4.5, y: 0.62, z: -1.45, sx: 2.7, sz: 1.85, slide: "1.65,0", color: "#2c3a4a" },
    { name: "Catch", x: -2.05, y: 0.3, z: -1.45, sx: 2.15, sz: 1.85, slide: "0,0", color: "#243044" },
  ];
  for (const pad of pads) {
    const entity = sized(
      makeSpawned(id, {
        name: pad.name,
        asset: "platform",
        color: pad.color,
        tags: "marble,play,fixture",
        physics: "true",
        kinematic: "true",
      }),
      pad.x,
      pad.y,
      pad.z,
      pad.sx,
      0.12,
      pad.sz,
    );
    entity.customData = { ...entity.customData, slide: pad.slide };
    entities[id] = entity;
    id += 1;
  }
  const marble = sized(
    makeSpawned(id, {
      name: "Marble",
      asset: "sphere",
      color: "#f4f1ec",
      tags: "marble,play",
      physics: "true",
    }),
    -5.6,
    2.62,
    3.5,
    0.42,
    0.42,
    0.42,
  );
  marble.customData = { ...marble.customData, solver: "xpbd" };
  entities[id] = marble;
  return { ...world, entities, nextId: id + 1 };
}
