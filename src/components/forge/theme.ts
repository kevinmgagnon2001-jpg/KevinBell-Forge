/**
 * The UI theme: "bubble" dark (the default, a deep violet night of iridescent bubbles) or light.
 * Set on <html data-theme>, remembered on this device.
 */
import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";
const KEY = "forge-theme";
const listeners = new Set<() => void>();

function read(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function startTheme() {
  if (typeof window === "undefined") return;
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(KEY);
  } catch {
    saved = null;
  }
  document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: this visit only */
  }
  listeners.forEach((notify) => notify());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    read,
    () => "dark",
  );
}
