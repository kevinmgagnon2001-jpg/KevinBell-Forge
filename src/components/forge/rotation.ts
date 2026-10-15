/**
 * Screen rotation (src/engine/view.ts). The setting is remembered on this device:
 *
 *   auto       Forge turns with the phone, even when the phone's rotation lock is on (default).
 *   portrait   / landscape: held one way.
 *   system     follow the phone's own rotation setting.
 *
 * In the Android app the bridge sets the activity's orientation (MainActivity.kt, setOrientation).
 * In a browser, portrait/landscape can only be held in full screen (screen.orientation.lock), so it is
 * tried and quietly skipped where the browser says no.
 *
 * `useAutoFill`: a phone turned on its side fills the screen with the 3D view, and goes back to the
 * window when turned upright again (unless the person chose Fill themselves).
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { isPhoneLandscape, isRotation, type Rotation } from "@/engine/view";

const PREF = "forge-rotation";
let rotation: Rotation = "auto";
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = globalThis.localStorage?.getItem(PREF);
    if (isRotation(saved)) rotation = saved;
  } catch {
    /* default */
  }
}

type Bridge = { setOrientation?: (mode: string) => boolean };
type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };

/** Tell the phone (or browser) about the setting. */
export function applyRotation() {
  load();
  const android = (globalThis as { ForgeAndroid?: Bridge }).ForgeAndroid;
  if (android?.setOrientation) {
    android.setOrientation(rotation);
    return;
  }
  const orientation = (globalThis.screen?.orientation ?? null) as LockableOrientation | null;
  if (!orientation) return;
  if (rotation === "portrait" || rotation === "landscape") {
    void orientation.lock?.(rotation)?.catch(() => undefined);
  } else {
    try {
      orientation.unlock?.();
    } catch {
      /* nothing was locked */
    }
  }
}

export function setRotation(next: Rotation) {
  load();
  rotation = next;
  try {
    globalThis.localStorage?.setItem(PREF, next);
  } catch {
    /* kept for this session */
  }
  applyRotation();
  listeners.forEach((notify) => notify());
}

export function useRotation(): Rotation {
  load();
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => rotation,
    () => "auto" as Rotation,
  );
}

const ROTATION_LABEL: Record<Rotation, string> = { auto: "Auto", portrait: "Portrait", landscape: "Landscape", system: "Phone" };
export const rotationLabel = (r: Rotation) => ROTATION_LABEL[r];

/** Fill the screen when a phone is turned on its side; back to the window when upright, if we filled it. */
export function useAutoFill(immersive: boolean, setImmersive: (on: boolean) => void) {
  const filledByTurn = useRef(false);
  const wasLandscape = useRef<boolean | null>(null);
  const state = useRef({ immersive, setImmersive });
  state.current = { immersive, setImmersive };
  useEffect(() => {
    applyRotation();
    const touch = typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || "ontouchstart" in window);
    const check = () => {
      const landscape = isPhoneLandscape(window.innerWidth, window.innerHeight, touch);
      if (wasLandscape.current === landscape) return;
      const first = wasLandscape.current === null;
      wasLandscape.current = landscape;
      const { immersive: on, setImmersive: set } = state.current;
      if (landscape && !on) {
        filledByTurn.current = true;
        set(true);
      } else if (!landscape && !first && filledByTurn.current) {
        filledByTurn.current = false;
        set(false);
      }
    };
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);
  // Choosing Window by hand while sideways keeps the window (and turning upright then changes nothing).
  const before = useRef(immersive);
  useEffect(() => {
    if (before.current && !immersive) filledByTurn.current = false;
    before.current = immersive;
  }, [immersive]);
}
