/**
 * The home for your linked devices, on this machine. Run it on a PC that stays on; your phone, tablet
 * and other computers pair with it once and then share one save through it.
 *
 *   node --experimental-strip-types scripts/link-node.ts [--name "Kevin's PC"] [--port 7430] [--dir .forge]
 *   forge link [same options]
 *
 * When a device asks to pair, this terminal shows its name and a six-digit code. Allow it only if the
 * device shows the same code. The home lives in <dir>/link-home.json, which holds the owner key:
 * keep it private (whoever has it can add devices) and back it up (without it, every device pairs again).
 *
 * Endpoints (link-home.ts): GET /link, POST /link/pair, GET /link/pair/<id>, and the signed
 * GET|PUT /link/save, POST /link/lead, GET /link/devices, POST /link/remove.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { networkInterfaces, hostname } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { LinkHome, SAVE_LIMIT, type HomeFile, type PairRequest } from "../src/engine/link-home.ts";

export type LinkNodeOptions = { name: string; port: number; dir: string; host?: string };

export function parseLinkArgs(argv: string[]): LinkNodeOptions {
  const get = (flag: string, fallback: string) => {
    const at = argv.indexOf(flag);
    return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
  };
  return { name: get("--name", hostname() || "Forge home"), port: Number(get("--port", "7430")), dir: get("--dir", ".forge"), host: get("--host", "0.0.0.0") };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > SAVE_LIMIT + 1024) {
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

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-forge-device, x-forge-time, x-forge-sig",
  "access-control-allow-methods": "GET, POST, PUT",
  // Chrome asks before a page reaches a private address such as 192.168.x.x.
  "access-control-allow-private-network": "true",
  "access-control-max-age": "600",
};

/** Addresses other devices on the network can use to reach this one. */
export function lanAddresses(port: number): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.internal) continue;
      if (item.family === "IPv4") out.push(`${item.address}:${port}`);
    }
  }
  return out;
}

export async function startLinkHome(options: LinkNodeOptions): Promise<{ server: Server; home: LinkHome; port: number }> {
  const file = join(options.dir, "link-home.json");
  const persist = (data: HomeFile) => {
    mkdirSync(options.dir, { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    renameSync(tmp, file);
  };
  const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as HomeFile) : null;
  const home = await LinkHome.open(saved, { name: options.name, persist });

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS);
        res.end();
        return;
      }
      let body = "";
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(413, { "content-type": "application/json", ...CORS });
        res.end(JSON.stringify({ ok: false, reason: "body is too large" }));
        return;
      }
      const out = await home.handle({ method: req.method ?? "GET", path: req.url ?? "/", headers: req.headers, body });
      res.writeHead(out.status, { "content-type": "application/json", "cache-control": "no-store", ...CORS });
      res.end(JSON.stringify(out.body));
    } catch {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json", ...CORS });
      res.end(JSON.stringify({ ok: false, reason: "internal error" }));
    }
  });
  server.on("close", () => home.close());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host ?? "0.0.0.0", () => resolve());
  });
  const address = server.address();
  return { server, home, port: typeof address === "object" && address ? address.port : options.port };
}

/** Run in a terminal: print where to connect, then ask about each pairing request. */
export async function runLinkHome(options: LinkNodeOptions) {
  const { home, port } = await startLinkHome(options);
  const addresses = lanAddresses(port);
  console.log(`Forge home "${home.info.name}" is running.`);
  console.log(addresses.length ? `On each device, open Devices and enter one of:\n  ${addresses.join("\n  ")}` : `No network address found; devices on this machine can use localhost:${port}.`);
  console.log(`Linked devices: ${home.devices().length}. Stop this and devices keep working on their own, then catch up when it is back.`);

  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const queue: PairRequest[] = [];
  let asking = false;
  const next = () => {
    if (asking || !queue.length) return;
    const ask = queue.shift() as PairRequest;
    if (!home.waiting().some((p) => p.pairId === ask.pairId)) return next();
    if (!rl) {
      console.log(`Pair request from "${ask.name}" (code ${ask.code}) refused: run forge link in a terminal to answer it.`);
      home.refuse(ask.pairId);
      return next();
    }
    asking = true;
    rl.question(`\n"${ask.name}" wants to link. Its screen should show ${ask.code}.\nSame code? Type y to allow, anything else to refuse: `, (answer) => {
      void (async () => {
        if (answer.trim().toLowerCase().startsWith("y")) {
          console.log((await home.approve(ask.pairId)) ? `Linked "${ask.name}".` : "That request expired; start again on the device.");
        } else {
          home.refuse(ask.pairId);
          console.log(`Refused "${ask.name}".`);
        }
        asking = false;
        next();
      })();
    });
  };
  home.onPair = (request) => {
    queue.push(request);
    next();
  };
}

if (process.argv[1]?.endsWith("link-node.ts")) {
  void runLinkHome(parseLinkArgs(process.argv.slice(2))).catch((error) => {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}
