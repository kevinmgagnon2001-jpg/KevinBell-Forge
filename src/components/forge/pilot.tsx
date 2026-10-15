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
 * A game controller, if one is connected: left stick moves, right stick looks, A uses (pick up or
 * pull out the phone), the triggers fly up and down. Returns the lift it asks for.
 */
const padHeld = { a: false, stick: false };
function readGamepad(dt: number): number {
  const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = Array.from(pads ?? []).find((p) => p && p.connected);
  if (!pad) return 0;
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
  const a = !!pad.buttons[0]?.pressed;
  if (a && !padHeld.a) window.dispatchEvent(new Event(INTERACT_EVENT));
  padHeld.a = a;
  return (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
}

function setFov(camera: { fov?: number; updateProjectionMatrix?: () => void }, fov: number) {
  if (camera.fov == null || Math.abs(camera.fov - fov) < 0.5) return;
  camera.fov = fov;
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
      pilotKeys.add(event.code);
    };
    const up = (event: KeyboardEvent) => pilotKeys.delete(event.code);
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
      if (!benchSet.current) {
        camera.position.set(BENCH_EYE.x, BENCH_EYE.y, BENCH_EYE.z);
        camera.lookAt(BENCH_AT.x, BENCH_AT.y, BENCH_AT.z);
        setFov(camera, 46);
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
    setFov(camera, mode === "first" ? 68 : 52);
    const dt = Math.min(delta, 0.05);
    const keys = pilotKeys;
    const padLift = readGamepad(dt);
    // The look stick turns at a rate: a small push is slow (squared, for aiming), a full push is fast.
    if (lookStick.x || lookStick.y) {
      lookPose.yaw -= lookStick.x * Math.abs(lookStick.x) * LOOK_RATE.yaw * dt;
      lookPose.pitch = Math.max(-1.05, Math.min(1.05, lookPose.pitch + lookStick.y * Math.abs(lookStick.y) * LOOK_RATE.pitch * dt));
    }
    // Keys and the thumbstick add up; the stick is analog, so a half push is half speed. Stick right
    // turns (or strafes) right, which is the D side.
    const turn = clamp1((keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) - (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - pilotStick.x);
    const gas = clamp1((keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) + pilotStick.y);
    const lift = clamp1((keys.has("Space") ? 1 : 0) - (keys.has("ShiftLeft") || keys.has("ControlLeft") || keys.has("KeyC") ? 1 : 0) + padLift);
    const pose = { x: 0, y: 0, z: 0, fx: 0, fz: 1, ok: false };
    useForge.setState((state) => {
      const avatar = Object.values(state.entities).find((entity) => entity.tags.includes("architect"));
      if (!avatar) return ensureAvatar(state);
      const storeYaw = Number(avatar.customData.yaw) || 0;
      if (!lookPrimed.current) {
        lookPose.yaw = storeYaw;
        lookPose.pitch = mode === "first" ? -0.08 : -0.16;
        lookPrimed.current = true;
      } else if (Math.abs(storeYaw - lookPose.yaw) > 0.35) {
        // The forge turned the body (a command or a skill). Follow it.
        lookPose.yaw = storeYaw;
      }
      // Chase cam: A and D turn the body. Helm: A and D strafe, drag looks.
      if (mode === "third") lookPose.yaw += turn * TURN * dt;
      const strafe = mode === "first" ? -turn : 0;
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
      const yaw = lookPose.yaw;
      const face = heading(yaw);
      const right = { x: -face.z, z: face.x };
      const vx = face.x * gas + right.x * strafe;
      const vz = face.z * gas + right.z * strafe;
      const moving = Math.hypot(vx, vz);
      setPilotSpeed(moving * SPEED);
      let x = p.x + vx * SPEED * dt;
      let z = p.z + vz * SPEED * dt;
      // On a visited island its host decides where you are: walk with prediction (prediction.ts), so it
      // still moves on this frame, and let the host correct it.
      if (visit) {
        const walker = visit.predictor ?? visit.walk({ position: p, yaw: yaw - (mode === "third" ? turn * TURN * dt : 0) });
        walker.input(gas, strafe, yaw - walker.predicted.yaw, dt);
        const shown = visit.toLocal(walker.shown().position);
        x = shown.x;
        z = shown.z;
      }
      const y = Math.max(MIN_Y, p.y + lift * SPEED * dt);
      pose.x = x;
      pose.y = y;
      pose.z = z;
      pose.fx = face.x;
      pose.fz = face.z;
      pose.ok = true;
      const yawStr = String(Math.round(yaw * 1000) / 1000);
      const speedStr = String(Math.round(moving * SPEED * 100) / 100);
      const moved = Math.hypot(x - p.x, y - p.y, z - p.z) > 1e-5 || yawStr !== (avatar.customData.yaw || "0") || speedStr !== (avatar.customData.speed || "0");
      const gliding = [...liveVisits].some((v) => v.others(state).size > 0);
      if (!moved && !gliding) return state;
      const helm = Object.values(state.entities).find((entity) => entity.tags.includes("helm"));
      const nextAvatar = {
        ...avatar,
        transform: { ...avatar.transform, position: { x, y, z } },
        customData: { ...avatar.customData, yaw: yawStr, speed: speedStr },
      };
      const entities = { ...state.entities, [avatar.id]: nextAvatar };
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
    const back = 6.2;
    const rise = 3.4 + pitch * 0.5;
    camera.position.set(pose.x - pose.fx * back, pose.y + rise, pose.z - pose.fz * back);
    camera.lookAt(pose.x + pose.fx * 2.2, pose.y + 0.85, pose.z + pose.fz * 2.2);
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
    };
  }
}
