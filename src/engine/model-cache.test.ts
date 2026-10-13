import assert from "node:assert/strict";
import test from "node:test";
import { DesktopBackend, MemoryBackend } from "./model-cache.ts";

test("the in-memory weight store keeps what was written for the session", async () => {
  const store = new MemoryBackend();
  assert.equal(store.isSupported(), true);
  assert.equal(await store.read("w"), null);
  assert.equal(await store.getSize("w"), -1);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array([1, 2, 3]));
      c.enqueue(new Uint8Array([4]));
      c.close();
    },
  });
  await store.write("w", stream);
  assert.equal(await store.getSize("w"), 4);
  assert.deepEqual(new Uint8Array(await (await store.read("w"))!.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual(await store.list(), [{ key: "w", size: 4 }]);
  await store.delete("w");
  assert.deepEqual(await store.list(), []);
});

test("desktop: weights go to the host in pieces, are committed, and read back whole", async () => {
  // A stand-in for the host's model_store_* commands, with the same rules as src-tauri/src/model_store.rs.
  const parts = new Map<string, Uint8Array>();
  const done = new Map<string, Uint8Array>();
  const writes: number[] = [];
  const unhex = (h: string) => new TextDecoder().decode(Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16))));
  const invoke = async (cmd: string, args?: Record<string, unknown> | Uint8Array, options?: { headers?: Record<string, string> }) => {
    const a = args as Record<string, unknown>;
    switch (cmd) {
      case "model_store_write": {
        const key = unhex(options!.headers!["forge-key"]);
        const offset = Number(options!.headers!["forge-offset"]);
        const have = offset === 0 ? new Uint8Array() : parts.get(key)!;
        assert.equal(have.length, offset, "pieces follow on");
        const next = new Uint8Array(have.length + (args as Uint8Array).length);
        next.set(have);
        next.set(args as Uint8Array, have.length);
        parts.set(key, next);
        writes.push((args as Uint8Array).length);
        return null;
      }
      case "model_store_commit":
        done.set(a.key as string, parts.get(a.key as string)!);
        parts.delete(a.key as string);
        return null;
      case "model_store_size":
        return done.get(a.key as string)?.length ?? -1;
      case "model_store_read": {
        const d = done.get(a.key as string)!;
        return d.slice(a.offset as number, (a.offset as number) + (a.len as number)).buffer;
      }
      case "model_store_list":
        return [...done].map(([k, v]) => [k, v.length]);
      case "model_store_delete":
        done.delete(a.key as string);
        return null;
    }
    throw new Error(cmd);
  };
  const backend = new DesktopBackend(invoke);
  const size = 20 * 1024 * 1024 + 123;
  const data = Uint8Array.from({ length: size }, (_, i) => (i * 7) & 0xff);
  // Arrives in odd-sized network chunks.
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let at = 0; at < size; at += 1_000_003) c.enqueue(data.subarray(at, at + 1_000_003));
      c.close();
    },
  });
  assert.equal(await backend.getSize("hf/m.gguf"), -1);
  await backend.write("hf/m.gguf", stream);
  assert.deepEqual(writes, [8 * 1024 * 1024, 8 * 1024 * 1024, size - 16 * 1024 * 1024]);
  assert.equal(await backend.getSize("hf/m.gguf"), size);
  assert.deepEqual(await backend.list(), [{ key: "hf/m.gguf", size }]);
  const back = new Uint8Array(await (await backend.read("hf/m.gguf"))!.arrayBuffer());
  assert.equal(back.length, size);
  assert.ok(back.every((b, i) => b === data[i]));
  await backend.delete("hf/m.gguf");
  assert.equal(await backend.read("hf/m.gguf"), null);
});
