/**
 * Photographic surface detail for the scenery (CC0 scans from Poly Haven in public/textures/pbr):
 * the plaza gets a full PBR set (colour, normal, AO / roughness); the land, rocks and trees, which
 * have no UVs, get the scans projected from world space (triplanar), as detail over their own
 * vertex colours, with bump from the scan's shading and a little roughness variation. The detail
 * fades out with distance, where it would only shimmer.
 */
import { LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3, type MeshStandardMaterial, type Texture, type WebGLProgramParametersWithUniforms } from "three";

const BASE = `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/"}textures/pbr/`;

export type Scan = "square_cobblestone" | "leafy_grass" | "rocky_terrain_02" | "mossy_rock" | "pine_bark" | "concrete_floor_worn_001" | "fabric_leather_02";

let allowed = false;
/** Scan detail on things in the world, on the best scenery rung only (Viewport sets it). */
export const setDetailAllowed = (on: boolean) => {
  allowed = on;
};
export const detailAllowed = () => allowed;

/** The mean colour of each scan's colour map, so detail divides out to about 1. */
const MEAN: Record<Scan, [number, number, number]> = {
  square_cobblestone: [0.421, 0.377, 0.288],
  leafy_grass: [0.592, 0.516, 0.349],
  rocky_terrain_02: [0.313, 0.308, 0.108],
  mossy_rock: [0.425, 0.419, 0.34],
  pine_bark: [0.402, 0.326, 0.251],
  concrete_floor_worn_001: [0.337, 0.339, 0.33],
  fabric_leather_02: [0.506, 0.305, 0.103],
};

/**
 * Wear on a made thing: worn concrete's shading and relief (not its colour), so a red cube reads as
 * a painted, handled object instead of flat plastic. Applied once per material.
 */
export function wearOn(material: MeshStandardMaterial | null, floor: boolean | "suit" = false) {
  if (!material || !allowed || material.userData.wear) return;
  material.userData.wear = true;
  // Floors: polished concrete, its patches and seams plain to see; things: a fine handled wear.
  if (floor === "suit") addDetail(material, { a: "fabric_leather_02", scaleA: 0.22, bump: 1.2, tint: 0, amount: 0.5, far: 14, key: "suit" });
  else if (floor) addDetail(material, { a: "concrete_floor_worn_001", scaleA: 2.6, bump: 0.9, tint: 0.7, amount: 1, far: 45, key: "wear-floor" });
  else addDetail(material, { a: "concrete_floor_worn_001", scaleA: 1.4, bump: 1, tint: 0, amount: 0.6, far: 30, key: "wear" });
}

const loader = new TextureLoader();
const cache = new Map<string, Texture>();

/** One map of a scan, shared; colour maps in sRGB, the rest linear. */
export function scanMap(scan: Scan, map: "diff" | "nor_gl" | "arm", anisotropy = 8): Texture {
  const key = `${scan}_${map}`;
  let tex = cache.get(key);
  if (!tex) {
    tex = loader.load(`${BASE}${key}.webp`);
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.anisotropy = anisotropy;
    if (map === "diff") tex.colorSpace = SRGBColorSpace;
    cache.set(key, tex);
  }
  return tex;
}

/** A full PBR set on a material with UVs, repeated `repeat` times. Clones share the image. */
export function applyScan(material: MeshStandardMaterial, scan: Scan, repeat: number, normal = 1) {
  const set = (t: Texture) => {
    const c = t.clone();
    c.repeat.set(repeat, repeat);
    return c;
  };
  material.map = set(scanMap(scan, "diff"));
  material.normalMap = set(scanMap(scan, "nor_gl"));
  material.normalScale.set(normal, normal);
  const arm = set(scanMap(scan, "arm"));
  material.roughnessMap = arm;
  material.aoMap = arm;
  material.aoMapIntensity = 0.85;
  material.roughness = 1;
  material.needsUpdate = true;
}

export type DetailOptions = {
  /** The main scan, and metres per tile. */
  a: Scan;
  scaleA: number;
  /** A second scan, blended in by `mask`. */
  b?: Scan;
  scaleB?: number;
  /**
   * GLSL float expression for how much of `b` (0..1). In scope: `dn` (world normal), `dw` (world
   * position), `vColor` when the material uses vertex colours.
   */
  mask?: string;
  /** Relief strength from the scan's normal map. */
  bump?: number;
  /** How much of the scan's shading shows in the colour (0..1). */
  amount?: number;
  /** How strongly the detail recolours (0 keeps the vertex colour, 1 is the scan's own). */
  tint?: number;
  /** Detail fades out by this distance (metres). */
  far?: number;
  key: string;
};

const vec3 = (c: [number, number, number]) => new Vector3(...c);

/** Triplanar scan detail on a material without UVs (instanced or not). Chains other patches. */
export function addDetail(material: MeshStandardMaterial, o: DetailOptions) {
  const uniforms = {
    uDetA: { value: scanMap(o.a, "diff") },
    uDetB: { value: scanMap(o.b ?? o.a, "diff") },
    uNorA: { value: scanMap(o.a, "nor_gl") },
    uNorB: { value: scanMap(o.b ?? o.a, "nor_gl") },
    uAmount: { value: o.amount ?? 0.6 },
    uMeanA: { value: vec3(MEAN[o.a]) },
    uMeanB: { value: vec3(MEAN[o.b ?? o.a]) },
    uScaleA: { value: 1 / o.scaleA },
    uScaleB: { value: 1 / (o.scaleB ?? o.scaleA) },
    uBump: { value: o.bump ?? 1 },
    uTint: { value: o.tint ?? 0.55 },
    uFar: { value: o.far ?? 60 },
  };
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    before?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vDetW;\nvarying vec3 vDetN;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        {
          mat4 detM = modelMatrix;
          #ifdef USE_INSTANCING
            detM = modelMatrix * instanceMatrix;
          #endif
          vDetW = (detM * vec4(transformed, 1.0)).xyz;
          vDetN = normalize(mat3(detM) * objectNormal);
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vDetW;
varying vec3 vDetN;
uniform sampler2D uDetA;
uniform sampler2D uDetB;
uniform sampler2D uNorA;
uniform sampler2D uNorB;
uniform float uAmount;
uniform vec3 uMeanA;
uniform vec3 uMeanB;
uniform float uScaleA;
uniform float uScaleB;
uniform float uBump;
uniform float uTint;
uniform float uFar;
vec3 detTri(sampler2D t, vec3 p, vec3 n, float s) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  return texture2D(t, p.zy * s).rgb * w.x + texture2D(t, p.xz * s).rgb * w.y + texture2D(t, p.xy * s).rgb * w.z;
}
// Triplanar normal map, whiteout blend (after Ben Golus): a world-space normal.
vec3 detTriN(sampler2D t, vec3 p, vec3 n, float s, float k) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  vec3 tx = (texture2D(t, p.zy * s).xyz * 2.0 - 1.0) * vec3(k, k, 1.0);
  vec3 ty = (texture2D(t, p.xz * s).xyz * 2.0 - 1.0) * vec3(k, k, 1.0);
  vec3 tz = (texture2D(t, p.xy * s).xyz * 2.0 - 1.0) * vec3(k, k, 1.0);
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float detFade = 1.0 - smoothstep(uFar * 0.45, uFar, length(vViewPosition));
vec3 dw = vDetW;
vec3 dn = normalize(vDetN);
float detMix = ${o.b ? `clamp(${o.mask ?? "0.0"}, 0.0, 1.0)` : "0.0"};
vec3 detA = detTri(uDetA, dw, dn, uScaleA) / uMeanA;
${o.b ? "vec3 detB = detTri(uDetB, dw, dn, uScaleB) / uMeanB;" : "vec3 detB = detA;"}
vec3 det = mix(vec3(1.0), mix(detA, detB, detMix), uAmount);
float detL = dot(det, vec3(0.299, 0.587, 0.114));
// Shading from the scan everywhere; its colour cast only as far as uTint.
vec3 detCol = mix(vec3(detL), det, uTint);
diffuseColor.rgb *= mix(vec3(1.0), clamp(detCol, 0.15, 2.4), detFade);
float detH = detL;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{
  // The scan's own relief, projected from world space, turned into view space.
  vec3 nA = detTriN(uNorA, dw, dn, uScaleA, uBump);
  vec3 nB = detTriN(uNorB, dw, dn, uScaleB, uBump);
  vec3 nW = normalize(mix(nA, nB, detMix));
  vec3 nV = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  // Keep the shading normal's side; blend the relief in with distance.
  normal = normalize(mix(normal, nV, detFade));
}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor * mix(1.0, 1.18 - detH * 0.3, detFade), 0.04, 1.0);`,
      );
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ""}|detail-${o.key}`;
  material.needsUpdate = true;
}
