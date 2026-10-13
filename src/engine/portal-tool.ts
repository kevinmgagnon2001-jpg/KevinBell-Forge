/**
 * The "place a portal" command. Deterministic, like compat_map: no model needed to recognise a
 * forge:// address. The portal appears a few steps in front of the avatar.
 */
import { makePortal } from "./island-content.ts";
import { normalizeAddress } from "./island.ts";
import type { ProposedAction, World } from "./types.ts";

const ADDRESS = /forge:\/\/[^\s"'<>]+/i;

export function portalProposal(intent: string): ProposedAction | null {
  const address = ADDRESS.exec(intent)?.[0];
  if (!address || !/\b(portal|island|door|gate|link|visit|open)\b/i.test(intent)) return null;
  return { kind: "tool_call", toolName: "place_portal", arguments: { address: address.replace(/[.,;:!?)]+$/, "") }, message: "portal" };
}

export function placePortal(world: World, args: Record<string, string>): { ok: boolean; detail: string; world: World } {
  const address = normalizeAddress(args.address ?? "");
  if (!address) return { ok: false, detail: "That is not a forge:// address (forge://host[:port]/slug).", world };
  const existing = Object.values(world.entities).find((e) => e.tags.includes("portal") && e.customData.portal === address);
  if (existing) return { ok: true, detail: `A portal to ${address} is already here (entity ${existing.id}).`, world };
  const avatar = Object.values(world.entities).find((e) => e.tags.includes("avatar"));
  const yaw = Number(avatar?.customData.yaw ?? 0) || 0;
  const from = avatar?.transform.position ?? { x: 0, y: 0, z: 0 };
  const at = { x: from.x + Math.sin(yaw) * 2.6, y: 0, z: from.z + Math.cos(yaw) * 2.6 };
  const next = makePortal(world, address, at);
  return { ok: true, detail: `Portal to ${address} placed as entity ${world.nextId}. Walk into it to visit; if the island is offline it says so.`, world: next };
}
