import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAutoFill } from "./rotation";

export type LookMode = "bench" | "first" | "third";

/** Shared with the pilot so a click on a prop does not also swing the view. */
export const pointerClaim = { entity: false };

/** Shared with the pilot and the on-screen look pad. Not persisted. */
export const lookPose = { yaw: 0, pitch: -0.16 };

export function shiftLook(dx: number, dy: number) {
  lookPose.yaw -= dx * 0.006;
  lookPose.pitch = Math.max(-1.05, Math.min(1.05, lookPose.pitch - dy * 0.006));
}

export function faceLook(yaw: number, pitch: number) {
  lookPose.yaw = yaw;
  lookPose.pitch = pitch;
}

/** Held keys. The keyboard and the visor buttons write here. Tests replace the set. */
export const pilotKeys = new Set<string>();

/**
 * The on-screen thumbstick (or a gamepad's left stick): x right, y forward, each -1..1. Added to
 * the keys, so a half push walks at half speed.
 */
export const pilotStick = { x: 0, y: 0 };

/**
 * The right thumbstick: hold it off centre and the view keeps turning (x right, y up, each -1..1),
 * so a full turn needs no lifting and re-dragging. Dragging the view itself stays for fine aim.
 */
export const lookStick = { x: 0, y: 0 };
/** Fastest turn from the look stick, radians per second (yaw, pitch). */
export const LOOK_RATE = { yaw: 2.6, pitch: 1.5 };

/** "Use" from the controller (E, the gamepad's A): pick up the phone, or pull it out. */
export const INTERACT_EVENT = "forge:interact";

export let pilotSpeed = 0;

export function setPilotSpeed(speed: number) {
  pilotSpeed = speed;
}

/** Crosshair target. Not persisted, so looking around does not rewrite the saved world. */
let gazeId: number | null = null;
const gazeListeners = new Set<() => void>();

export function currentGaze(): number | null {
  return gazeId;
}

export function setGazeLock(id: number | null) {
  if (gazeId === id) return;
  gazeId = id;
  gazeListeners.forEach((notify) => notify());
}

export function useGazeId(): number | null {
  return useSyncExternalStore(
    (notify) => {
      gazeListeners.add(notify);
      return () => gazeListeners.delete(notify);
    },
    () => gazeId,
    () => null,
  );
}

/** Where the crosshair sits, as a percent of the view. The ray uses the same point. */
let aimSnap = { x: 50, y: 50 };
let aimLive = false;
const aimListeners = new Set<() => void>();

export function setAimPoint(x: number, y: number, live: boolean) {
  if (aimLive === live && Math.abs(aimSnap.x - x) < 0.25 && Math.abs(aimSnap.y - y) < 0.25) return;
  aimLive = live;
  aimSnap = { x, y };
  aimListeners.forEach((notify) => notify());
}

export function useAimPoint(): { x: number; y: number } {
  return useSyncExternalStore(
    (notify) => {
      aimListeners.add(notify);
      return () => aimListeners.delete(notify);
    },
    () => aimSnap,
    () => aimSnap,
  );
}

type LookValue = {
  mode: LookMode;
  setMode: (mode: LookMode) => void;
  immersive: boolean;
  setImmersive: (on: boolean) => void;
};

const LookContext = createContext<LookValue | null>(null);

export function LookProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<LookMode>("third");
  const [immersive, setImmersive] = useState(false);
  useAutoFill(immersive, setImmersive);

  useEffect(() => {
    const onFull = () => {
      if (!document.fullscreenElement) setImmersive(false);
    };
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.key === "Escape") setImmersive(false);
    };
    document.addEventListener("fullscreenchange", onFull);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFull);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const node = document.querySelector(".app");
    if (!(node instanceof HTMLElement)) return;
    if (immersive) {
      void node.requestFullscreen?.().catch(() => undefined);
      return;
    }
    if (document.fullscreenElement === node) void document.exitFullscreen?.().catch(() => undefined);
  }, [immersive]);

  const value = useMemo(
    () => ({ mode, setMode, immersive, setImmersive }),
    [mode, immersive],
  );

  return <LookContext.Provider value={value}>{children}</LookContext.Provider>;
}

export function useLook(): LookValue {
  const value = useContext(LookContext);
  if (!value) {
    return {
      mode: "bench",
      setMode: () => undefined,
      immersive: false,
      setImmersive: () => undefined,
    };
  }
  return value;
}
