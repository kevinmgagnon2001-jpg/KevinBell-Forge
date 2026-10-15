/**
 * The avatar: a jointed figure (hips, knees, shoulders, elbows, spine, neck) posed every frame from
 * how the body moves. Idle breathes and looks around; walking and running swing arms and legs in
 * step with the ground speed (stride grows into a run); a jump tucks, a fall spreads the arms, a hard
 * landing crouches; flying leans into the direction of travel.
 *
 * Drawn in the entity's space: feet at y = -WALK.foot (0.62), eyes at about +0.62, facing +z. The
 * architect reads avatarMotion (body-state.ts, written by the pilot); any other figure (agents) reads
 * its own customData.speed. Everything moves inside useFrame, so it costs no React renders.
 */
import { useFrame } from "@react-three/fiber";
import { useRef, type ReactNode } from "react";
import type { Group } from "three";
import type { Entity } from "@/engine/types";
import { avatarMotion } from "./body-state";

const SUIT = "#313c4a";
const SUIT_LIGHT = "#4b5a6c";
const BOOT = "#191d24";
const TRIM = "#d4a24a";
const GLOW = "#7ee0c8";

/** Lengths, metres. Standing, the hip joint is at HIP_Y and the head's centre at HEAD_Y. */
const THIGH = 0.33;
const SHIN = 0.31;
const HIP_Y = -0.62 + 0.05 + SHIN + THIGH;
const TORSO = 0.36;
const UPPER_ARM = 0.27;
const FOREARM = 0.25;

type Joint = "root" | "pelvis" | "chest" | "head" | "hipL" | "hipR" | "kneeL" | "kneeR" | "shoulderL" | "shoulderR" | "elbowL" | "elbowR";
type Pose = Record<Joint, { x: number; y: number; z: number }> & { lift: number; breathe: number };

const zero = () => ({ x: 0, y: 0, z: 0 });
const blankPose = (): Pose => ({
  root: zero(),
  pelvis: zero(),
  chest: zero(),
  head: zero(),
  hipL: zero(),
  hipR: zero(),
  kneeL: zero(),
  kneeR: zero(),
  shoulderL: zero(),
  shoulderR: zero(),
  elbowL: zero(),
  elbowR: zero(),
  lift: 0,
  breathe: 1,
});

const smooth = (a: number, b: number, t: number) => {
  const k = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

function Limb({ length, radius, color }: { length: number; radius: number; color: string }) {
  // A capsule hanging down from its joint.
  return (
    <mesh position={[0, -length / 2, 0]} castShadow>
      <capsuleGeometry args={[radius, Math.max(0.01, length - radius * 2), 4, 10]} />
      <meshStandardMaterial color={color} roughness={0.62} metalness={0.12} />
    </mesh>
  );
}

export function AvatarFigure({ entity, tone, live, head }: { entity: Entity; tone: string; live: boolean; head?: ReactNode }) {
  const joints = useRef<Partial<Record<Joint, Group | null>>>({});
  const chestShell = useRef<Group>(null);
  const pose = useRef<Pose>(blankPose());
  const clock = useRef({ t: Math.random() * 10, phase: 0 });
  const set = (name: Joint) => (g: Group | null) => {
    joints.current[name] = g;
  };

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const c = clock.current;
    c.t += dt;
    const m = live ? avatarMotion : { speed: Number(entity.customData.speed) || 0, grounded: true, vy: 0, flying: false, landed: 0 };
    const speed = Math.min(m.speed, 12);
    const air = !m.grounded && !m.flying;
    // One stride (two steps) is ~1.15 m walking, stretching to ~1.9 m at a full run.
    const run = smooth(3.6, 6.8, speed);
    const walk = air || m.flying ? 0 : Math.min(1, speed / 1.1);
    const stride = 1.15 + run * 0.75;
    c.phase += dt * (speed / stride) * Math.PI * 2;
    const ph = c.phase;
    const idle = 1 - Math.min(1, speed / 0.6);
    const t = blankPose();
    const swing = (0.42 + run * 0.38) * walk;

    // Ground: walk and run cycle, plus idle life.
    t.hipL.x = -Math.sin(ph) * swing;
    t.hipR.x = Math.sin(ph) * swing;
    t.kneeL.x = walk * (0.08 + Math.max(0, -Math.cos(ph)) * (0.65 + run * 0.9));
    t.kneeR.x = walk * (0.08 + Math.max(0, Math.cos(ph)) * (0.65 + run * 0.9));
    t.shoulderL.x = Math.sin(ph) * (0.35 + run * 0.45) * walk;
    t.shoulderR.x = -Math.sin(ph) * (0.35 + run * 0.45) * walk;
    t.shoulderL.z = 0.07 + idle * 0.03;
    t.shoulderR.z = -0.07 - idle * 0.03;
    t.elbowL.x = -(0.12 + walk * 0.2 + run * 1.1);
    t.elbowR.x = -(0.12 + walk * 0.2 + run * 1.1);
    t.pelvis.y = Math.sin(ph) * 0.12 * walk;
    t.chest.y = -Math.sin(ph) * 0.16 * walk;
    t.chest.x = 0.04 * walk + 0.2 * run;
    t.lift = Math.abs(Math.sin(ph)) * (0.025 + run * 0.035) * walk - run * 0.03;
    t.head.y = Math.sin(c.t * 0.31) * 0.35 * idle;
    t.head.x = Math.sin(c.t * 0.23) * 0.06 * idle - t.chest.x * 0.5;
    t.root.z = Math.sin(c.t * 0.5) * 0.015 * idle;
    t.breathe = 1 + Math.sin(c.t * 1.7) * 0.014 * (0.5 + idle);

    if (air) {
      // Going up: knees tucked, arms thrown up. Coming down: legs reach, arms out for balance.
      const up = smooth(-1, 2, m.vy);
      t.hipL.x = -0.75 * up - 0.25 * (1 - up);
      t.hipR.x = -0.3 * up + 0.1 * (1 - up);
      t.kneeL.x = 1.25 * up + 0.35 * (1 - up);
      t.kneeR.x = 0.7 * up + 0.2 * (1 - up);
      t.shoulderL.x = -2.4 * up - 0.3 * (1 - up);
      t.shoulderR.x = -2.4 * up - 0.3 * (1 - up);
      t.shoulderL.z = 0.25 + 0.9 * (1 - up);
      t.shoulderR.z = -0.25 - 0.9 * (1 - up);
      t.elbowL.x = -0.4;
      t.elbowR.x = -0.4;
      t.chest.x = 0.1;
      t.lift = 0;
    }
    if (m.flying) {
      // Lean into the flight; fast, one fist forward.
      const fast = smooth(1, 4.6, speed);
      t.root.x = 1.15 * fast;
      t.hipL.x = 0.15 + 0.1 * fast;
      t.hipR.x = 0.05 + 0.2 * fast;
      t.kneeL.x = 0.25 + 0.2 * Math.sin(c.t * 2);
      t.kneeR.x = 0.45 + 0.2 * Math.sin(c.t * 2 + 1);
      t.shoulderR.x = -2.9 * fast + 0.25 * (1 - fast);
      t.shoulderL.x = 0.35 * fast + 0.2 * (1 - fast);
      t.shoulderL.z = 0.35 * (1 - fast) + 0.15;
      t.shoulderR.z = -0.35 * (1 - fast) - 0.1 * fast;
      t.elbowL.x = -0.3;
      t.elbowR.x = -0.1;
      t.head.x = -0.9 * fast;
      t.lift = Math.sin(c.t * 2.2) * 0.04;
    }
    if (m.landed > 0.05 && !m.flying) {
      // A hard landing: crouch, then stand back up.
      const squat = Math.min(1, m.landed / 9);
      t.lift -= squat * 0.2;
      t.kneeL.x += squat * 1.2;
      t.kneeR.x += squat * 1.2;
      t.hipL.x -= squat * 0.7;
      t.hipR.x -= squat * 0.7;
      t.chest.x += squat * 0.35;
      t.shoulderL.x -= squat * 0.5;
      t.shoulderR.x -= squat * 0.5;
      if (live) avatarMotion.landed *= Math.exp(-dt * 5);
    }

    // Ease every joint toward its target, so changes of gait blend instead of snapping.
    const p = pose.current;
    const k = 1 - Math.exp(-dt * 14);
    for (const name of Object.keys(t) as (keyof Pose)[]) {
      if (name === "lift" || name === "breathe") continue;
      const from = p[name] as { x: number; y: number; z: number };
      const to = t[name] as { x: number; y: number; z: number };
      from.x += (to.x - from.x) * k;
      from.y += (to.y - from.y) * k;
      from.z += (to.z - from.z) * k;
      const g = joints.current[name as Joint];
      if (g) g.rotation.set(from.x, from.y, from.z);
    }
    p.lift += (t.lift - p.lift) * k;
    p.breathe += (t.breathe - p.breathe) * k;
    const pelvis = joints.current.pelvis;
    if (pelvis) pelvis.position.y = HIP_Y + p.lift;
    if (chestShell.current) chestShell.current.scale.set(p.breathe, 1, p.breathe);
  });

  const skin = tone;
  return (
    // The root pivots about the middle of the body (flying leans on it).
    <group ref={set("root")}>
      <group>
        <group ref={set("pelvis")} position={[0, HIP_Y, 0]}>
          {/* Hips and belt. */}
          <mesh position={[0, 0.02, 0]} scale={[1, 0.75, 0.72]} castShadow>
            <sphereGeometry args={[0.15, 16, 12]} />
            <meshStandardMaterial color={SUIT} roughness={0.6} metalness={0.1} />
          </mesh>
          <mesh position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.72, 1]}>
            <torusGeometry args={[0.145, 0.018, 8, 24]} />
            <meshStandardMaterial color={TRIM} roughness={0.35} metalness={0.7} />
          </mesh>
          {/* Legs. */}
          {(["L", "R"] as const).map((side) => (
            <group key={side} ref={set(`hip${side}`)} position={[side === "L" ? 0.09 : -0.09, 0, 0]}>
              <Limb length={THIGH} radius={0.065} color={SUIT} />
              <group ref={set(`knee${side}`)} position={[0, -THIGH, 0]}>
                <mesh position={[0, 0, 0.02]}>
                  <sphereGeometry args={[0.05, 10, 8]} />
                  <meshStandardMaterial color={SUIT_LIGHT} roughness={0.5} metalness={0.2} />
                </mesh>
                <Limb length={SHIN} radius={0.055} color={SUIT} />
                {/* Boot. */}
                <mesh position={[0, -SHIN - 0.005, 0.045]} castShadow>
                  <boxGeometry args={[0.1, 0.07, 0.22]} />
                  <meshStandardMaterial color={BOOT} roughness={0.55} metalness={0.2} />
                </mesh>
              </group>
            </group>
          ))}
          {/* Spine and everything above it. */}
          <group ref={set("chest")} position={[0, 0.07, 0]}>
            <group ref={chestShell}>
              <mesh position={[0, TORSO / 2, 0]} scale={[1, 1, 0.68]} castShadow>
                <capsuleGeometry args={[0.15, TORSO - 0.22, 6, 14]} />
                <meshStandardMaterial color={SUIT} roughness={0.58} metalness={0.12} />
              </mesh>
              {/* Chest plate with a lit core, and shoulder pads. */}
              <mesh position={[0, TORSO * 0.66, 0.085]} rotation={[-0.12, 0, 0]}>
                <boxGeometry args={[0.2, 0.15, 0.03]} />
                <meshStandardMaterial color={SUIT_LIGHT} roughness={0.4} metalness={0.35} />
              </mesh>
              <mesh position={[0, TORSO * 0.66, 0.103]}>
                <circleGeometry args={[0.028, 16]} />
                <meshStandardMaterial color={GLOW} emissive={GLOW} emissiveIntensity={1.4} toneMapped={false} />
              </mesh>
            </group>
            {(["L", "R"] as const).map((side) => (
              <group key={side} ref={set(`shoulder${side}`)} position={[side === "L" ? 0.2 : -0.2, TORSO - 0.02, 0]}>
                <mesh scale={[1, 0.8, 1]}>
                  <sphereGeometry args={[0.065, 12, 10]} />
                  <meshStandardMaterial color={SUIT_LIGHT} roughness={0.45} metalness={0.3} />
                </mesh>
                <Limb length={UPPER_ARM} radius={0.048} color={SUIT} />
                <group ref={set(`elbow${side}`)} position={[0, -UPPER_ARM, 0]}>
                  <Limb length={FOREARM} radius={0.042} color={SUIT} />
                  <mesh position={[0, -FOREARM - 0.035, 0.005]} scale={[0.85, 1.1, 0.7]}>
                    <sphereGeometry args={[0.045, 10, 8]} />
                    <meshStandardMaterial color={skin} roughness={0.55} metalness={0.05} />
                  </mesh>
                </group>
              </group>
            ))}
            {/* Neck, head, hair; the helm sits on the head and moves with it. */}
            <mesh position={[0, TORSO + 0.035, 0]}>
              <cylinderGeometry args={[0.045, 0.05, 0.08, 10]} />
              <meshStandardMaterial color={skin} roughness={0.6} />
            </mesh>
            <group ref={set("head")} position={[0, TORSO + 0.09, 0]}>
              <mesh position={[0, 0.1, 0]} scale={[0.9, 1.05, 0.98]} castShadow>
                <sphereGeometry args={[0.115, 20, 16]} />
                <meshStandardMaterial color={skin} roughness={0.55} metalness={0.04} />
              </mesh>
              <mesh position={[0, 0.135, -0.012]} scale={[0.95, 0.9, 1]}>
                <sphereGeometry args={[0.118, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
                <meshStandardMaterial color="#2a211b" roughness={0.85} />
              </mesh>
              {head ? <group position={[0, 0.1, 0]}>{head}</group> : null}
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
