/**
 * A device's side of linking (link-home.ts has the other side).
 *
 *   pairWithHome   ask a home to pair; returns the six-digit code to compare with the home's screen
 *   awaitApproval  wait for the owner's answer; checks the certificate before keeping it
 *   LinkSession    signed requests to a home this device is linked to; checks every save reply
 *                  against the owner key it paired with
 *   LinkSync       keeps a local save in step: follows the home's newest save, and while this device
 *                  is the one in use (the lead) writes its own changes back
 */
import { idOf, type Identity } from "./island.ts";
import { pairingCode, signText, verifyDeviceCert, verifyText, type SignedDeviceCert } from "./device-link.ts";
import { hashPayload, requestText, saveReplyText, type DeviceRow, type HomeInfo, type SaveReply } from "./link-home.ts";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** What a device remembers about its home after pairing. */
export type LinkConfig = { base: string; home: HomeInfo; cert: SignedDeviceCert };

export type PairStart = { pairId: string; code: string; home: HomeInfo; base: string };

const withinMs = async (fetcher: Fetcher, url: string, init: RequestInit, ms: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

/** "192.168.1.20", "192.168.1.20:7430" or "http://pc.local:7430" -> "http://192.168.1.20:7430". */
export function homeBase(text: string, defaultPort = 7430): string | null {
  const trimmed = text.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.pathname !== "/" || url.search || url.username) return null;
    return `${url.protocol}//${url.hostname.includes(":") ? `[${url.hostname.replace(/^\[|\]$/g, "")}]` : url.hostname}:${url.port || defaultPort}`;
  } catch {
    return null;
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`the home answered ${res.status} with something that is not JSON`);
  }
}

async function checkHomeInfo(info: HomeInfo): Promise<boolean> {
  return info?.forge === "link-home" && info.version === 1 && typeof info.ownerKey === "string" && (await idOf(info.ownerKey).catch(() => "")) === info.ownerId;
}

export async function pairWithHome(base: string, device: Identity, name: string, fetcher: Fetcher = fetch): Promise<PairStart> {
  const infoRes = await withinMs(fetcher, `${base}/link`, {}, 5000).catch(() => null);
  if (!infoRes) throw new Error(`nothing answered at ${base}. Is \`forge link\` running there, on the same network?`);
  const info = await readJson<HomeInfo>(infoRes);
  if (!infoRes.ok || !(await checkHomeInfo(info))) throw new Error(`${base} is not a Forge home`);
  const res = await withinMs(fetcher, `${base}/link/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceKey: device.publicKey, name }) }, 5000);
  const body = await readJson<{ pairId?: string; nonce?: string; ownerKey?: string; reason?: string }>(res);
  if (!res.ok || !body.pairId || !body.nonce) throw new Error(body.reason ?? `the home answered ${res.status}`);
  if (body.ownerKey !== info.ownerKey) throw new Error("the home changed its key during pairing; try again");
  return { pairId: body.pairId, code: await pairingCode(body.nonce, device.publicKey, info.ownerKey), home: info, base };
}

export type Approval = { status: "approved"; config: LinkConfig } | { status: "refused" } | { status: "waiting" };

export async function awaitApproval(start: PairStart, device: Identity, options: { waitMs?: number; fetcher?: Fetcher } = {}): Promise<Approval> {
  const fetcher = options.fetcher ?? fetch;
  const waitMs = options.waitMs ?? 20_000;
  const res = await withinMs(fetcher, `${start.base}/link/pair/${encodeURIComponent(start.pairId)}?wait=${waitMs}`, {}, waitMs + 5000);
  const body = await readJson<{ status?: string; cert?: SignedDeviceCert; reason?: string }>(res);
  if (!res.ok) throw new Error(body.reason ?? `the home answered ${res.status}`);
  if (body.status === "refused") return { status: "refused" };
  if (body.status !== "approved" || !body.cert) return { status: "waiting" };
  const checked = await verifyDeviceCert(body.cert, { ownerId: start.home.ownerId });
  if (!checked.ok) throw new Error(`the home sent a certificate that does not check out: ${checked.reason}`);
  if (checked.cert.deviceKey !== device.publicKey || checked.cert.ownerKey !== start.home.ownerKey) throw new Error("the home sent a certificate for another device");
  return { status: "approved", config: { base: start.base, home: start.home, cert: body.cert } };
}

export class LinkError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type PushResult = { ok: true; reply: SaveReply } | { ok: false; conflict: SaveReply };

export class LinkSession {
  readonly config: LinkConfig;
  private device: Identity;
  private fetcher: Fetcher;

  constructor(config: LinkConfig, device: Identity, fetcher: Fetcher = fetch) {
    this.config = config;
    this.device = device;
    this.fetcher = fetcher;
  }

  get deviceId(): string {
    return this.device.id;
  }

  private async request<T>(method: string, path: string, body = "", timeoutMs = 8000): Promise<T> {
    const time = String(Date.now());
    const signature = await signText(this.device.privateKey, await requestText(method, path, time, body));
    const headers: Record<string, string> = { "x-forge-device": this.device.id, "x-forge-time": time, "x-forge-sig": signature };
    if (body) headers["content-type"] = "application/json";
    const res = await withinMs(this.fetcher, `${this.config.base}${path}`, { method, headers, body: body || undefined }, timeoutMs);
    const parsed = await readJson<T & { reason?: string; save?: SaveReply }>(res);
    if (res.status === 409 && parsed.save) return { conflict: parsed.save } as T;
    if (!res.ok) throw new LinkError(parsed.reason ?? `the home answered ${res.status}`, res.status);
    return parsed;
  }

  /** A save reply counts only if the owner key this device paired with signed it, and its payload matches. */
  private async check(reply: SaveReply): Promise<SaveReply> {
    const { signature, payload, ...rest } = reply;
    if (!(await verifyText(this.config.home.ownerKey, saveReplyText(rest), signature))) throw new LinkError("a save reply was not signed by this device's home", 0);
    if (payload !== undefined && (await hashPayload(payload)) !== reply.hash) throw new LinkError("a save arrived damaged", 0);
    return reply;
  }

  /** The newest save if it is newer than since; otherwise waits up to waitMs for one. */
  async pull(since: number, waitMs = 0): Promise<SaveReply> {
    return this.check(await this.request<SaveReply>("GET", `/link/save?since=${since}&wait=${waitMs}`, "", waitMs + 8000));
  }

  async push(base: number, payload: unknown): Promise<PushResult> {
    const out = await this.request<SaveReply | { conflict: SaveReply }>("PUT", "/link/save", JSON.stringify({ base, payload }), 15_000);
    if ("conflict" in out) return { ok: false, conflict: await this.check(out.conflict) };
    return { ok: true, reply: await this.check(out) };
  }

  /** Make this device the one in use. Returns the newest save if it is newer than since. */
  async lead(since: number): Promise<SaveReply> {
    return this.check(await this.request<SaveReply>("POST", "/link/lead", JSON.stringify({ since })));
  }

  async devices(): Promise<DeviceRow[]> {
    return (await this.request<{ devices: DeviceRow[] }>("GET", "/link/devices")).devices;
  }

  async remove(deviceId: string): Promise<void> {
    await this.request("POST", "/link/remove", JSON.stringify({ deviceId }));
  }
}

export type SyncStatus =
  | { state: "linked"; lead: boolean; version: number }
  | { state: "offline"; reason: string }
  | { state: "removed"; reason: string };

export type SyncHooks = {
  /** The part of local state that is shared. */
  read: () => unknown;
  /** Replace the shared part of local state with a save from the home. */
  apply: (payload: unknown, from: { deviceId: string; name: string }) => void;
  status: (status: SyncStatus) => void;
  /** Something worth telling the person (a clash between two devices). */
  note?: (text: string) => void;
  /** Where this device stands with the home; keep it, and pass it back as options.initial after a restart. */
  synced?: (mark: SyncMark) => void;
};

/** The last save this device and its home agreed on: its version, and the hash of what it held. */
export type SyncMark = { version: number; hash: string };

export type SyncOptions = { waitMs?: number; pushDelayMs?: number; retryMs?: number; initial?: SyncMark | null };

/**
 * Keeps one device in step with its home. Call changed() whenever local state changes and touched()
 * when the person uses this device. Only the lead writes, so a device left open in another room never
 * fights the one in your hand.
 */
export class LinkSync {
  version = -1;
  leadId: string | null = null;
  private lastHash = "";
  private running = false;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pushing = false;
  private pushAgain = false;
  private claiming: Promise<void> | null = null;

  private session: LinkSession;
  private hooks: SyncHooks;
  private options: SyncOptions;

  constructor(session: LinkSession, hooks: SyncHooks, options: SyncOptions = {}) {
    this.session = session;
    this.hooks = hooks;
    this.options = options;
    // After a restart, carry on from the last save agreed with the home, so changes made here while the
    // home was away are recognised as changes (and written back) instead of being replaced.
    if (options.initial && Number.isInteger(options.initial.version) && options.initial.version >= 0) {
      this.version = options.initial.version;
      this.lastHash = options.initial.hash;
    }
  }

  get isLead(): boolean {
    return this.leadId === this.session.deviceId;
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop() {
    this.running = false;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
  }

  /** The person used this device: it becomes the lead (after taking any newer save). */
  touched(): Promise<void> {
    if (!this.running || this.isLead) return Promise.resolve();
    this.claiming ??= (async () => {
      try {
        // A follower's own state is only a preview (its clock may have run on). If it moved since the
        // last save, start from the home's save instead of writing the preview back.
        const drifted = (await hashPayload(this.hooks.read())) !== this.lastHash;
        await this.take(await this.session.lead(drifted ? -1 : this.version), drifted);
        this.report();
        this.changed();
      } catch (error) {
        this.trouble(error);
      } finally {
        this.claiming = null;
      }
    })();
    return this.claiming;
  }

  /** Local state changed. The lead writes it back shortly; a follower leaves it alone. */
  changed() {
    if (!this.running || this.version < 0) return;
    if (this.leadId !== null && !this.isLead) return;
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.flush();
    }, this.options.pushDelayMs ?? 400);
  }

  /** Write local changes now (if this device leads and something changed). */
  async flush(): Promise<void> {
    if (this.pushing) {
      this.pushAgain = true;
      return;
    }
    this.pushing = true;
    try {
      do {
        this.pushAgain = false;
        if (this.leadId !== null && !this.isLead) return;
        const payload = this.hooks.read();
        const hash = await hashPayload(payload);
        if (hash === this.lastHash) continue;
        const result = await this.session.push(this.version, payload);
        if (result.ok) {
          this.version = result.reply.version;
          this.leadId = result.reply.lead;
          this.lastHash = hash;
          this.hooks.synced?.({ version: this.version, hash });
        } else {
          const from = result.conflict.byName || "another device";
          await this.take(result.conflict);
          this.hooks.note?.(`${from} saved at the same moment as this device. Kept ${from}'s version.`);
        }
        this.report();
      } while (this.pushAgain && this.running);
    } catch (error) {
      this.trouble(error);
    } finally {
      this.pushing = false;
    }
  }

  private async take(reply: SaveReply, force = false) {
    this.leadId = reply.lead;
    if (reply.payload !== undefined && (reply.version > this.version || force)) {
      this.hooks.apply(reply.payload, { deviceId: reply.by, name: reply.byName });
      // Hash what local state became, so applying a save never echoes it back as a change.
      this.lastHash = await hashPayload(this.hooks.read());
    }
    this.version = Math.max(this.version, reply.version);
    this.hooks.synced?.({ version: this.version, hash: this.lastHash });
  }

  private report() {
    this.hooks.status({ state: "linked", lead: this.isLead, version: this.version });
  }

  private trouble(error: unknown) {
    if (error instanceof LinkError && error.status === 403) {
      this.hooks.status({ state: "removed", reason: error.message });
      this.stop();
      return;
    }
    this.hooks.status({ state: "offline", reason: error instanceof Error ? error.message : String(error) });
  }

  private async loop() {
    let first = true;
    let backoff = this.options.retryMs ?? 2000;
    while (this.running) {
      try {
        const reply = await this.session.pull(this.version, first ? 0 : (this.options.waitMs ?? 20_000));
        if (!this.running) return;
        if (first && reply.version === 0 && reply.payload === undefined) {
          // A new home with no save yet: this device's world becomes the first one.
          this.version = 0;
          this.leadId = reply.lead;
          this.report();
          void this.flush();
        } else {
          const unsent = first && this.lastHash !== "" && reply.payload !== undefined && (await hashPayload(this.hooks.read())) !== this.lastHash;
          await this.take(reply);
          if (unsent) {
            const from = reply.byName || "another device";
            this.hooks.note?.(`Changes made here while the home was out of reach were replaced by newer ones from ${from}.`);
          }
          this.report();
          // Changes made here while the home was out of reach go back once it answers again.
          if (this.isLead || this.leadId === null) this.changed();
        }
        first = false;
        backoff = this.options.retryMs ?? 2000;
      } catch (error) {
        if (!this.running) return;
        this.trouble(error);
        if (!this.running) return;
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff = Math.min(backoff * 2, 15_000);
      }
    }
  }
}
