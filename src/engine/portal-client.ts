/**
 * Visitor side of a portal. Turns a forge:// address into an HTTP(S) base, fetches the signed
 * manifest, runs the handshake, and reports the island as offline when its host is gone.
 */
import {
  checkWelcome,
  makeHello,
  parseAddress,
  verifyManifest,
  type Capability,
  type Identity,
  type SignedManifest,
  type Welcome,
} from "./island.ts";
import { verifyEntry, type IslandEntry, type SyncReply, type View } from "./island-content.ts";
import type { MoveInput } from "./prediction.ts";

export type PortalResult =
  | { status: "open"; host: SignedManifest; grant: Capability[]; session: string | null }
  | { status: "offline"; reason: string }
  | { status: "refused"; reason: string };

export function httpBase(address: string, secure = false): string | null {
  const parsed = parseAddress(address);
  if (!parsed) return null;
  return `${secure ? "https" : "http"}://${parsed.host}${parsed.port === null ? "" : `:${parsed.port}`}`;
}

async function fetchWithin(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function openPortal(
  from: SignedManifest,
  identity: Identity,
  to: string,
  wants: Capability[],
  options: { secure?: boolean; timeoutMs?: number } = {},
): Promise<PortalResult> {
  const base = httpBase(to, options.secure);
  if (!base) return { status: "refused", reason: "bad address" };
  const timeout = options.timeoutMs ?? 4000;

  let host: SignedManifest;
  try {
    const res = await fetchWithin(`${base}/.well-known/forge-island`, {}, timeout);
    if (!res.ok) return { status: "offline", reason: `host answered ${res.status}` };
    host = (await res.json()) as SignedManifest;
  } catch {
    return { status: "offline", reason: "host is unreachable" };
  }
  const seen = await verifyManifest(host);
  if (!seen.ok) return { status: "refused", reason: seen.reason };

  const hello = await makeHello(from, identity, to, wants);
  let welcome: Welcome;
  let session: string | null = null;
  try {
    const res = await fetchWithin(
      `${base}/portal/hello`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(hello) },
      timeout,
    );
    const body = (await res.json()) as (Welcome & { session?: string }) | { ok: false; reason: string };
    if (!res.ok || !("type" in body)) return { status: "refused", reason: "reason" in body ? body.reason : `host answered ${res.status}` };
    welcome = body;
    session = typeof body.session === "string" ? body.session : null;
  } catch {
    return { status: "offline", reason: "host went away during the handshake" };
  }

  const checked = await checkWelcome(hello, welcome);
  if (!checked.ok) return { status: "refused", reason: checked.reason };
  if (welcome.host.manifest.id !== host.manifest.id) return { status: "refused", reason: "handshake answered by a different island than the manifest" };
  return { status: "open", host, grant: checked.grant, session };
}

export type Visit =
  | { status: "inside"; host: SignedManifest; grant: Capability[]; session: string; base: string; entry: IslandEntry }
  | { status: "offline"; reason: string }
  | { status: "refused"; reason: string };

/**
 * Walk through a portal: handshake, then download the island's starting world and check it against
 * the hash in the host's signed manifest before showing any of it.
 */
export async function enterIsland(
  from: SignedManifest,
  identity: Identity,
  to: string,
  wants: Capability[] = ["render", "input"],
  options: { secure?: boolean; timeoutMs?: number } = {},
): Promise<Visit> {
  const opened = await openPortal(from, identity, to, wants, options);
  if (opened.status !== "open") return opened;
  if (!opened.session) return { status: "refused", reason: "host did not open a session" };
  if (!opened.grant.includes("render")) return { status: "refused", reason: "host did not grant render" };
  const base = httpBase(to, options.secure)!;
  let bytes: Uint8Array;
  try {
    const res = await fetchWithin(`${base}/island/content`, { headers: { authorization: `Forge ${opened.session}` } }, options.timeoutMs ?? 8000);
    if (!res.ok) return { status: "refused", reason: `content answered ${res.status}` };
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return { status: "offline", reason: "host went away while sending its world" };
  }
  const checked = await verifyEntry(opened.host.manifest, bytes);
  if (!checked.ok) return { status: "refused", reason: checked.reason };
  return { status: "inside", host: opened.host, grant: opened.grant, session: opened.session, base, entry: checked.entry };
}

/** One live update from the host: send where we look, get back what changed in view. */
export async function syncIsland(base: string, session: string, view: View, timeoutMs = 4000, inputs?: MoveInput[]): Promise<SyncReply | { error: string }> {
  try {
    const res = await fetchWithin(
      `${base}/island/sync`,
      { method: "POST", headers: { "content-type": "application/json", authorization: `Forge ${session}` }, body: JSON.stringify(inputs ? { view, inputs } : { view }) },
      timeoutMs,
    );
    const body = (await res.json()) as SyncReply | { reason: string };
    if (!res.ok || !("tick" in body)) return { error: "reason" in body ? body.reason : `host answered ${res.status}` };
    return body;
  } catch {
    return { error: "host is unreachable" };
  }
}
