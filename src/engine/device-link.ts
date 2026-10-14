/**
 * One Forge, many devices.
 *
 * A person has one owner identity (an Ed25519 key). Each of their devices has its own key and an
 * owner-signed certificate that says what that device may do. Devices with valid certificates from
 * the same owner join one shared instance: the same worlds, skills and saves, no second install of
 * state. Unlike casting, every device can both show and send input, each renders at its own
 * resolution, and the device that runs the simulation (the host) can move between them.
 *
 * Roles
 *   host     runs the authoritative simulation for this instance
 *   compute  takes offloaded work (rendering, model inference) from the host
 *   display  renders the shared world at its own resolution and level of detail
 *   input    sends controls (a phone as a gamepad, a watch as a remote)
 *
 * Pairing uses numeric comparison, like Bluetooth: both screens show a six-digit code derived from
 * the new device's key and a fresh nonce. If they match, nobody in the middle swapped keys.
 */
import { b64url, canonical, fromB64url, idOf, sha256, type Identity } from "./island.ts";
import type { Tier } from "./hardware.ts";

export const ROLES = ["host", "compute", "display", "input"] as const;
export type Role = (typeof ROLES)[number];

export type DeviceCert = {
  forge: "device";
  version: 1;
  ownerId: string;
  ownerKey: string;
  deviceId: string;
  deviceKey: string;
  name: string;
  roles: Role[];
  issuedAt: number;
  expiresAt: number;
};

export type SignedDeviceCert = { cert: DeviceCert; signature: string };
export type Revocations = { ownerId: string; version: number; revoked: string[] };
export type SignedRevocations = { list: Revocations; signature: string };

const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;
const isRole = (value: unknown): value is Role => typeof value === "string" && (ROLES as readonly string[]).includes(value);

export async function signText(key: CryptoKey, text: string): Promise<string> {
  return b64url(new Uint8Array(await subtle().sign({ name: "Ed25519" }, key, enc.encode(text) as BufferSource)));
}

export async function verifyText(publicKey: string, text: string, signature: string): Promise<boolean> {
  const raw = fromB64url(publicKey);
  const sig = fromB64url(signature);
  if (!raw || raw.length !== 32 || !sig) return false;
  try {
    const key = await subtle().importKey("raw", raw as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    return await subtle().verify({ name: "Ed25519" }, key, sig as BufferSource, enc.encode(text) as BufferSource);
  } catch {
    return false;
  }
}

// ---------- pairing ----------

export function pairingNonce(): string {
  return b64url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Six digits both screens show. Same nonce and same keys give the same code. With the owner key in
 * the code as well, a swap on either side (the new device's key or the owner's) shows up as a mismatch.
 */
export async function pairingCode(nonce: string, deviceKey: string, ownerKey?: string): Promise<string> {
  const digest = fromB64url(await sha256(enc.encode(`pair|${nonce}|${deviceKey}${ownerKey ? `|${ownerKey}` : ""}`)));
  if (!digest) throw new Error("hash failed");
  const n = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, "0");
}

// ---------- certificates ----------

const DAY = 24 * 60 * 60 * 1000;

export async function issueDeviceCert(
  owner: Identity,
  device: { publicKey: string; name: string; roles: Role[] },
  options: { now?: number; days?: number } = {},
): Promise<SignedDeviceCert> {
  const roles = [...new Set(device.roles)];
  if (!roles.length || !roles.every(isRole)) throw new Error("a device needs at least one valid role");
  if (!device.name || device.name.length > 60) throw new Error("device name must be 1 to 60 characters");
  const now = options.now ?? Date.now();
  const cert: DeviceCert = {
    forge: "device",
    version: 1,
    ownerId: owner.id,
    ownerKey: owner.publicKey,
    deviceId: await idOf(device.publicKey),
    deviceKey: device.publicKey,
    name: device.name,
    roles,
    issuedAt: now,
    expiresAt: now + (options.days ?? 365) * DAY,
  };
  return { cert, signature: await signText(owner.privateKey, `device|${canonical(cert)}`) };
}

export async function verifyDeviceCert(
  signed: SignedDeviceCert,
  options: { ownerId?: string; now?: number; revoked?: Revocations | null } = {},
): Promise<{ ok: true; cert: DeviceCert } | { ok: false; reason: string }> {
  const c = signed?.cert;
  if (!c || c.forge !== "device" || c.version !== 1 || !Array.isArray(c.roles) || !c.roles.length || !c.roles.every(isRole)) {
    return { ok: false, reason: "certificate is malformed" };
  }
  if ((await idOf(c.ownerKey).catch(() => "")) !== c.ownerId) return { ok: false, reason: "owner id does not match owner key" };
  if ((await idOf(c.deviceKey).catch(() => "")) !== c.deviceId) return { ok: false, reason: "device id does not match device key" };
  if (options.ownerId && c.ownerId !== options.ownerId) return { ok: false, reason: "device belongs to a different owner" };
  const now = options.now ?? Date.now();
  if (now < c.issuedAt || now > c.expiresAt) return { ok: false, reason: "certificate is expired or not yet valid" };
  if (!(await verifyText(c.ownerKey, `device|${canonical(c)}`, signed.signature))) return { ok: false, reason: "certificate signature is invalid" };
  if (options.revoked && options.revoked.ownerId === c.ownerId && options.revoked.revoked.includes(c.deviceId)) {
    return { ok: false, reason: "device was removed by its owner" };
  }
  return { ok: true, cert: c };
}

// ---------- removing a device ----------

export async function signRevocations(owner: Identity, list: Revocations): Promise<SignedRevocations> {
  if (list.ownerId !== owner.id) throw new Error("revocations must be signed by their owner");
  return { list, signature: await signText(owner.privateKey, `revoke|${canonical(list)}`) };
}

/** Accept a newer revocation list only if the owner signed it and its version moved forward. */
export async function acceptRevocations(
  current: Revocations | null,
  incoming: SignedRevocations,
  ownerKey: string,
): Promise<Revocations | null> {
  const list = incoming?.list;
  if (!list || !Array.isArray(list.revoked) || !Number.isInteger(list.version)) return current;
  if ((await idOf(ownerKey).catch(() => "")) !== list.ownerId) return current;
  if (current && list.version <= current.version) return current;
  if (!(await verifyText(ownerKey, `revoke|${canonical(list)}`, incoming.signature))) return current;
  return list;
}

// ---------- choosing the host ----------

export type LinkedDevice = { deviceId: string; roles: Role[]; tier: Tier; onBattery: boolean; online: boolean };

const TIER_SCORE: Record<Tier, number> = { none: 0, low: 1, mid: 2, high: 3 };

/** The strongest online device allowed to host runs the simulation. Ties prefer plugged-in, then the current host. */
export function pickHost(devices: LinkedDevice[], current: string | null = null): string | null {
  const able = devices.filter((d) => d.online && d.roles.includes("host") && d.tier !== "none");
  if (!able.length) return null;
  const score = (d: LinkedDevice) => TIER_SCORE[d.tier] * 10 + (d.onBattery ? 0 : 5) + (d.deviceId === current ? 1 : 0);
  return [...able].sort((a, b) => score(b) - score(a))[0].deviceId;
}
