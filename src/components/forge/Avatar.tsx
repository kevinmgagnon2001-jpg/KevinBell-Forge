/**
 * The avatar: a jointed figure (hips, knees, shoulders, elbows, spine, neck) posed every frame from
 * how the body moves. Idle breathes and looks around; walking and running swing arms and legs in
 * step with the ground speed (stride grows into a run); a jump tucks, a fall spreads the arms, a hard
 * landing crouches; flying leans into the direction of travel.
 *
 * Drawn in the entity's space: feet at y = -WALK.foot (0.62), eyes at about +0.62, facing +z. The
 * architect reads avatarMotion (body-state.ts, written by the pilot); any other figure (agents) reads
 * its own customData.speed. Everything moves inside useFrame, so it costs no React renders.
 *
 * The walk cycle finishes its step when you stop and starts in step with the legs you have
 * (springs.ts stepPhase, alignPhase); the antenna on the pack and the ponytail swing on springs
 * driven by how the body speeds up and turns (secondary motion).
 */
import { useFrame } from "@react-three/fiber";
import { useRef, type ReactNode } from "react";
import { Vector3, type Group } from "three";
import type { Entity } from "@/engine/types";
import { inpaint, LEGS, legIk, movesOf, sampleMove, type Move } from "@/engine/motion";
import { groundUnderFoot, solidsFor } from "@/engine/physics";
import { alignPhase, jiggle, JIGGLE, spring2, stepPhase, track, tracker } from "@/engine/springs";
import { useForge } from "@/engine/store";
import { avatarMotion } from "./body-state";
import { townBodies } from "./Town";
import { currentGaze } from "./look";

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
  // Townsfolk wear their own colour (town.ts); everyone else the suit.
  const suit = entity.customData.suit || SUIT;
  const joints = useRef<Partial<Record<Joint, Group | null>>>({});
  // The move this figure is doing (motion.ts), and when it started. A one-shot already in the save
  // when the figure appears is not replayed; a looping one carries on.
  const moves = useForge((s) => s.moves);
  const moveId = entity.customData.move ?? "";
  const moveSeq = entity.customData.moveSeq ?? "";
  const playing = useRef<{ key: string; move: Move | null; started: number }>({ key: `${moveId}#${moveSeq}`, move: null, started: Number.NEGATIVE_INFINITY });
  const chestShell = useRef<Group>(null);
  const pose = useRef<Pose>(blankPose());
  const clock = useRef({ t: Math.random() * 10, phase: 0, walk: 0, moving: false });
  const antenna = useRef<Group>(null);
  const ponytail = useRef<Group>(null);
  const tail2 = useRef<Group>(null);
  const wobble = useRef({ track: tracker(), antenna: spring2(), pony: spring2(), at: new Vector3() });
  const set = (name: Joint) => (g: Group | null) => {
    joints.current[name] = g;
  };

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const c = clock.current;
    c.t += dt;
    const doing = playing.current;
    const key = `${moveId}#${moveSeq}`;
    if (doing.key !== key || (doing.move === null && moveId)) {
      const move = moveId ? (movesOf({ moves }).find((m) => m.id === moveId) ?? null) : null;
      // A new request starts now; on first sight only a looping move plays.
      const fresh = doing.key !== key;
      playing.current = { key, move, started: fresh || move?.loop ? c.t : Number.NEGATIVE_INFINITY };
    }
    const m = live ? avatarMotion : { speed: townBodies[entity.id]?.speed ?? (Number(entity.customData.speed) || 0), grounded: true, vy: 0, flying: false, landed: 0 };
    const speed = Math.min(m.speed, 12);
    const air = !m.grounded && !m.flying;
    // One stride (two steps) is ~1.15 m walking, stretching to ~1.9 m at a full run.
    const run = smooth(3.6, 6.8, speed);
    // The stride's size eases down when stopping, so the last step plays out instead of shrinking away.
    const walkTarget = air || m.flying ? 0 : Math.min(1, speed / 1.1);
    c.walk = walkTarget > c.walk ? walkTarget : c.walk + (walkTarget - c.walk) * (1 - Math.exp(-dt * 3));
    const walk = c.walk;
    const stride = 1.15 + run * 0.75;
    const moving = speed > 0.15 && !air && !m.flying;
    if (moving && !c.moving) {
      // Start the cycle at the phase that matches the legs as they are (out of a move or a landing).
      const now = pose.current;
      c.phase = alignPhase(now.hipL.x, now.hipR.x, now.kneeL.x, now.kneeR.x, 0.42 + run * 0.38);
    }
    c.moving = moving;
    c.phase = stepPhase(c.phase, air || m.flying ? 0 : speed, stride, dt);
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

    // Looking at something: the head turns to it when nothing else is using the head.
    if (live && idle > 0.5) {
      const gaze = currentGaze();
      const state = useForge.getState();
      const seen = gaze != null ? state.entities[gaze] : undefined;
      if (seen && seen.id !== entity.id && !seen.tags.includes("helm")) {
        const p = entity.transform.position;
        const q = seen.transform.position;
        const yaw = Number(entity.customData.yaw) || 0;
        let turn = Math.atan2(q.x - p.x, q.z - p.z) - yaw;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        if (Math.abs(turn) < 1.9) {
          t.head.y = Math.max(-1.1, Math.min(1.1, turn));
          t.head.x = Math.max(-0.5, Math.min(0.5, -Math.atan2(q.y - (p.y + 0.6), Math.hypot(q.x - p.x, q.z - p.z))));
        }
      }
    }

    // A move fills in only the joints it drives; the gait keeps the rest. Walking, the legs stay the
    // gait's (the stick is the stronger constraint), so you can wave on the move.
    const now = playing.current;
    let posed: Pose = t;
    if (now.move && Number.isFinite(now.started)) {
      const sample = sampleMove(now.move, c.t - now.started);
      if (sample.done) now.started = Number.NEGATIVE_INFINITY;
      else {
        const moving = speed > 0.8 || air || m.flying;
        const mask = moving ? sample.mask.filter((j) => !LEGS.includes(j)) : sample.mask;
        const pose = moving ? { ...sample.pose, lift: undefined } : sample.pose;
        posed = inpaint(t, { pose, mask, weight: sample.weight }) as Pose;
      }
    }

    // Feet on the real ground: each foot reaches the step, kerb or slope actually under it, and the
    // pelvis drops when one foot has to reach down (the walker stands on the highest thing under it).
    if (live && m.grounded && !m.flying) {
      const state = useForge.getState();
      const solids = solidsFor(state.entities);
      const p = entity.transform.position;
      const yaw = Number(entity.customData.yaw) || 0;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const feetY = p.y - 0.62;
      const reach = (side: "L" | "R") => {
        const hip = posed[`hip${side}`].x;
        const knee = posed[`knee${side}`].x;
        const lz = -THIGH * Math.sin(hip) - SHIN * Math.sin(hip + knee);
        const lx = side === "L" ? 0.09 : -0.09;
        const fx = p.x + cos * lx + sin * lz;
        const fz = p.z - sin * lx + cos * lz;
        const under = groundUnderFoot(fx, fz, feetY + 0.42, solids);
        return Math.max(-0.3, Math.min(0.4, under - feetY));
      };
      const raiseL = reach("L");
      const raiseR = reach("R");
      if (Math.abs(raiseL) > 0.01 || Math.abs(raiseR) > 0.01) {
        const drop = Math.max(0, -Math.min(raiseL, raiseR, 0));
        const solved = { ...posed, lift: posed.lift - drop } as Pose;
        for (const [side, raise] of [["L", raiseL], ["R", raiseR]] as const) {
          const leg = legIk(posed[`hip${side}`].x, posed[`knee${side}`].x, raise + drop, THIGH, SHIN);
          solved[`hip${side}`] = { ...posed[`hip${side}`], x: leg.hip };
          solved[`knee${side}`] = { ...posed[`knee${side}`], x: leg.knee };
        }
        posed = solved;
      }
    }

    // Ease every joint toward its target, so changes of gait blend instead of snapping.
    const p = pose.current;
    const k = 1 - Math.exp(-dt * 14);
    for (const name of Object.keys(posed) as (keyof Pose)[]) {
      if (name === "lift" || name === "breathe") continue;
      const from = p[name] as { x: number; y: number; z: number };
      const to = posed[name] as { x: number; y: number; z: number };
      from.x += (to.x - from.x) * k;
      from.y += (to.y - from.y) * k;
      from.z += (to.z - from.z) * k;
      const g = joints.current[name as Joint];
      if (g) g.rotation.set(from.x, from.y, from.z);
    }
    p.lift += (posed.lift - p.lift) * k;
    p.breathe += (t.breathe - p.breathe) * k;
    const pelvis = joints.current.pelvis;
    if (pelvis) pelvis.position.y = HIP_Y + p.lift;

    // Secondary motion: what hangs off the body lags its acceleration (in the body's own frame).
    const chest = joints.current.chest;
    if (chest) {
      const w = wobble.current;
      chest.getWorldPosition(w.at);
      w.track = track(w.track, w.at.x, w.at.y, w.at.z, dt);
      const yaw = Number(entity.customData.yaw) || 0;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const local = { x: w.track.ax * fz - w.track.az * fx, z: w.track.ax * fx + w.track.az * fz };
      // A hanging part swings the opposite way to an upright one. Bouncing (running, landing) shakes them too.
      const bounce = { x: local.x, z: local.z + w.track.ay * 0.35 };
      w.antenna = jiggle(w.antenna, bounce, dt, JIGGLE.antenna);
      w.pony = jiggle(w.pony, local, dt, JIGGLE.ponytail);
      if (antenna.current) antenna.current.rotation.set(-0.18 + w.antenna.x.x, 0, w.antenna.z.x);
      if (ponytail.current) ponytail.current.rotation.set(0.55 - w.pony.x.x - p.head.x * 0.6, 0, -w.pony.z.x);
      if (tail2.current) tail2.current.rotation.set(0.25 - w.pony.x.x * 0.6, 0, -w.pony.z.x * 0.6);
    }
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
            <meshStandardMaterial color={suit} roughness={0.6} metalness={0.1} />
          </mesh>
          <mesh position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.72, 1]}>
            <torusGeometry args={[0.145, 0.018, 8, 24]} />
            <meshStandardMaterial color={TRIM} roughness={0.35} metalness={0.7} />
          </mesh>
          {/* Legs. */}
          {(["L", "R"] as const).map((side) => (
            <group key={side} ref={set(`hip${side}`)} position={[side === "L" ? 0.09 : -0.09, 0, 0]}>
              <Limb length={THIGH} radius={0.065} color={suit} />
              <group ref={set(`knee${side}`)} position={[0, -THIGH, 0]}>
                <mesh position={[0, 0, 0.02]}>
                  <sphereGeometry args={[0.05, 10, 8]} />
                  <meshStandardMaterial color={SUIT_LIGHT} roughness={0.5} metalness={0.2} />
                </mesh>
                <Limb length={SHIN} radius={0.055} color={suit} />
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
                <meshStandardMaterial color={suit} roughness={0.58} metalness={0.12} />
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
            {/* A pack on the back, with an antenna on a spring. */}
            <mesh position={[0, TORSO * 0.55, -0.12]} castShadow>
              <boxGeometry args={[0.2, 0.24, 0.08]} />
              <meshStandardMaterial color={SUIT_LIGHT} roughness={0.5} metalness={0.3} />
            </mesh>
            <group ref={antenna} position={[0.07, TORSO * 0.55 + 0.12, -0.13]}>
              <mesh position={[0, 0.17, 0]}>
                <cylinderGeometry args={[0.006, 0.009, 0.34, 6]} />
                <meshStandardMaterial color={BOOT} roughness={0.4} metalness={0.6} />
              </mesh>
              <mesh position={[0, 0.35, 0]}>
                <sphereGeometry args={[0.022, 10, 8]} />
                <meshStandardMaterial color={GLOW} emissive={GLOW} emissiveIntensity={1.6} toneMapped={false} />
              </mesh>
            </group>
            {(["L", "R"] as const).map((side) => (
              <group key={side} ref={set(`shoulder${side}`)} position={[side === "L" ? 0.2 : -0.2, TORSO - 0.02, 0]}>
                <mesh scale={[1, 0.8, 1]}>
                  <sphereGeometry args={[0.065, 12, 10]} />
                  <meshStandardMaterial color={SUIT_LIGHT} roughness={0.45} metalness={0.3} />
                </mesh>
                <Limb length={UPPER_ARM} radius={0.048} color={suit} />
                <group ref={set(`elbow${side}`)} position={[0, -UPPER_ARM, 0]}>
                  <Limb length={FOREARM} radius={0.042} color={suit} />
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
              {/* Ponytail: two links on springs, hanging from the back of the head. */}
              <group ref={ponytail} position={[0, 0.16, -0.1]}>
                <mesh position={[0, -0.06, 0]}>
                  <capsuleGeometry args={[0.03, 0.08, 4, 8]} />
                  <meshStandardMaterial color="#2a211b" roughness={0.85} />
                </mesh>
                <group ref={tail2} position={[0, -0.12, 0]}>
                  <mesh position={[0, -0.06, 0]}>
                    <capsuleGeometry args={[0.024, 0.08, 4, 8]} />
                    <meshStandardMaterial color="#2a211b" roughness={0.85} />
                  </mesh>
                </group>
              </group>
              {head ? <group position={[0, 0.1, 0]}>{head}</group> : null}
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
