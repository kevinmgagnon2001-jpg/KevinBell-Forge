/**
 * Live state of the walking body and the arcade, shared by the pilot (pilot.tsx), the avatar
 * (Avatar.tsx), the on-screen controls (Viewport.tsx) and the arcade (Arcade.tsx). Plain objects
 * read every frame, plus small subscriptions for the few things buttons show. Not saved.
 */
import { useSyncExternalStore } from "react";
import type { Body } from "@/engine/town";

/** What the body is doing, for its animation. Written by the pilot every frame. */
export const avatarMotion = {
  /** Across the ground, m/s. */
  speed: 0,
  grounded: true,
  /** Up (+) or down (-), m/s. */
  vy: 0,
  flying: false,
  /** How hard the last landing was (m/s); the avatar eases it back to 0 as it recovers. */
  landed: 0,
  /** Ran into a wall this frame. */
  bumped: false,
};

/** Live positions of the townsfolk by entity id, stepped by Town.tsx and read by their figures. */
export const townBodies: Record<number, Body> = {};

/** When lightning last struck (performance.now()), written by the sky (Scenery.tsx), heard as thunder. */
export const lightning = { at: 0 };

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((notify) => notify());
    },
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
  };
}

/** Flying (no gravity, Up and Down climb) or walking (gravity, Jump). F or the Fly button toggles. */
export const flight = store(false);
export const toggleFlight = () => flight.set(!flight.get());
export const useFlight = () => useSyncExternalStore(flight.subscribe, flight.get, () => false);

export type ArcadeSpot = { game: string; label: string };

/** The game you are standing at (offered), and the one you are playing. */
export const arcadeNear = store<ArcadeSpot | null>(null);
export const arcadePlaying = store<ArcadeSpot | null>(null);
export const useArcadeNear = () => useSyncExternalStore(arcadeNear.subscribe, arcadeNear.get, () => null);
export const useArcadePlaying = () => useSyncExternalStore(arcadePlaying.subscribe, arcadePlaying.get, () => null);
