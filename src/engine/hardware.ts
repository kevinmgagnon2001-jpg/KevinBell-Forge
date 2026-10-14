/**
 * Hardware probe. One question: what can this machine draw, and how hard should we push it.
 * Pure reads, no side effects, safe to call before the 3D view mounts.
 *
 * Tiers
 *   none  no WebGL at all. The flat manifold stage stays up.
 *   low   software GL, tiny memory, or very few cores. 1x pixels, no antialias.
 *   mid   phones and mid laptops. Up to 1.5x pixels, antialias on.
 *   high  desktop class GPU. Up to 2x pixels, antialias on, high-performance GPU.
 */
export type Tier = "none" | "low" | "mid" | "high";

export type HardwareProfile = {
  tier: Tier;
  webgl: boolean;
  webgl2: boolean;
  webgpu: boolean;
  software: boolean;
  renderer: string;
  cores: number;
  memoryGb: number;
  touch: boolean;
  dpr: number;
};

/** How much of the world around the lab to draw (Scenery.tsx). */
export type SceneryLevel = "full" | "lite" | "min";
export type SceneryChoice = SceneryLevel | "off";

export type Quality = {
  dpr: [number, number];
  antialias: boolean;
  powerPreference: "high-performance" | "low-power" | "default";
  /** Sun shadows. */
  shadows: boolean;
  scenery: SceneryChoice;
};

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|softpipe|microsoft basic render/i;

type NavigatorHints = Navigator & { deviceMemory?: number; gpu?: unknown };

function glInfo(): { webgl: boolean; webgl2: boolean; renderer: string } {
  if (typeof document === "undefined") return { webgl: false, webgl2: false, renderer: "" };
  try {
    const canvas = document.createElement("canvas");
    const gl2 = canvas.getContext("webgl2");
    const gl = gl2 ?? canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
    if (!gl) return { webgl: false, webgl2: false, renderer: "" };
    const context = gl as WebGLRenderingContext;
    const ext = context.getExtension("WEBGL_debug_renderer_info");
    const renderer = ext ? String(context.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "") : "";
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return { webgl: true, webgl2: Boolean(gl2), renderer };
  } catch {
    return { webgl: false, webgl2: false, renderer: "" };
  }
}

export function classify(input: Omit<HardwareProfile, "tier">): Tier {
  if (!input.webgl) return "none";
  if (input.software) return "low";
  if (input.memoryGb > 0 && input.memoryGb <= 2) return "low";
  if (input.cores > 0 && input.cores <= 2) return "low";
  if (input.touch || (input.memoryGb > 0 && input.memoryGb <= 4) || input.cores <= 4) return "mid";
  return "high";
}

let cached: HardwareProfile | null = null;

export function probeHardware(): HardwareProfile {
  if (cached) return cached;
  const nav: NavigatorHints | null = typeof navigator === "undefined" ? null : (navigator as NavigatorHints);
  const info = glInfo();
  const base = {
    webgl: info.webgl,
    webgl2: info.webgl2,
    webgpu: Boolean(nav && "gpu" in nav && nav.gpu),
    software: SOFTWARE_RENDERER.test(info.renderer),
    renderer: info.renderer,
    cores: nav?.hardwareConcurrency ?? 0,
    memoryGb: nav?.deviceMemory ?? 0,
    touch: typeof window !== "undefined" && ("ontouchstart" in window || (nav?.maxTouchPoints ?? 0) > 0),
    dpr: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
  };
  cached = { ...base, tier: classify(base) };
  return cached;
}

export function qualityFor(profile: HardwareProfile): Quality {
  switch (profile.tier) {
    case "high":
      return { dpr: [1, 2], antialias: true, powerPreference: "high-performance", shadows: true, scenery: "full" };
    case "mid":
      return { dpr: [1, 1.5], antialias: true, powerPreference: "default", shadows: true, scenery: "lite" };
    default:
      // With no graphics chip at all (a software renderer) even the light scenery drops the frame rate
      // several times over, so it keeps the plain lab.
      return { dpr: [1, 1], antialias: false, powerPreference: "low-power", shadows: false, scenery: profile.software ? "off" : "min" };
  }
}

/** ?soft=1 turns on the flat software picture. Debug only, for GPUs that report WebGL but draw nothing. */
export function softRenderRequested(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("soft") === "1";
  } catch {
    return false;
  }
}

/** ?scenery=full|lite|min|off picks how much of the world around the lab to draw, whatever the hardware. */
export function sceneryRequested(): SceneryChoice | null {
  if (typeof window === "undefined") return null;
  try {
    const flag = new URLSearchParams(window.location.search).get("scenery");
    return flag === "full" || flag === "lite" || flag === "min" || flag === "off" ? flag : null;
  } catch {
    return null;
  }
}
