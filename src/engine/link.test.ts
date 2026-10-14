import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startLinkHome } from "../../scripts/link-node.ts";
import { pairingCode } from "./device-link.ts";
import { generateIdentity, type Identity } from "./island.ts";
import { awaitApproval, homeBase, LinkSession, LinkSync, pairWithHome, type LinkConfig, type SyncStatus } from "./link-client.ts";
import { requestText } from "./link-home.ts";
import { signText } from "./device-link.ts";

async function withHome(run: (ctx: { base: string; home: Awaited<ReturnType<typeof startLinkHome>>["home"]; dir: string }) => Promise<void>, dir?: string) {
  const own = dir ?? mkdtempSync(join(tmpdir(), "forge-link-"));
  const { server, home, port } = await startLinkHome({ name: "Test PC", port: 0, dir: own, host: "127.0.0.1" });
  try {
    await run({ base: `http://127.0.0.1:${port}`, home, dir: own });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    if (!dir) rmSync(own, { recursive: true, force: true });
  }
}

/** Pair a device, answering on the home the way the owner would after comparing codes. */
async function pair(base: string, home: { onPair: unknown; approve: (id: string) => Promise<boolean> }, name: string): Promise<{ device: Identity; config: LinkConfig; codes: [string, string] }> {
  const device = await generateIdentity();
  let homeCode = "";
  (home as { onPair: (r: { pairId: string; code: string }) => void }).onPair = (r) => {
    homeCode = r.code;
    void home.approve(r.pairId);
  };
  const start = await pairWithHome(base, device, name);
  const answer = await awaitApproval(start, device, { waitMs: 3000 });
  assert.equal(answer.status, "approved");
  return { device, config: (answer as { config: LinkConfig }).config, codes: [start.code, homeCode] };
}

test("home addresses are read the way people type them", () => {
  assert.equal(homeBase("192.168.1.20"), "http://192.168.1.20:7430");
  assert.equal(homeBase("192.168.1.20:8000"), "http://192.168.1.20:8000");
  assert.equal(homeBase(" http://pc.local:7430/ "), "http://pc.local:7430");
  assert.equal(homeBase("ftp://x"), null);
  assert.equal(homeBase("pc.local/some/path"), null);
  assert.equal(homeBase(""), null);
});

test("a device pairs only after the owner allows it, and both screens show the same code", async () => {
  await withHome(async ({ base, home }) => {
    const { config, codes } = await pair(base, home, "Phone");
    assert.match(codes[0], /^\d{6}$/);
    assert.equal(codes[0], codes[1]);
    assert.equal(config.cert.cert.name, "Phone");
    assert.equal(home.devices().length, 1);

    // Refused: no certificate.
    const other = await generateIdentity();
    home.onPair = (r) => home.refuse(r.pairId);
    const start = await pairWithHome(base, other, "Stranger");
    assert.equal((await awaitApproval(start, other, { waitMs: 2000 })).status, "refused");
    assert.equal(home.devices().length, 1);
  });
});

test("a swapped key on either side shows as a different code", async () => {
  const device = await generateIdentity();
  const owner = await generateIdentity();
  const mallory = await generateIdentity();
  const nonce = "fixed-nonce";
  const code = await pairingCode(nonce, device.publicKey, owner.publicKey);
  assert.notEqual(await pairingCode(nonce, mallory.publicKey, owner.publicKey), code);
  assert.notEqual(await pairingCode(nonce, device.publicKey, mallory.publicKey), code);
  // Without an owner key the code is what it always was.
  assert.equal(await pairingCode(nonce, device.publicKey), await pairingCode(nonce, device.publicKey, undefined));
});

test("only signed, fresh requests from linked devices get in", async () => {
  await withHome(async ({ base, home }) => {
    const { device } = await pair(base, home, "Laptop");
    const signed = async (who: Identity, method: string, path: string, body = "", time = Date.now()) => {
      const sig = await signText(who.privateKey, await requestText(method, path, String(time), body));
      return { "x-forge-device": who.id, "x-forge-time": String(time), "x-forge-sig": sig };
    };

    assert.equal((await fetch(`${base}/link/save`)).status, 401);

    const stranger = await generateIdentity();
    const unknown = await fetch(`${base}/link/save?since=-1&wait=0`, { headers: await signed(stranger, "GET", "/link/save?since=-1&wait=0") });
    assert.equal(unknown.status, 403);

    const good = await signed(device, "GET", "/link/save?since=-1&wait=0");
    assert.equal((await fetch(`${base}/link/save?since=-1&wait=0`, { headers: good })).status, 200);
    // The same signed request again is a replay.
    assert.equal((await fetch(`${base}/link/save?since=-1&wait=0`, { headers: good })).status, 401);

    // A body changed after signing.
    const body = JSON.stringify({ base: 0, payload: { a: 1 } });
    const headers = await signed(device, "PUT", "/link/save", body);
    const tampered = await fetch(`${base}/link/save`, { method: "PUT", headers, body: JSON.stringify({ base: 0, payload: { a: 2 } }) });
    assert.equal(tampered.status, 401);

    // A clock five minutes out.
    const old = await signed(device, "GET", "/link/devices", "", Date.now() - 5 * 60_000);
    const late = await fetch(`${base}/link/devices`, { headers: old });
    assert.equal(late.status, 401);
    assert.match(((await late.json()) as { reason: string }).reason, /clock/);

    // Removed: refused from then on, with a reason a person can act on.
    await home.remove(device.id);
    const gone = await fetch(`${base}/link/devices`, { headers: await signed(device, "GET", "/link/devices") });
    assert.equal(gone.status, 403);
    assert.match(((await gone.json()) as { reason: string }).reason, /removed/);
  });
});

test("saves are versioned: a stale write gets the newer save back instead of overwriting it", async () => {
  await withHome(async ({ base, home }) => {
    const a = await pair(base, home, "PC");
    const b = await pair(base, home, "Phone");
    const sa = new LinkSession(a.config, a.device);
    const sb = new LinkSession(b.config, b.device);

    const first = await sa.push(0, { world: "one" });
    assert.ok(first.ok);
    assert.equal(first.reply.version, 1);

    const stale = await sb.push(0, { world: "two" });
    assert.equal(stale.ok, false);
    if (!stale.ok) {
      assert.deepEqual(stale.conflict.payload, { world: "one" });
      assert.equal(stale.conflict.byName, "PC");
    }

    const pulled = await sb.pull(0);
    assert.equal(pulled.version, 1);
    assert.deepEqual(pulled.payload, { world: "one" });
    // Nothing newer: no payload is sent again.
    assert.equal((await sb.pull(1)).payload, undefined);
  });
});

test("a device rejects save replies its own home did not sign", async () => {
  await withHome(async ({ base, home }) => {
    const a = await pair(base, home, "PC");
    await new LinkSession(a.config, a.device).push(0, { world: "real" });
    // The same address, but this device believes in a different owner key (an impostor home).
    const impostor = await generateIdentity();
    const fooled = new LinkSession({ ...a.config, home: { ...a.config.home, ownerKey: impostor.publicKey } }, a.device);
    await assert.rejects(fooled.pull(-1), /not signed by this device's home/);
  });
});

test("a long poll returns as soon as another device saves", async () => {
  await withHome(async ({ base, home }) => {
    const a = await pair(base, home, "PC");
    const b = await pair(base, home, "Phone");
    const sa = new LinkSession(a.config, a.device);
    const sb = new LinkSession(b.config, b.device);
    const started = Date.now();
    const waiting = sb.pull(0, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await sa.push(0, { world: "fresh" });
    const reply = await waiting;
    assert.equal(reply.version, 1);
    assert.deepEqual(reply.payload, { world: "fresh" });
    assert.ok(Date.now() - started < 5000, "the poll should end on the save, not the timeout");
  });
});

/** A stand-in for one device's store: a value, and what the sync loop reports. */
function fakeDevice() {
  const box = { state: { world: "" } as { world: string }, statuses: [] as SyncStatus[], notes: [] as string[], applied: 0 };
  return {
    box,
    hooks: {
      read: () => box.state,
      apply: (payload: unknown) => {
        box.state = payload as { world: string };
        box.applied += 1;
      },
      status: (s: SyncStatus) => box.statuses.push(s),
      note: (text: string) => box.notes.push(text),
    },
  };
}

async function until(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("continuity: work moves from the PC to the phone and back, and only the device in use writes", async () => {
  await withHome(async ({ base, home }) => {
    const pc = await pair(base, home, "PC");
    const phone = await pair(base, home, "Phone");
    const devPc = fakeDevice();
    const devPhone = fakeDevice();
    devPc.box.state = { world: "castle" };
    devPhone.box.state = { world: "phone's old world" };
    const syncPc = new LinkSync(new LinkSession(pc.config, pc.device), devPc.hooks, { waitMs: 5000, pushDelayMs: 20 });
    const syncPhone = new LinkSync(new LinkSession(phone.config, phone.device), devPhone.hooks, { waitMs: 5000, pushDelayMs: 20 });
    try {
      // The PC joins an empty home first: its world becomes the shared one, and it leads.
      syncPc.start();
      await until(() => syncPc.isLead && syncPc.version === 1);
      // The phone joins next and takes the home's world in place of its own.
      syncPhone.start();
      await until(() => devPhone.box.state.world === "castle");
      assert.equal(syncPhone.isLead, false);

      // Working on the PC: the phone follows.
      devPc.box.state = { world: "castle + tower" };
      syncPc.changed();
      await until(() => devPhone.box.state.world === "castle + tower");

      // A change on the phone while it only follows is not written.
      devPhone.box.state = { world: "stray tick" };
      syncPhone.changed();
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(devPc.box.state.world, "castle + tower");

      // Pick up the phone: it takes the lead (and the newest save), then its edits reach the PC.
      await syncPhone.touched();
      assert.equal(syncPhone.isLead, true);
      assert.equal(devPhone.box.state.world, "castle + tower");
      devPhone.box.state = { world: "castle + tower + moat" };
      syncPhone.changed();
      await until(() => devPc.box.state.world === "castle + tower + moat");
      await until(() => !syncPc.isLead);

      // Back on the PC.
      await syncPc.touched();
      devPc.box.state = { world: "castle + tower + moat + bridge" };
      syncPc.changed();
      await until(() => devPhone.box.state.world === "castle + tower + moat + bridge");
      assert.deepEqual(devPc.box.notes, []);
    } finally {
      syncPc.stop();
      syncPhone.stop();
    }
  });
});

test("the home keeps its devices and save across a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-link-"));
  try {
    let config: LinkConfig | null = null;
    let device: Identity | null = null;
    await withHome(async ({ base, home }) => {
      const p = await pair(base, home, "Tablet");
      config = p.config;
      device = p.device;
      await new LinkSession(p.config, p.device).push(0, { world: "kept" });
    }, dir);
    await withHome(async ({ base, home }) => {
      assert.equal(home.devices().length, 1);
      const session = new LinkSession({ ...(config as unknown as LinkConfig), base }, device as unknown as Identity);
      const reply = await session.pull(-1);
      assert.deepEqual(reply.payload, { world: "kept" });
    }, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("changes made while the home was away survive an app restart and reach the other devices", async () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-link-"));
  try {
    let pcPair: Awaited<ReturnType<typeof pair>> | null = null;
    let phonePair: Awaited<ReturnType<typeof pair>> | null = null;
    let mark: { version: number; hash: string } | null = null;
    const pcState = fakeDevice();
    pcState.box.state = { world: "garden" };

    // Session one: the PC links and saves; then the home goes away.
    await withHome(async ({ base, home }) => {
      pcPair = await pair(base, home, "PC");
      phonePair = await pair(base, home, "Phone");
      const sync = new LinkSync(new LinkSession(pcPair.config, pcPair.device), { ...pcState.hooks, synced: (m) => (mark = m) }, { waitMs: 2000, pushDelayMs: 20 });
      sync.start();
      await until(() => sync.isLead && mark?.version === 1);
      sync.stop();
    }, dir);

    // Home away: the PC keeps working, then the app is closed.
    pcState.box.state = { world: "garden + pond" };

    // Session two: home back on the same port range, the PC app starts again from its saved mark.
    await withHome(async ({ base }) => {
      const pc = pcPair as unknown as Awaited<ReturnType<typeof pair>>;
      const phone = phonePair as unknown as Awaited<ReturnType<typeof pair>>;
      const pcSync = new LinkSync(new LinkSession({ ...pc.config, base }, pc.device), pcState.hooks, { waitMs: 2000, pushDelayMs: 20, initial: mark });
      const phoneState = fakeDevice();
      const phoneSync = new LinkSync(new LinkSession({ ...phone.config, base }, phone.device), phoneState.hooks, { waitMs: 2000, pushDelayMs: 20 });
      try {
        pcSync.start();
        await until(() => pcSync.version === 2);
        phoneSync.start();
        await until(() => phoneState.box.state.world === "garden + pond");
        assert.deepEqual(pcState.box.notes, []);
      } finally {
        pcSync.stop();
        phoneSync.stop();
      }
    }, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
