/**
 * The picture's finishing, by quality rung (perf.ts `post`): ambient occlusion (N8AO) grounds
 * everything in contact shadow, height fog and sun scatter give the air depth (atmosphere.ts), god
 * rays stream from the sun through the trees, bloom makes lamps, neon, screens and the sun glow, AgX
 * tone mapping keeps bright skies from clipping, a gentle grade, SMAA cleans edges, and at "11" a
 * touch of lens fringing, a vignette and film grain.
 * Lower rungs draw straight to the screen with the renderer's own tone mapping.
 */
import { useFrame, useThree } from "@react-three/fiber";
import {
  Bloom,
  BrightnessContrast,
  ChromaticAberration,
  EffectComposer,
  GodRays,
  HueSaturation,
  N8AO,
  Noise,
  SMAA,
  ToneMapping,
  Vignette,
  wrapEffect,
} from "@react-three/postprocessing";
import { BlendFunction, KernelSize, ToneMappingMode, type GodRaysEffect } from "postprocessing";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ACESFilmicToneMapping, NoToneMapping, Vector2 } from "three";
import type { Post } from "@/engine/perf";
import { AtmosphereEffect, air, sunDisc } from "./atmosphere";

const Atmosphere = wrapEffect(AtmosphereEffect);

/** The part of N8AO's pass this file turns (n8ao ships no types). */
type N8AOPostPass = { configuration: { intensity: number } };

/** ?nofx=air,rays,ao,bloom for comparing the picture with a pass left out. */
const OFF = new Set(typeof location === "undefined" ? [] : (new URLSearchParams(location.search).get("nofx") ?? "").split(","));

/**
 * Keeps the god rays to daylight, and the occlusion in step with the light: contact shadow is the
 * sky's light blocked, so under a dim night sky it is faint (at full strength it crushed the night
 * into black shapes).
 */
function Steady({ rays, ao, aoBase }: { rays: RefObject<GodRaysEffect | null>; ao: RefObject<N8AOPostPass | null>; aoBase: number }) {
  useFrame(() => {
    const pass = ao.current;
    if (pass) {
      const light = Math.max(0, Math.min(1, (air.sunDir.y + 0.08) * 4));
      pass.configuration.intensity = aoBase * (0.25 + 0.75 * light);
    }
    const r = rays.current;
    if (r) {
      // Fade out as the sun sets or hides behind weather.
      const day = Math.max(0, Math.min(1, (air.sunDir.y + 0.02) * 6));
      r.blendMode.opacity.value = day * (1 - air.haze * 0.8) * (1 - air.wet * 0.7);
    }
  });
  return null;
}

/**
 * Deep night, checked once a second. The occlusion pass comes out of the chain then: in a scene this
 * dark it blotted dim shapes into black squares (even switched off, only leaving the chain cured it).
 */
function useNight(): boolean {
  const [night, setNight] = useState(() => air.sunDir.y < -0.06);
  useEffect(() => {
    const timer = window.setInterval(() => setNight((was) => (was ? air.sunDir.y < -0.02 : air.sunDir.y < -0.06)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return night;
}

export function PostFX({ post }: { post: Post }) {
  const night = useNight();
  const gl = useThree((s) => s.gl);
  const rays = useRef<GodRaysEffect | null>(null);
  const aoPass = useRef<N8AOPostPass | null>(null);
  const fringe = useMemo(() => new Vector2(0.0006, 0.0004), []);
  // The composer tone maps at the end; the renderer must not do it a second time.
  useLayoutEffect(() => {
    if (post === "none") return;
    gl.toneMapping = NoToneMapping;
    return () => {
      gl.toneMapping = ACESFilmicToneMapping;
    };
  }, [gl, post]);
  if (post === "none") return null;
  const eleven = post === "eleven";
  const air3d = post !== "lite";
  const ao = air3d && !night && !OFF.has("ao");
  const atmos = air3d && !OFF.has("air");
  const godRays = air3d && !OFF.has("rays");
  return (
    <>
      <EffectComposer multisampling={0} enableNormalPass={false}>
        {ao ? <N8AO ref={aoPass} aoRadius={eleven ? 1.6 : 1.2} distanceFalloff={0.9} intensity={eleven ? 3.2 : 2.4} quality={eleven ? "high" : "medium"} halfRes={!eleven} color="#0b0a10" /> : <></>}
        {atmos ? <Atmosphere /> : <></>}
        {godRays ? (
          <GodRays
            ref={rays}
            sun={sunDisc}
            blendFunction={BlendFunction.SCREEN}
            samples={eleven ? 60 : 36}
            density={0.94}
            decay={0.93}
            weight={0.34}
            exposure={0.42}
            clampMax={1}
            kernelSize={KernelSize.SMALL}
            blur
            resolutionScale={eleven ? 0.5 : 0.35}
          />
        ) : (
          <></>
        )}
        <Bloom mipmapBlur luminanceThreshold={0.82} luminanceSmoothing={0.2} intensity={eleven ? 0.95 : 0.7} radius={0.75} />
        <ToneMapping mode={ToneMappingMode.AGX} />
        {/* A gentle grade after the tone curve: a little richer colour and contrast. */}
        <HueSaturation saturation={eleven ? 0.12 : 0.08} />
        <BrightnessContrast contrast={eleven ? 0.07 : 0.04} />
        <SMAA />
        {eleven ? <ChromaticAberration offset={fringe} radialModulation modulationOffset={0.35} /> : <></>}
        {eleven ? <Vignette offset={0.32} darkness={0.42} /> : <></>}
        {eleven ? <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.18} /> : <></>}
      </EffectComposer>
      {air3d ? <Steady rays={rays} ao={aoPass} aoBase={eleven ? 3.2 : 2.4} /> : null}
    </>
  );
}
