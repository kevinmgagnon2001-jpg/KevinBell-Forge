/**
 * Glints: the sparkle of snow, sand, frost, glitter and metal-flake paint. After "Glinty NDFs in
 * constant time" (Kemppinen et al., SIGGRAPH Asia 2025) in spirit: the surface is cut into tiny cells,
 * each holding one mirror-like flake with its own random tilt; a pixel lights up when its flake lines
 * up the sun with your eye. One hash and one dot product per pixel, the same cost wherever you look,
 * so no flake count to budget. Cells smaller than a pixel fade out instead of shimmering.
 *
 * Added to a MeshStandardMaterial as a shader include (onBeforeCompile). Only hero materials get it,
 * and never on the lowest quality rung (`setGlintsAllowed`).
 */
import type { MeshStandardMaterial, WebGLProgramParametersWithUniforms } from "three";

let allowed = true;
/** Off on the lowest quality rungs; materials made after this follow it. */
export function setGlintsAllowed(on: boolean) {
  allowed = on;
}
export const glintsAllowed = () => allowed;

export type GlintUniforms = { uGlint: { value: number }; uGlintDensity: { value: number } };

/**
 * Give a material flakes. strength 0..~2 (a uniform you can change live), density: flakes per metre.
 * Returns the uniforms, or null when glints are off.
 */
export function addGlint(material: MeshStandardMaterial, strength = 1, density = 90): GlintUniforms | null {
  if (!allowed) return null;
  // Once per material (React may build twice in development).
  const had = material.userData.glintUniforms as GlintUniforms | undefined;
  if (had) {
    had.uGlint.value = strength;
    return had;
  }
  const uniforms: GlintUniforms = { uGlint: { value: strength }, uGlintDensity: { value: density } };
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    before?.call(material, shader, renderer);
    shader.uniforms.uGlint = uniforms.uGlint;
    shader.uniforms.uGlintDensity = uniforms.uGlintDensity;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGlintPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlintPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vGlintPos;
uniform float uGlint;
uniform float uGlintDensity;
vec3 glintHash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yxz + 19.19);
  return fract((p.xxy + p.yxx) * p.zyx);
}`,
      )
      .replace(
        "#include <opaque_fragment>",
        `#if NUM_DIR_LIGHTS > 0
{
  vec3 cellPos = vGlintPos * uGlintDensity;
  vec3 cell = floor(cellPos);
  vec3 r = glintHash(cell);
  // One flake per cell, tilted at random about the surface normal; most cells hold none.
  vec3 tilt = (glintHash(cell + 7.31) - 0.5) * 0.9;
  vec3 flake = normalize(normal + tilt);
  vec3 L = directionalLights[0].direction;
  vec3 V = normalize(vViewPosition);
  vec3 H = normalize(L + V);
  float aligned = pow(max(dot(flake, H), 0.0), 900.0);
  // Cells under a pixel would shimmer: fade them by how many fit in one.
  float perPixel = length(fwidth(cellPos));
  float fade = 1.0 - smoothstep(0.35, 1.2, perPixel);
  float lit = max(dot(normal, L), 0.0);
  float sparkle = aligned * step(0.55, r.x) * fade * lit * uGlint * 40.0;
  outgoingLight += directionalLights[0].color * sparkle * mix(vec3(1.0), vec3(0.85, 0.92, 1.0), r.y);
}
#endif
#include <opaque_fragment>`,
      );
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ""}|glint`;
  material.userData.glintUniforms = uniforms;
  material.needsUpdate = true;
  return uniforms;
}
