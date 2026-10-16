/**
 * Smoke rings (src/engine/vortex.ts): "blow a smoke ring" and one leaves your head the way you
 * look, a torus of smoke rolling round its core as it glides; "blow two smoke rings" sends a
 * second, smaller one after it that catches up and leapfrogs through. Smoke is tracer particles
 * carried by the rings' own velocity field, thinning out as the rings weaken.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, CanvasTexture, NormalBlending } from "three";
import { makeRing, stepRings, tracersFor, velocityAt, type Ring, type V } from "@/engine/vortex";
import { useForge } from "@/engine/store";
import { lookPose } from "./look";

export const SMOKE_RING_EVENT = "forge:smoke-ring";
const PER_RING = 360;
const MAX = PER_RING * 6;
const LIFE = 10;

type Puff = { rings: Ring[]; smoke: V[]; age: number; pending: number; next: number; axis: V; at: V };

function dotTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  if (!g) return null;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.3)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

export function SmokeRings() {
  const puffs = useRef<Puff[]>([]);
  const dot = useMemo(dotTexture, []);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(MAX * 3).fill(-99), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(MAX * 4), 4));
    return g;
  }, []);

  useEffect(() => {
    const blow = (event: Event) => {
      const count = Math.max(1, Math.min(5, Number((event as CustomEvent<{ count?: number }>).detail?.count) || 1));
      const me = Object.values(useForge.getState().entities).find((e) => e.tags.includes("architect"));
      if (!me) return;
      const p = me.transform.position;
      const cp = Math.cos(lookPose.pitch);
      const axis = { x: Math.sin(lookPose.yaw) * cp, y: Math.sin(lookPose.pitch) + 0.05, z: Math.cos(lookPose.yaw) * cp };
      const at = { x: p.x + axis.x * 0.4, y: p.y + 0.6, z: p.z + axis.z * 0.4 };
      if (puffs.current.length >= 3) puffs.current.shift();
      puffs.current.push({ rings: [], smoke: [], age: 0, pending: count, next: 0, axis, at });
    };
    window.addEventListener(SMOKE_RING_EVENT, blow);
    return () => window.removeEventListener(SMOKE_RING_EVENT, blow);
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const pos = geometry.getAttribute("position") as BufferAttribute;
    const col = geometry.getAttribute("color") as BufferAttribute;
    let k = 0;
    for (const puff of puffs.current) {
      puff.age += dt;
      puff.next -= dt;
      if (puff.pending > 0 && puff.next <= 0) {
        // Each ring after the first is a little smaller, so it catches up and goes through.
        const n = puff.rings.length;
        const ring = makeRing(puff.at, puff.axis, 0.24 - n * 0.035, 0.85 + n * 0.05);
        puff.rings.push(ring);
        puff.smoke.push(...tracersFor(ring, PER_RING, 7 + n));
        puff.pending -= 1;
        puff.next = 0.45;
      }
      stepRings(puff.rings, dt, 0.08);
      const fade = Math.max(0, 1 - puff.age / LIFE);
      for (const s of puff.smoke) {
        const v = velocityAt(s, puff.rings);
        s.x += v.x * dt + (Math.random() - 0.5) * 0.004;
        s.y += v.y * dt + 0.02 * dt + (Math.random() - 0.5) * 0.004;
        s.z += v.z * dt + (Math.random() - 0.5) * 0.004;
        if (k >= MAX) break;
        pos.setXYZ(k, s.x, s.y, s.z);
        col.setXYZW(k, 0.95, 0.95, 1, 0.55 * fade);
        k += 1;
      }
    }
    puffs.current = puffs.current.filter((p) => p.age < LIFE);
    for (let i = k; i < MAX; i += 1) pos.setXYZ(i, 0, -99, 0);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });

  return (
    <points geometry={geometry} frustumCulled={false} raycast={() => null}>
      <pointsMaterial map={dot} size={0.09} sizeAttenuation vertexColors transparent depthWrite={false} blending={NormalBlending} />
    </points>
  );
}
