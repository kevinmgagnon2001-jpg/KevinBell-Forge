import assert from "node:assert/strict";
import test from "node:test";
import {
  answerHello,
  buildManifest,
  checkWelcome,
  formatAddress,
  generateIdentity,
  makeHello,
  normalizeAddress,
  parseAddress,
  signManifest,
  verifyManifest,
  type Capability,
  type SignedManifest,
} from "./island.ts";

const entry = { kind: "wasm" as const, sha256: "abc", bytes: 8 };

async function island(name: string, address: string, wants: Capability[] = []) {
  const identity = await generateIdentity();
  const signed = await signManifest(await buildManifest(identity, { name, address, entry, wants }), identity);
  return { identity, signed };
}

test("addresses parse, normalize, and refuse junk", () => {
  assert.deepEqual(parseAddress("forge://Example.com:8080/my-island"), { host: "example.com", port: 8080, slug: "my-island" });
  assert.equal(normalizeAddress("forge://EXAMPLE.com/island1"), "forge://example.com/island1");
  assert.equal(normalizeAddress("forge://example.com/Island1"), null);
  assert.equal(formatAddress({ host: "a.b", port: null, slug: "x" }), "forge://a.b/x");
  for (const bad of ["http://a.com/x", "forge://a.com", "forge://a.com:0/x", "forge://a.com:70000/x", "forge://-bad.com/x", "forge://a.com/x/y", "forge://a.com/ x"]) {
    assert.equal(parseAddress(bad), null, bad);
  }
});

test("a signed manifest verifies and any tampering is caught", async () => {
  const { signed } = await island("A", "forge://a.example/a");
  assert.deepEqual(await verifyManifest(signed), { ok: true });
  const renamed: SignedManifest = { ...signed, manifest: { ...signed.manifest, name: "B" } };
  assert.equal((await verifyManifest(renamed)).ok, false);
  const widened: SignedManifest = { ...signed, manifest: { ...signed.manifest, wants: ["fetch"] } };
  assert.equal((await verifyManifest(widened)).ok, false);
  const other = await island("C", "forge://c.example/c");
  const stolenKey: SignedManifest = { ...signed, manifest: { ...signed.manifest, publicKey: other.identity.publicKey } };
  assert.equal((await verifyManifest(stolenKey)).ok, false);
});

test("portal: host grants only what it allows, and the visitor can verify it", async () => {
  const visitor = await island("Visitor", "forge://v.example/v", ["render", "fetch"]);
  const host = await island("Host", "forge://h.example/h");
  const hello = await makeHello(visitor.signed, visitor.identity, "forge://H.example/h", ["render", "fetch", "storage"]);
  const answered = await answerHello(hello, host.signed, host.identity, { allow: ["render", "storage", "audio"] });
  assert.equal(answered.ok, true);
  if (!answered.ok) return;
  assert.deepEqual([...answered.welcome.grant].sort(), ["render", "storage"]);
  const checked = await checkWelcome(hello, answered.welcome);
  assert.equal(checked.ok, true);
  if (checked.ok) assert.deepEqual([...checked.grant].sort(), ["render", "storage"]);
});

test("portal: spoofing, wrong target, blocked ids, imposters, replays and over-granting are refused", async () => {
  const visitor = await island("Visitor", "forge://v.example/v");
  const host = await island("Host", "forge://h.example/h");
  const mallory = await island("Mallory", "forge://m.example/m");
  const policy = { allow: ["render" as const] };

  // Mallory presents the visitor's manifest but cannot sign for it.
  const forged = await makeHello(visitor.signed, mallory.identity, "forge://h.example/h", ["render"]);
  assert.equal((await answerHello(forged, host.signed, host.identity, policy)).ok, false);

  // Addressed to somebody else.
  const misaddressed = await makeHello(visitor.signed, visitor.identity, "forge://elsewhere.example/h", ["render"]);
  assert.equal((await answerHello(misaddressed, host.signed, host.identity, policy)).ok, false);

  // Blocked.
  const hello = await makeHello(visitor.signed, visitor.identity, "forge://h.example/h", ["render"]);
  assert.equal((await answerHello(hello, host.signed, host.identity, { ...policy, blockedIds: [visitor.identity.id] })).ok, false);

  // A different island tries to answer for the host.
  assert.equal((await answerHello(hello, mallory.signed, mallory.identity, policy)).ok, false);

  const ok = await answerHello(hello, host.signed, host.identity, policy);
  assert.equal(ok.ok, true);
  if (!ok.ok) return;

  // A welcome replayed against a fresh hello.
  const second = await makeHello(visitor.signed, visitor.identity, "forge://h.example/h", ["render"]);
  assert.equal((await checkWelcome(second, ok.welcome)).ok, false);

  // The host claims more than it was asked for.
  const greedy = { ...ok.welcome, grant: ["render" as const, "fetch" as const] };
  assert.equal((await checkWelcome(hello, greedy)).ok, false);
});
