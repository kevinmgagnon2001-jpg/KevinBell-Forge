import assert from "node:assert/strict";
import test from "node:test";
import { SAMPLE } from "./isa.ts";
import { hostKind, runTranslated } from "./native-host.ts";

test("outside the desktop app, translated code runs in-process", async () => {
  assert.equal(hostKind(), "browser");
  assert.deepEqual(await runTranslated(SAMPLE), { host: "browser", x0: 11 });
});

test("inside the desktop app, the call goes to the native host with the module bytes", async () => {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  const g = globalThis as { __TAURI_INTERNALS__?: unknown };
  g.__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return 11;
    },
  };
  try {
    assert.equal(hostKind(), "desktop");
    assert.deepEqual(await runTranslated(SAMPLE, 0), { host: "desktop", x0: 11 });
    assert.equal(calls[0]?.cmd, "run_wasm");
    const bytes = calls[0]?.args?.bytes as number[];
    assert.deepEqual(bytes.slice(0, 4), [0x00, 0x61, 0x73, 0x6d]);
  } finally {
    delete g.__TAURI_INTERNALS__;
  }
});
