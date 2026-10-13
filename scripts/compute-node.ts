/**
 * A compute device for pooled inference. Holds one slice of a model's layers and runs activations
 * through it. It refuses any slice larger than the memory it was given.
 *
 *   node --experimental-strip-types scripts/compute-node.ts --id laptop --port 7600 --memory-mb 512 --speed 1
 *
 *   GET  /info      { id, memoryBytes, speed }
 *   POST /load      { model, from, to }  -> builds layers [from, to) locally
 *   POST /forward   { x: base64 f32 }    -> { y: base64 f32 }
 *
 * Weights never cross the link: the device builds (or, for a real model, reads from its own copy
 * of the model file) only the layers it was assigned.
 */
import { createServer, type IncomingMessage } from "node:http";
import { b64ToF32, f32ToB64, layerBytes, makeLayer, runLayers, type Layer, type ModelSpec } from "../src/engine/pooled.ts";

export type ComputeOptions = { id: string; port: number; memoryBytes: number; speed: number };

function body(req: IncomingMessage, limit = 4 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function startComputeNode(options: ComputeOptions) {
  let layers: Layer[] = [];
  let loaded: { model: string; from: number; to: number } | null = null;
  const server = createServer(async (req, res) => {
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.method === "GET" && req.url === "/info") return send(200, { id: options.id, memoryBytes: options.memoryBytes, speed: options.speed, loaded });
      if (req.method === "POST" && req.url === "/load") {
        const { model, from, to } = JSON.parse(await body(req)) as { model: ModelSpec; from: number; to: number };
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > model.layers || from >= to) return send(400, { reason: "bad layer range" });
        let need = 0;
        for (let i = from; i < to; i += 1) need += layerBytes(model, i);
        if (need > options.memoryBytes) return send(507, { reason: `slice needs ${need} bytes; this device has ${options.memoryBytes}` });
        layers = [];
        for (let i = from; i < to; i += 1) layers.push(makeLayer(model, i));
        loaded = { model: model.id, from, to };
        return send(200, { ok: true, bytes: need });
      }
      if (req.method === "POST" && req.url === "/forward") {
        if (!layers.length) return send(409, { reason: "no slice loaded" });
        const { x } = JSON.parse(await body(req)) as { x: string };
        return send(200, { y: f32ToB64(runLayers(layers, b64ToF32(x))) });
      }
      send(404, { reason: "not found" });
    } catch (error) {
      send(500, { reason: String(error) });
    }
  });
  await new Promise<void>((resolve) => server.listen(options.port, resolve));
  return { server, base: `http://localhost:${options.port}` };
}

if (process.argv[1]?.endsWith("compute-node.ts")) {
  const get = (flag: string, fallback: string) => {
    const at = process.argv.indexOf(flag);
    return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
  };
  void startComputeNode({
    id: get("--id", "device"),
    port: Number(get("--port", "7600")),
    memoryBytes: Number(get("--memory-mb", "512")) * 1024 * 1024,
    speed: Number(get("--speed", "1")),
  }).then(({ base }) => console.log(`compute device online at ${base}`));
}
