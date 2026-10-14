/**
 * The home of one person's linked devices: the place their shared save lives.
 *
 * The home holds the owner key. A new device asks to pair; both screens show a six-digit code, and the
 * owner approves on the home only if the codes match. The device then gets an owner-signed certificate
 * (device-link.ts) and signs every later request with its own key. Revoked or unknown devices are
 * refused, and so is a request replayed or sent with a clock more than two minutes out.
 *
 * The save is one versioned JSON document. A device writes it only on top of the version it last saw
 * (otherwise 409 and the newer save), so two devices can never silently overwrite each other. Devices
 * wait for the next version with a long poll. Every save reply is signed with the owner key, so a
 * device can tell its own home from anything else answering at that address.
 *
 * "Lead" is the device being used right now. It is the one that writes; the others follow. Touching
 * another device moves the lead there, which is how a session continues from the PC to the phone.
 *
 * Transport-free: handle() takes a method, path, headers and body and returns a status and JSON, so the
 * same home runs in Node (scripts/link-node.ts) and, later, inside the app itself.
 */
import { b64url, canonical, fromB64url, generateIdentity, idOf, sha256, type Identity } from "./island.ts";
import {
  issueDeviceCert,
  pairingCode,
  pairingNonce,
  signRevocations,
  signText,
  verifyDeviceCert,
  verifyText,
  type Role,
  type SignedDeviceCert,
  type SignedRevocations,
} from "./device-link.ts";

/** Largest save a device may write, in bytes of JSON. */
export const SAVE_LIMIT = 4 * 1024 * 1024;
/** How far a request's clock may be from the home's. */
export const CLOCK_SKEW_MS = 2 * 60_000;
/** Longest a long poll is held open. */
export const MAX_WAIT_MS = 25_000;
const PAIR_TTL_MS = 5 * 60_000;
const MAX_PENDING = 8;
const ONLINE_MS = 30_000;
const DEFAULT_ROLES: Role[] = ["host", "display", "input"];

const enc = new TextEncoder();

export type SavedState = { version: number; by: string; at: number; payload: unknown };

/** Everything the home keeps between runs. Holds the owner's private key: keep it private. */
export type HomeFile = {
  forge: "link-home";
  version: 1;
  name: string;
  owner: { publicKey: string; pkcs8: string };
  devices: SignedDeviceCert[];
  revocations: SignedRevocations | null;
  save: SavedState | null;
};

export type HomeInfo = { forge: "link-home"; version: 1; name: string; ownerId: string; ownerKey: string };

export type LinkRequest = { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: string };
export type LinkResponse = { status: number; body: unknown };

/** What the owner sees on the home when a device asks to pair. */
export type PairRequest = { pairId: string; name: string; deviceId: string; code: string };

/** A save as the home reports it. payload is present only when it is newer than what the device has. */
export type SaveReply = {
  version: number;
  by: string;
  byName: string;
  at: number;
  lead: string | null;
  hash: string;
  signature: string;
  payload?: unknown;
};

export type DeviceRow = { deviceId: string; name: string; roles: Role[]; issuedAt: number; online: boolean; lead: boolean };

type Pending = {
  pairId: string;
  deviceKey: string;
  deviceId: string;
  name: string;
  nonce: string;
  code: string;
  createdAt: number;
  status: "waiting" | "approved" | "refused";
  cert?: SignedDeviceCert;
};

const fail = (status: number, reason: string): LinkResponse => ({ status, body: { ok: false, reason } });

function header(req: LinkRequest, name: string): string {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export async function hashPayload(payload: unknown): Promise<string> {
  return sha256(enc.encode(canonical(payload ?? null)));
}

/** The text the owner key signs for a save reply (everything but the payload, which the hash covers). */
export function saveReplyText(reply: Omit<SaveReply, "signature" | "payload">): string {
  return `save|${canonical({ version: reply.version, by: reply.by, byName: reply.byName, at: reply.at, lead: reply.lead, hash: reply.hash })}`;
}

/** The text a device signs for one request. path includes the query string, exactly as sent. */
export async function requestText(method: string, path: string, time: string, body: string): Promise<string> {
  return `link|${method.toUpperCase()}|${path}|${time}|${await sha256(enc.encode(body))}`;
}

async function importOwner(owner: HomeFile["owner"]): Promise<Identity> {
  const der = fromB64url(owner.pkcs8);
  if (!der) throw new Error("the home's owner key is damaged");
  const privateKey = await crypto.subtle.importKey("pkcs8", der as BufferSource, { name: "Ed25519" }, true, ["sign"]);
  return { publicKey: owner.publicKey, id: await idOf(owner.publicKey), privateKey };
}

export class LinkHome {
  /** Called when a device asks to pair; the owner compares codes and calls approve() or refuse(). */
  onPair: ((request: PairRequest) => void) | null = null;
  now: () => number = Date.now;

  private pending = new Map<string, Pending>();
  private seen = new Map<string, number>();
  private lastSeen = new Map<string, number>();
  private lead: string | null = null;
  private waiters = new Set<() => void>();
  private closed = false;
  private saveHash: string | null = null;

  private file: HomeFile;
  private owner: Identity;
  private persist: (file: HomeFile) => void;

  private constructor(file: HomeFile, owner: Identity, persist: (file: HomeFile) => void) {
    this.file = file;
    this.owner = owner;
    this.persist = persist;
  }

  /** Open an existing home, or make a new one (with a new owner key) when file is null. */
  static async open(file: HomeFile | null, options: { name?: string; persist?: (file: HomeFile) => void } = {}): Promise<LinkHome> {
    const persist = options.persist ?? (() => {});
    if (file) {
      if (file.forge !== "link-home" || file.version !== 1) throw new Error("not a Forge link home file");
      return new LinkHome(file, await importOwner(file.owner), persist);
    }
    const owner = await generateIdentity();
    const pkcs8 = b64url(new Uint8Array(await crypto.subtle.exportKey("pkcs8", owner.privateKey)));
    const fresh: HomeFile = {
      forge: "link-home",
      version: 1,
      name: (options.name ?? "Forge home").slice(0, 60) || "Forge home",
      owner: { publicKey: owner.publicKey, pkcs8 },
      devices: [],
      revocations: null,
      save: null,
    };
    persist(fresh);
    return new LinkHome(fresh, owner, persist);
  }

  get info(): HomeInfo {
    return { forge: "link-home", version: 1, name: this.file.name, ownerId: this.owner.id, ownerKey: this.owner.publicKey };
  }

  devices(): DeviceRow[] {
    const now = this.now();
    return this.file.devices.map(({ cert }) => ({
      deviceId: cert.deviceId,
      name: cert.name,
      roles: cert.roles,
      issuedAt: cert.issuedAt,
      online: now - (this.lastSeen.get(cert.deviceId) ?? -Infinity) < ONLINE_MS,
      lead: this.lead === cert.deviceId,
    }));
  }

  /** Requests waiting for the owner's answer. */
  waiting(): PairRequest[] {
    this.prunePending();
    return [...this.pending.values()]
      .filter((p) => p.status === "waiting")
      .map((p) => ({ pairId: p.pairId, name: p.name, deviceId: p.deviceId, code: p.code }));
  }

  async approve(pairId: string, roles: Role[] = DEFAULT_ROLES): Promise<boolean> {
    this.prunePending();
    const p = this.pending.get(pairId);
    if (!p || p.status !== "waiting") return false;
    const cert = await issueDeviceCert(this.owner, { publicKey: p.deviceKey, name: p.name, roles }, { now: this.now() });
    // Pairing again (a reinstalled app, say) replaces the old certificate and lifts an old removal.
    this.file.devices = [...this.file.devices.filter((d) => d.cert.deviceId !== p.deviceId), cert];
    if (this.file.revocations?.list.revoked.includes(p.deviceId)) {
      const list = this.file.revocations.list;
      this.file.revocations = await signRevocations(this.owner, { ...list, version: list.version + 1, revoked: list.revoked.filter((id) => id !== p.deviceId) });
    }
    this.persist(this.file);
    p.status = "approved";
    p.cert = cert;
    this.wake();
    return true;
  }

  refuse(pairId: string): boolean {
    const p = this.pending.get(pairId);
    if (!p || p.status !== "waiting") return false;
    p.status = "refused";
    this.wake();
    return true;
  }

  /** Take a device off this home. Its certificate stops working at once, here and on every device. */
  async remove(deviceId: string): Promise<boolean> {
    if (!this.file.devices.some((d) => d.cert.deviceId === deviceId)) return false;
    const list = this.file.revocations?.list ?? { ownerId: this.owner.id, version: 0, revoked: [] };
    this.file.revocations = await signRevocations(this.owner, {
      ownerId: this.owner.id,
      version: list.version + 1,
      revoked: [...new Set([...list.revoked, deviceId])],
    });
    this.file.devices = this.file.devices.filter((d) => d.cert.deviceId !== deviceId);
    if (this.lead === deviceId) this.lead = null;
    this.persist(this.file);
    this.wake();
    return true;
  }

  /** Let every waiting long poll go (the server is stopping). */
  close() {
    this.closed = true;
    this.wake();
  }

  async handle(req: LinkRequest): Promise<LinkResponse> {
    const url = new URL(req.path, "http://home");
    const method = req.method.toUpperCase();
    const route = url.pathname;

    if (method === "GET" && route === "/link") return { status: 200, body: this.info };
    if (method === "POST" && route === "/link/pair") return this.pairStart(req.body);
    if (method === "GET" && route.startsWith("/link/pair/")) return this.pairStatus(route.slice("/link/pair/".length), url.searchParams);

    if (!route.startsWith("/link/")) return fail(404, "not found");
    const auth = await this.authenticate(req, method);
    if (!auth.ok) return fail(auth.status, auth.reason);
    const me = auth.deviceId;

    if (method === "GET" && route === "/link/save") {
      const since = Number(url.searchParams.get("since") ?? "-1");
      const waitMs = Math.min(MAX_WAIT_MS, Math.max(0, Number(url.searchParams.get("wait") ?? "0") || 0));
      const lead = this.lead;
      await this.wait(waitMs, () => this.version() > since || this.lead !== lead);
      this.lastSeen.set(me, this.now());
      return { status: 200, body: await this.reply(since) };
    }
    if (method === "PUT" && route === "/link/save") return this.write(me, req.body);
    if (method === "POST" && route === "/link/lead") {
      let since = -1;
      try {
        since = Number((JSON.parse(req.body || "{}") as { since?: unknown }).since ?? -1);
      } catch {
        return fail(400, "body is not JSON");
      }
      if (this.lead !== me) {
        this.lead = me;
        this.wake();
      }
      return { status: 200, body: await this.reply(Number.isFinite(since) ? since : -1) };
    }
    if (method === "GET" && route === "/link/devices") return { status: 200, body: { devices: this.devices(), revocations: this.file.revocations } };
    if (method === "POST" && route === "/link/remove") {
      let target = "";
      try {
        target = String((JSON.parse(req.body || "{}") as { deviceId?: unknown }).deviceId ?? "");
      } catch {
        return fail(400, "body is not JSON");
      }
      return (await this.remove(target)) ? { status: 200, body: { ok: true } } : fail(404, "no such device");
    }
    return fail(404, "not found");
  }

  // ---------- pairing ----------

  private prunePending() {
    const now = this.now();
    for (const [id, p] of this.pending) if (now - p.createdAt > PAIR_TTL_MS) this.pending.delete(id);
  }

  private async pairStart(body: string): Promise<LinkResponse> {
    let ask: { deviceKey?: unknown; name?: unknown };
    try {
      ask = JSON.parse(body) as typeof ask;
    } catch {
      return fail(400, "body is not JSON");
    }
    const deviceKey = typeof ask?.deviceKey === "string" ? ask.deviceKey : "";
    const raw = fromB64url(deviceKey);
    const name = typeof ask?.name === "string" ? ask.name.trim().slice(0, 60) : "";
    if (!raw || raw.length !== 32) return fail(400, "deviceKey must be an Ed25519 public key");
    if (!name) return fail(400, "a device needs a name");
    this.prunePending();
    if ([...this.pending.values()].filter((p) => p.status === "waiting").length >= MAX_PENDING) {
      return fail(429, "too many devices are waiting to pair; answer or let them expire first");
    }
    const nonce = pairingNonce();
    const pending: Pending = {
      pairId: b64url(crypto.getRandomValues(new Uint8Array(12))),
      deviceKey,
      deviceId: await idOf(deviceKey),
      name,
      nonce,
      code: await pairingCode(nonce, deviceKey, this.owner.publicKey),
      createdAt: this.now(),
      status: "waiting",
    };
    this.pending.set(pending.pairId, pending);
    this.onPair?.({ pairId: pending.pairId, name, deviceId: pending.deviceId, code: pending.code });
    return { status: 200, body: { pairId: pending.pairId, nonce, ownerKey: this.owner.publicKey, ownerId: this.owner.id, name: this.file.name } };
  }

  private async pairStatus(pairId: string, query: URLSearchParams): Promise<LinkResponse> {
    this.prunePending();
    const p = this.pending.get(pairId);
    if (!p) return fail(404, "no such pairing request (it may have expired; start again)");
    const waitMs = Math.min(MAX_WAIT_MS, Math.max(0, Number(query.get("wait") ?? "0") || 0));
    await this.wait(waitMs, () => p.status !== "waiting");
    if (p.status === "approved") {
      this.pending.delete(pairId);
      return { status: 200, body: { status: "approved", cert: p.cert } };
    }
    if (p.status === "refused") {
      this.pending.delete(pairId);
      return { status: 200, body: { status: "refused" } };
    }
    return { status: 200, body: { status: "waiting" } };
  }

  // ---------- signed requests ----------

  private async authenticate(req: LinkRequest, method: string): Promise<{ ok: true; deviceId: string } | { ok: false; status: number; reason: string }> {
    const deviceId = header(req, "x-forge-device");
    const time = header(req, "x-forge-time");
    const signature = header(req, "x-forge-sig");
    if (!deviceId || !time || !signature) return { ok: false, status: 401, reason: "unsigned request" };
    const now = this.now();
    const at = Number(time);
    if (!Number.isFinite(at) || Math.abs(now - at) > CLOCK_SKEW_MS) {
      return { ok: false, status: 401, reason: "this device's clock is more than two minutes from the home's; set both to automatic time" };
    }
    const signed = this.file.devices.find((d) => d.cert.deviceId === deviceId);
    if (!signed) {
      const removed = this.file.revocations?.list.revoked.includes(deviceId);
      return { ok: false, status: 403, reason: removed ? "this device was removed; pair it again to rejoin" : "this device is not linked to this home; pair it first" };
    }
    const checked = await verifyDeviceCert(signed, { ownerId: this.owner.id, now, revoked: this.file.revocations?.list ?? null });
    if (!checked.ok) return { ok: false, status: 403, reason: checked.reason };
    if (!(await verifyText(checked.cert.deviceKey, await requestText(method, req.path, time, req.body), signature))) {
      return { ok: false, status: 401, reason: "request signature is invalid" };
    }
    for (const [sig, until] of this.seen) if (until < now) this.seen.delete(sig);
    if (this.seen.has(signature)) return { ok: false, status: 401, reason: "request was replayed" };
    this.seen.set(signature, at + CLOCK_SKEW_MS);
    this.lastSeen.set(deviceId, now);
    return { ok: true, deviceId };
  }

  // ---------- the save ----------

  private version(): number {
    return this.file.save?.version ?? 0;
  }

  private async reply(since: number): Promise<SaveReply> {
    const save = this.file.save;
    this.saveHash ??= await hashPayload(save?.payload ?? null);
    const by = save?.by ?? "";
    const base = {
      version: save?.version ?? 0,
      by,
      byName: this.file.devices.find((d) => d.cert.deviceId === by)?.cert.name ?? "",
      at: save?.at ?? 0,
      lead: this.lead,
      hash: this.saveHash,
    };
    const signature = await signText(this.owner.privateKey, saveReplyText(base));
    return save && save.version > since ? { ...base, signature, payload: save.payload } : { ...base, signature };
  }

  private async write(me: string, body: string): Promise<LinkResponse> {
    if (body.length > SAVE_LIMIT) return fail(413, `a save is limited to ${SAVE_LIMIT / 1024 / 1024} MB`);
    let put: { base?: unknown; payload?: unknown };
    try {
      put = JSON.parse(body) as typeof put;
    } catch {
      return fail(400, "body is not JSON");
    }
    if (!Number.isInteger(put?.base) || !put.payload || typeof put.payload !== "object") return fail(400, "a save needs { base, payload }");
    if (put.base !== this.version()) return { status: 409, body: { ok: false, reason: "a newer save arrived first", save: await this.reply(-1) } };
    this.file.save = { version: this.version() + 1, by: me, at: this.now(), payload: put.payload };
    this.saveHash = await hashPayload(put.payload);
    if (this.lead === null) this.lead = me;
    this.persist(this.file);
    this.wake();
    return { status: 200, body: await this.reply(this.file.save.version) };
  }

  // ---------- long polls ----------

  private wake() {
    for (const fn of [...this.waiters]) fn();
  }

  private wait(ms: number, ready: () => boolean): Promise<void> {
    if (ms <= 0 || ready() || this.closed) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve();
      };
      const check = () => {
        if (ready() || this.closed) done();
      };
      const timer = setTimeout(done, ms);
      this.waiters.add(check);
    });
  }
}
