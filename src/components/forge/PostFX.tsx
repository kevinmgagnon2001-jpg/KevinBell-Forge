/**
 * The picture's finishing, by quality rung (perf.ts `post`): ambient occlusion (N8AO) grounds
 * everything in contact shadow, bloom makes lamps, neon, screens and the sun glow, AgX tone mapping
 * keeps bright skies from clipping, SMAA cleans edges, and at "11" a vignette and a little film grain.
 * Lower rungs draw straight to the screen with the renderer's own tone mapping.
 */
import { useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, Noise, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import { useLayoutEffect } from "react";
import { ACESFilmicToneMapping, NoToneMapping } from "three";
import type { Post } from "@/engine/perf";

export function PostFX({ post }: { post: Post }) {
  const gl = useThree((s) => s.gl);
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
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {post !== "lite" ? <N8AO aoRadius={eleven ? 1.6 : 1.2} distanceFalloff={0.9} intensity={eleven ? 3.2 : 2.4} quality={eleven ? "high" : "medium"} halfRes={!eleven} color="#0b0a10" /> : <></>}
      <Bloom mipmapBlur luminanceThreshold={0.82} luminanceSmoothing={0.2} intensity={eleven ? 0.95 : 0.7} radius={0.75} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <SMAA />
      {eleven ? <Vignette offset={0.32} darkness={0.42} /> : <></>}
      {eleven ? <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.18} /> : <></>}
    </EffectComposer>
  );
}
