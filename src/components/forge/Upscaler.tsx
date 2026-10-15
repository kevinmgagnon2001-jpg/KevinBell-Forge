/**
 * FSR 1-style upscaling for the 3D view. The world is drawn at a fraction of the screen's pixels
 * (the quality rung's `scale`, src/engine/perf.ts), then brought back up to full size:
 *
 *   1. the scene, into a small linear HDR target (with MSAA when the rung has antialiasing);
 *   2. tone mapping and sRGB (three's OutputPass), into a small 8-bit target;
 *   3. EASU, an edge-adaptive 12-tap upscale (AMD FidelityFX Super Resolution 1, MIT licence), to full size;
 *   4. RCAS, contrast-adaptive sharpening (same source), to the screen.
 *
 * The passes only look at the finished picture, which is the point: later the same passes sit
 * behind any program Forge runs (docs/RECOMPILER.md, "Forge owns the picture").
 *
 * Mounted only when the rung's scale is below 1; otherwise React Three Fiber renders as usual.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { GLSL3, HalfFloatType, LinearFilter, NearestFilter, NoColorSpace, ShaderMaterial, UnsignedByteType, Vector2, WebGLRenderTarget, type Camera, type Scene, type WebGLRenderer } from "three";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { renderSize } from "@/engine/perf";
import { pointScale } from "./render-scale";

const VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** EASU: AMD FidelityFX FSR 1 (MIT), written out with texelFetch so the taps are exact. */
const EASU = /* glsl */ `
precision highp float;
uniform sampler2D source;
uniform vec2 inSize;
uniform vec2 outSize;
out highp vec4 outColor;

vec3 tap(ivec2 p) {
  ivec2 hi = ivec2(inSize) - 1;
  return texelFetch(source, clamp(p, ivec2(0), hi), 0).rgb;
}
float luma(vec3 c) { return c.g + 0.5 * (c.r + c.b); }

void easuSet(inout vec2 dir, inout float len, float w, float lA, float lB, float lC, float lD, float lE) {
  float lenX = max(abs(lD - lC), abs(lC - lB));
  float dirX = lD - lB;
  dir.x += dirX * w;
  lenX = clamp(abs(dirX) / max(lenX, 1e-5), 0.0, 1.0);
  len += lenX * lenX * w;
  float lenY = max(abs(lE - lC), abs(lC - lA));
  float dirY = lE - lA;
  dir.y += dirY * w;
  lenY = clamp(abs(dirY) / max(lenY, 1e-5), 0.0, 1.0);
  len += lenY * lenY * w;
}

void easuTap(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len, float lob, float clp, vec3 c) {
  vec2 v = vec2(dot(off, dir), dot(off, vec2(-dir.y, dir.x))) * len;
  float d2 = min(dot(v, v), clp);
  float wB = 0.4 * d2 - 1.0;
  float wA = lob * d2 - 1.0;
  wB *= wB;
  wA *= wA;
  wB = 1.5625 * wB - 0.5625;
  float w = wB * wA;
  aC += c * w;
  aW += w;
}

void main() {
  vec2 pp = gl_FragCoord.xy * (inSize / outSize) - 0.5;
  vec2 fp = floor(pp);
  pp -= fp;
  ivec2 f0 = ivec2(fp);
  //    b c
  //  e f g h
  //  i j k l
  //    n o
  vec3 bC = tap(f0 + ivec2(0, -1)); vec3 cC = tap(f0 + ivec2(1, -1));
  vec3 eC = tap(f0 + ivec2(-1, 0)); vec3 fC = tap(f0);              vec3 gC = tap(f0 + ivec2(1, 0)); vec3 hC = tap(f0 + ivec2(2, 0));
  vec3 iC = tap(f0 + ivec2(-1, 1)); vec3 jC = tap(f0 + ivec2(0, 1)); vec3 kC = tap(f0 + ivec2(1, 1)); vec3 lC = tap(f0 + ivec2(2, 1));
  vec3 nC = tap(f0 + ivec2(0, 2));  vec3 oC = tap(f0 + ivec2(1, 2));
  float bL = luma(bC), cL = luma(cC), eL = luma(eC), fL = luma(fC), gL = luma(gC), hL = luma(hC);
  float iL = luma(iC), jL = luma(jC), kL = luma(kC), lL = luma(lC), nL = luma(nC), oL = luma(oC);

  vec2 dir = vec2(0.0);
  float len = 0.0;
  easuSet(dir, len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
  easuSet(dir, len, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
  easuSet(dir, len, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
  easuSet(dir, len, pp.x * pp.y, gL, jL, kL, lL, oL);

  vec2 dir2 = dir * dir;
  float dirR = dir2.x + dir2.y;
  bool zro = dirR < (1.0 / 32768.0);
  dirR = zro ? 1.0 : inversesqrt(dirR);
  dir.x = zro ? 1.0 : dir.x;
  dir *= dirR;
  len = len * 0.5;
  len *= len;
  float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
  vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
  float lob = 0.5 - 0.29 * len;
  float clp = 1.0 / lob;

  vec3 min4 = min(min(fC, gC), min(jC, kC));
  vec3 max4 = max(max(fC, gC), max(jC, kC));
  vec3 aC = vec3(0.0);
  float aW = 0.0;
  easuTap(aC, aW, vec2(0.0, -1.0) - pp, dir, len2, lob, clp, bC);
  easuTap(aC, aW, vec2(1.0, -1.0) - pp, dir, len2, lob, clp, cC);
  easuTap(aC, aW, vec2(-1.0, 1.0) - pp, dir, len2, lob, clp, iC);
  easuTap(aC, aW, vec2(0.0, 1.0) - pp, dir, len2, lob, clp, jC);
  easuTap(aC, aW, vec2(0.0, 0.0) - pp, dir, len2, lob, clp, fC);
  easuTap(aC, aW, vec2(-1.0, 0.0) - pp, dir, len2, lob, clp, eC);
  easuTap(aC, aW, vec2(1.0, 1.0) - pp, dir, len2, lob, clp, kC);
  easuTap(aC, aW, vec2(2.0, 1.0) - pp, dir, len2, lob, clp, lC);
  easuTap(aC, aW, vec2(2.0, 0.0) - pp, dir, len2, lob, clp, hC);
  easuTap(aC, aW, vec2(1.0, 0.0) - pp, dir, len2, lob, clp, gC);
  easuTap(aC, aW, vec2(1.0, 2.0) - pp, dir, len2, lob, clp, oC);
  easuTap(aC, aW, vec2(0.0, 2.0) - pp, dir, len2, lob, clp, nC);
  outColor = vec4(min(max4, max(min4, aC / aW)), 1.0);
}`;

/** RCAS: AMD FidelityFX FSR 1 (MIT). `sharpness` is in stops: 0 is the strongest, 2 is mild. */
const RCAS = /* glsl */ `
precision highp float;
uniform sampler2D source;
uniform vec2 size;
uniform float sharpness;
out highp vec4 outColor;

vec3 tap(ivec2 p) {
  return texelFetch(source, clamp(p, ivec2(0), ivec2(size) - 1), 0).rgb;
}
float luma(vec3 c) { return c.g + 0.5 * (c.r + c.b); }

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 b = tap(p + ivec2(0, -1));
  vec3 d = tap(p + ivec2(-1, 0));
  vec3 e = tap(p);
  vec3 f = tap(p + ivec2(1, 0));
  vec3 h = tap(p + ivec2(0, 1));
  vec3 mn4 = min(min(b, d), min(f, h));
  vec3 mx4 = max(max(b, d), max(f, h));
  vec3 hitMin = min(mn4, e) / (4.0 * mx4 + 1e-5);
  vec3 hitMax = (1.0 - max(mx4, e)) / (4.0 * mn4 - 4.0 - 1e-5);
  vec3 lobeRGB = max(-hitMin, hitMax);
  float limit = 0.25 - 1.0 / 16.0;
  float lobe = max(-limit, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * exp2(-sharpness);
  // Less sharpening where the picture is noisy.
  float bL = luma(b), dL = luma(d), eL = luma(e), fL = luma(f), hL = luma(h);
  float nz = 0.25 * (bL + dL + fL + hL) - eL;
  float range = max(max(max(bL, dL), max(eL, fL)), hL) - min(min(min(bL, dL), min(eL, fL)), hL);
  nz = clamp(abs(nz) / max(range, 1e-5), 0.0, 1.0);
  lobe *= 1.0 - 0.5 * nz;
  vec3 c = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function target(width: number, height: number, hdr: boolean, samples: number, depth: boolean) {
  const rt = new WebGLRenderTarget(width, height, {
    type: hdr ? HalfFloatType : UnsignedByteType,
    minFilter: hdr ? LinearFilter : NearestFilter,
    magFilter: hdr ? LinearFilter : NearestFilter,
    depthBuffer: depth,
    samples,
  });
  // The 8-bit targets hold values that are already sRGB: no decoding on the way in or out.
  rt.texture.colorSpace = NoColorSpace;
  return rt;
}

/** The passes and their targets, resized as the canvas or the scale changes. */
class Pipeline {
  private scene: WebGLRenderTarget;
  private small: WebGLRenderTarget;
  private full: WebGLRenderTarget;
  private output = new OutputPass();
  private easu: ShaderMaterial;
  private rcas: ShaderMaterial;
  private easuQuad: FullScreenQuad;
  private rcasQuad: FullScreenQuad;
  private out = new Vector2();

  constructor(gl: WebGLRenderer, antialias: boolean) {
    const hdr = gl.extensions.has("EXT_color_buffer_float") || gl.extensions.has("EXT_color_buffer_half_float");
    const samples = antialias ? Math.min(4, gl.capabilities.maxSamples) : 0;
    this.scene = target(1, 1, hdr, samples, true);
    this.small = target(1, 1, false, 0, false);
    this.full = target(1, 1, false, 0, false);
    this.easu = new ShaderMaterial({ glslVersion: GLSL3, vertexShader: VERTEX, fragmentShader: EASU, uniforms: { source: { value: null }, inSize: { value: new Vector2() }, outSize: { value: new Vector2() } }, depthTest: false, depthWrite: false, toneMapped: false });
    this.rcas = new ShaderMaterial({ glslVersion: GLSL3, vertexShader: VERTEX, fragmentShader: RCAS, uniforms: { source: { value: null }, size: { value: new Vector2() }, sharpness: { value: 0.25 } }, depthTest: false, depthWrite: false, toneMapped: false });
    this.easuQuad = new FullScreenQuad(this.easu);
    this.rcasQuad = new FullScreenQuad(this.rcas);
  }

  render(gl: WebGLRenderer, scene: Scene, camera: Camera, scale: number, sharpness: number) {
    gl.getDrawingBufferSize(this.out);
    const outW = this.out.x;
    const outH = this.out.y;
    const inner = renderSize(outW, outH, scale);
    if (this.scene.width !== inner.width || this.scene.height !== inner.height) {
      this.scene.setSize(inner.width, inner.height);
      this.small.setSize(inner.width, inner.height);
    }
    if (this.full.width !== outW || this.full.height !== outH) this.full.setSize(outW, outH);

    // 1. The world, small.
    gl.setRenderTarget(this.scene);
    gl.render(scene, camera);
    // 2. Tone mapping and sRGB, small.
    this.output.render(gl, this.small, this.scene, 0, false);
    // 3. Edge-adaptive upscale to full size.
    this.easu.uniforms.source.value = this.small.texture;
    this.easu.uniforms.inSize.value.set(inner.width, inner.height);
    this.easu.uniforms.outSize.value.set(outW, outH);
    gl.setRenderTarget(this.full);
    this.easuQuad.render(gl);
    // 4. Sharpen, to the screen.
    this.rcas.uniforms.source.value = this.full.texture;
    this.rcas.uniforms.size.value.set(outW, outH);
    this.rcas.uniforms.sharpness.value = sharpness;
    gl.setRenderTarget(null);
    this.rcasQuad.render(gl);
  }

  dispose() {
    this.scene.dispose();
    this.small.dispose();
    this.full.dispose();
    this.output.dispose();
    this.easu.dispose();
    this.rcas.dispose();
    this.easuQuad.dispose();
    this.rcasQuad.dispose();
  }
}

/** Takes over drawing the frame (a priority-1 useFrame stops R3F's own render) while mounted. */
export function Upscaler({ scale, antialias, sharpness = 0.25 }: { scale: number; antialias: boolean; sharpness?: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const pipe = useMemo(() => new Pipeline(gl, antialias), [gl, antialias]);
  useEffect(() => () => pipe.dispose(), [pipe]);
  // Several passes per frame: count them all as one frame for the Stats overlay.
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
      pointScale.value = 1;
    };
  }, [gl]);
  useFrame(() => {
    gl.info.reset();
    pointScale.value = renderSize(1000, 1000, scale).width / 1000;
    pipe.render(gl, scene, camera, scale, sharpness);
  }, 1);
  return null;
}
