/**
 * Live state of the walking body and the arcade, shared by the pilot (pilot.tsx), the avatar
 * (Avatar.tsx), the on-screen controls (Viewport.tsx) and the arcade (Arcade.tsx). Plain objects
 * read every frame, plus small subscriptions for the few things buttons show. Not saved.
 */
import { useSyncExternalStore } from "react";
import type { TraverseKind } from "@/engine/parkour";
import type { MouthKey } from "@/engine/talk";
import type { RopeSim } from "@/engine/rope";
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
  /** Sideways share of the motion, -1..1 (+ to the body's left): a side step. */
  side: 0,
  /** Walking backwards. */
  back: false,
  /**
   * A vault, mantle or climb under way (parkour.ts): how far through it is (0..1), and where the
   * hands go on the ledge, relative to the feet (up) and ahead of the body's centre (ahead).
   */
  parkour: null as null | { kind: TraverseKind | "rope"; s: number; up: number; ahead: number },
};

/** Live positions of the townsfolk by entity id, stepped by Town.tsx and read by their figures. */
export const townBodies: Record<number, Body> = {};

/** The companion's live position, stepped by Companion.tsx (same shape as a townsperson's). */
export const companionBodies: Record<number, { x: number; y: number; z: number; yaw: number; speed: number }> = {};

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

/** Talking with a townsperson (Talk.tsx): who is close enough, and who you are talking with. */
export type TalkState = { id: number; name: string; reply: string; thinking: boolean };
export const talkNear = store<{ id: number; name: string } | null>(null);
export const talking = store<TalkState | null>(null);
export const useTalkNear = () => useSyncExternalStore(talkNear.subscribe, talkNear.get, () => null);
export const useTalking = () => useSyncExternalStore(talking.subscribe, talking.get, () => null);

/** The live ropes (Rope.tsx steps them), by entity id, and the one you are hanging on (pilot.tsx). */
export const liveRopes: Record<number, RopeSim> = {};
export const ropeGrip = { rope: null as number | null, index: 0, push: { x: 0, z: 0 }, cooldown: 0 };

/** Who is speaking a line now (by entity id): when it started (performance.now()) and its mouth shapes. */
export const mouths: Record<number, { start: number; track: MouthKey[] }> = {};

/** Keys for a game on a screen of its own (Breakout): the arcade hands them over, and no one else sees them. */
export const screenKeys: { down: ((event: KeyboardEvent) => void) | null } = { down: null };

/** The game you are standing at (offered), and the one you are playing. */
export const arcadeNear = store<ArcadeSpot | null>(null);
export const arcadePlaying = store<ArcadeSpot | null>(null);
export const useArcadeNear = () => useSyncExternalStore(arcadeNear.subscribe, arcadeNear.get, () => null);
export const useArcadePlaying = () => useSyncExternalStore(arcadePlaying.subscribe, arcadePlaying.get, () => null);
