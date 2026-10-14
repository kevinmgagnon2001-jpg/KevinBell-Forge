/**
 * A self-hosted island node. Run it and your island is on the network; stop it and it is gone.
 *
 *   node --experimental-strip-types scripts/island-node.ts --name "My Island" --slug my-island --port 7420
 *
 * Endpoints
 *   GET  /.well-known/forge-island   the signed manifest (who this island is)
 *   POST /portal/hello               a visitor's signed hello; answers with a signed welcome, or 403
 *   GET  /health                     liveness for portal probes
 *   GET  /island/content             the starting world (needs a session with "render"); its hash is in the manifest
 *   POST /island/sync                { view, inputs? } -> what this visitor can see, changes only (needs "render");
 *                                    with inputs (needs "input") the host walks the visitor and says where
 *   POST /island/carry               { mechanic } (needs "carry"): the visitor moves with its own mechanic
 *                                    (checked first) for the rest of the visit; { mechanic: null } stops
 *   GET  /island/mechanics           the mechanics in use here (needs "render"), for visitors to keep
 *
 * Mechanics visitors bring are saved under <dir>/mechanics/ as they arrive. To make one this island's
 * own (visitors who carry none move with it): --mechanic <dir>/mechanics/<file>.json
 *
 * Options: --world world.json (a saved Forge world; default is the lab room), --tick 100 (simulate every N ms).
 *
 * The identity key lives in .forge/identity.json where you run it. Keep it private:
 * whoever holds it is this island.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_RULES, PACKAGE_LIMIT, type MechanicPackage } from "../src/engine/mechanic.ts";
import { join } from "node:path";
import { encodeEntry, entryFromWorld, entryInfo, IslandHost, type View } from "../src/engine/island-content.ts";
import { labWorld, stepWorld } from "../src/engine/manifold.ts";
import type { World } from "../src/engine/types.ts";
import type { MoveInput } from "../src/engine/prediction.ts";
import {
  answerHello,
  b64url,
  buildManifest,
  CAPABILITIES,
  fromB64url,
  idOf,
  signManifest,
  type Capability,
  type Hello,
  type Identity,
  type Policy,
  type SignedManifest,
} from "../src/engine/island.ts";

export type NodeOptions = {
  name: string;
  slug: string;
  host: string;
  port: number;
  allow: Capability[];
  dir: string;
  world?: World;
  worldFile?: string;
  tickMs?: number;
  /** A mechanic package file: how visitors who carry none move here. */
  mechanicFile?: string;
  maxSpeed?: number;
  /** Save mechanics visitors carry in under <dir>/mechanics (default on). */
  keepCarried?: boolean;
};

export function parseArgs(argv: string[]): NodeOptions {
  const get = (flag: string, fallback: string) => {
    const at = argv.indexOf(flag);
    return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
  };
  const allow = get("--allow", "render,input,audio,portal,carry")
    .split(",")
    .filter((item): item is Capability => (CAPABILITIES as readonly string[]).includes(item));
  return {
    name: get("--name", "Island"),
    slug: get("--slug", "island"),
    host: get("--host", "localhost"),
    port: Number(get("--port", "7420")),
    allow,
    dir: get("--dir", ".forge"),
    worldFile: get("--world", "") || undefined,
    tickMs: Number(get("--tick", "0")) || undefined,
    mechanicFile: get("--mechanic", "") || undefined,
    maxSpeed: Number(get("--max-speed", "0")) || undefined,
  };
}

async function loadIdentity(dir: string): Promise<Identity> {
  const file = join(dir, "identity.json");
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, "utf8")) as { publicKey: string; pkcs8: string };
    const raw = fromB64url(saved.pkcs8);
    if (!raw) throw new Error("identity.json is damaged");
    const privateKey = await crypto.subtle.importKey("pkcs8", raw as BufferSource, { name: "Ed25519" }, true, ["sign"]);
    return { publicKey: saved.publicKey, id: await idOf(saved.publicKey), privateKey };
  }
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const pkcs8 = b64url(new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)));
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ publicKey, pkcs8 }), { mode: 0o600 });
  return { publicKey, id: await idOf(publicKey), privateKey: pair.privateKey };
}

const LIMIT = 64 * 1024;

function readBody(req: IncomingMessage, limit = LIMIT): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
}

export async function startIsland(options: NodeOptions) {
  const identity = await loadIdentity(options.dir);
  const address = `forge://${options.host}:${options.port}/${options.slug}`;
  const world: World = options.world ?? (options.worldFile ? (JSON.parse(readFileSync(options.worldFile, "utf8")) as World) : labWorld());
  const entryBytes = encodeEntry(entryFromWorld(world));
  const manifest = await buildManifest(identity, {
    name: options.name,
    address,
    entry: await entryInfo(entryBytes),
    wants: ["render", "input"],
  });
  const host = new IslandHost(world, undefined, { ...DEFAULT_RULES, ...(options.maxSpeed ? { maxSpeed: options.maxSpeed } : {}) });
  if (options.mechanicFile) {
    const adopted = await host.adopt(JSON.parse(readFileSync(options.mechanicFile, "utf8")));
    if (!adopted.ok) throw new Error(`${options.mechanicFile}: ${adopted.reason}`);
  }
  if (options.keepCarried !== false) {
    host.onCarried = (pkg: MechanicPackage) => {
      const dir = join(options.dir, "mechanics");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${pkg.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mechanic"}-${pkg.hash.slice(0, 8)}.json`);
      if (!existsSync(file)) writeFileSync(file, JSON.stringify(pkg, null, 2));
      if (!process.argv[1]?.includes(".test.")) console.log(`a visitor carried in "${pkg.name}" by ${pkg.author.name || "someone"}; kept a copy: ${file}`);
    };
  }
  const timer = options.tickMs
    ? setInterval(() => host.setWorld(stepWorld(host.world, 1)), options.tickMs)
    : null;
  const bearer = (req: IncomingMessage) => /^Forge ([0-9a-f]{36})$/.exec(req.headers.authorization ?? "")?.[1] ?? null;
  const signed: SignedManifest = await signManifest(manifest, identity);
  const policy: Policy = { allow: options.allow };

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST" });
        res.end();
        return;
      }
      if (req.method === "GET" && req.url === "/.well-known/forge-island") return send(res, 200, signed);
      if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true, id: identity.id });
      if (req.method === "POST" && req.url === "/portal/hello") {
        let hello: Hello;
        try {
          hello = JSON.parse(await readBody(req)) as Hello;
        } catch {
          return send(res, 400, { ok: false, reason: "body is not JSON or is too large" });
        }
        const answer = await answerHello(hello, signed, identity, policy);
        if (!answer.ok) return send(res, 403, answer);
        const session = host.open(hello.from.manifest.id, answer.welcome.grant);
        return send(res, 200, { ...answer.welcome, session });
      }
      if (req.method === "GET" && req.url === "/island/content") {
        const s = host.session(bearer(req));
        if (!s) return send(res, 401, { ok: false, reason: "no session (handshake again)" });
        if (!s.grant.includes("render")) return send(res, 403, { ok: false, reason: "render was not granted" });
        res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
        res.end(entryBytes);
        return;
      }
      if (req.method === "POST" && req.url === "/island/sync") {
        let body: { view: View; inputs?: MoveInput[] };
        try {
          body = JSON.parse(await readBody(req)) as { view: View; inputs?: MoveInput[] };
        } catch {
          return send(res, 400, { ok: false, reason: "body is not JSON or is too large" });
        }
        const reply = host.sync(bearer(req) ?? "", body.view, body.inputs);
        return "error" in reply ? send(res, reply.status, { ok: false, reason: reply.error }) : send(res, 200, reply);
      }
      if (req.method === "POST" && req.url === "/island/carry") {
        let body: { mechanic?: unknown };
        try {
          body = JSON.parse(await readBody(req, PACKAGE_LIMIT + 1024)) as { mechanic?: unknown };
        } catch {
          return send(res, 400, { ok: false, reason: "body is not JSON or is too large" });
        }
        const reply = await host.carry(bearer(req) ?? "", body?.mechanic ?? null);
        return "error" in reply ? send(res, reply.status, { ok: false, reason: reply.error }) : send(res, 200, reply);
      }
      if (req.method === "GET" && req.url === "/island/mechanics") {
        const s = host.session(bearer(req));
        if (!s) return send(res, 401, { ok: false, reason: "no session (handshake again)" });
        if (!s.grant.includes("render")) return send(res, 403, { ok: false, reason: "render was not granted" });
        return send(res, 200, { mechanics: host.mechanics() });
      }
      send(res, 404, { ok: false, reason: "not found" });
    } catch {
      send(res, 500, { ok: false, reason: "internal error" });
    }
  });
  server.on("close", () => {
    if (timer) clearInterval(timer);
  });
  await new Promise<void>((resolve) => server.listen(options.port, resolve));
  return { server, identity, signed, address, host };
}

if (process.argv[1]?.endsWith("island-node.ts")) {
  const options = parseArgs(process.argv.slice(2));
  void startIsland(options).then(({ address, identity }) => {
    console.log(`island online  ${address}`);
    console.log(`island id      ${identity.id}`);
    console.log("stop this process and the island leaves the network");
  });
}
