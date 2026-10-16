/**
 * Fire on screen (rules in src/engine/fire.ts): flames as camera-facing sheets with a noise shader
 * (a white-hot core through yellow and orange to red licks, glowing past white so the bloom takes
 * them), smoke that rises and drifts with the wind, embers that swirl up, a warm flickering light,
 * steam where water hits the flames, and your water spray (hold H, or the water bubble).
 */
import { useFrame } from "@react-three/fiber";
import { Droplets } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, InstancedBufferAttribute, InstancedMesh, Matrix4, NormalBlending, PlaneGeometry, PointLight, Points, ShaderMaterial, Vector3 } from "three";
import { burningCells, cellCentre, douse, emptyFire, flammable, fuelFrom, igniteThing, stepFire, type FireGrid } from "@/engine/fire";
import { groundAt, solidsFor } from "@/engine/physics";
import { useForge } from "@/engine/store";
import { weatherOf } from "@/engine/weather";
import { fireNear, spray, useFireNear } from "./body-state";
import { lookPose } from "./look";

const MAX_FLAMES = 700;
const SMOKE = 420;
const EMBERS = 320;
const DROPS = 260;

const FLAME_VERT = /* glsl */ `
  attribute float seed;
  varying vec2 vUv;
  varying float vSeed;
  void main() {
    vUv = uv;
    vSeed = seed;
    vec3 centre = vec3(instanceMatrix[3]);
    float w = length(vec3(instanceMatrix[0]));
    float h = length(vec3(instanceMatrix[1]));
    // Stand upright and turn to face the camera round the vertical.
    vec3 toCam = cameraPosition - centre;
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    vec3 p = centre + right * position.x * w + vec3(0.0, (position.y + 0.5) * h, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const FLAME_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vSeed;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  void main() {
    vec2 uv = vUv;
    float t = uTime * 1.6 + vSeed * 17.0;
    // Licks: the edges wander, more toward the tip.
    float n = fbm(vec2(uv.x * 3.0 + vSeed * 5.0, uv.y * 2.4 - t * 1.4));
    float sway = (fbm(vec2(uv.y * 1.5 - t * 0.7, vSeed * 3.0)) - 0.5) * 0.35 * uv.y;
    float x = abs(uv.x - 0.5 - sway) * 2.0;
    float width = (1.0 - uv.y) * 0.9 + 0.05;
    float body = smoothstep(width, width * 0.35, x + (n - 0.5) * 0.55 * (0.4 + uv.y));
    float tip = smoothstep(1.0, 0.25, uv.y + (n - 0.5) * 0.5);
    float base = smoothstep(0.0, 0.12, uv.y);
    float f = body * tip * base;
    if (f < 0.01) discard;
    float core = smoothstep(0.55, 1.0, f) * (1.0 - uv.y);
    vec3 col = mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.45, 0.05), smoothstep(0.1, 0.5, f));
    col = mix(col, vec3(1.0, 0.85, 0.35), smoothstep(0.45, 0.85, f));
    col += vec3(1.0, 0.92, 0.7) * core * 0.8;
    gl_FragColor = vec4(col * f * 1.35, f);
  }
`;

function softDot(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  if (!g) return null;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

type Puff = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; shade: number };

function pool(n: number): Puff[] {
  return Array.from({ length: n }, () => ({ x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0, shade: 0 }));
}

function pointsOf(n: number, alpha: boolean): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(n * (alpha ? 4 : 3)), alpha ? 4 : 3));
  return g;
}

const hash = (i: number) => {
  const v = Math.sin(i * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

export function Fire() {
  const grid = useRef<FireGrid>(emptyFire());
  const seen = useRef<{ fuel: string; ignite: Map<number, string>; douse: Map<number, string>; any: boolean; quiet: number }>({ fuel: "", ignite: new Map(), douse: new Map(), any: false, quiet: 0 });
  const flames = useRef<InstancedMesh>(null);
  const light = useRef<PointLight>(null);
  const smokePts = useRef<Points>(null);
  const emberPts = useRef<Points>(null);
  const dropPts = useRef<Points>(null);
  const dot = useMemo(softDot, []);
  const flameMat = useMemo(
    () => new ShaderMaterial({ vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
    [],
  );
  const flameGeo = useMemo(() => {
    const g = new PlaneGeometry(1, 1);
    g.setAttribute("seed", new InstancedBufferAttribute(new Float32Array(MAX_FLAMES).map((_, i) => hash(i + 1)), 1));
    return g;
  }, []);
  const smokeGeo = useMemo(() => pointsOf(SMOKE, true), []);
  const emberGeo = useMemo(() => pointsOf(EMBERS, false), []);
  const dropGeo = useMemo(() => pointsOf(DROPS, false), []);
  const parts = useRef({ smoke: pool(SMOKE), embers: pool(EMBERS), drops: pool(DROPS), sNext: 0, eNext: 0, dNext: 0, t: 0, m: new Matrix4(), v: new Vector3() });

  useEffect(() => () => spray.set(false), []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const state = useForge.getState();
    const g = grid.current;
    const s = seen.current;
    const P = parts.current;
    P.t += dt;
    flameMat.uniforms.uTime.value = P.t;

    // Fuel follows the flammable things (only rebuilt when they change).
    const burnable = Object.values(state.entities).filter(flammable);
    const key = burnable.map((e) => `${e.id}:${e.transform.position.x.toFixed(2)},${e.transform.position.z.toFixed(2)},${e.transform.scale.x.toFixed(2)}`).join("|");
    if (key !== s.fuel) {
      s.fuel = key;
      fuelFrom(g, state);
    }
    for (const e of Object.values(state.entities)) {
      const ig = e.customData.ignite;
      if (ig && s.ignite.get(e.id) !== ig) {
        s.ignite.set(e.id, ig);
        if (e.customData.charred !== "1" && igniteThing(g, e.id) > 0) s.quiet = 0;
      }
      const d = e.customData.douse;
      if (d && s.douse.get(e.id) !== d) {
        s.douse.set(e.id, d);
        for (const i of burningCells(g)) {
          const c = cellCentre(g, i);
          douse(g, c.x, c.z, 0.3, 1);
          for (let k = 0; k < 3; k += 1) puff(P.smoke, (P.sNext = (P.sNext + 1) % SMOKE), c.x, g.top[i] + 0.2, c.z, 0.9, 1.4);
        }
      }
    }

    const w = weatherOf(state);
    const wind = { x: w.wind * 6 * 0.8, z: w.wind * 6 * 0.6 };
    // With nothing burning for a while (and no rain to soak things), the grid rests.
    const rain = Math.max(w.rain, w.snow * 0.5);
    s.quiet = s.any || rain > 0 ? 0 : s.quiet + dt;
    const step = s.quiet > 6 && !spray.get() ? { burnedOut: [], burning: 0 } : stepFire(g, dt, { wind, rain });
    if (step.burnedOut.length) {
      // Burnt out: charred black, and no longer fuel.
      useForge.setState((st) => {
        const entities = { ...st.entities };
        for (const id of step.burnedOut) {
          const e = entities[id];
          if (!e) continue;
          const { ignite: _i, flammable: _f, ...rest } = e.customData;
          entities[id] = { ...e, customData: { ...rest, charred: "1", color: "#211912", flammable: "0" } };
        }
        return { entities };
      });
    }

    // Flames: two sheets per burning cell, sized by heat, on top of what burns.
    const lit = step.burning ? burningCells(g) : [];
    const mesh = flames.current;
    let count = 0;
    let cx = 0;
    let cz = 0;
    let cy = 0;
    if (mesh) {
      for (const i of lit) {
        const c = cellCentre(g, i);
        cx += c.x;
        cz += c.z;
        cy += g.top[i];
        for (let k = 0; k < 2 && count < MAX_FLAMES; k += 1) {
          const j = hash(i * 3 + k);
          const h = (0.55 + g.heat[i] * 0.85) * (0.75 + j * 0.5) * (1 + 0.12 * Math.sin(P.t * 9 + j * 20));
          P.m.makeScale(0.5 + j * 0.25, h, 1);
          P.m.setPosition(c.x + (j - 0.5) * 0.35, g.top[i] - 0.05, c.z + (hash(i * 7 + k) - 0.5) * 0.35);
          mesh.setMatrixAt(count, P.m);
          count += 1;
        }
        // Smoke and embers rise from it.
        if (Math.random() < dt * 5) puff(P.smoke, (P.sNext = (P.sNext + 1) % SMOKE), c.x, g.top[i] + 0.9, c.z, 0.25, 0.5);
        if (Math.random() < dt * 4) {
          const e = P.embers[(P.eNext = (P.eNext + 1) % EMBERS)];
          Object.assign(e, { x: c.x + (Math.random() - 0.5) * 0.4, y: g.top[i] + 0.3, z: c.z + (Math.random() - 0.5) * 0.4, vx: (Math.random() - 0.5) * 0.6, vy: 1.4 + Math.random() * 1.6, vz: (Math.random() - 0.5) * 0.6, life: 1.6 + Math.random() * 1.4, max: 3, size: 1, shade: 0 });
        }
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = count > 0;
    }
    if (light.current) {
      const n = lit.length;
      light.current.visible = n > 0;
      if (n) {
        light.current.position.set(cx / n, cy / n + 0.9, cz / n);
        light.current.intensity = Math.min(9, 1.5 + n * 0.35) * (0.82 + 0.18 * Math.sin(P.t * 13) * Math.sin(P.t * 7.3));
      }
    }

    // The water spray: from your hands, the way you look, arcing down; it douses where it lands.
    const me = Object.values(state.entities).find((e) => e.tags.includes("architect"));
    if (spray.get() && me) {
      const p = me.transform.position;
      const cosP = Math.cos(lookPose.pitch + 0.25);
      for (let k = 0; k < Math.ceil(dt * 70); k += 1) {
        const d = P.drops[(P.dNext = (P.dNext + 1) % DROPS)];
        const jitter = (Math.random() - 0.5) * 0.12;
        const yaw = lookPose.yaw + jitter;
        const speed = 8.5 + Math.random() * 1.5;
        Object.assign(d, { x: p.x + Math.sin(yaw) * 0.45, y: p.y + 0.25, z: p.z + Math.cos(yaw) * 0.45, vx: Math.sin(yaw) * cosP * speed, vy: Math.sin(lookPose.pitch + 0.25) * speed + (Math.random() - 0.5), vz: Math.cos(yaw) * cosP * speed, life: 2, max: 2, size: 1, shade: 0 });
      }
    }
    const solids = P.drops.some((d) => d.life > 0) ? solidsFor(state.entities) : [];
    for (const d of P.drops) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.vy -= 9.81 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      let floor = groundAt(d.x, d.z);
      for (const sol of solids) if (d.x > sol.min.x && d.x < sol.max.x && d.z > sol.min.z && d.z < sol.max.z && sol.max.y <= d.y + 0.3) floor = Math.max(floor, sol.max.y);
      for (const i of lit) {
        const c = cellCentre(g, i);
        if (Math.abs(c.x - d.x) < 0.3 && Math.abs(c.z - d.z) < 0.3 && d.y < g.top[i] + 1.2) floor = Math.max(floor, d.y);
      }
      if (d.y <= floor) {
        if (douse(g, d.x, d.z, 0.45, 0.12) > 0) puff(P.smoke, (P.sNext = (P.sNext + 1) % SMOKE), d.x, d.y + 0.3, d.z, 0.95, 1.1);
        d.life = 0;
      }
    }

    // Smoke and steam rise, spread and fade; embers swirl up and wink out.
    const sp = smokeGeo.getAttribute("position") as BufferAttribute;
    const sc = smokeGeo.getAttribute("color") as BufferAttribute;
    P.smoke.forEach((q, i) => {
      if (q.life > 0) {
        q.life -= dt;
        q.vy += 0.15 * dt;
        q.x += (q.vx + wind.x * 0.25) * dt;
        q.y += q.vy * dt;
        q.z += (q.vz + wind.z * 0.25) * dt;
        q.size += dt * 0.6;
      }
      const a = q.life > 0 ? Math.min(1, q.life / q.max) * (1 - Math.min(1, q.life / q.max) * 0.3) * 0.55 : 0;
      sp.setXYZ(i, q.x, q.life > 0 ? q.y : -99, q.z);
      sc.setXYZW(i, q.shade, q.shade, q.shade * 1.02, a);
    });
    sp.needsUpdate = true;
    sc.needsUpdate = true;
    const ep = emberGeo.getAttribute("position") as BufferAttribute;
    const ec = emberGeo.getAttribute("color") as BufferAttribute;
    P.embers.forEach((q, i) => {
      if (q.life > 0) {
        q.life -= dt;
        q.vx += Math.sin(P.t * 3 + i) * dt * 1.2 + wind.x * 0.2 * dt;
        q.vz += Math.cos(P.t * 2.6 + i) * dt * 1.2 + wind.z * 0.2 * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.z += q.vz * dt;
      }
      const glow = q.life > 0 ? Math.min(1, q.life) * (0.7 + 0.3 * Math.sin(P.t * 20 + i)) : 0;
      ep.setXYZ(i, q.x, q.life > 0 ? q.y : -99, q.z);
      ec.setXYZ(i, 3 * glow, 1.2 * glow, 0.25 * glow);
    });
    ep.needsUpdate = true;
    ec.needsUpdate = true;
    const dp = dropGeo.getAttribute("position") as BufferAttribute;
    const dc = dropGeo.getAttribute("color") as BufferAttribute;
    P.drops.forEach((q, i) => {
      dp.setXYZ(i, q.x, q.life > 0 ? q.y : -99, q.z);
      dc.setXYZ(i, 0.75, 0.9, 1.2);
    });
    dp.needsUpdate = true;
    dc.needsUpdate = true;

    // Is there a fire close enough to spray? (shows the water bubble on touch screens)
    let near = false;
    if (me && lit.length) {
      const p = me.transform.position;
      near = lit.some((i) => {
        const c = cellCentre(g, i);
        return Math.hypot(c.x - p.x, c.z - p.z) < 9;
      });
    }
    if (near !== fireNear.get()) fireNear.set(near);
    s.any = lit.length > 0;
  });

  return (
    <>
      <instancedMesh ref={flames} args={[flameGeo, flameMat, MAX_FLAMES]} frustumCulled={false} raycast={() => null} />
      <pointLight ref={light} color="#ff8a3a" intensity={0} distance={9} decay={1.6} visible={false} />
      <points ref={smokePts} geometry={smokeGeo} frustumCulled={false} raycast={() => null}>
        <pointsMaterial map={dot} size={1.1} sizeAttenuation vertexColors transparent depthWrite={false} blending={NormalBlending} />
      </points>
      <points ref={emberPts} geometry={emberGeo} frustumCulled={false} raycast={() => null}>
        <pointsMaterial map={dot} size={0.07} sizeAttenuation vertexColors transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </points>
      <points ref={dropPts} geometry={dropGeo} frustumCulled={false} raycast={() => null}>
        <pointsMaterial map={dot} size={0.09} sizeAttenuation vertexColors transparent depthWrite={false} opacity={0.85} />
      </points>
    </>
  );
}

/** A smoke (shade dark) or steam (shade light) puff. */
function puff(list: Puff[], i: number, x: number, y: number, z: number, shade: number, size: number) {
  Object.assign(list[i], { x: x + (Math.random() - 0.5) * 0.3, y, z: z + (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 0.2, vy: 0.6 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.2, life: 2.5 + Math.random() * 1.5, max: 4, size, shade: shade * (0.85 + Math.random() * 0.15) });
}

/** The water bubble (touch) and the H key, shown when a fire is close. */
export function FireControls() {
  const near = useFireNear();
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.code !== "KeyH") return;
      spray.set(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "KeyH") spray.set(false);
    };
    const stop = () => spray.set(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", stop);
    };
  }, []);
  if (!near) return null;
  return (
    <button
      type="button"
      className="visor-key bubble-icon fire-spray"
      aria-label="Spray water"
      title="Spray water (hold H)"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        spray.set(true);
      }}
      onPointerUp={() => spray.set(false)}
      onPointerCancel={() => spray.set(false)}
    >
      <Droplets aria-hidden />
    </button>
  );
}
