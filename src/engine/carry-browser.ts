/**
 * Carrying, as this app does it. When you walk through a portal with a mechanic of your own, the
 * island is asked to take it (the "carry" grant); if it does, you predict with exactly the mechanic
 * the host runs for you, under the rules it announced, so the crossing changes nothing about how you
 * move. Changing your mechanic mid-visit carries the new one. Islands that do not take it walk you
 * their own way, and you are told why.
 *
 * Also keeps the list of mechanics in use on the islands you are visiting, so you can keep one.
 */
import { create } from "zustand";
import { checkMechanic, mechanicRule, type MechanicPackage } from "./mechanic.ts";
import { prepare } from "./movers.ts";
import type { LiveVisit } from "./live-visit.ts";
import { carryMechanic, islandMechanics } from "./portal-client.ts";
import { useForge } from "./store.ts";

type Visit = { base: string; session: string; name: string; grant: string[]; carrying: string };

const visits = new Map<LiveVisit, Visit>();

export type Nearby = { pkg: MechanicPackage; island: string };
export const useNearby = create<{ items: Nearby[]; carried: Record<string, string> }>(() => ({ items: [], carried: {} }));

const say = (tone: "engine" | "warn", body: string) => useForge.getState().note([{ tone, title: "Mechanics", body }]);

function current(): MechanicPackage | null {
  const state = useForge.getState();
  return state.moverHash ? (state.mechanics.find((m) => m.hash === state.moverHash) ?? null) : null;
}

function showCarried() {
  useNearby.setState({ carried: Object.fromEntries([...visits.values()].map((v) => [v.name, v.carrying])) });
}

/** Ask the island to take the mechanic you move with now (or to go back to its own way). */
async function carryInto(link: LiveVisit, visit: Visit) {
  const pkg = current();
  if (!pkg) {
    if (visit.carrying) await carryMechanic(visit.base, visit.session, null);
    visit.carrying = "";
    link.useRule(null);
    showCarried();
    return;
  }
  if (!visit.grant.includes("carry")) {
    link.useRule(null);
    say("warn", `${visit.name} does not let visitors bring mechanics. You move its way while you are there.`);
    return;
  }
  const runtime = await prepare(pkg);
  if (!runtime) {
    link.useRule(null);
    say("warn", `${pkg.name} did not pass this device's own checks, so it stays home.`);
    return;
  }
  const answer = await carryMechanic(visit.base, visit.session, pkg);
  if (!answer.ok) {
    link.useRule(null);
    say("warn", `${visit.name} did not take your ${pkg.name}: ${answer.reason}. You move its way while you are there.`);
    return;
  }
  link.useRule(mechanicRule(runtime, answer.rules));
  visit.carrying = pkg.name;
  showCarried();
  say("engine", `${visit.name} took your ${pkg.name}${pkg.author.name ? ` (by ${pkg.author.name})` : ""}. It runs there for this visit only, at most ${answer.rules.maxSpeed} m/s.`);
}

/** A visit has started: remember it, and carry what you move with. */
export async function startCarrying(link: LiveVisit, visit: Omit<Visit, "carrying">) {
  const entry: Visit = { ...visit, carrying: "" };
  visits.set(link, entry);
  await carryInto(link, entry);
  void refreshNearby();
}

/** A visit has ended (the host left, or you did). */
export function stopCarrying(link: LiveVisit) {
  visits.delete(link);
  showCarried();
  void refreshNearby();
}

/** Ask every island you are on what mechanics are in use there. */
export async function refreshNearby() {
  const items: Nearby[] = [];
  for (const visit of visits.values()) {
    for (const pkg of await islandMechanics(visit.base, visit.session)) items.push({ pkg, island: visit.name });
  }
  useNearby.setState({ items });
}

/** Keep a mechanic someone else brought: checked here in full first, author credited. */
export async function keepMechanic(pkg: MechanicPackage): Promise<string | null> {
  const checked = await checkMechanic(pkg);
  if (!checked.ok) return checked.reason;
  useForge.getState().keepMechanic(pkg);
  say("engine", `Kept ${pkg.name}${pkg.author.name ? ` by ${pkg.author.name}` : ""}. Choose it under Mechanics to move with it.`);
  return null;
}

let started = false;

/** Follow changes of mechanic: get the new one ready, and carry it onto every island you are on. */
export function startMechanics() {
  if (started) return;
  started = true;
  let last = useForge.getState().moverHash;
  const ready = () => {
    const pkg = current();
    if (pkg) void prepare(pkg);
  };
  ready();
  useForge.subscribe((state) => {
    if (state.moverHash === last) return;
    last = state.moverHash;
    ready();
    for (const [link, visit] of visits) void carryInto(link, visit);
  });
  window.setInterval(() => {
    if (visits.size) void refreshNearby();
  }, 8000);
}
