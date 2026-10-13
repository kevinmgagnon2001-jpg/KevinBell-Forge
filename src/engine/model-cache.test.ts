import assert from "node:assert/strict";
import test from "node:test";
import { MemoryBackend } from "./model-cache.ts";

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
