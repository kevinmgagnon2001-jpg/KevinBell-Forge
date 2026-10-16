/**
 * Living growth drawn over things (src/engine/growth.ts): a thin shell around the thing, wrapped
 * with the reaction-diffusion pattern on all sides (triplanar, so nothing stretches), creeping out
 * from a spot near its base with a ragged, living edge. It is a standard lit material underneath
 * (shadows, reflections), with the pattern deciding colour, where it shows, and for frost and
 * crystal a glow.
 */
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Color, DataTexture, LinearFilter, MeshStandardMaterial, RepeatWrapping, RGBAFormat, Vector3, type Mesh } from "three";
import { useShallow } from "zustand/react/shallow";
import { grayScott, GROWTHS, GROWTH_KINDS, type GrowthKind } from "@/engine/growth";
import { useForge } from "@/engine/store";

const SIZE = 96;
const patterns: Partial<Record<GrowthKind, DataTexture>> = {};

/** The kind's pattern, grown once (about a tenth of a second) and kept. */
function patternOf(kind: GrowthKind): DataTexture {
  const have = patterns[kind];
  if (have) return have;
  const g = GROWTHS[kind];
  const b = grayScott(SIZE, 2200, g.feed, g.kill, 7 + GROWTH_KINDS.indexOf(kind));
  let max = 0;
  for (const v of b) max = Math.max(max, v);
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < b.length; i += 1) {
    const v = Math.round(Math.min(1, b[i] / (max || 1)) * 255);
    data.set([v, v, v, 255], i * 4);
  }
  const tex = new DataTexture(data, SIZE, SIZE, RGBAFormat);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  patterns[kind] = tex;
  return tex;
}

type Uniforms = {
  uPattern: { value: DataTexture };
  uSeed: { value: Vector3 };
  uRadius: { value: number };
  uColA: { value: Color };
  uColB: { value: Color };
  uGlow: { value: number };
  uScale: { value: number };
};

function growthMaterial(kind: GrowthKind): { material: MeshStandardMaterial; uniforms: Uniforms } {
  const g = GROWTHS[kind];
  const uniforms: Uniforms = {
    uPattern: { value: patternOf(kind) },
    uSeed: { value: new Vector3() },
    uRadius: { value: 0 },
    uColA: { value: new Color(g.color[0]) },
    uColB: { value: new Color(g.color[1]) },
    uGlow: { value: g.glow },
    uScale: { value: kind === "frost" ? 3.2 : kind === "crystal" ? 1.8 : 2.4 },
  };
  const material = new MeshStandardMaterial({ transparent: true, depthWrite: false, roughness: 1 - g.shine * 0.8, metalness: kind === "crystal" ? 0.3 : 0, polygonOffset: true, polygonOffsetFactor: -2 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGrowPos;\nvarying vec3 vGrowNormal;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvGrowPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGrowNormal = normalize(mat3(modelMatrix) * objectNormal);");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D uPattern;
        uniform vec3 uSeed;
        uniform float uRadius;
        uniform vec3 uColA;
        uniform vec3 uColB;
        uniform float uGlow;
        uniform float uScale;
        varying vec3 vGrowPos;
        varying vec3 vGrowNormal;
        float growPattern() {
          vec3 w = pow(abs(normalize(vGrowNormal)), vec3(4.0));
          w /= (w.x + w.y + w.z);
          // Two scales of the pattern, turned against each other, so it never looks tiled.
          vec3 p = vGrowPos * uScale;
          vec3 q = vGrowPos * uScale * 2.37 + vec3(0.31, 0.17, 0.53);
          float a = texture2D(uPattern, p.yz).r * w.x + texture2D(uPattern, p.xz).r * w.y + texture2D(uPattern, p.xy).r * w.z;
          float b = texture2D(uPattern, q.zy).r * w.x + texture2D(uPattern, q.zx).r * w.y + texture2D(uPattern, q.yx).r * w.z;
          return clamp(a * 0.7 + b * 0.45, 0.0, 1.0);
        }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float pat = growPattern();
        float edge = texture2D(uPattern, vGrowPos.xz * 0.37 + vGrowPos.y * 0.21).r;
        float reach = uRadius - distance(vGrowPos, uSeed) + (edge - 0.5) * 0.45;
        float mask = smoothstep(0.0, 0.25, reach);
        float body = smoothstep(0.18, 0.55, pat);
        diffuseColor.rgb = mix(uColA, uColB, smoothstep(0.35, 0.95, pat));
        diffuseColor.a = body * mask;
        if (diffuseColor.a < 0.02) discard;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uColB * uGlow * smoothstep(0.6, 1.0, pat) * mask;`,
      );
  };
  return { material, uniforms };
}

export function Growths() {
  const keys = useForge(
    useShallow((s) =>
      Object.values(s.entities)
        .filter((e) => GROWTH_KINDS.includes(e.customData.growth as GrowthKind))
        .map((e) => `${e.id}|${e.customData.growth}|${e.customData.growthSeq ?? ""}`),
    ),
  );
  // Growths already in the world when it loads are fully grown; new ones creep out.
  const born = useRef<Map<string, number> | null>(null);
  if (!born.current) born.current = new Map(keys.map((k) => [k, -1e6]));
  return (
    <>
      {keys.map((key) => {
        const [id, kind] = key.split("|");
        if (!born.current!.has(key)) born.current!.set(key, performance.now() / 1000);
        return <GrowthShell key={key} id={Number(id)} kind={kind as GrowthKind} start={born.current!.get(key)!} />;
      })}
    </>
  );
}

function GrowthShell({ id, kind, start }: { id: number; kind: GrowthKind; start: number }) {
  const mesh = useRef<Mesh>(null);
  const { material, uniforms } = useMemo(() => growthMaterial(kind), [kind]);
  const entity = useForge((s) => s.entities[id]);
  const asset = entity?.representation.kind === "mesh" ? entity.representation.assetId : "cube";
  useFrame(() => {
    const e = useForge.getState().entities[id];
    const m = mesh.current;
    if (!e || !m) return;
    const p = e.transform.position;
    const s = e.transform.scale;
    const q = e.transform.rotation;
    m.position.set(p.x, p.y, p.z);
    m.quaternion.set(q.x, q.y, q.z, q.w);
    const pad = 0.012;
    m.scale.set(Math.abs(s.x) + pad * 2, Math.abs(s.y) + pad * 2, Math.abs(s.z) + pad * 2);
    // It starts low on one side and spreads at the kind's pace until it covers the whole thing.
    uniforms.uSeed.value.set(p.x - Math.abs(s.x) * 0.3, p.y - Math.abs(s.y) / 2, p.z + Math.abs(s.z) * 0.35);
    const full = Math.hypot(s.x, s.y, s.z) + 0.6;
    uniforms.uRadius.value = Math.min(full, (performance.now() / 1000 - start) * GROWTHS[kind].speed + 0.05);
  });
  if (!entity) return null;
  return (
    <mesh ref={mesh} material={material} raycast={() => null} receiveShadow>
      {asset === "sphere" ? <sphereGeometry args={[0.5, 40, 28]} /> : <boxGeometry args={[1, 1, 1]} />}
    </mesh>
  );
}
