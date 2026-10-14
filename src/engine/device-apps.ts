/**
 * The real apps on this phone or computer, for the screen in Forge's world (DeviceScreen.tsx).
 *
 * Forge does not replace the system it runs on; it sits in front of it. The screen in the world is a
 * way through: pick an app and it opens for real while Forge steps aside (minimized on a computer,
 * in the background on a phone). Open Forge again, or press Home when Forge is the phone's home
 * screen, and you are back where you were, because Forge keeps its state.
 *
 *   Android   window.ForgeAndroid, added by MainActivity.kt (ForgeApps)
 *   Desktop   the apps_list / apps_open commands of the Tauri host (src-tauri/src/apps.rs)
 *   Browser   nothing to open; ?apps=demo shows a made-up list, to try the screen
 */
import type { Entity, Vec3, World } from "./types.ts";

export type DeviceApp = { id: string; name: string; icon?: string };
export type DeviceKind = "phone" | "computer";
export type HomeState = "off" | "offered" | "home";

type AndroidBridge = { countApps(): number; listApps(): string; openApp(id: string): boolean; homeState(): string; setHome(on: boolean): void };
type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

const g = globalThis as { ForgeAndroid?: AndroidBridge; __TAURI_INTERNALS__?: TauriInternals; location?: Location };

const android = (): AndroidBridge | null => (g.ForgeAndroid && typeof g.ForgeAndroid.listApps === "function" ? g.ForgeAndroid : null);
const tauri = (): TauriInternals | null => (g.__TAURI_INTERNALS__ && typeof g.__TAURI_INTERNALS__.invoke === "function" ? g.__TAURI_INTERNALS__ : null);
const demo = (): "computer" | "phone" | null => {
  const flag = new URLSearchParams(g.location?.search ?? "").get("apps");
  return flag === "demo" ? "computer" : flag === "demo-phone" ? "phone" : null;
};

const DEMO_APPS: DeviceApp[] = ["Browser", "Calendar", "Camera", "Clock", "Files", "Mail", "Maps", "Messages", "Music", "Notes", "Phone", "Photos", "Settings", "Terminal", "Weather"].map((name) => ({ id: `demo:${name.toLowerCase()}`, name }));

/** Is there a real device behind Forge here, and which kind? null in a plain browser tab. */
export function deviceKind(): DeviceKind | null {
  if (android()) return "phone";
  if (tauri()) return "computer";
  return demo();
}

let cached: Promise<DeviceApp[]> | null = null;

/** The apps on this device, sorted by name. Cached; pass fresh to look again. */
export function listApps(fresh = false): Promise<DeviceApp[]> {
  if (cached && !fresh) return cached;
  cached = (async () => {
    const phone = android();
    if (phone) {
      const parsed = JSON.parse(phone.listApps()) as DeviceApp[];
      return parsed.filter((a) => a && typeof a.id === "string" && typeof a.name === "string").sort((a, b) => a.name.localeCompare(b.name));
    }
    const host = tauri();
    if (host) {
      const rows = (await host.invoke("apps_list")) as [string, string][];
      return rows.map(([id, name]) => ({ id, name }));
    }
    return demo() ? DEMO_APPS : [];
  })().catch((error) => {
    cached = null;
    throw error;
  });
  return cached;
}

/** Open an app for real. Forge steps aside. Returns why not, or null when it opened. */
export async function openApp(app: DeviceApp): Promise<string | null> {
  const phone = android();
  if (phone) return phone.openApp(app.id) ? null : `${app.name} cannot be opened from here.`;
  const host = tauri();
  if (host) {
    try {
      await host.invoke("apps_open", { id: app.id });
      return null;
    } catch (error) {
      return String(error);
    }
  }
  return demo() ? null : "There are no apps to open in a browser tab. Use the Forge app on your phone or computer.";
}

/** Android only: whether Forge is offered as, or is, the home screen. null elsewhere. */
export function homeState(): HomeState | null {
  const phone = android();
  if (!phone) return null;
  const state = phone.homeState();
  return state === "home" || state === "offered" ? state : "off";
}

/** Android only: offer Forge as the home screen (or stop), then open the system's home setting. */
export function setHome(on: boolean) {
  android()?.setHome(on);
}

/** How many apps the phone has (cheap). The emulator test reads the bridge's log of this call. */
export function countApps(): number | null {
  const phone = android();
  if (!phone) return null;
  try {
    return phone.countApps();
  } catch {
    return null;
  }
}

// ---------- the phone (or computer) in the world ----------
//
// It is a thing you carry. It starts on its stand in the lab, floating and turning so you can find
// it. Walk up and pick it up, and it goes in your pocket. Pull it out and your apps are on it; put it
// away and it is back in your pocket. Drop it anywhere, and if you lose it, summon it: it flies back
// to your hand from wherever it is.
//
//   customData.carry   "lying" (in the world, the default) | "pocket" | "out" (in your hand, in use)
//
// Each device has its own; it is not shared between linked devices (store.ts sharedSave).

export const SCREEN_TAG = "device-screen";
/** Dispatched on window to pull the phone out from anywhere (or bring it, if it is not with you). */
export const OPEN_DEVICE_EVENT = "forge:open-device";
/** Close enough to pick it up (metres from the avatar). */
export const SCREEN_REACH = 2.4;
/** Bumped when the device's shape changes, so an older one in a saved world is replaced. */
const MODEL = "handheld-1";
/** Where it waits in the lab: a few steps ahead and to the right of where you start. */
export const STAND = { x: 2.2, y: 0.85, z: -0.2 };

export type Carry = "lying" | "pocket" | "out";
export type Pose = { position: Vec3; yaw: number };

export function carryOf(entity: Entity | undefined): Carry {
  const c = entity?.customData.carry;
  return c === "pocket" || c === "out" ? c : "lying";
}

export function deviceOf(world: Pick<World, "entities">): Entity | undefined {
  return Object.values(world.entities).find((e) => e.tags.includes(SCREEN_TAG));
}

function avatarOf(world: Pick<World, "entities">): Entity | undefined {
  return Object.values(world.entities).find((e) => e.tags.includes("architect"));
}

/** The avatar's position and heading, if there is one. */
export function avatarPose(world: Pick<World, "entities">): Pose | null {
  const avatar = avatarOf(world);
  if (!avatar) return null;
  return { position: { ...avatar.transform.position }, yaw: Number(avatar.customData.yaw) || 0 };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Where the device is when carried: in your right hand in front of you, screen towards you; or out of sight in your pocket. */
export function handSpot(avatar: Pose, carry: Exclude<Carry, "lying">): Pose {
  const fx = Math.sin(avatar.yaw);
  const fz = Math.cos(avatar.yaw);
  // Right of the heading (x, z) is (-z, x) in this world (pilot.tsx).
  const rx = -fz;
  const rz = fx;
  const p = avatar.position;
  if (carry === "pocket") return { position: { x: round(p.x + rx * 0.3), y: round(p.y + 0.1), z: round(p.z + rz * 0.3) }, yaw: avatar.yaw };
  return { position: { x: round(p.x + fx * 0.55 + rx * 0.16), y: round(p.y + 0.42), z: round(p.z + fz * 0.55 + rz * 0.16) }, yaw: avatar.yaw + Math.PI };
}

function place(entity: Entity, pose: Pose, carry: Carry, extra: Record<string, string> = {}): Entity {
  const { flight: _flight, ...rest } = entity.customData;
  return {
    ...entity,
    transform: { ...entity.transform, position: pose.position },
    customData: { ...rest, ...extra, carry, yaw: String(round(pose.yaw)) },
  };
}

export function makeScreen(id: number, kind: DeviceKind): Entity {
  const phone = kind === "phone";
  return {
    id,
    name: phone ? "Your phone" : "Your computer",
    transform: {
      position: { ...STAND },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: phone ? { x: 0.2, y: 0.38, z: 0.035 } : { x: 0.42, y: 0.3, z: 0.03 },
    },
    representation: { kind: "mesh", assetId: SCREEN_TAG },
    physics: null,
    tags: [SCREEN_TAG, "fixture"],
    customData: {
      role: "device",
      kind,
      model: MODEL,
      carry: "lying",
      color: "#10141a",
      yaw: String(round(Math.atan2(0.15 - 2.2, -2.2 - -0.2))),
      note: phone ? "Your real phone. Pick it up, pull it out to use your apps; summon it if you lose it." : "Your real computer. Pick it up, pull it out to use your apps; summon it if you lose it.",
    },
  };
}

/** Put this device in the world (once). An older fixed screen from a previous version is replaced. */
export function ensureScreen<W extends Pick<World, "entities" | "nextId">>(world: W, kind: DeviceKind): W {
  const existing = deviceOf(world);
  if (existing && existing.customData.kind === kind && existing.customData.model === MODEL) return world;
  const entities = { ...world.entities };
  if (existing) delete entities[existing.id];
  const screen = makeScreen(world.nextId, kind);
  entities[screen.id] = screen;
  return { ...world, entities, nextId: world.nextId + 1 };
}

function withDevice<W extends Pick<World, "entities">>(world: W, change: (device: Entity, avatar: Pose) => Entity | null): W {
  const device = deviceOf(world);
  const avatar = avatarPose(world);
  if (!device || !avatar) return world;
  const next = change(device, avatar);
  if (!next) return world;
  return { ...world, entities: { ...world.entities, [device.id]: next } };
}

/** How far the device is from you (metres, along the ground). Infinity if either is missing. */
export function deviceDistance(world: Pick<World, "entities">): number {
  const device = deviceOf(world);
  const avatar = avatarPose(world);
  if (!device || !avatar) return Infinity;
  if (carryOf(device) !== "lying") return 0;
  const a = avatar.position;
  const b = device.transform.position;
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Pick it up if it is within reach. It goes in your pocket. */
export function pickUp<W extends Pick<World, "entities">>(world: W): W {
  if (deviceDistance(world) >= SCREEN_REACH) return world;
  return withDevice(world, (device, avatar) => (carryOf(device) === "lying" ? place(device, handSpot(avatar, "pocket"), "pocket") : null));
}

/** Out of your pocket and into your hand, to use. */
export function pullOut<W extends Pick<World, "entities">>(world: W): W {
  return withDevice(world, (device, avatar) => (carryOf(device) === "pocket" ? place(device, handSpot(avatar, "out"), "out") : null));
}

/** Back in your pocket. */
export function putAway<W extends Pick<World, "entities">>(world: W): W {
  return withDevice(world, (device, avatar) => (carryOf(device) === "out" ? place(device, handSpot(avatar, "pocket"), "pocket") : null));
}

/** Leave it here, floating just in front of you. */
export function drop<W extends Pick<World, "entities">>(world: W): W {
  return withDevice(world, (device, avatar) => {
    if (carryOf(device) === "lying") return null;
    const p = avatar.position;
    const at = { x: round(p.x + Math.sin(avatar.yaw) * 0.9), y: 0.85, z: round(p.z + Math.cos(avatar.yaw) * 0.9) };
    return place(device, { position: at, yaw: avatar.yaw + Math.PI }, "lying");
  });
}

/** How long a summoned device takes to fly back to you. */
export const FLIGHT_MS = 650;

/**
 * Where a summoned device is `t` (0..1) of the way from `from` back to your hand: an arc, so it is
 * plainly flying to you rather than sliding through things.
 */
export function flightSpot(from: Vec3, avatar: Pose, t: number): Pose {
  const k = Math.min(1, Math.max(0, t));
  const ease = k * k * (3 - 2 * k);
  const to = handSpot(avatar, "out");
  const lift = Math.sin(Math.PI * k) * Math.min(3, 0.6 + Math.hypot(to.position.x - from.x, to.position.z - from.z) * 0.12);
  return {
    position: {
      x: round(from.x + (to.position.x - from.x) * ease),
      y: round(from.y + (to.position.y - from.y) * ease + lift),
      z: round(from.z + (to.position.z - from.z) * ease),
    },
    yaw: avatar.yaw + Math.PI + (1 - ease) * Math.PI * 4,
  };
}

/** One frame of a summon: fly towards your hand, and land there ("out") when `t` reaches 1. */
export function summonStep<W extends Pick<World, "entities">>(world: W, from: Vec3, t: number): W {
  return withDevice(world, (device, avatar) => (t >= 1 ? place(device, handSpot(avatar, "out"), "out") : place(device, flightSpot(from, avatar, t), "lying", { flight: "1" })));
}

/** Carried devices go where you go. The pilot calls this each frame it moves the avatar. */
export function carryAlong(entities: Record<number, Entity>, avatar: Pose): void {
  for (const [id, e] of Object.entries(entities)) {
    if (!e.tags.includes(SCREEN_TAG)) continue;
    const carry = carryOf(e);
    if (carry === "lying") continue;
    entities[Number(id)] = place(e, handSpot(avatar, carry), carry);
  }
}
