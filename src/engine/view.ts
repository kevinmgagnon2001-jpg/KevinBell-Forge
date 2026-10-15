/**
 * The camera's field of view for the screen it is on, and the screen's rotation setting.
 *
 * three.js fixes the VERTICAL field of view, so a phone held upright (aspect ~0.46 on a Galaxy S26
 * Ultra) sees a narrow slot while the same phone on its side sees a wide view. `fovFor` keeps each view
 * at its intended vertical angle on wide screens, and on narrow ones widens the vertical angle (up to a
 * cap, past which the picture bends too much) so the horizontal view does not collapse.
 */
export type ViewMode = "third" | "first" | "bench";

/** Vertical angle on a wide screen, the horizontal angle we try to keep, and the vertical cap. */
export const VIEW_FOV: Record<ViewMode, { base: number; wide: number; cap: number }> = {
  first: { base: 68, wide: 90, cap: 96 },
  third: { base: 52, wide: 72, cap: 84 },
  bench: { base: 46, wide: 62, cap: 76 },
};

const deg = Math.PI / 180;

/** The vertical field of view, in degrees, for a view mode on a screen of this aspect (width / height). */
export function fovFor(mode: ViewMode, aspect: number): number {
  const spec = VIEW_FOV[mode];
  if (!Number.isFinite(aspect) || aspect <= 0) return spec.base;
  // The vertical angle that shows `wide` degrees across.
  const needed = (2 * Math.atan(Math.tan((spec.wide * deg) / 2) / aspect)) / deg;
  return Math.min(spec.cap, Math.max(spec.base, needed));
}

/** The horizontal angle a vertical field of view gives on this aspect. */
export function horizontalFov(vertical: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((vertical * deg) / 2) * aspect)) / deg;
}

/**
 * How the screen may turn. "auto" follows the phone's sensor even when the system rotation lock is
 * on (Forge is a 3D view: turning the phone sideways should widen it); "system" follows the phone's
 * own setting; the other two hold one way.
 */
export const ROTATIONS = ["auto", "portrait", "landscape", "system"] as const;
export type Rotation = (typeof ROTATIONS)[number];

export function isRotation(value: unknown): value is Rotation {
  return typeof value === "string" && (ROTATIONS as readonly string[]).includes(value);
}

/** The next setting for the Rotate button (it skips "system"; that one is set from the Stats panel only). */
export function nextRotation(current: Rotation): Rotation {
  const cycle: Rotation[] = ["auto", "portrait", "landscape"];
  const i = cycle.indexOf(current);
  return cycle[(i + 1) % cycle.length];
}

/** A phone on its side: wider than tall and short. Tablets and laptops are left alone. */
export function isPhoneLandscape(width: number, height: number, touch: boolean): boolean {
  return touch && width > height && height <= 540;
}
