import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptRevocations,
  issueDeviceCert,
  pairingCode,
  pairingNonce,
  pickHost,
  signRevocations,
  verifyDeviceCert,
  type LinkedDevice,
} from "./device-link.ts";
import { generateIdentity } from "./island.ts";

test("pairing codes match only for the same nonce and the same device key", async () => {
  const phone = await generateIdentity();
  const attacker = await generateIdentity();
  const nonce = pairingNonce();
  const code = await pairingCode(nonce, phone.publicKey);
  assert.match(code, /^\d{6}$/);
  assert.equal(await pairingCode(nonce, phone.publicKey), code);
  assert.notEqual(await pairingCode(nonce, attacker.publicKey), code);
  assert.notEqual(await pairingCode(pairingNonce(), phone.publicKey), code);
});

test("a device certified by its owner joins the instance; others do not", async () => {
  const owner = await generateIdentity();
  const stranger = await generateIdentity();
  const tv = await generateIdentity();
  const now = Date.UTC(2026, 9, 12);
  const cert = await issueDeviceCert(owner, { publicKey: tv.publicKey, name: "Living room TV", roles: ["display", "input"] }, { now });

  const ok = await verifyDeviceCert(cert, { ownerId: owner.id, now: now + 1000 });
  assert.equal(ok.ok, true);

  // Someone else's device.
  const foreign = await issueDeviceCert(stranger, { publicKey: tv.publicKey, name: "TV", roles: ["display"] }, { now });
  assert.equal((await verifyDeviceCert(foreign, { ownerId: owner.id, now })).ok, false);

  // Roles cannot be widened after signing.
  const widened = { ...cert, cert: { ...cert.cert, roles: ["host" as const] } };
  assert.equal((await verifyDeviceCert(widened, { now })).ok, false);

  // Expiry.
  assert.equal((await verifyDeviceCert(cert, { now: now + 400 * 24 * 3600 * 1000 })).ok, false);
});

test("removing a device takes effect, and old revocation lists cannot undo it", async () => {
  const owner = await generateIdentity();
  const laptop = await generateIdentity();
  const now = Date.UTC(2026, 9, 12);
  const cert = await issueDeviceCert(owner, { publicKey: laptop.publicKey, name: "Laptop", roles: ["host", "display"] }, { now });

  const v1 = await signRevocations(owner, { ownerId: owner.id, version: 1, revoked: [cert.cert.deviceId] });
  const list = await acceptRevocations(null, v1, owner.publicKey);
  assert.equal((await verifyDeviceCert(cert, { now, revoked: list })).ok, false);

  // A replayed older (empty) list is ignored.
  const v0 = await signRevocations(owner, { ownerId: owner.id, version: 0, revoked: [] });
  assert.equal(await acceptRevocations(list, v0, owner.publicKey), list);

  // A list not signed by the owner is ignored.
  const mallory = await generateIdentity();
  const forged = { list: { ownerId: owner.id, version: 9, revoked: [] }, signature: (await signRevocations(mallory, { ownerId: mallory.id, version: 9, revoked: [] })).signature };
  assert.equal(await acceptRevocations(list, forged, owner.publicKey), list);
});

test("the strongest plugged-in device hosts, and hosting moves when it leaves", () => {
  const devices: LinkedDevice[] = [
    { deviceId: "phone", roles: ["host", "display", "input"], tier: "mid", onBattery: true, online: true },
    { deviceId: "pc", roles: ["host", "compute", "display"], tier: "high", onBattery: false, online: true },
    { deviceId: "tv", roles: ["display", "input"], tier: "mid", onBattery: false, online: true },
  ];
  assert.equal(pickHost(devices), "pc");
  const pcOff = devices.map((d) => (d.deviceId === "pc" ? { ...d, online: false } : d));
  assert.equal(pickHost(pcOff, "pc"), "phone");
  assert.equal(pickHost(devices.filter((d) => d.deviceId === "tv")), null);
});
