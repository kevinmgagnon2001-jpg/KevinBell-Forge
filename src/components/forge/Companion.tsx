/**
 * Runs the companion (src/engine/companion.ts) every frame: it walks with the walker's physics,
 * carries things over its head, sets them down and stacks them, and says what it is doing in a
 * little bubble. Its position lives in companionBodies between commits (like the townsfolk); what
 * it carries, and where it ends up, go to the world.
 */
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";
import type { Group } from "three";
import { companionOf, freshState, ordersOf, stepCompanion, type CompanionState } from "@/engine/companion";
import { useForge } from "@/engine/store";
import { companionBodies } from "./body-state";

export function Companion() {
  const live = useRef<{ id: number; seq: string; state: CompanionState; since: number } | null>(null);
  const bubble = useRef<Group>(null);
  const [said, setSaid] = useState("");

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const world = useForge.getState();
    const self = companionOf(world);
    if (!self) {
      if (live.current) delete companionBodies[live.current.id];
      live.current = null;
      if (said) setSaid("");
      return;
    }
    const seq = self.customData.orderSeq ?? "";
    if (!live.current || live.current.id !== self.id) live.current = { id: self.id, seq, state: freshState(self), since: 0 };
    const l = live.current;
    if (l.seq !== seq) {
      // New orders: drop what it was doing (setting down anything held where it stands).
      l.seq = seq;
      const tasks = ordersOf(self);
      l.state = { ...l.state, queue: tasks.length ? tasks : [{ kind: "follow" }], said: self.customData.reply ?? "", sayFor: 3 };
    }
    const me = Object.values(world.entities).find((e) => e.tags.includes("architect"));
    if (!me) return;
    const step = stepCompanion(world, self, l.state, me.transform.position, Number(me.customData.yaw) || 0, dt);
    const was = l.state;
    l.state = step.state;
    const s = l.state;
    companionBodies[self.id] = { x: s.x, y: s.y, z: s.z, yaw: s.yaw, speed: Math.hypot(s.x - was.x, s.z - was.z) / Math.max(dt, 1e-3) };
    if (bubble.current) bubble.current.position.set(s.x, s.y + 0.95, s.z);
    const text = s.sayFor > 0 ? s.said : "";
    if (text !== said) setSaid(text);
    // The world hears where it is now and then, and every frame something it carries moves.
    l.since += dt;
    if (!step.moved.length && l.since < 0.5) return;
    l.since = 0;
    useForge.setState((state) => {
      const body = state.entities[self.id];
      if (!body) return state;
      const entities = { ...state.entities, [self.id]: { ...body, transform: { ...body.transform, position: { x: s.x, y: s.y, z: s.z } }, customData: { ...body.customData, yaw: String(Math.round(s.yaw * 1000) / 1000) } } };
      for (const m of step.moved) {
        const e = entities[m.id];
        if (!e) continue;
        // Carried things stop falling while held; set down, they rest where they were put.
        const physics = e.physics ? { ...e.physics, velocity: { x: 0, y: 0, z: 0 } } : e.physics;
        entities[m.id] = { ...e, physics, transform: { ...e.transform, position: m.position } };
      }
      return { entities };
    });
  });

  return (
    <group ref={bubble}>
      {said ? (
        <Html center zIndexRange={[30, 0]} pointerEvents="none">
          <div className="talk-bubble is-companion" aria-live="polite">
            {said}
          </div>
        </Html>
      ) : null}
    </group>
  );
}
