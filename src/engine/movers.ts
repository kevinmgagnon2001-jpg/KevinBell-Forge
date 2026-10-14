/**
 * The mechanics this app has checked and can run right now, by hash. A package is checked in full
 * (checkMechanic: signature, module, every fixture) once, the first time it is needed; after that the
 * pilot and the portal code step it without waiting.
 */
import { BUILT_IN, checkMechanic, packMechanic, type MechanicPackage, type MoverRuntime, type Recipe } from "./mechanic.ts";
import { visitorIdentity } from "./visitor.ts";

const ready = new Map<string, MoverRuntime>();
const pending = new Map<string, Promise<MoverRuntime | null>>();
const refused = new Map<string, string>();

/** The runtime for a package, if it has been checked already. */
export function runtimeNow(hash: string): MoverRuntime | null {
  return ready.get(hash) ?? null;
}

/** Why a package was refused, if it was. */
export function refusedWhy(hash: string): string | null {
  return refused.get(hash) ?? null;
}

/** Check a package (once) and keep its runtime ready. null if it does not pass. */
export function prepare(pkg: MechanicPackage): Promise<MoverRuntime | null> {
  const have = ready.get(pkg.hash);
  if (have) return Promise.resolve(have);
  let job = pending.get(pkg.hash);
  if (!job) {
    job = checkMechanic(pkg).then((checked) => {
      pending.delete(pkg.hash);
      if (!checked.ok) {
        refused.set(pkg.hash, checked.reason);
        return null;
      }
      ready.set(pkg.hash, checked.runtime);
      return checked.runtime;
    });
    pending.set(pkg.hash, job);
  }
  return job;
}

/** A built-in recipe as a package of your own: signed with this device's identity, credited to Forge. */
export async function packBuiltIn(recipe: Recipe): Promise<MechanicPackage> {
  const me = await visitorIdentity();
  return packMechanic(recipe, me.identity, "Forge (built in)");
}

export const BUILT_IN_RECIPES = BUILT_IN;
