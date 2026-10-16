/**
 * Runs the town (town.ts) every frame: people walk their plans, step round each other and remember
 * what they do. Positions live here between frames (townBodies) and the figures read them directly;
 * the world gets them, with the minds, about once a second, so saving and the scene list stay current
 * without re-rendering anyone per frame.
 */
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { useForge } from "@/engine/store";
import { townBodies } from "./body-state";
import { NPC_TAG, placesOf, solidsOf, stepTown, type Place, type Disc, type Town as TownState } from "@/engine/town";


export function Town() {
  const since = useRef(0);
  // The town as stepped here, and the one last written to the world: a change made elsewhere (people
  // added, sent somewhere) is picked up; otherwise this one runs on between commits.
  const live = useRef<{ town: TownState | null; committed: TownState | null }>({ town: null, committed: null });
  const cache = useRef<{ entities: unknown; places: Place[]; solids: Disc[] }>({ entities: null, places: [], solids: [] });
  useFrame((_, delta) => {
    const state = useForge.getState();
    const l = live.current;
    if (state.town !== l.committed) {
      l.town = state.town ?? null;
      l.committed = state.town ?? null;
    }
    const town = l.town;
    if (!town || !Object.keys(town.minds).length) return;
    const c = cache.current;
    if (c.entities !== state.entities) {
      // Rebuilt when the world changes, not every frame (moving people do not change it between commits).
      c.entities = state.entities;
      c.places = placesOf(state);
      c.solids = solidsOf(state);
    }
    const out = stepTown(state, town, townBodies, delta, c.places, c.solids);
    for (const key of Object.keys(townBodies)) if (!out.bodies[Number(key)]) delete townBodies[Number(key)];
    Object.assign(townBodies, out.bodies);
    // The clock and minds advance in the store less often; positions go with them.
    l.town = out.town;
    since.current += delta;
    if (since.current < 1 && !out.news.length) return;
    since.current = 0;
    const entities = { ...state.entities };
    for (const [key, b] of Object.entries(out.bodies)) {
      const e = entities[Number(key)];
      if (!e || !e.tags.includes(NPC_TAG)) continue;
      entities[e.id] = { ...e, transform: { ...e.transform, position: { ...e.transform.position, x: b.x, z: b.z } }, customData: { ...e.customData, yaw: b.yaw.toFixed(3), speed: b.speed.toFixed(2) } };
    }
    l.committed = out.town;
    useForge.setState({ town: out.town, entities });
    if (out.news.length) state.note(out.news.map((body) => ({ tone: "engine" as const, title: "Town", body })));
  });
  return null;
}
