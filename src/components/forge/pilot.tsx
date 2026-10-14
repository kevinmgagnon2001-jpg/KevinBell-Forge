import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { liveVisits } from "@/engine/live-visit";
import { useForge } from "@/engine/store";
import { ensureAvatar, restoreLab } from "@/engine/manifold";
import { pilotKeys, pointerClaim, setPilotSpeed, useLook, lookPose, faceLook } from "./look";
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
    const blur = () => pilotKeys.clear();
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
      setKeys: (codes: string[]) => {
        pilotKeys.clear();
        for (const code of codes) pilotKeys.add(code);
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
    const turn = (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) - (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0);
    const gas = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const lift = (keys.has("Space") ? 1 : 0) - (keys.has("ShiftLeft") || keys.has("ControlLeft") || keys.has("KeyC") ? 1 : 0);
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
      const yaw = lookPose.yaw;
      const face = heading(yaw);
      const right = { x: -face.z, z: face.x };
      const strafe = mode === "first" ? -turn : 0;
      const p = avatar.transform.position;
      const vx = face.x * gas + right.x * strafe;
      const vz = face.z * gas + right.z * strafe;
      const moving = Math.hypot(vx, vz);
      setPilotSpeed(moving * SPEED);
      let x = p.x + vx * SPEED * dt;
      let z = p.z + vz * SPEED * dt;
      // On a visited island its host decides where you are: walk with prediction (prediction.ts), so it
      // still moves on this frame, and let the host correct it.
      const visit = [...liveVisits].find((v) => v.contains(p));
      for (const v of liveVisits) if (v !== visit && v.predictor) v.leave();
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
      if (!moved) return state;
      const helm = Object.values(state.entities).find((entity) => entity.tags.includes("helm"));
      const nextAvatar = {
        ...avatar,
        transform: { ...avatar.transform, position: { x, y, z } },
        customData: { ...avatar.customData, yaw: yawStr, speed: speedStr },
      };
      const entities = { ...state.entities, [avatar.id]: nextAvatar };
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
      setKeys: (codes: string[]) => void;
      setSteer: (value: number) => void;
    };
  }
}
