/**
 * The engine room's machines (src/engine/gauges.ts). Each gauge entity names a stat, a mesh and a
 * skin; GaugeMesh looks the mesh up in GAUGE_PARTS and hands it a live, smoothed reading.
 *
 * Adding a mesh: write a component that takes PartProps, add it to GAUGE_PARTS under the id you
 * added to MESHES in gauges.ts. It is drawn in metres, standing on y = 0, facing +z. Read the
 * reading from `reading.current` inside useFrame (never in render), so the gauges cost no React
 * renders while they move.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import { BufferGeometry, CanvasTexture, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, SRGBColorSpace, BoxGeometry, DoubleSide, AdditiveBlending } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Entity } from "@/engine/types";
import { gaugeLevel, gaugeMood, gaugeText, meshById, skinById, statById, STATS, SKINS, type GaugeMood, type SkinSpec, type StatSpec } from "@/engine/gauges";
import { liveSample, usePerf } from "./PerfOverlay";

type Reading = {
  /** Smoothed 0..1. */
  level: number;
  known: boolean;
  mood: GaugeMood;
  /** Seconds since mount, for idle motion. */
  t: number;
};

type PartProps = { skin: SkinSpec; stat: StatSpec; reading: MutableRefObject<Reading>; rich: boolean };

const HALF_PI = Math.PI / 2;

/** Lerp the reading toward the device's value every frame. */
function useReading(stat: StatSpec): MutableRefObject<Reading> {
  const reading = useRef<Reading>({ level: 0, known: false, mood: "unknown", t: 0 });
  useFrame((_, delta) => {
    const r = reading.current;
    const dt = Math.min(delta, 0.1);
    r.t += dt;
    const level = gaugeLevel(stat, liveSample);
    r.known = level != null;
    r.mood = gaugeMood(stat, level);
    // An unknown reading rests low with a slow sway, so the machine still looks alive.
    const target = level ?? 0.08 + Math.sin(r.t * 0.7) * 0.03;
    r.level += (target - r.level) * Math.min(1, dt * 3);
  });
  return reading;
}

/** The glow colour for a mood: the skin's own, turning hot toward danger. */
function moodColor(skin: SkinSpec, mood: GaugeMood, out: Color): Color {
  const base = new Color(skin.glow);
  if (mood === "danger") return out.copy(base).lerp(new Color(skin.hot), 0.9);
  if (mood === "warn") return out.copy(base).lerp(new Color(skin.hot), 0.45);
  return out.copy(base);
}

/** Emissive material whose colour and strength follow the reading. */
function useGlow(skin: SkinSpec, reading: MutableRefObject<Reading>, scale = 1) {
  const material = useMemo(() => new MeshStandardMaterial({ color: skin.glow, emissive: skin.glow, emissiveIntensity: skin.emissive, roughness: 0.3, metalness: 0, toneMapped: false }), [skin]);
  const tmp = useMemo(() => new Color(), []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    const r = reading.current;
    moodColor(skin, r.mood, tmp);
    material.color.copy(tmp);
    material.emissive.copy(tmp);
    const pulse = r.mood === "danger" ? 0.6 + Math.abs(Math.sin(r.t * 6)) * 0.8 : 1;
    material.emissiveIntensity = (r.known ? skin.emissive : skin.emissive * 0.25) * pulse * scale;
  });
  return material;
}

function Metal({ color, skin, rough }: { color: string; skin: SkinSpec; rough?: number }) {
  return <meshStandardMaterial color={color} metalness={skin.metalness} roughness={rough ?? skin.roughness} />;
}

function Glass({ skin, opacity = 0.28 }: { skin: SkinSpec; opacity?: number }) {
  return <meshStandardMaterial color={skin.glass} transparent opacity={opacity} roughness={0.05} metalness={0.1} depthWrite={false} side={DoubleSide} />;
}

/** A ring of small rivets, merged into one geometry (one draw call). */
function useRivets(radius: number, count: number, size = 0.022): BufferGeometry {
  const geometry = useMemo(() => {
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2;
      const g = new SphereGeometry(size, 6, 4);
      g.translate(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      parts.push(g);
    }
    const merged = mergeGeometries(parts) ?? new BufferGeometry();
    parts.forEach((g) => g.dispose());
    return merged;
  }, [radius, count, size]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

/** Tick marks around a dial face (in the xy plane), merged. From -135° to +135°. */
function useTicks(radius: number, count: number): BufferGeometry {
  const geometry = useMemo(() => {
    const parts: BufferGeometry[] = [];
    for (let i = 0; i <= count; i += 1) {
      const a = (-135 + (270 * i) / count) * (Math.PI / 180);
      const major = i % 5 === 0;
      const g = new BoxGeometry(0.012, major ? 0.07 : 0.04, 0.008);
      g.translate(0, radius - (major ? 0.035 : 0.02), 0);
      g.rotateZ(-a);
      parts.push(g);
    }
    const merged = mergeGeometries(parts) ?? new BufferGeometry();
    parts.forEach((g) => g.dispose());
    return merged;
  }, [radius, count]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

/**
 * A round dial facing +z: face, coloured warn/danger arc, ticks and a needle that sweeps 270°.
 * Used by the dial mesh, and small on the boiler.
 */
function DialFace({ skin, stat, reading, radius }: PartProps & { radius: number }) {
  const needle = useRef<Group>(null);
  const ticks = useTicks(radius, 20);
  const glow = useGlow(skin, reading, 0.6);
  // The arc where the reading is bad, in the face's own angles (three.js measures from +x, counter-clockwise).
  const from = stat.lowIsBad ? 0 : stat.warn;
  const to = stat.lowIsBad ? stat.warn : 1;
  const toTheta = (f: number) => HALF_PI - (-135 + 270 * f) * (Math.PI / 180);
  const thetaStart = toTheta(to);
  const thetaLength = toTheta(from) - thetaStart;
  useFrame(() => {
    const r = reading.current;
    const shake = r.mood === "danger" ? Math.sin(r.t * 40) * 0.02 : 0;
    if (needle.current) needle.current.rotation.z = -((-135 + 270 * r.level) * Math.PI) / 180 + shake;
  });
  return (
    <group>
      <mesh>
        <circleGeometry args={[radius, 48]} />
        <meshStandardMaterial color={skin.face} roughness={0.6} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0, 0.004]} material={glow}>
        <ringGeometry args={[radius * 0.74, radius * 0.86, 40, 1, thetaStart, thetaLength]} />
      </mesh>
      <mesh geometry={ticks} position={[0, 0, 0.006]}>
        <meshStandardMaterial color={skin.needle} roughness={0.5} />
      </mesh>
      <group ref={needle} position={[0, 0, 0.02]}>
        <mesh position={[0, radius * 0.38, 0]}>
          <boxGeometry args={[0.018, radius * 0.86, 0.01]} />
          <meshStandardMaterial color={skin.needle} metalness={0.4} roughness={0.35} />
        </mesh>
      </group>
      <mesh position={[0, 0, 0.03]} rotation={[HALF_PI, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.02, 16]} />
        <Metal color={skin.trim} skin={skin} />
      </mesh>
      <mesh position={[0, 0, 0.012]}>
        <torusGeometry args={[radius, radius * 0.08, 10, 48]} />
        <Metal color={skin.body} skin={skin} />
      </mesh>
      <mesh position={[0, 0, 0.03]}>
        <circleGeometry args={[radius * 0.98, 40]} />
        <Glass skin={skin} opacity={0.12} />
      </mesh>
    </group>
  );
}

/** A plinth every machine stands on. */
function Plinth({ skin, radius = 0.38, height = 0.12 }: { skin: SkinSpec; radius?: number; height?: number }) {
  const rivets = useRivets(radius * 0.86, 12);
  return (
    <group>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[radius * 0.92, radius, height, 28]} />
        <Metal color={skin.trim} skin={skin} rough={skin.roughness + 0.15} />
      </mesh>
      <mesh geometry={rivets} position={[0, height + 0.004, 0]}>
        <Metal color={skin.body} skin={skin} />
      </mesh>
    </group>
  );
}

// ---------- the meshes ----------

function Thermometer({ skin, reading, rich }: PartProps) {
  const liquid = useRef<Mesh>(null);
  const glow = useGlow(skin, reading);
  const tube = 1.25;
  const ticks = useMemo(() => {
    const parts: BufferGeometry[] = [];
    for (let i = 0; i <= 10; i += 1) {
      const g = new BoxGeometry(i % 5 === 0 ? 0.09 : 0.055, 0.012, 0.012);
      g.translate(0.13 + (i % 5 === 0 ? 0.045 : 0.027), 0.42 + (tube * i) / 10, 0);
      parts.push(g);
    }
    const merged = mergeGeometries(parts) ?? new BufferGeometry();
    parts.forEach((g) => g.dispose());
    return merged;
  }, []);
  useEffect(() => () => ticks.dispose(), [ticks]);
  useFrame(() => {
    const r = reading.current;
    const h = Math.max(0.02, r.level) * tube;
    if (liquid.current) {
      liquid.current.scale.y = h;
      liquid.current.position.y = 0.42 + h / 2;
    }
  });
  return (
    <group>
      <Plinth skin={skin} radius={0.3} />
      {/* The bulb and its cage. */}
      <mesh position={[0, 0.3, 0]} material={glow}>
        <sphereGeometry args={[0.13, 24, 16]} />
      </mesh>
      <mesh position={[0, 0.3, 0]}>
        <sphereGeometry args={[0.16, 24, 16]} />
        <Glass skin={skin} />
      </mesh>
      {/* The column: glass tube, the liquid inside it (scaled by the reading). */}
      <mesh ref={liquid} position={[0, 0.5, 0]} material={glow}>
        <cylinderGeometry args={[0.045, 0.045, 1, 14]} />
      </mesh>
      <mesh position={[0, 0.42 + tube / 2, 0]}>
        <cylinderGeometry args={[0.075, 0.075, tube + 0.06, 18, 1, true]} />
        <Glass skin={skin} />
      </mesh>
      {/* A backboard with the scale, and brass bands. */}
      <mesh position={[0.17, 0.42 + tube / 2, -0.03]} castShadow>
        <boxGeometry args={[0.2, tube + 0.12, 0.03]} />
        <Metal color={skin.body} skin={skin} />
      </mesh>
      <mesh geometry={ticks} position={[0, 0, -0.005]}>
        <meshStandardMaterial color={skin.needle} roughness={0.5} />
      </mesh>
      {[0.42, 0.42 + tube / 2, 0.42 + tube].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[HALF_PI, 0, 0]}>
          <torusGeometry args={[0.085, 0.016, 8, 20]} />
          <Metal color={skin.trim} skin={skin} />
        </mesh>
      ))}
      <mesh position={[0, 0.42 + tube + 0.08, 0]}>
        <coneGeometry args={[0.07, 0.14, 14]} />
        <Metal color={skin.body} skin={skin} />
      </mesh>
      {rich ? <Sparkle skin={skin} reading={reading} y={0.42 + tube + 0.18} /> : null}
    </group>
  );
}

/** A little glint over a hot machine. */
function Sparkle({ skin, reading, y }: { skin: SkinSpec; reading: MutableRefObject<Reading>; y: number }) {
  const ref = useRef<Mesh>(null);
  useFrame(() => {
    const r = reading.current;
    if (!ref.current) return;
    ref.current.visible = r.mood === "danger" || r.mood === "warn";
    ref.current.rotation.z = r.t * 2;
    ref.current.scale.setScalar(0.6 + Math.abs(Math.sin(r.t * 5)) * 0.6);
  });
  return (
    <mesh ref={ref} position={[0, y, 0]}>
      <planeGeometry args={[0.18, 0.18]} />
      <meshBasicMaterial color={skin.hot} transparent opacity={0.7} blending={AdditiveBlending} depthWrite={false} side={DoubleSide} />
    </mesh>
  );
}

/** Steam (or smoke) puffs rising from a point; more and faster as the reading climbs. */
function Steam({ skin, reading, count, y, spread = 0.05, color = "#e8e4dc" }: { skin: SkinSpec; reading: MutableRefObject<Reading>; count: number; y: number; spread?: number; color?: string }) {
  const group = useRef<Group>(null);
  const seeds = useMemo(() => Array.from({ length: count }, (_, i) => ({ phase: i / count, side: Math.sin(i * 12.9898) * spread })), [count, spread]);
  const neon = skin.id === "neon";
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const r = reading.current;
    const speed = 0.25 + r.level * 0.9;
    g.children.forEach((child, i) => {
      const s = seeds[i];
      const life = (s.phase + r.t * speed) % 1;
      const visible = r.known && r.level > 0.15 + s.phase * 0.5;
      child.visible = visible;
      child.position.set(s.side + Math.sin(r.t + i) * 0.04 * life, life * 0.9, Math.cos(i * 3.1) * 0.03 * life);
      child.scale.setScalar(0.05 + life * 0.18);
      const material = (child as Mesh).material as MeshStandardMaterial;
      material.opacity = (1 - life) * 0.45;
    });
  });
  return (
    <group ref={group} position={[0, y, 0]}>
      {seeds.map((s) => (
        <mesh key={s.phase}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshStandardMaterial color={neon ? skin.glow : color} emissive={neon ? skin.glow : "#000000"} emissiveIntensity={neon ? 0.6 : 0} transparent opacity={0.4} depthWrite={false} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function Boiler(props: PartProps) {
  const { skin, reading, rich } = props;
  const wheel = useRef<Group>(null);
  const firebox = useGlow(skin, reading, 0.8);
  const bands = useRivets(0.43, 18);
  useFrame((_, delta) => {
    const r = reading.current;
    if (wheel.current && r.mood === "danger") wheel.current.rotation.z += delta * 4;
  });
  return (
    <group>
      {/* Three legs. */}
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.3, 0.12, Math.sin(a) * 0.3]}>
            <cylinderGeometry args={[0.035, 0.05, 0.24, 8]} />
            <Metal color={skin.trim} skin={skin} />
          </mesh>
        );
      })}
      {/* The tank, domed. */}
      <mesh position={[0, 0.72, 0]} castShadow>
        <cylinderGeometry args={[0.42, 0.42, 0.96, 32]} />
        <Metal color={skin.body} skin={skin} />
      </mesh>
      <mesh position={[0, 1.2, 0]} castShadow>
        <sphereGeometry args={[0.42, 32, 12, 0, Math.PI * 2, 0, HALF_PI]} />
        <Metal color={skin.body} skin={skin} />
      </mesh>
      <mesh position={[0, 0.24, 0]}>
        <sphereGeometry args={[0.42, 32, 10, 0, Math.PI * 2, HALF_PI, HALF_PI]} />
        <Metal color={skin.body} skin={skin} />
      </mesh>
      {[0.32, 0.72, 1.12].map((y) => (
        <group key={y} position={[0, y, 0]}>
          <mesh rotation={[HALF_PI, 0, 0]}>
            <torusGeometry args={[0.425, 0.02, 8, 40]} />
            <Metal color={skin.trim} skin={skin} />
          </mesh>
          <mesh geometry={bands}>
            <Metal color={skin.trim} skin={skin} />
          </mesh>
        </group>
      ))}
      {/* The firebox door glows with the reading. */}
      <mesh position={[0, 0.42, 0.41]} material={firebox}>
        <circleGeometry args={[0.1, 20]} />
      </mesh>
      <mesh position={[0, 0.42, 0.405]}>
        <torusGeometry args={[0.11, 0.02, 8, 24]} />
        <Metal color={skin.trim} skin={skin} />
      </mesh>
      {/* The pressure dial. */}
      <group position={[0, 0.86, 0.43]}>
        <DialFace {...props} radius={0.2} />
      </group>
      {/* Chimney, a valve wheel, steam. */}
      <mesh position={[0.18, 1.5, 0]}>
        <cylinderGeometry args={[0.06, 0.07, 0.42, 14]} />
        <Metal color={skin.trim} skin={skin} />
      </mesh>
      <mesh position={[0.18, 1.72, 0]}>
        <cylinderGeometry args={[0.09, 0.065, 0.06, 14]} />
        <Metal color={skin.body} skin={skin} />
      </mesh>
      <group ref={wheel} position={[-0.2, 1.38, 0.18]} rotation={[0, 0.4, 0]}>
        <mesh>
          <torusGeometry args={[0.08, 0.014, 6, 18]} />
          <meshStandardMaterial color={skin.hot} metalness={0.5} roughness={0.4} />
        </mesh>
        {[0, 1].map((i) => (
          <mesh key={i} rotation={[0, 0, (i * Math.PI) / 2]}>
            <boxGeometry args={[0.16, 0.014, 0.014]} />
            <meshStandardMaterial color={skin.hot} metalness={0.5} roughness={0.4} />
          </mesh>
        ))}
      </group>
      <group position={[0.18, 1.75, 0]}>
        <Steam skin={skin} reading={reading} count={rich ? 9 : 4} y={0} />
      </group>
    </group>
  );
}

function Dial(props: PartProps) {
  const { skin } = props;
  return (
    <group>
      <Plinth skin={skin} radius={0.3} />
      <mesh position={[0, 0.55, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.08, 0.9, 12]} />
        <Metal color={skin.trim} skin={skin} />
      </mesh>
      {/* The case, a drum behind the face. */}
      <group position={[0, 1.2, 0]}>
        <mesh position={[0, 0, -0.06]} rotation={[HALF_PI, 0, 0]} castShadow>
          <cylinderGeometry args={[0.46, 0.46, 0.12, 40]} />
          <Metal color={skin.body} skin={skin} />
        </mesh>
        <DialFace {...props} radius={0.42} />
      </group>
      {/* Two pipes feeding it, for looks. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.33, 0.62, -0.06]} rotation={[0, 0, side * 0.5]}>
          <cylinderGeometry args={[0.025, 0.025, 0.9, 8]} />
          <Metal color={skin.trim} skin={skin} />
        </mesh>
      ))}
    </group>
  );
}

function Piston({ skin, reading, rich }: PartProps) {
  const wheel = useRef<Group>(null);
  const piston = useRef<Group>(null);
  const rod = useRef<Mesh>(null);
  const lamp = useGlow(skin, reading);
  const angle = useRef(0);
  const crank = 0.16;
  const rodLength = 0.5;
  const wheelY = 0.62;
  useFrame((_, delta) => {
    const r = reading.current;
    // Up to ~3 turns a second at the top of the scale; it idles slowly when there is no reading.
    angle.current += Math.min(delta, 0.1) * (r.known ? 0.6 + r.level * 18 : 0.6);
    const a = angle.current;
    if (wheel.current) wheel.current.rotation.z = a;
    // Crank pin, then the piston straight above it on the rod.
    const px = Math.cos(a) * crank;
    const py = wheelY + Math.sin(a) * crank;
    const top = py + Math.sqrt(rodLength * rodLength - px * px);
    if (piston.current) piston.current.position.y = top;
    if (rod.current) {
      rod.current.position.set(px / 2, (py + top) / 2, 0.1);
      rod.current.rotation.z = Math.atan2(px, top - py);
    }
  });
  const spokes = [0, 1, 2, 3, 4, 5];
  return (
    <group>
      <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.2, 0.55]} />
        <Metal color={skin.trim} skin={skin} rough={skin.roughness + 0.15} />
      </mesh>
      {/* Flywheel. */}
      <group ref={wheel} position={[0, wheelY, 0.02]}>
        <mesh>
          <torusGeometry args={[0.3, 0.04, 10, 36]} />
          <Metal color={skin.body} skin={skin} />
        </mesh>
        {spokes.map((i) => (
          <mesh key={i} rotation={[0, 0, (i / spokes.length) * Math.PI]}>
            <boxGeometry args={[0.6, 0.025, 0.025]} />
            <Metal color={skin.body} skin={skin} />
          </mesh>
        ))}
        <mesh position={[crank, 0, 0.06]} rotation={[HALF_PI, 0, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 0.1, 10]} />
          <Metal color={skin.trim} skin={skin} />
        </mesh>
      </group>
      {/* Uprights holding the axle. */}
      {[-0.1, 0.12].map((z) => (
        <mesh key={z} position={[0, wheelY / 2 + 0.1, z]}>
          <boxGeometry args={[0.08, wheelY - 0.1, 0.04]} />
          <Metal color={skin.trim} skin={skin} />
        </mesh>
      ))}
      <mesh ref={rod}>
        <boxGeometry args={[0.035, rodLength, 0.03]} />
        <Metal color={skin.trim} skin={skin} />
      </mesh>
      {/* The cylinder: a glass sleeve so the piston shows, lit by the reading. */}
      <mesh position={[0, wheelY + rodLength + 0.12, 0.1]}>
        <cylinderGeometry args={[0.13, 0.13, 0.62, 20, 1, true]} />
        <Glass skin={skin} opacity={0.22} />
      </mesh>
      <mesh position={[0, wheelY + rodLength + 0.46, 0.1]}>
        <cylinderGeometry args={[0.15, 0.15, 0.06, 20]} />
        <Metal color={skin.body} skin={skin} />
      </mesh>
      <group ref={piston} position={[0, wheelY + rodLength, 0.1]}>
        <mesh position={[0, 0.05, 0]} material={lamp}>
          <cylinderGeometry args={[0.115, 0.115, 0.1, 18]} />
        </mesh>
      </group>
      {rich ? (
        <group position={[0, wheelY + rodLength + 0.5, 0.1]}>
          <Steam skin={skin} reading={reading} count={5} y={0} spread={0.03} />
        </group>
      ) : null}
    </group>
  );
}

function Cell({ skin, reading, rich }: PartProps) {
  const liquid = useRef<Mesh>(null);
  const bubbles = useRef<Group>(null);
  const glow = useGlow(skin, reading, 0.9);
  const height = 1.0;
  const base = 0.22;
  useFrame(() => {
    const r = reading.current;
    const h = Math.max(0.02, r.level) * height;
    if (liquid.current) {
      liquid.current.scale.y = h;
      liquid.current.position.y = base + h / 2;
    }
    const b = bubbles.current;
    if (b) {
      b.children.forEach((child, i) => {
        const life = (i / b.children.length + r.t * (liveSample.charging ? 0.6 : 0.2)) % 1;
        child.position.y = base + life * h;
        child.visible = r.known && life * h < h - 0.02;
      });
    }
  });
  return (
    <group>
      <Plinth skin={skin} radius={0.36} height={0.2} />
      <mesh ref={liquid} position={[0, base + 0.5, 0]} material={glow}>
        <cylinderGeometry args={[0.24, 0.24, 1, 24]} />
      </mesh>
      <mesh position={[0, base + height / 2, 0]}>
        <cylinderGeometry args={[0.28, 0.28, height, 28, 1, true]} />
        <Glass skin={skin} />
      </mesh>
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.3, base + height / 2, Math.sin(a) * 0.3]}>
            <cylinderGeometry args={[0.02, 0.02, height, 8]} />
            <Metal color={skin.body} skin={skin} />
          </mesh>
        );
      })}
      <mesh position={[0, base + height + 0.04, 0]}>
        <cylinderGeometry args={[0.33, 0.33, 0.08, 28]} />
        <Metal color={skin.body} skin={skin} />
      </mesh>
      {/* Terminals on the lid. */}
      {[-0.13, 0.13].map((x, i) => (
        <mesh key={x} position={[x, base + height + 0.13, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 0.1, 10]} />
          <meshStandardMaterial color={i ? skin.hot : skin.trim} metalness={0.6} roughness={0.35} />
        </mesh>
      ))}
      <group ref={bubbles}>
        {Array.from({ length: rich ? 8 : 4 }, (_, i) => (
          <mesh key={i} position={[Math.sin(i * 2.4) * 0.15, base, Math.cos(i * 2.4) * 0.15]}>
            <sphereGeometry args={[0.018, 6, 4]} />
            <meshBasicMaterial color={skin.glass} transparent opacity={0.6} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Coil({ skin, reading, rich }: PartProps) {
  const sparks = useRef<Group>(null);
  const top = useGlow(skin, reading, 0.5);
  const windings = useMemo(() => {
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < 14; i += 1) {
      const g = new CylinderGeometry(0.105 - i * 0.002, 0.105 - i * 0.002, 0.025, 16, 1, true);
      g.translate(0, 0.3 + i * 0.055, 0);
      parts.push(g);
    }
    const merged = mergeGeometries(parts) ?? new BufferGeometry();
    parts.forEach((g) => g.dispose());
    return merged;
  }, []);
  useEffect(() => () => windings.dispose(), [windings]);
  const count = rich ? 7 : 4;
  useFrame(() => {
    const g = sparks.current;
    if (!g) return;
    const r = reading.current;
    g.children.forEach((child, i) => {
      // Each arc flickers on at random, more often and longer as the reading climbs.
      const on = r.known && Math.random() < 0.15 + r.level * 0.7 && i / count < 0.25 + r.level;
      child.visible = on;
      if (!on) return;
      const a = Math.random() * Math.PI * 2;
      const len = 0.18 + r.level * 0.45 * Math.random();
      child.rotation.set((Math.random() - 0.5) * 0.9, a, HALF_PI + (Math.random() - 0.5) * 0.6);
      child.scale.set(1, len, 1);
    });
  });
  return (
    <group>
      <Plinth skin={skin} radius={0.34} height={0.16} />
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.2, 0.26, 0.12, 20]} />
        <Metal color={skin.body} skin={skin} />
      </mesh>
      <mesh position={[0, 0.66, 0]}>
        <cylinderGeometry args={[0.085, 0.095, 0.82, 16]} />
        <meshStandardMaterial color={skin.face} roughness={0.7} />
      </mesh>
      <mesh geometry={windings}>
        <Metal color={skin.id === "neon" ? skin.trim : "#b87333"} skin={skin} rough={0.3} />
      </mesh>
      <group position={[0, 1.2, 0]}>
        <mesh rotation={[HALF_PI, 0, 0]} castShadow>
          <torusGeometry args={[0.2, 0.075, 14, 36]} />
          <Metal color={skin.body} skin={skin} rough={0.15} />
        </mesh>
        <mesh material={top}>
          <sphereGeometry args={[0.07, 14, 10]} />
        </mesh>
        <group ref={sparks}>
          {Array.from({ length: count }, (_, i) => (
            <group key={i}>
              <mesh position={[0, 0.2 + 0.5, 0]}>
                <boxGeometry args={[0.012, 1, 0.012]} />
                <meshBasicMaterial color={skin.glow} toneMapped={false} transparent opacity={0.9} blending={AdditiveBlending} depthWrite={false} />
              </mesh>
            </group>
          ))}
        </group>
      </group>
    </group>
  );
}

/** A spur gear facing +z (teeth in the xy plane), merged into one geometry. */
function useGear(radius: number, teeth: number, depth = 0.04): BufferGeometry {
  const geometry = useMemo(() => {
    const parts: BufferGeometry[] = [];
    const disc = new CylinderGeometry(radius * 0.86, radius * 0.86, depth, 28);
    disc.rotateX(HALF_PI);
    parts.push(disc);
    const width = ((Math.PI * 2 * radius) / teeth) * 0.5;
    for (let i = 0; i < teeth; i += 1) {
      const g = new BoxGeometry(width, radius * 0.24, depth);
      g.translate(0, radius * 0.95, 0);
      g.rotateZ((i / teeth) * Math.PI * 2);
      parts.push(g);
    }
    const merged = mergeGeometries(parts) ?? new BufferGeometry();
    parts.forEach((g) => g.dispose());
    return merged;
  }, [radius, teeth, depth]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

/**
 * Three meshed gears on a back plate. The train spins faster as the reading climbs (it idles slowly
 * with no reading), the hubs glow with it, and a small dial on top gives the number.
 */
function Gearbox(props: PartProps) {
  const { skin, reading, rich } = props;
  const hub = useGlow(skin, reading, 0.7);
  // Same tooth pitch on every gear, so the speed ratios are the tooth ratios.
  const train = [
    { r: 0.26, teeth: 16, x: -0.14, y: 0.62 },
    { r: 0.13, teeth: 8, x: 0.187, y: 0.809 },
    { r: 0.0975, teeth: 6, x: 0.297, y: 0.618 },
  ];
  const big = useGear(train[0].r, train[0].teeth);
  const mid = useGear(train[1].r, train[1].teeth);
  const small = useGear(train[2].r, train[2].teeth);
  const gears = useRef<(Group | null)[]>([]);
  const angle = useRef(0);
  useFrame((_, delta) => {
    const r = reading.current;
    angle.current += Math.min(delta, 0.1) * (r.known ? 0.3 + r.level * 6 : 0.3);
    const shake = r.mood === "danger" ? Math.sin(r.t * 50) * 0.01 : 0;
    const a = angle.current;
    const spins = [a, -a * (16 / 8) + 0.2, a * (16 / 6)];
    gears.current.forEach((g, i) => {
      if (!g) return;
      g.rotation.z = spins[i];
      g.position.x = train[i].x + shake;
    });
  });
  const geometries = [big, mid, small];
  return (
    <group>
      <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.95, 0.2, 0.45]} />
        <Metal color={skin.trim} skin={skin} rough={skin.roughness + 0.15} />
      </mesh>
      <mesh position={[0, 0.775, -0.02]} castShadow>
        <boxGeometry args={[0.92, 1.15, 0.06]} />
        <Metal color={skin.body} skin={skin} rough={skin.roughness + 0.1} />
      </mesh>
      {/* A frame around the plate. */}
      {[
        [0, 1.35, 0.96, 0.05],
        [-0.46, 0.775, 0.05, 1.2],
        [0.46, 0.775, 0.05, 1.2],
      ].map(([x, y, w, h]) => (
        <mesh key={`${x}-${y}`} position={[x, y, 0.02]}>
          <boxGeometry args={[w, h, 0.05]} />
          <Metal color={skin.trim} skin={skin} />
        </mesh>
      ))}
      {train.map((gear, i) => (
        <group key={gear.r} ref={(g) => void (gears.current[i] = g)} position={[gear.x, gear.y, 0.06]}>
          <mesh geometry={geometries[i]} castShadow>
            <Metal color={i === 1 ? skin.trim : skin.body} skin={skin} rough={0.25} />
          </mesh>
          {/* A spoke so the turning shows even on the smallest gear. */}
          <mesh position={[0, gear.r * 0.42, 0.024]}>
            <boxGeometry args={[gear.r * 0.16, gear.r * 0.84, 0.01]} />
            <meshStandardMaterial color={skin.needle} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0, 0.03]} material={hub}>
            <sphereGeometry args={[Math.max(0.025, gear.r * 0.18), 12, 8]} />
          </mesh>
        </group>
      ))}
      <group position={[-0.2, 1.13, 0.02]}>
        <DialFace {...props} radius={0.16} />
      </group>
      {rich ? (
        <group position={[0.3, 1.36, 0]}>
          <Steam skin={skin} reading={reading} count={4} y={0} spread={0.03} />
        </group>
      ) : null}
    </group>
  );
}

/**
 * A firebox and a tall chimney. The fire window up the front of the stack fills with the reading,
 * the grate glows, and smoke rises thicker and faster as the reading climbs.
 */
function Smokestack({ skin, reading, rich }: PartProps) {
  const fire = useGlow(skin, reading);
  const grate = useGlow(skin, reading, 0.8);
  const column = useRef<Mesh>(null);
  const rivets = useRivets(0.165, 14, 0.018);
  const bottom = 0.5;
  const span = 1.1;
  useFrame(() => {
    const h = Math.max(0.02, reading.current.level) * span;
    if (column.current) {
      column.current.scale.y = h;
      column.current.position.y = bottom + h / 2;
    }
  });
  const ticks = useMemo(() => {
    const parts: BufferGeometry[] = [];
    for (let i = 0; i <= 10; i += 1) {
      const g = new BoxGeometry(i % 5 === 0 ? 0.07 : 0.04, 0.01, 0.01);
      g.translate(0.075 + (i % 5 === 0 ? 0.035 : 0.02), bottom + (span * i) / 10, 0);
      parts.push(g);
    }
    const merged = mergeGeometries(parts) ?? new BufferGeometry();
    parts.forEach((g) => g.dispose());
    return merged;
  }, []);
  useEffect(() => () => ticks.dispose(), [ticks]);
  const top = 0.35 + 1.5;
  return (
    <group>
      {/* The firebox, with a glowing grate in its door. */}
      <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.62, 0.36, 0.5]} />
        <Metal color={skin.trim} skin={skin} rough={skin.roughness + 0.15} />
      </mesh>
      <mesh position={[0, 0.17, 0.252]} material={grate}>
        <planeGeometry args={[0.3, 0.14]} />
      </mesh>
      {[-0.1, -0.035, 0.035, 0.1].map((x) => (
        <mesh key={x} position={[x, 0.17, 0.26]}>
          <boxGeometry args={[0.018, 0.16, 0.012]} />
          <Metal color={skin.body} skin={skin} />
        </mesh>
      ))}
      {/* The stack, banded and riveted. */}
      <mesh position={[0, 0.35 + 0.75, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.17, 1.5, 24]} />
        <Metal color={skin.body} skin={skin} />
      </mesh>
      {[0.42, 1.0, 1.6].map((y) => (
        <group key={y} position={[0, y, 0]}>
          <mesh rotation={[HALF_PI, 0, 0]}>
            <torusGeometry args={[0.17 - (y - 0.35) * 0.02, 0.016, 8, 28]} />
            <Metal color={skin.trim} skin={skin} />
          </mesh>
          <mesh geometry={rivets}>
            <Metal color={skin.trim} skin={skin} />
          </mesh>
        </group>
      ))}
      {/* The fire window up the front, filled to the reading, with a scale beside it. */}
      <group position={[0, 0, 0.16]}>
        <mesh position={[0, bottom + span / 2, -0.004]}>
          <boxGeometry args={[0.07, span + 0.04, 0.012]} />
          <meshStandardMaterial color={skin.face} roughness={0.8} />
        </mesh>
        <mesh ref={column} position={[0, bottom + 0.5, 0.004]} material={fire}>
          <boxGeometry args={[0.05, 1, 0.01]} />
        </mesh>
        <mesh geometry={ticks}>
          <meshStandardMaterial color={skin.needle} roughness={0.5} />
        </mesh>
      </group>
      {/* A flared cap, and the smoke. */}
      <mesh position={[0, top, 0]}>
        <cylinderGeometry args={[0.2, 0.14, 0.1, 24]} />
        <Metal color={skin.trim} skin={skin} />
      </mesh>
      <group position={[0, top + 0.05, 0]}>
        <Steam skin={skin} reading={reading} count={rich ? 10 : 5} y={0} spread={0.07} color="#5d5752" />
      </group>
    </group>
  );
}

/**
 * A column of segments, lit from the bottom up to the reading. Each segment keeps the colour of its
 * zone (calm, warn, danger, by where it sits on the scale), and a peak marker falls back slowly.
 */
function Bars({ skin, stat, reading, rich }: PartProps) {
  const count = 14;
  const segments = useRef<(Mesh | null)[]>([]);
  const peak = useRef(0);
  const { zones, off } = useMemo(() => {
    const glow = new Color(skin.glow);
    const hot = new Color(skin.hot);
    const make = (color: Color) => new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: skin.emissive, roughness: 0.35, metalness: 0, toneMapped: false });
    return {
      zones: { calm: make(glow.clone()), warn: make(glow.clone().lerp(hot, 0.45)), danger: make(hot.clone()) },
      off: new MeshStandardMaterial({ color: new Color(skin.glow).multiplyScalar(0.12), roughness: 0.6, metalness: 0.1 }),
    };
  }, [skin]);
  useEffect(() => () => [zones.calm, zones.warn, zones.danger, off].forEach((m) => m.dispose()), [zones, off]);
  // The zone of each segment, from the middle of the scale it covers.
  const segmentZone = useMemo(() => Array.from({ length: count }, (_, i) => gaugeMood(stat, (i + 0.5) / count) as "calm" | "warn" | "danger"), [stat]);
  useFrame((_, delta) => {
    const r = reading.current;
    const lit = Math.round(r.level * count);
    peak.current = Math.max(lit, peak.current - Math.min(delta, 0.1) * 3);
    const peakAt = Math.max(0, Math.ceil(peak.current) - 1);
    const pulse = r.mood === "danger" ? 0.6 + Math.abs(Math.sin(r.t * 6)) * 0.8 : 1;
    const strength = (r.known ? skin.emissive : skin.emissive * 0.25) * pulse;
    zones.calm.emissiveIntensity = strength;
    zones.warn.emissiveIntensity = strength;
    zones.danger.emissiveIntensity = strength;
    segments.current.forEach((segment, i) => {
      if (!segment) return;
      const on = i < lit || (r.known && i === peakAt && peak.current > 0.5);
      segment.material = on ? zones[segmentZone[i]] : off;
    });
  });
  const pitch = 0.075;
  const bottom = 0.47;
  const height = count * pitch + 0.08;
  return (
    <group>
      <Plinth skin={skin} radius={0.3} />
      <mesh position={[0, 0.27, 0]}>
        <cylinderGeometry args={[0.05, 0.08, 0.3, 12]} />
        <Metal color={skin.trim} skin={skin} />
      </mesh>
      {/* The housing and its frame. */}
      <mesh position={[0, bottom + height / 2 - 0.04, -0.03]} castShadow>
        <boxGeometry args={[0.4, height, 0.12]} />
        <Metal color={skin.body} skin={skin} />
      </mesh>
      <mesh position={[0, bottom + height / 2 - 0.04, 0.032]}>
        <boxGeometry args={[0.3, height - 0.04, 0.004]} />
        <meshStandardMaterial color={skin.face} roughness={0.8} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.2, bottom + height / 2 - 0.04, 0.02]}>
          <boxGeometry args={[0.03, height + 0.03, 0.06]} />
          <Metal color={skin.trim} skin={skin} />
        </mesh>
      ))}
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i} ref={(m) => void (segments.current[i] = m)} position={[0, bottom + i * pitch, 0.04]} material={off}>
          <boxGeometry args={[0.24, pitch * 0.72, 0.014]} />
        </mesh>
      ))}
      <mesh position={[0, bottom + height - 0.02, 0.035]}>
        <boxGeometry args={[0.44, 0.04, 0.14]} />
        <Metal color={skin.trim} skin={skin} />
      </mesh>
      {rich ? <Sparkle skin={skin} reading={reading} y={bottom + height + 0.12} /> : null}
    </group>
  );
}

/** Every mesh id in gauges.ts MESHES, drawn. */
export const GAUGE_PARTS: Record<string, (props: PartProps) => ReactNode> = {
  thermometer: Thermometer,
  boiler: Boiler,
  dial: Dial,
  piston: Piston,
  cell: Cell,
  coil: Coil,
  gearbox: Gearbox,
  smokestack: Smokestack,
  bars: Bars,
};

/** The brass (or neon) nameplate in front of each machine, drawn on a small canvas twice a second. */
function Nameplate({ skin, stat, reading }: { skin: SkinSpec; stat: StatSpec; reading: MutableRefObject<Reading> }) {
  const { canvas, texture } = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 96;
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return { canvas: c, texture: t };
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  const last = useRef({ at: -1, text: "", mood: "" });
  useFrame(() => {
    const r = reading.current;
    if (r.t - last.current.at < 0.5) return;
    last.current.at = r.t;
    const text = gaugeText(stat, liveSample);
    const key = `${skin.id}|${stat.id}`;
    if (text === last.current.text && r.mood === last.current.mood && key === (canvas.dataset.key ?? "")) return;
    last.current.text = text;
    last.current.mood = r.mood;
    canvas.dataset.key = key;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const neon = skin.id === "neon";
    ctx.clearRect(0, 0, 256, 96);
    ctx.fillStyle = neon ? "#0b0c1a" : skin.body;
    ctx.beginPath();
    ctx.roundRect(4, 4, 248, 88, 14);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = neon ? skin.trim : skin.trim;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = neon ? skin.glass : skin.needle;
    ctx.font = "600 22px 'IBM Plex Mono', monospace";
    ctx.fillText(stat.label.toUpperCase(), 128, 36);
    const color = r.mood === "danger" ? skin.hot : r.mood === "warn" ? (neon ? "#ffd166" : "#7a2e0e") : neon ? skin.glow : skin.needle;
    ctx.fillStyle = r.known ? color : neon ? "#8088a8" : skin.trim;
    ctx.font = "700 32px 'IBM Plex Mono', monospace";
    ctx.fillText(text, 128, 74);
    texture.needsUpdate = true;
  });
  return (
    <mesh position={[0, 0.2, 0.56]} rotation={[-0.5, 0, 0]}>
      <planeGeometry args={[0.5, 0.19]} />
      <meshStandardMaterial map={texture} roughness={0.45} metalness={skin.id === "neon" ? 0 : 0.3} emissive={skin.id === "neon" ? "#ffffff" : "#000000"} emissiveMap={skin.id === "neon" ? texture : null} emissiveIntensity={skin.id === "neon" ? 0.8 : 0} />
    </mesh>
  );
}

/** A gauge entity, drawn: the chosen mesh in the chosen skin, plus its nameplate. */
export function GaugeMesh({ entity }: { entity: Entity }) {
  const stat = statById(entity.customData.stat) ?? STATS[0];
  const skin = skinById(entity.customData.skin) ?? SKINS[0];
  const mesh = meshById(entity.customData.mesh)?.id ?? stat.mesh;
  const reading = useReading(stat);
  // The extra steam, bubbles and sparks only on the top two quality rungs.
  const rich = usePerf().rung <= 1;
  const Part = GAUGE_PARTS[mesh] ?? Dial;
  return (
    <group>
      <Part skin={skin} stat={stat} reading={reading} rich={rich} />
      <Nameplate skin={skin} stat={stat} reading={reading} />
    </group>
  );
}
