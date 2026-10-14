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
import type { Entity, World } from "./types.ts";

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

// ---------- the screen in the world ----------

export const SCREEN_TAG = "device-screen";
/** Dispatched on window to open the apps sheet from anywhere (the Phone / Computer button by the move keys). */
export const OPEN_DEVICE_EVENT = "forge:open-device";
/** Close enough to use the screen (metres from the avatar). */
export const SCREEN_REACH = 2.4;

/** The screen for this device, a few steps ahead and to the right of where you start in the lab, facing you. */
export function makeScreen(id: number, kind: DeviceKind): Entity {
  const phone = kind === "phone";
  return {
    id,
    name: phone ? "Your phone" : "Your computer",
    transform: {
      position: { x: 2.2, y: phone ? 1.15 : 1.1, z: -0.2 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: phone ? { x: 0.5, y: 0.9, z: 0.06 } : { x: 1.2, y: 0.78, z: 0.06 },
    },
    representation: { kind: "mesh", assetId: SCREEN_TAG },
    physics: null,
    tags: [SCREEN_TAG, "fixture"],
    customData: { role: "device", kind, color: "#10141a", yaw: String(Math.round(Math.atan2(0.15 - 2.2, -2.2 - -0.2) * 1000) / 1000), note: "Your real apps. Open one and Forge steps aside; come back to Forge any time." },
  };
}

/** Put this device's screen in the world (once). Each device has its own; it is not shared between linked devices. */
export function ensureScreen(world: World, kind: DeviceKind): World {
  const existing = Object.values(world.entities).find((e) => e.tags.includes(SCREEN_TAG));
  if (existing && existing.customData.kind === kind) return world;
  const entities = { ...world.entities };
  if (existing) delete entities[existing.id];
  const screen = makeScreen(world.nextId, kind);
  entities[screen.id] = screen;
  return { ...world, entities, nextId: world.nextId + 1 };
}
