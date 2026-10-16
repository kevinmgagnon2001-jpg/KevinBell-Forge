import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { liveVisits } from "@/engine/live-visit";
import { useForge } from "@/engine/store";
import { ensureAvatar, restoreLab } from "@/engine/manifold";
import { DEFAULT_RULES, slotsOf, stepUnderRules, STATE_SLOTS } from "@/engine/mechanic";
import { runtimeNow } from "@/engine/movers";
import { carryAlong } from "@/engine/device-apps";
import { INTERACT_EVENT, LOOK_RATE, lookStick, pilotKeys, pilotStick, pointerClaim, setPilotSpeed, shiftLook, useLook, lookPose, faceLook } from "./look";
import { stageCamera, stageGl } from "./picture";
import { fovFor } from "@/engine/view";
import { solidsFor, stepWalk, WALK } from "@/engine/physics";
import { heightAt } from "@/engine/terrain";
import { chase, chasePoint, driveSpeed, KEY_PUSH } from "@/engine/drive";
import { frameCamera, gameById } from "@/engine/arcade";
import type { LookMode } from "./look";
import { arcadePlaying, avatarMotion, flight, toggleFlight } from "./body-state";

const EYE = 0.62;
const MIN_Y = 0.45;
const SPEED = 4.6;
const TURN = 1.8;
const BENCH_EYE = { x: 0.2, y: 16.4, z: 7.6 };
const BENCH_AT = { x: 0.2, y: 0.2, z: 0.4 };

function heading(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

const clamp1 = (n: number) => Math.max(-1, Math.min(1, n));
const DEAD = 0.15;
const deadzone = (n: number) => (Math.abs(n) < DEAD ? 0 : (n - Math.sign(n) * DEAD) / (1 - DEAD));

/**
 * A game controller, if one is connected: left stick moves, right stick looks, A jumps, X uses (pick
 * up the phone, play a game you are standing at), Y flies or lands, the triggers fly up and down.
 * Returns the lift and jump it asks for.
 */
const padHeld = { x: false, y: false, stick: false };
function readGamepad(dt: number): { lift: number; jump: boolean } {
  const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = Array.from(pads ?? []).find((p) => p && p.connected);
  if (!pad) return { lift: 0, jump: false };
  const lx = deadzone(pad.axes[0] ?? 0);
  const ly = deadzone(pad.axes[1] ?? 0);
  // Only drive the stick while the controller's stick is pushed, so the touch stick still works.
  if (lx || ly) {
    pilotStick.x = lx;
    pilotStick.y = -ly;
    padHeld.stick = true;
  } else if (padHeld.stick) {
    pilotStick.x = 0;
    pilotStick.y = 0;
    padHeld.stick = false;
  }
  const rx = deadzone(pad.axes[2] ?? 0);
  const ry = deadzone(pad.axes[3] ?? 0);
  if (rx || ry) shiftLook(rx * 520 * dt, ry * 360 * dt);
  const x = !!pad.buttons[2]?.pressed;
  if (x && !padHeld.x) window.dispatchEvent(new Event(INTERACT_EVENT));
  padHeld.x = x;
  const y = !!pad.buttons[3]?.pressed;
  if (y && !padHeld.y) toggleFlight();
  padHeld.y = y;
  return { lift: (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0), jump: !!pad.buttons[0]?.pressed };
}

/** Where the body stands and how it is falling, between frames. */
const body = { vy: 0, grounded: true };

/**
 * Third person moves like a modern action game: the camera orbits on its own (drag, right stick), the
 * stick and WASD move relative to the camera, and the body carries momentum. Walking forward the body
 * turns to where it goes; sideways or back it keeps facing ahead and side-steps. Q and E dash aside.
 * Flying steers by looking, like Anthem: you fly where the view points, climbing and diving with it;
 * W boosts, S brakes to a hover.
 */
const motion = { flew: false, vx: 0, vy: 0, vz: 0, bodyYaw: null as number | null, dash: 0, dashX: 0, dashZ: 0, cam: null as { x: number; y: number; z: number } | null, bank: 0 };
const ACCEL = { ground: 11, air: 2.5, fly: 2.2 };
const FLY = { cruise: 9, boost: 17, sprint: 27, drift: 4 };
const DASH = { speed: 9, time: 0.2 };
const TURN_RATE = 11;

/** Turn an angle toward another by at most `rate * dt`, the short way round. */
function turnToward(from: number, to: number, rate: number, dt: number): number {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.max(-rate * dt, Math.min(rate * dt, d));
}

/** Ease the camera toward the field of view for this mode on this screen (view.ts), so a rotation glides. */
function setFov(camera: { fov?: number; aspect?: number; updateProjectionMatrix?: () => void }, mode: LookMode, delta: number) {
  if (camera.fov == null) return;
  const target = fovFor(mode, camera.aspect ?? 1);
  if (Math.abs(camera.fov - target) < 0.05) return;
  camera.fov = delta > 0 ? camera.fov + (target - camera.fov) * Math.min(1, delta * 8) : target;
  camera.updateProjectionMatrix?.();
}

/**
 * God-mode body. Third person is a chase cam: A yaws the nose left on screen.
 * First person is the helm: A strafes left, drag looks.
 */
export function Pilot() {
  const mode = useLook().mode;
  const { camera, gl, controls } = useThree();
  const lookPrimed = useRef(false);
  const looking = useRef<number | null>(null);
  const benchSet = useRef(false);
  const seenMode = useRef(mode);
  const arcadeAim = useRef<{ x: number; y: number; z: number } | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    useForge.setState((state) => {
      const next = restoreLab(state);
      faceLook(0, -0.16);
      lookPrimed.current = true;
      return next;
    });
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // A game being played has the keys (Arcade.tsx).
      if (arcadePlaying.get()) return;
      if (event.code === "KeyF" && !event.repeat) toggleFlight();
      pilotKeys.add(event.code);
    };
    const up = (event: KeyboardEvent) => pilotKeys.delete(event.code);
    const dashKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || event.repeat || arcadePlaying.get()) return;
      if ((event.code === "KeyQ" || event.code === "KeyE") && motion.dash <= 0 && !flight.get()) {
        motion.dash = DASH.time;
        // Aside from where the camera looks: Q to the left, E to the right.
        const face = heading(lookPose.yaw);
        const side = event.code === "KeyQ" ? 1 : -1;
        motion.dashX = -face.z * -side;
        motion.dashZ = face.x * -side;
      }
    };
    window.addEventListener("keydown", dashKey);
    const blur = () => {
      pilotKeys.clear();
      pilotStick.x = 0;
      pilotStick.y = 0;
      lookStick.x = 0;
      lookStick.y = 0;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("keydown", dashKey);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useEffect(() => {
    const el = gl.domElement;
    let tracking: { id: number; x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => {
      if (modeRef.current === "bench" || event.button > 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, textarea, .steer, .mode-bar, .tex-sphere")) return;
      if (event.target !== el) return;
      tracking = { id: event.pointerId, x: event.clientX, y: event.clientY };
      looking.current = event.pointerId;
    };
    const onMove = (event: PointerEvent) => {
      if (!tracking || tracking.id !== event.pointerId || modeRef.current === "bench") return;
      const dx = event.clientX - tracking.x;
      const dy = event.clientY - tracking.y;
      tracking.x = event.clientX;
      tracking.y = event.clientY;
      const mx = dx || event.movementX || 0;
      const my = dy || event.movementY || 0;
      if (!mx && !my) return;
      lookPose.yaw -= mx * 0.006;
      lookPose.pitch = Math.max(-1.05, Math.min(1.05, lookPose.pitch - my * 0.006));
    };
    const onUp = (event: PointerEvent) => {
      if (tracking?.id === event.pointerId) tracking = null;
      if (looking.current === event.pointerId) looking.current = null;
      pointerClaim.entity = false;
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [gl]);

  useEffect(() => {
    const probe = {
      getYaw: () => lookPose.yaw,
      getSpeed: () => {
        const state = useForge.getState();
        const avatar = Object.values(state.entities).find((entity) => entity.tags.includes("architect"));
        return avatar ? Number(avatar.customData.speed) || 0 : 0;
      },
      getPosition: () => {
        const avatar = Object.values(useForge.getState().entities).find((entity) => entity.tags.includes("architect"));
        return avatar ? { ...avatar.transform.position } : null;
      },
      getVisits: () => [...liveVisits].map((v) => ({ bounds: v.bounds, walking: !!v.predictor, carried: !!v.rule, correction: v.predictor?.maxCorrection ?? 0 })),
      setKeys: (codes: string[]) => {
        pilotKeys.clear();
        for (const code of codes) pilotKeys.add(code);
      },
      getStick: () => ({ ...pilotStick }),
      setLook: (x: number, y: number) => {
        lookStick.x = x;
        lookStick.y = y;
      },
      setStick: (x: number, y: number) => {
        pilotStick.x = x;
        pilotStick.y = y;
      },
      getMotion: () => ({ ...avatarMotion, flying: flight.get(), playing: arcadePlaying.get()?.game ?? null }),
      /** Stand somewhere, facing yaw (for the browser checks). */
      place: (x: number, z: number, yaw: number, y?: number) => {
        faceLook(yaw, -0.16);
        body.vy = 0;
        useForge.setState((state) => {
          const avatar = Object.values(state.entities).find((entity) => entity.tags.includes("architect"));
          if (!avatar) return state;
          return { entities: { ...state.entities, [avatar.id]: { ...avatar, transform: { ...avatar.transform, position: { x, y: y ?? avatar.transform.position.y + 0.5, z } }, customData: { ...avatar.customData, yaw: String(yaw) } } } };
        });
      },
      build: (kind: string) => useForge.getState().dispatchManual("build_play", { kind }),
      setSteer: (value: number) => {
        pilotKeys.delete("KeyA");
        pilotKeys.delete("KeyD");
        if (value > 0.2) pilotKeys.add("KeyA");
        if (value < -0.2) pilotKeys.add("KeyD");
      },
    };
    window.__controlsTest = probe;
    return () => {
      if (window.__controlsTest === probe) delete window.__controlsTest;
    };
  }, []);

  useFrame((_, delta) => {
    stageCamera.current = camera;
    stageGl.current = gl.domElement;
    const orbit = controls as { enabled?: boolean; target?: { set: (x: number, y: number, z: number) => void }; update?: () => void } | null;
    if (seenMode.current !== mode) {
      lookPose.pitch = mode === "first" ? -0.08 : -0.16;
      seenMode.current = mode;
    }
    if (mode === "bench") {
      setPilotSpeed(0);
      setFov(camera, "bench", benchSet.current ? delta : 0);
      if (!benchSet.current) {
        camera.position.set(BENCH_EYE.x, BENCH_EYE.y, BENCH_EYE.z);
        camera.lookAt(BENCH_AT.x, BENCH_AT.y, BENCH_AT.z);
        if (orbit?.target) {
          orbit.target.set(BENCH_AT.x, BENCH_AT.y, BENCH_AT.z);
          orbit.update?.();
          benchSet.current = true;
        }
      }
      return;
    }
    benchSet.current = false;
    if (orbit) orbit.enabled = false;
    setFov(camera, mode, delta);
    const dt = Math.min(delta, 0.05);
    // Playing a game: the camera frames it and the body waits where it stood.
    const playing = arcadePlaying.get();
    if (playing) {
      const state = useForge.getState();
      const game = gameById(playing.game);
      const board = game?.find(state);
      setPilotSpeed(0);
      avatarMotion.speed = 0;
      if (game && board) {
        const persp = camera as { fov?: number; aspect?: number };
        const frame = frameCamera(game.framing(state, board), persp.fov ?? 50, persp.aspect ?? 1);
        const k = 1 - Math.exp(-dt * 5);
        camera.position.set(camera.position.x + (frame.eye.x - camera.position.x) * k, camera.position.y + (frame.eye.y - camera.position.y) * k, camera.position.z + (frame.eye.z - camera.position.z) * k);
        const aim = arcadeAim.current ?? { ...frame.at };
        aim.x += (frame.at.x - aim.x) * k;
        aim.y += (frame.at.y - aim.y) * k;
        aim.z += (frame.at.z - aim.z) * k;
        arcadeAim.current = aim;
        camera.lookAt(aim.x, aim.y, aim.z);
        stageCamera.current = camera;
      }
      return;
    }
    if (arcadeAim.current) {
      // Back from a game: look the way the body faces again.
      arcadeAim.current = null;
    }
    const keys = pilotKeys;
    const pad = readGamepad(dt);
    const padLift = pad.lift;
    const flying = flight.get();
    // The look stick turns at a rate: a small push is slow (squared, for aiming), a full push is fast.
    if (lookStick.x || lookStick.y) {
      lookPose.yaw -= lookStick.x * Math.abs(lookStick.x) * LOOK_RATE.yaw * dt;
      lookPose.pitch = Math.max(-1.05, Math.min(1.05, lookPose.pitch + lookStick.y * Math.abs(lookStick.y) * LOOK_RATE.pitch * dt));
    }
    // Keys and the thumbstick add up; the stick is analog, so a half push is half speed. Stick right
    // turns (or strafes) right, which is the D side.
    const turn = clamp1((keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) - (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - pilotStick.x);
    const gas = clamp1((keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) + pilotStick.y);
    // Flying, Space climbs and Shift (or C) sinks; walking, Space jumps and Shift runs.
    const lift = clamp1((keys.has("Space") ? 1 : 0) - ((flying && keys.has("ShiftLeft")) || keys.has("ControlLeft") || keys.has("KeyC") ? 1 : 0) + padLift);
    const jump = !flying && (keys.has("Space") || pad.jump);
    const sprint = !flying && (keys.has("ShiftLeft") || keys.has("ShiftRight"));
    // How hard the walk is pushed: the stick by how far it is dragged; keys jog, or run with Shift.
    const keyed = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].some((code) => keys.has(code));
    const drive = Math.min(1, Math.max(keyed ? (sprint ? KEY_PUSH.run : KEY_PUSH.jog) : 0, Math.hypot(pilotStick.x, pilotStick.y)));
    const pose = { x: 0, y: 0, z: 0, fx: 0, fz: 1, ok: false };
    useForge.setState((state) => {
      const avatar = Object.values(state.entities).find((entity) => entity.tags.includes("architect"));
      if (!avatar) return ensureAvatar(state);
      const storeYaw = Number(avatar.customData.yaw) || 0;
      if (!lookPrimed.current) {
        lookPose.yaw = storeYaw;
        lookPose.pitch = mode === "first" ? -0.08 : -0.16;
        lookPrimed.current = true;
      } else if (motion.bodyYaw != null && Math.abs(Math.atan2(Math.sin(storeYaw - motion.bodyYaw), Math.cos(storeYaw - motion.bodyYaw))) > 0.35) {
        // The forge turned the body (a command or a skill). Follow it.
        lookPose.yaw = storeYaw;
        motion.bodyYaw = storeYaw;
      }
      if (motion.bodyYaw == null) motion.bodyYaw = storeYaw;
      // A mechanic (a car, a plane) steers itself: A and D turn it, as before.
      const steering = !!state.moverHash && mode === "third";
      if (steering) lookPose.yaw += turn * TURN * dt;
      const strafe = steering ? 0 : -turn;
      const p = avatar.transform.position;
      const visit = [...liveVisits].find((v) => v.contains(p));
      for (const v of liveVisits) if (v !== visit && v.predictor) v.leave();
      // A mechanic of your own (a car, a plane, ...), unless you are on an island that did not take it.
      const mover = state.moverHash ? runtimeNow(state.moverHash) : null;
      const pkg = mover ? state.mechanics.find((m) => m.hash === state.moverHash) : undefined;
      if (mover && pkg && !(visit && !visit.rule)) {
        let saved: number[] | undefined;
        try {
          const parsed = JSON.parse(avatar.customData.mover || "null") as unknown;
          if (Array.isArray(parsed) && parsed.length === STATE_SLOTS && parsed.every(Number.isFinite)) saved = parsed as number[];
        } catch {
          saved = undefined;
        }
        const slots = slotsOf({ position: p, yaw: storeYaw, slots: saved });
        // The turn the person asked for this frame (keys in third person, the mouse in first); A/D also steer.
        const asked = lookPose.yaw - storeYaw;
        let out: number[];
        if (visit) {
          // On a visited island its host runs this same mechanic and has the last word; predict it here.
          const walker = visit.predictor ?? visit.walk({ position: p, yaw: storeYaw, slots });
          walker.input(gas, strafe, asked, dt, { steer: turn, lift });
          const shown = walker.shown();
          const local = visit.toLocal(shown.position);
          out = [...(shown.slots ?? slots)];
          out[0] = local.x;
          out[1] = local.y;
          out[2] = local.z;
          out[3] = shown.yaw;
        } else {
          out = stepUnderRules(mover, slots, { forward: gas, strafe, turn: asked, steer: turn, lift, dt, action: 0 }, [], DEFAULT_RULES);
        }
        lookPose.yaw = out[3];
        motion.bodyYaw = out[3];
        const face = heading(out[3]);
        const speed = Math.abs(out[5]);
        setPilotSpeed(speed);
        pose.x = out[0];
        pose.y = out[1];
        pose.z = out[2];
        pose.fx = face.x;
        pose.fz = face.z;
        pose.ok = true;
        const helm = Object.values(state.entities).find((entity) => entity.tags.includes("helm"));
        const entities = {
          ...state.entities,
          [avatar.id]: {
            ...avatar,
            transform: { ...avatar.transform, position: { x: out[0], y: out[1], z: out[2] } },
            customData: { ...avatar.customData, yaw: String(Math.round(out[3] * 1000) / 1000), speed: String(Math.round(speed * 100) / 100), mover: JSON.stringify(out), look: pkg.look },
          },
        };
        for (const v of liveVisits) {
          for (const [id, at] of v.others(state)) {
            const e = entities[id];
            if (e) entities[id] = { ...e, transform: { ...e.transform, position: at } };
          }
        }
        carryAlong(entities, { position: { x: out[0], y: out[1], z: out[2] }, yaw: out[3] });
        if (helm) {
          entities[helm.id] = {
            ...helm,
            transform: { ...helm.transform, position: { x: out[0] + face.x * 0.16, y: out[1] + EYE, z: out[2] + face.z * 0.16 } },
            customData: { ...helm.customData, yaw: String(Math.round(out[3] * 1000) / 1000) },
          };
        }
        return { entities };
      }
      if (avatar.customData.look || avatar.customData.mover) {
        // Back to walking: drop what the mechanic kept.
        const { look: _look, mover: _mover, ...rest } = avatar.customData;
        return { entities: { ...state.entities, [avatar.id]: { ...avatar, customData: rest } } };
      }
      // The camera's frame: forward is where it looks, right is to its right.
      const camFace = heading(lookPose.yaw);
      const camRight = { x: -camFace.z, z: camFace.x };
      let wx = camFace.x * gas + camRight.x * strafe;
      let wz = camFace.z * gas + camRight.z * strafe;
      // Diagonals are no faster than straight ahead.
      const push = Math.hypot(wx, wz);
      if (push > 1) {
        wx /= push;
        wz /= push;
      }
      const moving = Math.min(1, push);
      const pace = driveSpeed(drive);
      let yaw = motion.bodyYaw ?? lookPose.yaw;
      let flyUp = 0;
      if (flying && !motion.flew) motion.vy = Math.max(motion.vy, 5);
      motion.flew = flying;
      if (flying) {
        // Fly where you look: the view's pitch climbs and dives. W boosts, S brakes to a hover.
        const aim = mode === "first" ? lookPose.pitch : lookPose.pitch + 0.16;
        const boost = gas > 0.1 ? (sprint || keys.has("ShiftLeft") ? FLY.sprint : FLY.boost) : gas < -0.1 ? 0 : FLY.cruise;
        const cos = Math.cos(aim);
        const tx = camFace.x * cos * boost + camRight.x * strafe * FLY.drift;
        const tz = camFace.z * cos * boost + camRight.z * strafe * FLY.drift;
        const ty = Math.sin(aim) * boost + lift * SPEED;
        const k = 1 - Math.exp(-dt * ACCEL.fly);
        motion.vx += (tx - motion.vx) * k;
        motion.vz += (tz - motion.vz) * k;
        motion.vy += (ty - motion.vy) * k;
        flyUp = motion.vy;
        yaw = turnToward(yaw, lookPose.yaw, TURN_RATE * 0.6, dt);
        // Lean into turns.
        const yawRate = Math.atan2(Math.sin(lookPose.yaw - yaw), Math.cos(lookPose.yaw - yaw));
        motion.bank += (Math.max(-0.7, Math.min(0.7, yawRate * 1.5)) - motion.bank) * Math.min(1, dt * 4);
      } else {
        // Walking: momentum, quick on the ground and loose in the air.
        const k = 1 - Math.exp(-dt * (body.grounded ? ACCEL.ground : ACCEL.air));
        let want = { x: wx * pace, z: wz * pace };
        if (mode === "first") yaw = lookPose.yaw;
        else if (moving > 0.05) {
          // Third person: the push puts a point on the ground around you and the body chases it,
          // turning to step that way (springs back to a pivot when the point is behind).
          const dir = Math.hypot(wx, wz) || 1;
          const point = chasePoint(p.x, p.z, wx / dir, wz / dir, drive);
          const run = chase(yaw, p.x, p.z, point, pace, dt, TURN_RATE);
          yaw = run.yaw;
          want = { x: run.vx, z: run.vz };
        }
        motion.vx += (want.x - motion.vx) * k;
        motion.vz += (want.z - motion.vz) * k;
        motion.vy = 0;
        motion.bank *= Math.max(0, 1 - dt * 6);
      }
      if (motion.dash > 0) {
        // A dash aside: a burst, then momentum carries it out.
        motion.dash -= dt;
        motion.vx = motion.dashX * DASH.speed + wx * pace * 0.3;
        motion.vz = motion.dashZ * DASH.speed + wz * pace * 0.3;
      }
      motion.bodyYaw = yaw;
      const face = heading(yaw);
      const vx = motion.vx;
      const vz = motion.vz;
      setPilotSpeed(Math.hypot(vx, vz));
      let x = p.x + vx * dt;
      let z = p.z + vz * dt;
      let y = Math.max(MIN_Y, p.y + lift * SPEED * dt);
      let shoved: { id: number; vx: number; vz: number }[] = [];
      // On a visited island its host decides where you are: walk with prediction (prediction.ts), so it
      // still moves on this frame, and let the host correct it.
      if (visit) {
        const walker = visit.predictor ?? visit.walk({ position: p, yaw });
        const along = (vx * face.x + vz * face.z) / Math.max(pace, 1e-3);
        const aside = -(vx * -face.z + vz * face.x) / Math.max(pace, 1e-3);
        walker.input(clamp1(along), clamp1(aside), yaw - walker.predicted.yaw, dt);
        const shown = visit.toLocal(walker.shown().position);
        x = shown.x;
        z = shown.z;
        avatarMotion.grounded = true;
        avatarMotion.vy = 0;
      } else {
        // Here at home the body has weight: it walks on what is under it, steps up kerbs, stops at
        // walls, jumps, falls, and shoves loose things. Flying keeps the walls but drops gravity.
        const walked = stepWalk(
          { x: p.x, y: p.y - WALK.foot, z: p.z, vy: body.vy, grounded: body.grounded },
          { vx, vz, jump, fly: flying ? (Math.abs(flyUp) < 0.01 ? 0 : Math.sign(flyUp)) : null, flySpeed: Math.max(0.01, Math.abs(flyUp)) },
          solidsFor(state.entities),
          dt,
        );
        body.vy = walked.state.vy;
        body.grounded = walked.state.grounded;
        x = walked.state.x;
        y = walked.state.y + WALK.foot;
        z = walked.state.z;
        // A wall takes the momentum that ran into it.
        if (walked.bumped) {
          motion.vx = (x - p.x) / Math.max(dt, 1e-3);
          motion.vz = (z - p.z) / Math.max(dt, 1e-3);
        }
        shoved = walked.shoved;
        avatarMotion.grounded = walked.state.grounded;
        avatarMotion.vy = walked.state.vy;
        avatarMotion.bumped = walked.bumped;
        if (walked.landed > 2) avatarMotion.landed = Math.max(avatarMotion.landed, walked.landed);
      }
      avatarMotion.flying = flying;
      // How the body moves relative to where it faces, for side steps and walking backwards (Avatar.tsx).
      const sp = Math.hypot(vx, vz);
      avatarMotion.side = sp > 0.3 && !flying ? (vx * Math.cos(yaw) - vz * Math.sin(yaw)) / sp : 0;
      avatarMotion.back = sp > 0.3 && !flying && vx * face.x + vz * face.z < -0.2 * sp;
      avatarMotion.speed = Math.hypot(x - p.x, z - p.z) / Math.max(dt, 1e-3);
      pose.x = x;
      pose.y = y;
      pose.z = z;
      pose.fx = face.x;
      pose.fz = face.z;
      pose.ok = true;
      const yawStr = String(Math.round(yaw * 1000) / 1000);
      const speedStr = String(Math.round(Math.hypot(vx, vz) * 100) / 100);
      const moved = Math.hypot(x - p.x, y - p.y, z - p.z) > 1e-5 || yawStr !== (avatar.customData.yaw || "0") || speedStr !== (avatar.customData.speed || "0");
      const gliding = [...liveVisits].some((v) => v.others(state).size > 0);
      if (!moved && !gliding && !shoved.length) return state;
      const helm = Object.values(state.entities).find((entity) => entity.tags.includes("helm"));
      const nextAvatar = {
        ...avatar,
        transform: { ...avatar.transform, position: { x, y, z } },
        customData: { ...avatar.customData, yaw: yawStr, speed: speedStr },
      };
      const entities = { ...state.entities, [avatar.id]: nextAvatar };
      // What you walked into starts moving (Settle in Viewport.tsx steps it from here).
      for (const kick of shoved) {
        const e = entities[kick.id];
        if (!e?.physics) continue;
        const v = e.physics.velocity;
        entities[kick.id] = { ...e, physics: { ...e.physics, velocity: { x: Math.abs(kick.vx) > Math.abs(v.x) ? kick.vx : v.x, y: v.y, z: Math.abs(kick.vz) > Math.abs(v.z) ? kick.vz : v.z } } };
      }
      // Other visitors on visited islands glide between the host's snapshots.
      for (const v of liveVisits) {
        for (const [id, at] of v.others(state)) {
          const e = entities[id];
          if (e) entities[id] = { ...e, transform: { ...e.transform, position: at } };
        }
      }
      carryAlong(entities, { position: { x, y, z }, yaw });
      if (helm) {
        entities[helm.id] = {
          ...helm,
          transform: {
            ...helm.transform,
            position: { x: x + face.x * 0.16, y: y + EYE, z: z + face.z * 0.16 },
          },
          customData: { ...helm.customData, yaw: yawStr },
        };
      }
      return { entities };
    });
    if (!pose.ok) return;
    const eyeY = pose.y + EYE;
    const pitch = lookPose.pitch;
    if (mode === "first") {
      const cos = Math.cos(pitch);
      const ahead = 0.22;
      camera.position.set(pose.x + pose.fx * ahead, eyeY, pose.z + pose.fz * ahead);
      camera.lookAt(pose.x + pose.fx * (ahead + cos), eyeY + Math.sin(pitch), pose.z + pose.fz * (ahead + cos));
      stageCamera.current = camera;
      return;
    }
    // Third person: an orbit camera over the shoulder that follows with a little lag. Pitch swings it
    // over and under the body; flying it pulls back with speed.
    const speedNow = Math.hypot(motion.vx, motion.vy, motion.vz);
    const back = (flight.get() ? 5.6 + Math.min(4, speedNow * 0.18) : 4.6) * (1 + Math.max(0, -pitch) * 0.25);
    const camYaw = lookPose.yaw;
    const cf = heading(camYaw);
    const side = { x: -cf.z, z: cf.x };
    const height = 1.25 - Math.sin(pitch) * back * 0.9;
    const shoulder = 0.55;
    const want = {
      x: pose.x - cf.x * back * Math.cos(pitch * 0.6) + side.x * shoulder,
      y: Math.max(pose.y - 0.4, pose.y + height, heightAt(pose.x, pose.z) + 0.3),
      z: pose.z - cf.z * back * Math.cos(pitch * 0.6) + side.z * shoulder,
    };
    const cam = motion.cam ?? { ...want };
    const lag = 1 - Math.exp(-dt * (flight.get() ? 9 : 14));
    cam.x += (want.x - cam.x) * lag;
    cam.y += (want.y - cam.y) * lag;
    cam.z += (want.z - cam.z) * lag;
    motion.cam = cam;
    camera.position.set(cam.x, cam.y, cam.z);
    const aimAhead = 3;
    camera.lookAt(pose.x + cf.x * aimAhead + side.x * shoulder * 0.6, pose.y + 0.85 + Math.sin(pitch) * aimAhead, pose.z + cf.z * aimAhead + side.z * shoulder * 0.6);
    // Bank the view a touch into flying turns.
    if (flight.get() && Math.abs(motion.bank) > 0.001) camera.rotateZ(-motion.bank * 0.25);
    stageCamera.current = camera;
  });

  return null;
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      getPosition: () => { x: number; y: number; z: number } | null;
      getVisits: () => { bounds: { min: { x: number; z: number }; max: { x: number; z: number } } | null; walking: boolean; carried: boolean; correction: number }[];
      setKeys: (codes: string[]) => void;
      setSteer: (value: number) => void;
      setStick: (x: number, y: number) => void;
      getStick: () => { x: number; y: number };
      setLook: (x: number, y: number) => void;
      getMotion: () => { speed: number; grounded: boolean; vy: number; flying: boolean; playing: string | null };
      place: (x: number, z: number, yaw: number, y?: number) => void;
      build: (kind: string) => void;
    };
  }
}
