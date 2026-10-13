/**
 * This browser's identity when it walks through portals. Generated once, kept in this browser only.
 * The private key never leaves the page; only the signed manifest is sent.
 */
import { b64url, buildManifest, fromB64url, generateIdentity, idOf, signManifest, type Identity, type SignedManifest } from "./island.ts";

const KEY = "forge-visitor-identity-v1";
let cached: Promise<{ identity: Identity; signed: SignedManifest }> | null = null;

async function load(): Promise<Identity> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { publicKey: string; pkcs8: string };
      const der = fromB64url(saved.pkcs8);
      if (der) {
        const privateKey = await crypto.subtle.importKey("pkcs8", der as BufferSource, { name: "Ed25519" }, true, ["sign"]);
        return { publicKey: saved.publicKey, id: await idOf(saved.publicKey), privateKey };
      }
    }
  } catch {
    /* fall through to a fresh key */
  }
  const identity = await generateIdentity();
  try {
    const pkcs8 = b64url(new Uint8Array(await crypto.subtle.exportKey("pkcs8", identity.privateKey)));
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ publicKey: identity.publicKey, pkcs8 }));
  } catch {
    /* private window: the identity lasts for this session */
  }
  return identity;
}

export function visitorIdentity(): Promise<{ identity: Identity; signed: SignedManifest }> {
  cached ??= (async () => {
    const identity = await load();
    const manifest = await buildManifest(identity, {
      name: "Forge visitor",
      address: `forge://visitor.local/v-${identity.id.slice(0, 12).toLowerCase().replace(/[^a-z0-9]/g, "x")}`,
      entry: { kind: "world", sha256: "", bytes: 0 },
      wants: ["render", "input"],
    });
    return { identity, signed: await signManifest(manifest, identity) };
  })();
  return cached;
}
