/**
 * Linking, as this app uses it: this device's own key, the home it paired with, and the sync loop that
 * keeps the shared save (store.ts sharedSave) in step with the home. Browser only.
 *
 * The device key never leaves this device. What is remembered here (localStorage): the key, the home's
 * address and owner key, and this device's certificate.
 */
import { create } from "zustand";
import { b64url, fromB64url, generateIdentity, idOf, type Identity } from "./island.ts";
import { awaitApproval, homeBase, LinkSession, LinkSync, pairWithHome, type LinkConfig, type PairStart, type SyncMark } from "./link-client.ts";
import type { DeviceRow } from "./link-home.ts";
import { applySharedSave, sharedSave, useForge } from "./store.ts";

const ID_KEY = "forge-device-identity-v1";
const CONFIG_KEY = "forge-link-v1";
const MARK_KEY = "forge-link-mark-v1";
const PAIR_TIMEOUT_MS = 5 * 60_000;

export type LinkPhase = "off" | "pairing" | "waiting" | "linked" | "offline" | "removed";

export type LinkView = {
  phase: LinkPhase;
  /** What went wrong, or what to do next. */
  detail: string;
  code: string;
  homeName: string;
  base: string;
  lead: boolean;
  /** The device whose save this one shows last. */
  lastFrom: string;
  devices: DeviceRow[];
  deviceId: string;
};

export const useLink = create<LinkView>(() => ({
  phase: "off",
  detail: "",
  code: "",
  homeName: "",
  base: "",
  lead: false,
  lastFrom: "",
  devices: [],
  deviceId: "",
}));

let identity: Promise<Identity> | null = null;
let sync: LinkSync | null = null;
let session: LinkSession | null = null;
let teardown: (() => void) | null = null;
let pairingRun = 0;

export function deviceIdentity(): Promise<Identity> {
  identity ??= (async () => {
    try {
      const raw = globalThis.localStorage?.getItem(ID_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { publicKey: string; pkcs8: string };
        const der = fromB64url(saved.pkcs8);
        if (der) {
          const privateKey = await crypto.subtle.importKey("pkcs8", der as BufferSource, { name: "Ed25519" }, true, ["sign"]);
          return { publicKey: saved.publicKey, id: await idOf(saved.publicKey), privateKey };
        }
      }
    } catch {
      /* fall through to a fresh key */
    }
    const fresh = await generateIdentity();
    try {
      const pkcs8 = b64url(new Uint8Array(await crypto.subtle.exportKey("pkcs8", fresh.privateKey)));
      globalThis.localStorage?.setItem(ID_KEY, JSON.stringify({ publicKey: fresh.publicKey, pkcs8 }));
    } catch {
      /* private window: this key lasts for this session */
    }
    return fresh;
  })();
  return identity;
}

function loadConfig(): LinkConfig | null {
  try {
    const raw = globalThis.localStorage?.getItem(CONFIG_KEY);
    const config = raw ? (JSON.parse(raw) as LinkConfig) : null;
    return config?.base && config.home?.ownerKey && config.cert?.cert ? config : null;
  } catch {
    return null;
  }
}

function saveConfig(config: LinkConfig | null) {
  try {
    if (config) globalThis.localStorage?.setItem(CONFIG_KEY, JSON.stringify(config));
    else globalThis.localStorage?.removeItem(CONFIG_KEY);
  } catch {
    /* nothing to keep it in */
  }
}

function loadMark(): SyncMark | null {
  try {
    const mark = JSON.parse(globalThis.localStorage?.getItem(MARK_KEY) ?? "null") as SyncMark | null;
    return mark && Number.isInteger(mark.version) && typeof mark.hash === "string" ? mark : null;
  } catch {
    return null;
  }
}

function saveMark(mark: SyncMark | null) {
  try {
    if (mark) globalThis.localStorage?.setItem(MARK_KEY, JSON.stringify(mark));
    else globalThis.localStorage?.removeItem(MARK_KEY);
  } catch {
    /* nothing to keep it in */
  }
}

/** A name for this device people will recognise in the device list. */
export function guessDeviceName(): string {
  const ua = globalThis.navigator?.userAgent ?? "";
  if (/android/i.test(ua)) return /mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/windows/i.test(ua)) return "Windows PC";
  if (/mac os/i.test(ua)) return "Mac";
  if (/linux/i.test(ua)) return "Linux PC";
  return "This device";
}

function begin(config: LinkConfig, device: Identity, mark: SyncMark | null) {
  stopSync();
  session = new LinkSession(config, device);
  useLink.setState({ phase: "offline", detail: "Reaching your home…", homeName: config.home.name, base: config.base, deviceId: device.id, code: "" });
  sync = new LinkSync(session, {
    read: () => sharedSave(useForge.getState()),
    apply: (payload, from) => {
      if (applySharedSave(payload)) useLink.setState({ lastFrom: from.deviceId === device.id ? "this device" : from.name || "another device" });
    },
    status: (status) => {
      if (status.state === "linked") useLink.setState({ phase: "linked", lead: status.lead, detail: "" });
      else if (status.state === "offline") useLink.setState({ phase: "offline", detail: status.reason });
      else {
        useLink.setState({ phase: "removed", detail: status.reason, lead: false });
        saveConfig(null);
        saveMark(null);
        stopSync();
      }
    },
    note: (text) => useForge.getState().note([{ tone: "warn", title: "Devices", body: text }]),
    synced: saveMark,
  }, { initial: mark });
  const unsubscribe = useForge.subscribe(() => sync?.changed());
  // Using this device (a tap, a key, the wheel) makes it the one in charge.
  const touch = () => void sync?.touched();
  const events = ["pointerdown", "keydown", "wheel"] as const;
  for (const name of events) window.addEventListener(name, touch, { capture: true, passive: true });
  teardown = () => {
    unsubscribe();
    for (const name of events) window.removeEventListener(name, touch, { capture: true });
  };
  sync.start();
}

function stopSync() {
  sync?.stop();
  sync = null;
  teardown?.();
  teardown = null;
}

/** On launch: pick the link back up if this device was linked before. */
export async function resumeLink() {
  const config = loadConfig();
  if (!config || sync) return;
  begin(config, await deviceIdentity(), loadMark());
}

/** Ask the home at address to pair. Shows the code, then waits (up to five minutes) for the owner's answer. */
export async function pairDevice(address: string, name: string) {
  const base = homeBase(address);
  if (!base) {
    useLink.setState({ phase: "off", detail: "That is not an address. Use what `forge link` printed, like 192.168.1.20:7430." });
    return;
  }
  const run = ++pairingRun;
  useLink.setState({ phase: "pairing", detail: `Reaching ${base}…`, code: "", base });
  try {
    const device = await deviceIdentity();
    const start: PairStart = await pairWithHome(base, device, name.trim().slice(0, 60) || guessDeviceName());
    if (run !== pairingRun) return;
    useLink.setState({ phase: "waiting", code: start.code, homeName: start.home.name, detail: "" });
    const until = Date.now() + PAIR_TIMEOUT_MS;
    while (run === pairingRun && Date.now() < until) {
      const answer = await awaitApproval(start, device);
      if (run !== pairingRun) return;
      if (answer.status === "refused") {
        useLink.setState({ phase: "off", code: "", detail: `${start.home.name} refused this device.` });
        return;
      }
      if (answer.status === "approved") {
        saveConfig(answer.config);
        saveMark(null);
        begin(answer.config, device, null);
        return;
      }
    }
    if (run === pairingRun) useLink.setState({ phase: "off", code: "", detail: "Nobody answered on the home in five minutes. Start again." });
  } catch (error) {
    if (run === pairingRun) useLink.setState({ phase: "off", code: "", detail: error instanceof Error ? error.message : String(error) });
  }
}

export function cancelPairing() {
  pairingRun += 1;
  useLink.setState({ phase: "off", code: "", detail: "" });
}

export async function refreshDevices() {
  if (!session) return;
  try {
    useLink.setState({ devices: await session.devices() });
  } catch (error) {
    useLink.setState({ detail: error instanceof Error ? error.message : String(error) });
  }
}

export async function removeDevice(deviceId: string) {
  if (!session) return;
  try {
    await session.remove(deviceId);
  } catch (error) {
    useLink.setState({ detail: error instanceof Error ? error.message : String(error) });
  }
  await refreshDevices();
}

/** Leave the home. This device keeps its world as it is now and stops syncing. */
export async function unlinkDevice() {
  const current = session;
  stopSync();
  session = null;
  saveConfig(null);
  saveMark(null);
  useLink.setState({ phase: "off", detail: "", code: "", lead: false, devices: [], lastFrom: "" });
  if (current) await current.remove(current.deviceId).catch(() => {});
}
