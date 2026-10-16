/**
 * Keeps the rigid solver (src/engine/rigid.ts) in step with the entities tagged "rigid": dominoes,
 * Jenga blocks. New ones become bodies; one moved from outside (dragged, undone, edited) is put
 * where it now is; a kick (walking into it sets its velocity) pushes it high up, so it tips. Each
 * frame the awake bodies are stepped and written back: position, rotation and velocity.
 */
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { groundAt, solidsFor } from "@/engine/physics";
import { makeBody, newRigidWorld, push, RIGID_TAG, stepRigid, type RBody } from "@/engine/rigid";
import { useForge } from "@/engine/store";
import type { Entity, Quat, Vec3 } from "@/engine/types";

type Written = { p: Vec3; q: Quat; v: Vec3 };
const far = (a: Vec3, b: Vec3, d: number) => Math.abs(a.x - b.x) > d || Math.abs(a.y - b.y) > d || Math.abs(a.z - b.z) > d;

export function RigidBodies({ paused }: { paused: boolean }) {
  const world = useRef(newRigidWorld());
  const written = useRef(new Map<number, Written>());

  useFrame((_, delta) => {
    if (paused) return;
    const state = useForge.getState();
    if (state.running) return;
    const rigid = Object.values(state.entities).filter((e) => e.tags.includes(RIGID_TAG) && e.physics && !e.physics.isKinematic);
    const w = world.current;
    if (!rigid.length) {
      if (w.bodies.length) {
        w.bodies = [];
        written.current.clear();
      }
      return;
    }
    const byId = new Map(w.bodies.map((b) => [b.id, b]));
    const keep: RBody[] = [];
    for (const e of rigid) {
      let body = byId.get(e.id);
      const was = written.current.get(e.id);
      const h = { x: Math.abs(e.transform.scale.x) / 2, y: Math.abs(e.transform.scale.y) / 2, z: Math.abs(e.transform.scale.z) / 2 };
      if (!body || far(body.h, h, 1e-4)) {
        body = makeBody(e.id, e.transform.position, e.transform.rotation, h, Math.max(0.05, e.physics!.mass || 1));
      } else if (!was || far(was.p, e.transform.position, 1e-4)) {
        // Moved from outside: start again from where it is.
        body.p = { ...e.transform.position };
        body.q = { ...e.transform.rotation };
        body.v = { x: 0, y: 0, z: 0 };
        body.w = { x: 0, y: 0, z: 0 };
        body.asleep = false;
        body.still = 0;
      }
      const v = e.physics!.velocity;
      if (was && far(was.v, v, 0.3)) {
        // A kick: high on the body, so a domino tips rather than slides.
        const m = 1 / (body.invM || 1);
        push(body, { x: (v.x - body.v.x) * m * 0.6, y: 0, z: (v.z - body.v.z) * m * 0.6 }, { x: body.p.x, y: body.p.y + body.h.y * 0.7, z: body.p.z });
      }
      keep.push(body);
    }
    w.bodies = keep;
    const statics = solidsFor(state.entities).filter((s) => !s.dynamic);
    const moved = stepRigid(w, Math.min(delta, 1 / 30), state.gravity, statics, groundAt);
    if (!moved.size && written.current.size === keep.length) return;
    const bodies = new Map(keep.map((b) => [b.id, b]));
    useForge.setState((s) => {
      const entities = { ...s.entities };
      for (const e of rigid) {
        const b = bodies.get(e.id);
        const now = entities[e.id] as Entity | undefined;
        if (!b || !now) continue;
        if (!moved.has(b.id) && written.current.has(b.id)) continue;
        entities[e.id] = {
          ...now,
          transform: { ...now.transform, position: { ...b.p }, rotation: { ...b.q } },
          physics: { ...now.physics!, velocity: { ...b.v }, angularVelocity: { ...b.w } },
        };
        written.current.set(b.id, { p: { ...b.p }, q: { ...b.q }, v: { ...b.v } });
      }
      return { entities };
    });
  });
  return null;
}
