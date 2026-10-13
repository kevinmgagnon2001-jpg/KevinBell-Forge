/**
 * Pooled inference: one model split across linked devices by layers.
 *
 * Each compute device holds a contiguous slice of layers sized to its memory. The prompt's
 * activations pass from slice to slice over the device link; only those small vectors travel,
 * never the weights. The host plans the split from each device's free memory and speed, and
 * re-plans when a device joins or leaves. If the devices still online cannot hold the model,
 * the request fails with the numbers instead of hanging. Precedent: exo, petals, llama.cpp RPC.
 *
 * The model here is a deterministic toy (dense tanh layers, weights generated from a seed) so the
 * mechanics can be tested end to end. A real deployment swaps `runLayers` for a GGUF runtime's
 * per-layer forward; the planner, transport and failure handling stay the same.
 */

export type ModelSpec = { id: string; seed: number; width: number; layers: number; vocab: number };
export type DeviceInfo = { id: string; memoryBytes: number; speed: number; online: boolean };
export type Slice = { device: string; from: number; to: number }; // layers [from, to)
export type Plan = { ok: true; slices: Slice[] } | { ok: false; reason: string };

export const layerBytes = (m: ModelSpec, layer: number) => {
  const outWidth = layer === m.layers - 1 ? m.vocab : m.width;
  return (m.width * outWidth + outWidth) * 4;
};
export const modelBytes = (m: ModelSpec) => Array.from({ length: m.layers }, (_, i) => layerBytes(m, i)).reduce((a, b) => a + b, 0);

/**
 * Contiguous split. Faster devices get more layers, nobody gets more than fits, fewest hops first.
 * Devices are used in the order given (the host first), so the hop order is stable across re-plans.
 */
export function planSplit(model: ModelSpec, devices: DeviceInfo[]): Plan {
  const online = devices.filter((d) => d.online && d.memoryBytes > 0);
  const need = modelBytes(model);
  const have = online.reduce((a, d) => a + d.memoryBytes, 0);
  if (have < need) {
    return { ok: false, reason: `model needs ${(need / 1e6).toFixed(1)} MB; the ${online.length} online ${online.length === 1 ? "device has" : "devices have"} ${(have / 1e6).toFixed(1)} MB` };
  }
  // Target share by speed, then fill greedily without exceeding memory.
  const totalSpeed = online.reduce((a, d) => a + Math.max(d.speed, 0.01), 0);
  const slices: Slice[] = [];
  let layer = 0;
  for (const [i, d] of online.entries()) {
    if (layer >= model.layers) break;
    const remainingDevices = online.slice(i + 1);
    const restCapacity = remainingDevices.reduce((a, x) => a + x.memoryBytes, 0);
    const target = Math.round((model.layers * Math.max(d.speed, 0.01)) / totalSpeed);
    let used = 0;
    const start = layer;
    while (layer < model.layers) {
      const cost = layerBytes(model, layer);
      if (used + cost > d.memoryBytes) break;
      const left = Array.from({ length: model.layers - layer - 1 }, (_, k) => layerBytes(model, layer + 1 + k)).reduce((a, b) => a + b, 0);
      // Stop at the speed target only if the rest still fits on the remaining devices.
      if (layer - start >= target && left + cost <= restCapacity) break;
      used += cost;
      layer += 1;
    }
    if (layer > start) slices.push({ device: d.id, from: start, to: layer });
  }
  if (layer < model.layers) return { ok: false, reason: "layers do not fit contiguously on the online devices" };
  return { ok: true, slices };
}

// ---------- the toy model ----------

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

export type Layer = { w: Float32Array; b: Float32Array; out: number; final: boolean };

/** Weights for one layer, generated where they live. A real device reads its slice from the model file. */
export function makeLayer(model: ModelSpec, index: number): Layer {
  const out = index === model.layers - 1 ? model.vocab : model.width;
  const r = rng(model.seed * 1000003 + index * 7919);
  const scale = 1.5 / Math.sqrt(model.width);
  const w = new Float32Array(model.width * out);
  for (let i = 0; i < w.length; i += 1) w[i] = r() * scale;
  const b = new Float32Array(out);
  for (let i = 0; i < out; i += 1) b[i] = r() * 0.1;
  return { w, b, out, final: index === model.layers - 1 };
}

export function runLayers(layers: Layer[], input: Float32Array): Float32Array {
  let x = input;
  for (const layer of layers) {
    const y = new Float32Array(layer.out);
    for (let o = 0; o < layer.out; o += 1) {
      let acc = layer.b[o];
      const row = o * x.length;
      for (let i = 0; i < x.length; i += 1) acc = Math.fround(acc + Math.fround(layer.w[row + i] * x[i]));
      y[o] = layer.final ? acc : Math.fround(Math.tanh(acc));
    }
    x = y;
  }
  return x;
}

export const ALPHABET = " abcdefghijklmnopqrstuvwxyz.,!?'0123456789-:;()ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function embed(model: ModelSpec, text: string): Float32Array {
  const x = new Float32Array(model.width);
  for (const [pos, ch] of [...text.slice(-32)].entries()) {
    const code = ch.charCodeAt(0);
    for (let k = 0; k < 4; k += 1) {
      const slot = Math.imul(code * 31 + k * 977 + pos * 131, 2654435761) >>> 0;
      x[slot % model.width] += k % 2 ? 0.5 : -0.5;
    }
  }
  return x;
}

export function pickToken(model: ModelSpec, logits: Float32Array): string {
  let best = 0;
  for (let i = 1; i < logits.length; i += 1) if (logits[i] > logits[best]) best = i;
  return ALPHABET[best % ALPHABET.length];
}

// ---------- the coordinator ----------

/** How the host reaches a device's slice. HTTP between processes in the tests; any link in general. */
export type SliceLink = {
  load(model: ModelSpec, from: number, to: number): Promise<{ ok: true } | { ok: false; reason: string }>;
  forward(x: Float32Array): Promise<Float32Array>;
};

export type Generation = { ok: true; text: string; hops: number; activationBytes: number; plan: Slice[] } | { ok: false; reason: string; partial: string };

export class Pool {
  private plan: Slice[] = [];
  private model: ModelSpec;
  private devices: () => Promise<DeviceInfo[]>;
  private link: (deviceId: string) => SliceLink;
  constructor(model: ModelSpec, devices: () => Promise<DeviceInfo[]>, link: (deviceId: string) => SliceLink) {
    this.model = model;
    this.devices = devices;
    this.link = link;
  }

  get slices(): Slice[] {
    return this.plan;
  }

  async replan(): Promise<Plan> {
    const plan = planSplit(this.model, await this.devices());
    if (!plan.ok) {
      this.plan = [];
      return plan;
    }
    for (const s of plan.slices) {
      const loaded = await this.link(s.device).load(this.model, s.from, s.to).catch((error) => ({ ok: false as const, reason: String(error) }));
      if (!loaded.ok) return { ok: false, reason: `${s.device} could not load layers ${s.from}-${s.to - 1}: ${loaded.reason}` };
    }
    this.plan = plan.slices;
    return plan;
  }

  async generate(prompt: string, tokens: number): Promise<Generation> {
    let text = "";
    let hops = 0;
    let activationBytes = 0;
    if (!this.plan.length) {
      const plan = await this.replan();
      if (!plan.ok) return { ok: false, reason: plan.reason, partial: text };
    }
    for (let t = 0; t < tokens; t += 1) {
      let x = embed(this.model, prompt + text);
      let attempt = 0;
      for (let i = 0; i < this.plan.length; i += 1) {
        const slice = this.plan[i];
        try {
          activationBytes += x.byteLength;
          x = await this.link(slice.device).forward(x);
          activationBytes += x.byteLength;
          hops += 1;
        } catch {
          // A device left mid-answer. Re-plan over who is left and redo this token from the start.
          attempt += 1;
          const plan = await this.replan();
          if (!plan.ok || attempt > 2) return { ok: false, reason: plan.ok ? "devices keep dropping out" : plan.reason, partial: text };
          x = embed(this.model, prompt + text);
          i = -1;
        }
      }
      text += pickToken(this.model, x);
    }
    return { ok: true, text, hops, activationBytes, plan: this.plan };
  }
}

/** Single-machine reference, for checking that the pooled answer is the same answer. */
export function generateLocally(model: ModelSpec, prompt: string, tokens: number): string {
  const layers = Array.from({ length: model.layers }, (_, i) => makeLayer(model, i));
  let text = "";
  for (let t = 0; t < tokens; t += 1) text += pickToken(model, runLayers(layers, embed(model, prompt + text)));
  return text;
}

// ---------- wire format ----------

export function f32ToB64(x: Float32Array): string {
  const bytes = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function b64ToF32(text: string): Float32Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/** HTTP link to scripts/compute-node.ts. */
export function httpLink(base: string, timeoutMs = 5000): SliceLink {
  const call = async (path: string, body: unknown) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(json.reason ?? res.status));
      return json;
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    async load(model, from, to) {
      try {
        await call("/load", { model, from, to });
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
    async forward(x) {
      const json = await call("/forward", { x: f32ToB64(x) });
      return b64ToF32(String(json.y));
    },
  };
}
