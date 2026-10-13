import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateLocally, httpLink, modelBytes, planSplit, Pool, type DeviceInfo, type ModelSpec } from "./pooled.ts";

const MODEL: ModelSpec = { id: "toy-8x256", seed: 42, width: 256, layers: 8, vocab: 72 };
const MB = 1024 * 1024;

function device(id: string, port: number, memoryMb: number, speed: number): Promise<{ proc: ChildProcess; base: string }> {
  const script = fileURLToPath(new URL("../../scripts/compute-node.ts", import.meta.url));
  const proc = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", script, "--id", id, "--port", String(port), "--memory-mb", String(memoryMb), "--speed", String(speed)], { stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((resolve, reject) => {
    proc.stdout!.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("online")) resolve({ proc, base: `http://localhost:${port}` });
    });
    proc.on("exit", (code) => reject(new Error(`device ${id} exited ${code}`)));
  });
}

async function info(base: string): Promise<DeviceInfo & { base: string }> {
  try {
    const res = await fetch(`${base}/info`);
    const json = (await res.json()) as { id: string; memoryBytes: number; speed: number };
    return { ...json, online: true, base };
  } catch {
    return { id: base, memoryBytes: 0, speed: 0, online: false, base };
  }
}

test("the planner splits by speed, never past a device's memory, and fails with numbers when it cannot fit", () => {
  const total = modelBytes(MODEL);
  const a = { id: "a", memoryBytes: 1.2 * MB, speed: 2, online: true };
  const b = { id: "b", memoryBytes: 1.2 * MB, speed: 1, online: true };
  assert.ok(total > a.memoryBytes && total > b.memoryBytes, "neither device can hold the model alone");
  const plan = planSplit(MODEL, [a, b]);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.deepEqual(plan.slices.map((s) => s.device), ["a", "b"]);
  assert.equal(plan.slices[0].from, 0);
  assert.equal(plan.slices.at(-1)!.to, MODEL.layers);
  assert.ok(plan.slices[0].to - plan.slices[0].from >= plan.slices[1].to - plan.slices[1].from, "the faster device takes at least as many layers");
  const alone = planSplit(MODEL, [a, { ...b, online: false }]);
  assert.equal(alone.ok, false);
  assert.match(!alone.ok ? alone.reason : "", /model needs 1\.9 MB; the 1 online device has 1\.3 MB/);
});

test("a model too large for either of two linked machines answers using both, and unplugging one fails cleanly or re-plans", async () => {
  const want = generateLocally(MODEL, "hello forge", 12);
  const ports = [21800, 21801, 21802].map((p) => p + Math.floor(Math.random() * 500));
  const a = await device("desk", ports[0], 1.2, 2);
  const b = await device("phone", ports[1], 1.2, 1);
  let c: { proc: ChildProcess; base: string } | null = null;
  try {
    let bases = [a.base, b.base];
    const pool = new Pool(MODEL, () => Promise.all(bases.map(info)), (id) => {
      const known = { desk: a.base, phone: b.base, tablet: c?.base ?? "" } as Record<string, string>;
      return httpLink(known[id], 2000);
    });
    const first = await pool.generate("hello forge", 12);
    assert.equal(first.ok, true, !first.ok ? first.reason : "");
    if (!first.ok) return;
    assert.equal(first.text, want, "pooled answer equals the single-machine answer");
    assert.equal(first.plan.length, 2);
    assert.equal(first.hops, 24);
    assert.ok(first.activationBytes < modelBytes(MODEL) / 10, `only activations travel (${first.activationBytes} bytes)`);

    // Unplug the phone: what is left cannot hold the model, so the request fails with a reason.
    b.proc.kill();
    await new Promise((r) => setTimeout(r, 200));
    const failed = await pool.generate("hello forge", 4);
    assert.equal(failed.ok, false);
    assert.match(!failed.ok ? failed.reason : "", /model needs .* MB/);

    // A tablet joins: the pool re-plans over desk + tablet and answers the same thing again.
    c = await device("tablet", ports[2], 1.5, 1);
    bases = [a.base, c.base];
    const again = await pool.generate("hello forge", 12);
    assert.equal(again.ok, true, !again.ok ? again.reason : "");
    if (again.ok) {
      assert.equal(again.text, want);
      assert.deepEqual(again.plan.map((s) => s.device), ["desk", "tablet"]);
    }
  } finally {
    a.proc.kill();
    b.proc.kill();
    c?.proc.kill();
  }
});
