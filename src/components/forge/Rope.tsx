/**
 * Draws and steps the world's ropes, cables and string lights (rope.ts). Each is a tube rebuilt in
 * place every frame along the simulated chain (parallel-transport frames, so it never twists), with a
 * braided texture on ropes, a glossy jacket on cables, and glowing bulbs on string lights that the
 * bloom picks up. People (you and the townsfolk) push them aside; the weather's wind sways them.
 */
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, InstancedMesh, Matrix4, RepeatWrapping, SRGBColorSpace, Vector3, type Mesh } from "three";
import { useShallow } from "zustand/react/shallow";
import { groundAt, solidsFor, type Solid } from "@/engine/physics";
import { endPoint, makeRope, parseEnd, ROPE_KINDS, ROPE_LOOK, ROPE_TAG, stepRope, type Pusher, type RopeKind } from "@/engine/rope";
import { useForge } from "@/engine/store";
import { weatherOf } from "@/engine/weather";
import type { Entity } from "@/engine/types";
import { townBodies } from "./body-state";

const SIDES = 8;
/** Each link is drawn as this many rings (Catmull-Rom between particles), so the curve is smooth. */
const SPLIT = 2;
const BULB_GAP = 0.42;
const BULB_TONES = ["#ffd38a", "#ffb35c", "#ffe7b8", "#ff9a6b", "#fff0c8"];

let braid: CanvasTexture | null = null;
/** Twisted strands, drawn once: diagonal bands with a darker groove between. */
function braidTexture(): CanvasTexture | null {
  if (braid || typeof document === "undefined") return braid;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#cfc2ad";
  g.fillRect(0, 0, 64, 64);
  for (let i = -2; i < 4; i += 1) {
    const grad = g.createLinearGradient(0, i * 21, 64, i * 21 + 30);
    grad.addColorStop(0, "#8d7a60");
    grad.addColorStop(0.5, "#f1e6d2");
    grad.addColorStop(1, "#8d7a60");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, i * 21);
    g.lineTo(64, i * 21 + 32);
    g.lineTo(64, i * 21 + 50);
    g.lineTo(0, i * 21 + 18);
    g.closePath();
    g.fill();
  }
  braid = new CanvasTexture(c);
  braid.wrapS = RepeatWrapping;
  braid.wrapT = RepeatWrapping;
  braid.colorSpace = SRGBColorSpace;
  return braid;
}

let glow: CanvasTexture | null = null;
/** A soft round glow, bright in the middle and fading to nothing. */
function glowTexture(): CanvasTexture | null {
  if (glow || typeof document === "undefined") return glow;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  if (!g) return null;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glow = new CanvasTexture(c);
  return glow;
}

type Spec = { id: number; kind: RopeKind; a: string; b: string; length: number; color: string };

function specOf(e: Entity): Spec | null {
  const kind = e.customData.rope as RopeKind;
  if (!ROPE_KINDS.includes(kind)) return null;
  const length = Number(e.customData.length);
  if (!Number.isFinite(length) || length <= 0) return null;
  return { id: e.id, kind, a: e.customData.a ?? "", b: e.customData.b ?? "", length, color: e.customData.color || ROPE_LOOK[kind].color };
}

export function Ropes() {
  // Only the ropes' own settings re-render this; their motion lives in the frame loop.
  const keys = useForge(
    useShallow((s) =>
      Object.values(s.entities)
        .filter((e) => e.tags.includes(ROPE_TAG))
        .map((e) => [e.id, e.customData.rope, e.customData.a, e.customData.b, e.customData.length, e.customData.color].join("|")),
    ),
  );
  const specs = useMemo(
    () =>
      keys
        .map((key) => {
          const [id, kind, a, b, length, color] = key.split("|");
          return specOf({ id: Number(id), customData: { rope: kind, a, b, length, color }, tags: [ROPE_TAG] } as unknown as Entity);
        })
        .filter((s): s is Spec => s !== null),
    [keys],
  );
  return (
    <>
      {specs.map((spec) => (
        <RopeView key={`${spec.id}:${spec.kind}:${spec.a}:${spec.b}:${spec.length}`} spec={spec} />
      ))}
    </>
  );
}

function RopeView({ spec }: { spec: Spec }) {
  const look = ROPE_LOOK[spec.kind];
  const ends = useMemo(() => ({ a: parseEnd(spec.a), b: parseEnd(spec.b) }), [spec.a, spec.b]);
  const sim = useMemo(() => {
    const entities = useForge.getState().entities;
    const a = endPoint(ends.a, entities) ?? { x: 0, y: 2, z: 0 };
    return makeRope({ kind: spec.kind, a, b: endPoint(ends.b, entities), length: spec.length });
  }, [ends, spec.kind, spec.length]);
  const rings = (sim.n - 1) * SPLIT + 1;
  const radius = look.radius;
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const verts = rings * (SIDES + 1);
    g.setAttribute("position", new BufferAttribute(new Float32Array(verts * 3), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(verts * 3), 3));
    const uv = new Float32Array(verts * 2);
    const along = spec.length / (radius * Math.PI * 2 * 2.5);
    for (let r = 0; r < rings; r += 1) {
      for (let s = 0; s <= SIDES; s += 1) {
        uv[(r * (SIDES + 1) + s) * 2] = s / SIDES;
        uv[(r * (SIDES + 1) + s) * 2 + 1] = (r / (rings - 1)) * along;
      }
    }
    g.setAttribute("uv", new BufferAttribute(uv, 2));
    const index: number[] = [];
    for (let r = 0; r < rings - 1; r += 1) {
      for (let s = 0; s < SIDES; s += 1) {
        const i = r * (SIDES + 1) + s;
        const j = i + SIDES + 1;
        index.push(i, j, i + 1, i + 1, j, j + 1);
      }
    }
    g.setIndex(index);
    return g;
  }, [rings, radius, spec.length]);
  const mesh = useRef<Mesh>(null);
  const bulbCount = spec.kind === "lights" ? Math.max(2, Math.floor(spec.length / BULB_GAP)) : 0;
  const bulbs = useRef<InstancedMesh>(null);
  const halos = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(Math.max(1, bulbCount) * 3), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(Math.max(1, bulbCount) * 3), 3));
    return g;
  }, [bulbCount]);
  const scratch = useMemo(() => ({ curve: new Float64Array(rings * 3), t: new Vector3(), n: new Vector3(), bn: new Vector3(), prevT: new Vector3(), m: new Matrix4(), c: new Color(), clock: Math.random() * 10, near: [] as Solid[] }), [rings]);
  const map = spec.kind === "rope" ? braidTexture() : null;

  useFrame((_, delta) => {
    const state = useForge.getState();
    const a = endPoint(ends.a, state.entities);
    if (!a) return;
    const b = ends.b == null ? null : endPoint(ends.b, state.entities);
    const sc = scratch;
    sc.clock += delta;
    // What it can touch: solids near it (not the things it is tied to), and people.
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < sim.n; i += 1) {
      minX = Math.min(minX, sim.pos[i * 3]);
      maxX = Math.max(maxX, sim.pos[i * 3]);
      minZ = Math.min(minZ, sim.pos[i * 3 + 2]);
      maxZ = Math.max(maxZ, sim.pos[i * 3 + 2]);
    }
    const tied = new Set([ends.a, ends.b].filter((e): e is number => typeof e === "number"));
    sc.near.length = 0;
    for (const s of solidsFor(state.entities)) {
      if (tied.has(s.id) || s.max.x < minX - 0.6 || s.min.x > maxX + 0.6 || s.max.z < minZ - 0.6 || s.min.z > maxZ + 0.6) continue;
      sc.near.push(s);
    }
    const pushers: Pusher[] = [];
    for (const e of Object.values(state.entities)) {
      if (!e.tags.includes("architect") || tied.has(e.id)) continue;
      const p = e.transform.position;
      pushers.push({ x: p.x, y: p.y - 0.62, z: p.z, r: 0.27, h: 1.5 });
    }
    for (const body of Object.values(townBodies)) pushers.push({ x: body.x, y: groundAt(body.x, body.z), z: body.z, r: 0.25, h: 1.5 });
    const w = weatherOf(state).wind;
    const gust = w * 3.2 * (0.6 + 0.4 * Math.sin(sc.clock * 0.7) + 0.25 * Math.sin(sc.clock * 2.3 + spec.id));
    stepRope(sim, spec.kind, a, b, delta, { solids: sc.near, ground: groundAt, wind: { x: gust * 0.8, z: gust * 0.6 }, pushers });

    // A smooth curve through the particles (Catmull-Rom), SPLIT rings per link.
    const P = sim.pos;
    const get = (i: number, k: number) => P[Math.max(0, Math.min(sim.n - 1, i)) * 3 + k];
    for (let i = 0; i < sim.n - 1; i += 1) {
      for (let s = 0; s < SPLIT; s += 1) {
        const t = s / SPLIT;
        const t2 = t * t;
        const t3 = t2 * t;
        for (let k = 0; k < 3; k += 1) {
          const p0 = get(i - 1, k);
          const p1 = get(i, k);
          const p2 = get(i + 1, k);
          const p3 = get(i + 2, k);
          sc.curve[(i * SPLIT + s) * 3 + k] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
        }
      }
    }
    for (let k = 0; k < 3; k += 1) sc.curve[(rings - 1) * 3 + k] = P[(sim.n - 1) * 3 + k];

    // Rings around it, framed by parallel transport (no sudden twists).
    const pos = geometry.getAttribute("position") as BufferAttribute;
    const nor = geometry.getAttribute("normal") as BufferAttribute;
    const C = sc.curve;
    for (let r = 0; r < rings; r += 1) {
      const i0 = Math.max(0, r - 1);
      const i1 = Math.min(rings - 1, r + 1);
      sc.t.set(C[i1 * 3] - C[i0 * 3], C[i1 * 3 + 1] - C[i0 * 3 + 1], C[i1 * 3 + 2] - C[i0 * 3 + 2]).normalize();
      if (r === 0) {
        sc.n.set(0, 1, 0);
        if (Math.abs(sc.t.y) > 0.9) sc.n.set(1, 0, 0);
        sc.n.sub(sc.bn.copy(sc.t).multiplyScalar(sc.n.dot(sc.t))).normalize();
      } else {
        // Carry the last normal over, minus whatever now lies along the tangent.
        sc.n.sub(sc.bn.copy(sc.t).multiplyScalar(sc.n.dot(sc.t))).normalize();
      }
      sc.bn.crossVectors(sc.t, sc.n);
      for (let s = 0; s <= SIDES; s += 1) {
        const ang = (s / SIDES) * Math.PI * 2;
        const cx = Math.cos(ang);
        const sx = Math.sin(ang);
        const nx = sc.n.x * cx + sc.bn.x * sx;
        const ny = sc.n.y * cx + sc.bn.y * sx;
        const nz = sc.n.z * cx + sc.bn.z * sx;
        const v = r * (SIDES + 1) + s;
        pos.setXYZ(v, C[r * 3] + nx * radius, C[r * 3 + 1] + ny * radius, C[r * 3 + 2] + nz * radius);
        nor.setXYZ(v, nx, ny, nz);
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    geometry.computeBoundingSphere();

    // Bulbs hang just under the cable at even spacing, with a slow, warm shimmer.
    const inst = bulbs.current;
    if (inst) {
      for (let k = 0; k < bulbCount; k += 1) {
        const f = ((k + 0.5) / bulbCount) * (rings - 1);
        const r = Math.floor(f);
        const u = f - r;
        const r2 = Math.min(rings - 1, r + 1);
        const x = C[r * 3] + (C[r2 * 3] - C[r * 3]) * u;
        const y = C[r * 3 + 1] + (C[r2 * 3 + 1] - C[r * 3 + 1]) * u;
        const z = C[r * 3 + 2] + (C[r2 * 3 + 2] - C[r * 3 + 2]) * u;
        sc.m.makeTranslation(x, y - 0.055, z);
        inst.setMatrixAt(k, sc.m);
        (halos.getAttribute("position") as BufferAttribute).setXYZ(k, x, y - 0.055, z);
        const glow = 2.6 + Math.sin(sc.clock * 1.3 + k * 1.7) * 0.35;
        sc.c.set(BULB_TONES[k % BULB_TONES.length]).multiplyScalar(glow);
        inst.setColorAt(k, sc.c);
        sc.c.multiplyScalar(0.5);
        (halos.getAttribute("color") as BufferAttribute).setXYZ(k, sc.c.r, sc.c.g, sc.c.b);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.computeBoundingSphere();
      halos.getAttribute("position").needsUpdate = true;
      halos.getAttribute("color").needsUpdate = true;
    }
  });

  const hook = typeof ends.a !== "number" && ends.a ? ends.a : null;
  return (
    <group>
      <mesh ref={mesh} geometry={geometry} castShadow frustumCulled={false}>
        {spec.kind === "rope" ? (
          <meshStandardMaterial map={map} color={spec.color} roughness={0.92} metalness={0} />
        ) : (
          <meshPhysicalMaterial color={spec.color} roughness={0.32} metalness={0.05} clearcoat={0.6} clearcoatRoughness={0.3} />
        )}
      </mesh>
      {bulbCount ? (
        <instancedMesh ref={bulbs} args={[undefined, undefined, bulbCount]} frustumCulled={false}>
          <sphereGeometry args={[0.042, 12, 10]} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
      ) : null}
      {bulbCount ? (
        // A soft glow round each bulb, so they read as lit on the rungs without bloom too.
        <points geometry={halos} frustumCulled={false} raycast={() => null}>
          <pointsMaterial map={glowTexture()} size={0.5} sizeAttenuation vertexColors transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
        </points>
      ) : null}
      {hook ? (
        // A ring bolted in the air for a rope hung from nothing.
        <mesh position={[hook.x, hook.y + 0.04, hook.z]} rotation={[0, 0, 0]} castShadow>
          <torusGeometry args={[0.06, 0.013, 8, 20]} />
          <meshStandardMaterial color="#9aa3ad" roughness={0.3} metalness={0.85} />
        </mesh>
      ) : null}
    </group>
  );
}
