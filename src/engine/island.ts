/**
 * Islands. One app, one self-hosted node, one signed identity.
 *
 * Address   forge://host[:port]/slug          (same idea as OpenSim's host:port/Region)
 * Identity  Ed25519 key pair. The node id is the hash of the public key, so nobody can claim an id
 *           without holding the key.
 * Portal    A two-message handshake. The visitor says who it is and what it wants. The host checks
 *           the signature, intersects the request with its own policy, and answers with what it grants,
 *           signed so the visitor knows it reached the real host.
 *
 * Nothing here opens a socket. It is the protocol logic only, so any transport can carry it
 * (HTTP, WebSocket, WebRTC, a native host). Uses WebCrypto; Ed25519 needs a current browser or Node 20+.
 */

export const CAPABILITIES = ["render", "input", "audio", "storage", "portal", "fetch", "compute"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type Address = { host: string; port: number | null; slug: string };

export type IslandManifest = {
  forge: "island";
  version: 1;
  id: string;
  name: string;
  address: string;
  publicKey: string;
  entry: { kind: "wasm" | "world"; sha256: string; bytes: number };
  wants: Capability[];
  portals: string[];
};

export type SignedManifest = { manifest: IslandManifest; signature: string };
export type Identity = { publicKey: string; id: string; privateKey: CryptoKey };

export type Hello = {
  type: "hello";
  from: SignedManifest;
  to: string;
  wants: Capability[];
  nonce: string;
  signature: string;
};

export type Welcome = {
  type: "welcome";
  host: SignedManifest;
  grant: Capability[];
  nonce: string;
  signature: string;
};

export type Policy = { allow: Capability[]; blockedIds?: string[] };

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseAddress(text: string): Address | null {
  const match = /^forge:\/\/([^/:?#\s]+)(?::(\d{1,5}))?\/([^/?#\s]+)$/.exec(text.trim());
  if (!match) return null;
  const [, host, portText, slug] = match;
  if (!HOST.test(host) || !SLUG.test(slug)) return null;
  const port = portText === undefined ? null : Number(portText);
  if (port !== null && (port < 1 || port > 65535)) return null;
  return { host: host.toLowerCase(), port, slug };
}

export function formatAddress(address: Address): string {
  return `forge://${address.host}${address.port === null ? "" : `:${address.port}`}/${address.slug}`;
}

/** Same address, same string, whatever the host's case. */
export function normalizeAddress(text: string): string | null {
  const parsed = parseAddress(text);
  return parsed ? formatAddress(parsed) : null;
}

// ---------- bytes ----------

const subtle = (): SubtleCrypto => {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error("WebCrypto is not available here");
  return api;
};

export function b64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(text: string): Uint8Array | null {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
    const raw = atob(padded);
    return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

const enc = new TextEncoder();

export async function sha256(bytes: Uint8Array): Promise<string> {
  return b64url(new Uint8Array(await subtle().digest("SHA-256", bytes as BufferSource)));
}

/** Stable JSON: keys sorted, so the same manifest always signs to the same bytes. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// ---------- identity ----------

export async function generateIdentity(): Promise<Identity> {
  const pair = (await subtle().generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  const publicKey = b64url(raw);
  return { publicKey, id: await idOf(publicKey), privateKey: pair.privateKey };
}

export async function idOf(publicKey: string): Promise<string> {
  const raw = fromB64url(publicKey);
  if (!raw) throw new Error("bad public key");
  return (await sha256(raw)).slice(0, 22);
}

async function importPublic(publicKey: string): Promise<CryptoKey | null> {
  const raw = fromB64url(publicKey);
  if (!raw || raw.length !== 32) return null;
  try {
    return await subtle().importKey("raw", raw as BufferSource, { name: "Ed25519" }, false, ["verify"]);
  } catch {
    return null;
  }
}

async function sign(key: CryptoKey, text: string): Promise<string> {
  return b64url(new Uint8Array(await subtle().sign({ name: "Ed25519" }, key, enc.encode(text) as BufferSource)));
}

async function verify(publicKey: string, text: string, signature: string): Promise<boolean> {
  const key = await importPublic(publicKey);
  const sig = fromB64url(signature);
  if (!key || !sig) return false;
  try {
    return await subtle().verify({ name: "Ed25519" }, key, sig as BufferSource, enc.encode(text) as BufferSource);
  } catch {
    return false;
  }
}

// ---------- manifest ----------

const isCap = (value: unknown): value is Capability => typeof value === "string" && (CAPABILITIES as readonly string[]).includes(value);

export function validateManifest(value: unknown): value is IslandManifest {
  if (!value || typeof value !== "object") return false;
  const m = value as Partial<IslandManifest>;
  return (
    m.forge === "island" &&
    m.version === 1 &&
    typeof m.id === "string" &&
    typeof m.name === "string" &&
    m.name.length > 0 &&
    m.name.length <= 80 &&
    typeof m.address === "string" &&
    parseAddress(m.address) !== null &&
    typeof m.publicKey === "string" &&
    !!m.entry &&
    (m.entry.kind === "wasm" || m.entry.kind === "world") &&
    typeof m.entry.sha256 === "string" &&
    Number.isInteger(m.entry.bytes) &&
    m.entry.bytes >= 0 &&
    Array.isArray(m.wants) &&
    m.wants.every(isCap) &&
    Array.isArray(m.portals) &&
    m.portals.every((item) => typeof item === "string" && parseAddress(item) !== null)
  );
}

export async function signManifest(manifest: IslandManifest, identity: Identity): Promise<SignedManifest> {
  if (manifest.publicKey !== identity.publicKey || manifest.id !== identity.id) throw new Error("manifest does not match the identity");
  return { manifest, signature: await sign(identity.privateKey, `manifest|${canonical(manifest)}`) };
}

export async function verifyManifest(signed: SignedManifest): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!signed || !validateManifest(signed.manifest)) return { ok: false, reason: "manifest is malformed" };
  const m = signed.manifest;
  if ((await idOf(m.publicKey).catch(() => "")) !== m.id) return { ok: false, reason: "id does not match the public key" };
  if (!(await verify(m.publicKey, `manifest|${canonical(m)}`, signed.signature))) return { ok: false, reason: "manifest signature is invalid" };
  return { ok: true };
}

// ---------- portal handshake ----------

function randomNonce(): string {
  return b64url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

const helloText = (h: Pick<Hello, "from" | "to" | "wants" | "nonce">) =>
  `hello|${h.nonce}|${h.to}|${h.from.manifest.id}|${[...h.wants].sort().join(",")}`;
const welcomeText = (nonce: string, visitorId: string, hostId: string, grant: Capability[]) =>
  `welcome|${nonce}|${visitorId}|${hostId}|${[...grant].sort().join(",")}`;

export async function makeHello(from: SignedManifest, identity: Identity, to: string, wants: Capability[]): Promise<Hello> {
  const target = normalizeAddress(to);
  if (!target) throw new Error("bad destination address");
  const base = { from, to: target, wants: [...new Set(wants)], nonce: randomNonce() };
  return { type: "hello", ...base, signature: await sign(identity.privateKey, helloText(base)) };
}

/** The host decides. A request is never a grant. */
export async function answerHello(
  hello: Hello,
  host: SignedManifest,
  identity: Identity,
  policy: Policy,
): Promise<{ ok: true; welcome: Welcome } | { ok: false; reason: string }> {
  if (!hello || hello.type !== "hello" || typeof hello.to !== "string" || typeof hello.nonce !== "string" || !Array.isArray(hello.wants) || !hello.wants.every(isCap)) {
    return { ok: false, reason: "hello is malformed" };
  }
  const seen = await verifyManifest(hello.from);
  if (!seen.ok) return { ok: false, reason: `visitor rejected: ${seen.reason}` };
  if (normalizeAddress(hello.to) !== normalizeAddress(host.manifest.address)) return { ok: false, reason: "hello is addressed to a different island" };
  if (!(await verify(hello.from.manifest.publicKey, helloText(hello), hello.signature))) return { ok: false, reason: "hello signature is invalid" };
  if (policy.blockedIds?.includes(hello.from.manifest.id)) return { ok: false, reason: "visitor is blocked" };
  const grant = hello.wants.filter((cap) => policy.allow.includes(cap));
  const welcome: Welcome = {
    type: "welcome",
    host,
    grant,
    nonce: hello.nonce,
    signature: await sign(identity.privateKey, welcomeText(hello.nonce, hello.from.manifest.id, host.manifest.id, grant)),
  };
  return { ok: true, welcome };
}

/** The visitor confirms it reached the real host and learns what it was actually granted. */
export async function checkWelcome(hello: Hello, welcome: Welcome): Promise<{ ok: true; grant: Capability[] } | { ok: false; reason: string }> {
  if (!welcome || welcome.type !== "welcome" || !Array.isArray(welcome.grant)) return { ok: false, reason: "welcome is malformed" };
  const seen = await verifyManifest(welcome.host);
  if (!seen.ok) return { ok: false, reason: `host rejected: ${seen.reason}` };
  if (normalizeAddress(welcome.host.manifest.address) !== normalizeAddress(hello.to)) return { ok: false, reason: "answered by a different island than the one asked" };
  if (welcome.nonce !== hello.nonce) return { ok: false, reason: "nonce mismatch (replayed or stale)" };
  if (!welcome.grant.every(isCap) || !welcome.grant.every((cap) => hello.wants.includes(cap))) return { ok: false, reason: "host granted more than was asked" };
  const text = welcomeText(welcome.nonce, hello.from.manifest.id, welcome.host.manifest.id, welcome.grant);
  if (!(await verify(welcome.host.manifest.publicKey, text, welcome.signature))) return { ok: false, reason: "welcome signature is invalid" };
  return { ok: true, grant: welcome.grant };
}

export async function buildManifest(
  identity: Identity,
  fields: { name: string; address: string; entry: IslandManifest["entry"]; wants?: Capability[]; portals?: string[] },
): Promise<IslandManifest> {
  const address = normalizeAddress(fields.address);
  if (!address) throw new Error("bad island address");
  const portals = (fields.portals ?? []).map((item) => normalizeAddress(item));
  if (portals.some((item) => item === null)) throw new Error("bad portal address");
  return {
    forge: "island",
    version: 1,
    id: identity.id,
    name: fields.name,
    address,
    publicKey: identity.publicKey,
    entry: fields.entry,
    wants: [...new Set(fields.wants ?? [])],
    portals: portals as string[],
  };
}
