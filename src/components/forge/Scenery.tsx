/**
 * The world around the lab: sky and sun, a stone plaza, a meadow that moves in the wind, hills,
 * forests, a lake, mountains in the haze, clouds and drifting motes. Drawn only; nothing here is an
 * entity, saved, shared or collided with (the land itself is src/engine/terrain.ts).
 *
 * The sky, light, fog, rain and snow follow the world's weather (weather.ts), easing from one to the
 * next.
 *
 * How much is drawn follows the device (hardware.ts: full / lite / min), or ?scenery=full|lite|min|off.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  AmbientLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { SceneryLevel } from "@/engine/hardware";
import { useForge } from "@/engine/store";
import { lightning } from "./body-state";
import { addGlint } from "./glint";
import { blendSky, skyFor, weatherOf, type RGB, type Sky, type Weather } from "@/engine/weather";
import { fbm, heightAt, LAKE, LAND_HALF, noise2, PLAZA_RADIUS, scatter, seeded, slopeAt, WATER_Y } from "@/engine/terrain";

/** Late afternoon: the sun low over the lake, warm haze on the horizon. */
const SKY = {
  top: "#2763c2",
  horizon: "#f3cfa6",
  below: "#8f8a84",
  sun: "#ffd9a8",
  fog: "#d9c4ad",
  light: "#ffe4c4",
  hemiSky: "#c4d8f5",
  hemiGround: "#5d5040",
};
const SUN = new Vector3(-0.5, 0.36, -0.79).normalize();
const FOG_NEAR = 45;
const FOG_FAR = 340;

const COUNTS: Record<SceneryLevel, { land: number; pines: number; leafy: number; rocks: number; grass: number; flowers: number; clouds: number; motes: number; shadowMap: number; drops: number }> = {
  full: { land: 220, pines: 520, leafy: 260, rocks: 150, grass: 16000, flowers: 1100, clouds: 16, motes: 220, shadowMap: 2048, drops: 9000 },
  lite: { land: 150, pines: 300, leafy: 150, rocks: 90, grass: 6500, flowers: 450, clouds: 10, motes: 110, shadowMap: 1024, drops: 4500 },
  min: { land: 64, pines: 80, leafy: 36, rocks: 20, grass: 0, flowers: 0, clouds: 4, motes: 0, shadowMap: 512, drops: 1600 },
};

const ignoreRays = () => {};

/** Mark as scenery: no shadow flags from ShadowFlags, and invisible to the gaze and pointer rays. */
const scenery = <T extends Object3D>(o: T): T => {
  o.traverse((c) => {
    c.userData.scenery = true;
    c.raycast = ignoreRays;
  });
  return o;
};

function canvasTexture(size: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void, srgb = true): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) paint(ctx, size);
  const texture = new CanvasTexture(canvas);
  if (srgb) texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function disposeTree(root: Object3D) {
  root.traverse((o) => {
    const mesh = o as Mesh;
    mesh.geometry?.dispose();
    const mats = (Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) as Material[];
    for (const m of mats) {
      for (const value of Object.values(m)) if (value && typeof value === "object" && "isTexture" in value) (value as Texture).dispose();
      m.dispose();
    }
  });
}

/** Keep built objects for the life of the component and free them after. */
function useBuilt<T extends Object3D>(build: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const built = useMemo(build, deps);
  useEffect(() => () => disposeTree(built), [built]);
  return built;
}

// ---------- sky ----------

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBelow;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uStars;
uniform float uFlash;
varying vec3 vDir;
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float s = max(dot(d, uSunDir), 0.0);
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.5, h), 0.5));
  col = mix(col, uBelow, smoothstep(0.0, -0.25, h));
  // Warm haze along the horizon, strongest towards the sun.
  col = mix(col, uSun, exp(-abs(h) * 10.0) * (0.25 + 0.45 * pow(s, 3.0)));
  col += uSun * (pow(s, 1400.0) * 9.0 + pow(s, 60.0) * 0.55 + pow(s, 6.0) * 0.18);
  if (uStars > 0.002 && h > -0.02) {
    // Stars: one in a few hundred cells of the sky, each its own brightness; and the moon.
    vec3 cell = floor(d * 260.0);
    float r = hash3(cell);
    float star = step(0.9972, r) * smoothstep(-0.02, 0.2, h) * (0.35 + 0.65 * hash3(cell + 3.1));
    col += vec3(0.9, 0.93, 1.0) * star * uStars * 1.6;
    float m = max(dot(d, uMoonDir), 0.0);
    col += vec3(0.88, 0.92, 1.0) * (smoothstep(0.99955, 0.9997, m) * 1.6 + pow(m, 90.0) * 0.12) * uStars;
  }
  col += vec3(0.72, 0.78, 1.0) * uFlash;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

type SkyUniforms = {
  uTop: { value: Color };
  uHorizon: { value: Color };
  uBelow: { value: Color };
  uSun: { value: Color };
  uSunDir: { value: Vector3 };
  uMoonDir: { value: Vector3 };
  uStars: { value: number };
  uFlash: { value: number };
};

function skyUniforms(): SkyUniforms {
  return {
    uTop: { value: new Color(SKY.top) },
    uHorizon: { value: new Color(SKY.horizon) },
    uBelow: { value: new Color(SKY.below) },
    uSun: { value: new Color(SKY.sun) },
    uSunDir: { value: SUN.clone() },
    uMoonDir: { value: new Vector3(0.3, 0.7, 0.6).normalize() },
    uStars: { value: 0 },
    uFlash: { value: 0 },
  };
}

const setRgb = (c: Color, rgb: RGB) => c.setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);

/** Put a sky's colours and directions into the dome's uniforms. */
function paintSky(u: SkyUniforms, sky: Sky, flash = 0) {
  setRgb(u.uTop.value, sky.top);
  setRgb(u.uHorizon.value, sky.horizon);
  setRgb(u.uBelow.value, sky.below);
  setRgb(u.uSun.value, sky.sun);
  u.uSunDir.value.set(...sky.sunDir);
  u.uMoonDir.value.set(-sky.sunDir[0] * 0.6 + 0.2, Math.max(0.25, -sky.sunDir[1]) + 0.35, -sky.sunDir[2] * 0.6 + 0.3).normalize();
  u.uStars.value = sky.stars;
  u.uFlash.value = flash;
}

function makeSky(uniforms: SkyUniforms = skyUniforms()): Mesh {
  const material = new ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms,
  });
  const mesh = new Mesh(new SphereGeometry(500, 48, 24), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return scenery(mesh);
}

function SkyDome({ follow = true, uniforms }: { follow?: boolean; uniforms: SkyUniforms }) {
  const sky = useBuilt(() => makeSky(uniforms), [uniforms]);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    if (follow) sky.position.copy(camera.position);
  });
  return <primitive object={sky} />;
}

// ---------- land, plaza, water ----------

const GRASS_A = new Color("#4b7a2c");
const GRASS_B = new Color("#79a03e");
const DRY = new Color("#a59b58");
const SAND = new Color("#cdb88f");
const ROCK = new Color("#857e75");
const SNOW = new Color("#f1f4f8");
const MEADOW = new Color("#3f6d27");

function landColor(x: number, y: number, z: number, out: Color): Color {
  const r = Math.hypot(x, z);
  const n = fbm(x * 0.05, z * 0.05, 3) * 0.5 + 0.5;
  out.copy(GRASS_A).lerp(GRASS_B, n);
  const dry = fbm(x * 0.012 + 40, z * 0.012, 3);
  if (dry > 0.15) out.lerp(DRY, Math.min(1, (dry - 0.15) * 2.2));
  if (r < PLAZA_RADIUS + 12) out.lerp(MEADOW, 0.35 * (1 - (r - PLAZA_RADIUS) / 12));
  const slope = r > 40 ? slopeAt(x, z) : 0;
  const rocky = Math.max((slope - 0.45) * 2.2, (y - 22 + noise2(x * 0.1, z * 0.1) * 6) / 10);
  if (rocky > 0) out.lerp(ROCK, Math.min(1, rocky));
  const snowy = (y - 44 + noise2(x * 0.07, z * 0.07) * 8) / 6;
  if (snowy > 0) out.lerp(SNOW, Math.min(1, snowy) * (slope > 1.1 ? 0.5 : 1));
  if (y < WATER_Y + 0.55) out.lerp(SAND, Math.min(1, (WATER_Y + 0.55 - y) * 1.6));
  return out;
}

function makeLand(segments: number): Mesh {
  const geometry = new PlaneGeometry(LAND_HALF * 2, LAND_HALF * 2, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position as BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    landColor(x, y, z, c);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  // Fine grain up close, so the ground is not a flat wash of colour.
  const detail = canvasTexture(256, (ctx, size) => {
    const img = ctx.createImageData(size, size);
    const rand = seeded(3);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const v = 200 + (noise2(x / 9, y / 9) * 0.5 + noise2(x / 3, y / 3) * 0.3 + (rand() - 0.5) * 0.4) * 55;
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v));
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  detail.repeat.set(150, 150);
  const material = new MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.96, metalness: 0 });
  const mesh = new Mesh(geometry, material);
  mesh.position.y = -0.02;
  mesh.receiveShadow = true;
  return scenery(mesh);
}

function makePlaza(): Group {
  const group = new Group();
  // Stone tiles, 1 m each, lined up with the building grid.
  const tiles = canvasTexture(512, (ctx, size) => {
    const rand = seeded(11);
    const cell = size / 4;
    ctx.fillStyle = "#4a4743";
    ctx.fillRect(0, 0, size, size);
    for (let ty = 0; ty < 4; ty += 1) {
      for (let tx = 0; tx < 4; tx += 1) {
        const tone = 138 + Math.floor((rand() - 0.5) * 34);
        const warm = Math.floor(rand() * 10);
        ctx.fillStyle = `rgb(${tone + warm}, ${tone + Math.floor(warm / 2)}, ${tone - 4})`;
        ctx.fillRect(tx * cell + 3, ty * cell + 3, cell - 6, cell - 6);
        for (let i = 0; i < 220; i += 1) {
          ctx.fillStyle = `rgba(${rand() > 0.5 ? "255,250,240" : "40,36,32"},${0.05 + rand() * 0.08})`;
          ctx.fillRect(tx * cell + 3 + rand() * (cell - 8), ty * cell + 3 + rand() * (cell - 8), 1 + rand() * 3, 1 + rand() * 3);
        }
      }
    }
  });
  tiles.repeat.set(7.5, 7.5);
  const floor = new Mesh(new CircleGeometry(PLAZA_RADIUS, 128), new MeshStandardMaterial({ map: tiles, roughness: 0.82, metalness: 0.02 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.012;
  floor.receiveShadow = true;
  group.add(floor);
  group.userData.floor = floor.material;
  const stone = new MeshStandardMaterial({ color: "#8c867c", roughness: 0.75, metalness: 0.02 });
  const curb = new Mesh(new TorusGeometry(PLAZA_RADIUS, 0.2, 10, 160), stone);
  curb.rotation.x = Math.PI / 2;
  curb.scale.z = 0.55;
  curb.position.y = 0.0;
  curb.receiveShadow = true;
  curb.castShadow = true;
  group.add(curb);
  // Lamp posts around the edge, lit warm.
  const pole = new MeshStandardMaterial({ color: "#2a2d33", roughness: 0.45, metalness: 0.7 });
  const lampGlass = new MeshStandardMaterial({ color: "#fff1d6", emissive: "#ffc879", emissiveIntensity: 2.4, roughness: 0.3 });
  const glow = new SpriteMaterial({ map: puffTexture(), color: "#ffcf8f", transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending, fog: false });
  const poleGeo = new CylinderGeometry(0.06, 0.09, 3.2, 10);
  const baseGeo = new CylinderGeometry(0.22, 0.28, 0.25, 12);
  const capGeo = new ConeGeometry(0.3, 0.22, 12);
  const lampGeo = new SphereGeometry(0.17, 16, 12);
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    const post = new Group();
    post.position.set(Math.cos(a) * (PLAZA_RADIUS + 0.7), 0, Math.sin(a) * (PLAZA_RADIUS + 0.7));
    const base = new Mesh(baseGeo, pole);
    base.position.y = 0.12;
    const shaft = new Mesh(poleGeo, pole);
    shaft.position.y = 1.6;
    shaft.castShadow = true;
    const lamp = new Mesh(lampGeo, lampGlass);
    lamp.position.y = 3.32;
    const cap = new Mesh(capGeo, pole);
    cap.position.y = 3.55;
    const halo = new Sprite(glow);
    halo.position.y = 3.32;
    halo.scale.setScalar(1.6);
    post.add(base, shaft, lamp, cap, halo);
    group.add(post);
  }
  group.userData.lampGlass = lampGlass;
  group.userData.lampGlow = glow;
  return scenery(group);
}

function makeWater(): Mesh {
  const ripples = canvasTexture(
    256,
    (ctx, size) => {
      // A tiling normal map from smooth noise.
      const img = ctx.createImageData(size, size);
      const h = (x: number, y: number) => {
        const u = (x / size) * 8;
        const v = (y / size) * 8;
        // Periodic so the map tiles.
        return Math.sin(u * Math.PI * 2 * 0.5 + noise2(Math.sin((u * Math.PI) / 4) * 3, Math.cos((v * Math.PI) / 4) * 3) * 2) * 0.5 + Math.sin(v * Math.PI * 2 * 0.75 + u) * 0.5;
      };
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const dx = h(x + 1, y) - h(x - 1, y);
          const dy = h(x, y + 1) - h(x, y - 1);
          const i = (y * size + x) * 4;
          img.data[i] = 128 + dx * 60;
          img.data[i + 1] = 128 + dy * 60;
          img.data[i + 2] = 255;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    false,
  );
  ripples.repeat.set(10, 10);
  const material = new MeshStandardMaterial({ color: "#3b6f8a", roughness: 0.06, metalness: 0.15, normalMap: ripples, transparent: true, opacity: 0.9 });
  material.normalScale.set(0.35, 0.35);
  const water = new Mesh(new CircleGeometry(LAKE.r * 2.1, 96), material);
  water.rotation.x = -Math.PI / 2;
  water.position.set(LAKE.x, WATER_Y, LAKE.z);
  water.receiveShadow = true;
  return scenery(water);
}

// ---------- trees, rocks ----------

function paint(geometry: BufferGeometry, color: string, jitter = 0, seed = 1): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position as BufferAttribute;
  const base = new Color(color);
  const colors = new Float32Array(pos.count * 3);
  const rand = seeded(seed);
  const c = new Color();
  for (let i = 0; i < pos.count; i += 1) {
    c.copy(base).multiplyScalar(1 + (rand() - 0.5) * jitter);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new BufferAttribute(colors, 3));
  g.deleteAttribute("uv");
  return g;
}

/** Push vertices in and out by smooth noise, so shapes read as grown, not modelled. */
function lumpy(geometry: BufferGeometry, amount: number, freq: number, seed: number): BufferGeometry {
  const pos = geometry.attributes.position as BufferAttribute;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const n = noise2(v.x * freq + seed, v.z * freq + v.y * freq * 0.7 - seed);
    const k = 1 + n * amount;
    pos.setXYZ(i, v.x * k, v.y + n * amount * 0.4, v.z * k);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function pineGeometry(): BufferGeometry {
  const parts = [paint(new CylinderGeometry(0.11, 0.19, 1.4, 7).translate(0, 0.7, 0), "#5b4030", 0.15, 2)];
  const tiers: [number, number, number][] = [
    [1.25, 1.9, 1.75],
    [1.0, 1.7, 2.55],
    [0.76, 1.45, 3.3],
    [0.48, 1.15, 3.95],
  ];
  tiers.forEach(([radius, height, y], i) => {
    const cone = lumpy(new ConeGeometry(radius, height, 11, 2).translate(0, y, 0), 0.12, 2.2, i * 3);
    parts.push(paint(cone, i % 2 ? "#2f5a35" : "#2a5230", 0.22, 10 + i));
  });
  const merged = mergeGeometries(parts);
  merged.computeVertexNormals();
  return merged;
}

/** An icosphere with shared vertices, so lumpy() keeps it closed and it shades smooth, not faceted. */
function blob(radius: number, detail: number): BufferGeometry {
  const g = new IcosahedronGeometry(radius, detail);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  return mergeVertices(g);
}

function leafyGeometry(): BufferGeometry {
  const trunk = paint(new CylinderGeometry(0.13, 0.22, 2.0, 7).translate(0, 1.0, 0), "#6a4a35", 0.15, 4);
  const crown = lumpy(blob(1.35, 2).translate(0, 2.75, 0), 0.22, 1.4, 5);
  const side = lumpy(blob(0.95, 2).translate(0.7, 2.25, 0.35), 0.2, 1.6, 9);
  const top = lumpy(blob(0.85, 2).translate(-0.45, 3.45, -0.2), 0.2, 1.7, 13);
  const merged = mergeGeometries([trunk, paint(crown, "#4f7d32", 0.25, 6), paint(side, "#5b8a38", 0.25, 7), paint(top, "#6a9a3f", 0.25, 8)]);
  merged.computeVertexNormals();
  return merged;
}

function rockGeometry(): BufferGeometry {
  return paint(lumpy(blob(1, 2), 0.32, 1.3, 21), "#8a857d", 0.2, 22);
}

function instanced(geometry: BufferGeometry, material: Material, spots: ReturnType<typeof scatter>, shape: (spot: ReturnType<typeof scatter>[number], o: Object3D, c: Color) => void, shadows: boolean): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, spots.length));
  mesh.count = spots.length;
  const o = new Object3D();
  const c = new Color();
  spots.forEach((spot, i) => {
    o.position.set(spot.x, spot.y, spot.z);
    o.rotation.set(0, spot.yaw, 0);
    o.scale.setScalar(spot.scale);
    c.setRGB(1, 1, 1);
    shape(spot, o, c);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    mesh.setColorAt(i, c);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  mesh.computeBoundingSphere();
  return mesh;
}

function makeWoods(level: SceneryLevel, shadows: boolean): Group {
  const n = COUNTS[level];
  const group = new Group();
  const bark = new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  const pines = scatter(101, n.pines, 34, 165, { clump: 0.55, maxSlope: 0.85 });
  group.add(
    instanced(pineGeometry(), bark, pines, (s, o, c) => {
      o.scale.set(s.scale * 1.1, s.scale * (1.1 + s.tint * 0.9), s.scale * 1.1);
      c.setRGB(0.85 + s.tint * 0.3, 0.9 + s.tint * 0.2, 0.85 + s.tint * 0.2);
    }, shadows),
  );
  const leafy = scatter(202, n.leafy, 31, 120, { clump: 0.35, maxSlope: 0.6 });
  group.add(
    instanced(leafyGeometry(), bark, leafy, (s, o, c) => {
      o.scale.multiplyScalar(1.1);
      // Some turn autumn colours.
      if (s.tint > 0.82) c.setRGB(1.6, 1.0, 0.45);
      else c.setRGB(0.85 + s.tint * 0.25, 0.9 + s.tint * 0.2, 0.8);
    }, shadows),
  );
  const rocks = [
    ...scatter(303, n.rocks, 22, 160, { maxSlope: 1.4, clump: 0.2, maxY: 60 }),
    // A few boulders just off the plaza, to sit on.
    ...scatter(304, 7, PLAZA_RADIUS + 3, 26, { maxSlope: 0.3 }).map((s) => ({ ...s, scale: s.scale * 0.8 })),
  ];
  const stone = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true });
  group.add(
    instanced(rockGeometry(), stone, rocks, (s, o, c) => {
      o.scale.set(s.scale * (0.8 + s.tint), s.scale * (0.45 + s.tint * 0.5), s.scale * (0.9 + (1 - s.tint) * 0.6));
      o.position.y -= 0.25 * o.scale.y;
      o.rotation.set((s.tint - 0.5) * 0.4, s.yaw, 0);
      const g = 0.8 + s.tint * 0.35;
      c.setRGB(g, g * 0.98, g * 0.94);
    }, shadows),
  );
  return scenery(group);
}

// ---------- grass and flowers ----------

function bladeGeometry(): BufferGeometry {
  const rows = 4;
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const root = new Color("#2d5419");
  const tip = new Color("#a6c95d");
  const c = new Color();
  for (let i = 0; i <= rows; i += 1) {
    const t = i / rows;
    const w = 0.05 * (1 - t * 0.92);
    const bend = t * t * 0.12;
    positions.push(-w, t * 0.55, bend, w, t * 0.55, bend);
    c.copy(root).lerp(tip, Math.pow(t, 0.8));
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    normals.push(0, 1, 0, 0, 1, 0);
  }
  const index: number[] = [];
  for (let i = 0; i < rows; i += 1) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  g.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  g.setIndex(index);
  return g;
}

/** Sway in the wind: tips move most, gusts roll across the meadow. */
function windy(material: MeshStandardMaterial, time: { value: number }, strength: number) {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;").replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      {
        vec2 at = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
        float gust = sin(uTime * 0.9 + at.x * 0.09 + at.y * 0.05) * 0.5 + 0.5;
        float sway = sin(uTime * 2.3 + at.x * 0.7 + at.y * 0.45) * (0.35 + gust) + gust * 0.6;
        float k = transformed.y * transformed.y * ${strength.toFixed(2)};
        transformed.x += sway * k;
        transformed.z += sway * k * 0.6;
      }`,
    );
  };
  material.customProgramCacheKey = () => `forge-wind-${strength}`;
}

function makeMeadow(level: SceneryLevel, time: { value: number }, motion: boolean, shadows: boolean, dense = 1): Group {
  const base = COUNTS[level];
  const n = { ...base, grass: Math.round(base.grass * dense), flowers: Math.round(base.flowers * dense) };
  const group = new Group();
  if (!n.grass) return group;
  const rand = seeded(505);
  const blades: ReturnType<typeof scatter> = [];
  for (let tries = 0; blades.length < n.grass && tries < n.grass * 4; tries += 1) {
    const r = Math.sqrt((PLAZA_RADIUS + 0.4) ** 2 + rand() * (52 ** 2 - (PLAZA_RADIUS + 0.4) ** 2));
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    // Denser near the plaza and in patches further out.
    if (fbm(x * 0.08, z * 0.08, 2) * 0.5 + 0.5 < (r - PLAZA_RADIUS) / 60 + rand() * 0.25) continue;
    const y = heightAt(x, z);
    if (y < WATER_Y + 0.3) continue;
    blades.push({ x, y, z, yaw: rand() * Math.PI * 2, scale: 0.7 + rand() * 0.8, tint: rand() });
  }
  const grassMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: DoubleSide });
  if (motion) windy(grassMat, time, 1.4);
  const grass = instanced(bladeGeometry(), grassMat, blades, (s, o, c) => {
    o.scale.set(s.scale, s.scale * (0.8 + s.tint * 0.7), s.scale);
    c.setRGB(0.85 + s.tint * 0.3, 0.92 + s.tint * 0.16, 0.85);
  }, false);
  grass.receiveShadow = shadows;
  group.add(grass);

  if (n.flowers) {
    const palette = ["#ffffff", "#ffe066", "#f7a1c4", "#b49cff", "#ff8a5c"].map((h) => new Color(h));
    const spots = scatter(606, n.flowers, PLAZA_RADIUS + 1, 48, { clump: 0.6, maxSlope: 0.4 });
    const stem = paint(new CylinderGeometry(0.008, 0.01, 0.32, 3).translate(0, 0.16, 0), "#3c6b25");
    const head = paint(new IcosahedronGeometry(0.055, 0).translate(0, 0.34, 0), "#ffffff");
    const flowerGeo = mergeGeometries([stem, head]);
    const flowerMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    if (motion) windy(flowerMat, time, 1.1);
    group.add(
      instanced(flowerGeo, flowerMat, spots, (s, o, c) => {
        o.scale.setScalar(0.8 + s.tint * 0.6);
        c.copy(palette[Math.floor(s.tint * palette.length) % palette.length]);
      }, false),
    );
  }
  return scenery(group);
}

// ---------- clouds and motes ----------

let puff: Texture | null = null;
function puffTexture(): Texture {
  if (puff) return puff;
  puff = canvasTexture(128, (ctx, size) => {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
  return puff;
}

function cloudTexture(seed: number): Texture {
  return canvasTexture(256, (ctx, size) => {
    const rand = seeded(seed);
    for (let i = 0; i < 26; i += 1) {
      const x = size * (0.18 + rand() * 0.64);
      const y = size * (0.45 + (rand() - 0.5) * 0.28);
      const r = size * (0.09 + rand() * 0.16);
      const g = ctx.createRadialGradient(x, y - r * 0.3, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.75)");
      g.addColorStop(0.6, "rgba(255,250,244,0.35)");
      g.addColorStop(1, "rgba(255,248,240,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function makeClouds(level: SceneryLevel): Group {
  const group = new Group();
  const rand = seeded(707);
  const textures = [cloudTexture(1), cloudTexture(2), cloudTexture(3)];
  for (let i = 0; i < COUNTS[level].clouds; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = 150 + rand() * 170;
    const material = new SpriteMaterial({ map: textures[i % textures.length], color: "#fff4ea", transparent: true, opacity: 0.6 + rand() * 0.3, depthWrite: false, fog: false });
    material.userData.opacity = material.opacity;
    const cloud = new Sprite(material);
    const w = 70 + rand() * 90;
    cloud.scale.set(w, w * (0.32 + rand() * 0.14), 1);
    cloud.position.set(Math.cos(a) * r, 55 + rand() * 60, Math.sin(a) * r);
    group.add(cloud);
  }
  return scenery(group);
}

const MOTE_VERT = /* glsl */ `
uniform float uTime;
attribute float seed;
varying float vFade;
void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.31 + seed * 6.28) * 0.9;
  p.y += sin(uTime * 0.53 + seed * 12.1) * 0.6;
  p.z += cos(uTime * 0.27 + seed * 9.4) * 0.9;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vFade = 0.45 + 0.55 * sin(uTime * 1.7 + seed * 40.0);
  gl_PointSize = min((2.2 + seed * 2.6) * (60.0 / -mv.z), 7.0);
  gl_Position = projectionMatrix * mv;
}`;
const MOTE_FRAG = /* glsl */ `
varying float vFade;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vFade;
  gl_FragColor = vec4(1.0, 0.86, 0.6, a * 0.8);
}`;

function makeMotes(level: SceneryLevel, time: { value: number }): Points | null {
  const count = COUNTS[level].motes;
  if (!count) return null;
  const rand = seeded(808);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = 3 + rand() * 30;
    positions.set([Math.cos(a) * r, 0.4 + rand() * 4.5, Math.sin(a) * r], i * 3);
    seeds[i] = rand();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("seed", new BufferAttribute(seeds, 1));
  const material = new ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: { uTime: time }, transparent: true, depthWrite: false, blending: AdditiveBlending });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return scenery(points);
}

// ---------- rain and snow ----------

const DROP_VERT = /* glsl */ `
uniform float uTime;
uniform float uAmount;
uniform float uSnow;
uniform float uWind;
uniform vec3 uCam;
attribute float seed;
varying float vAlpha;
varying float vSnow;
const vec3 BOX = vec3(40.0, 24.0, 40.0);
void main() {
  float fall = mix(15.0, 1.4, uSnow) * (0.75 + seed * 0.5);
  vec3 p = position;
  p.y -= uTime * fall;
  p.x += uTime * uWind * mix(4.0, 1.8, uSnow) + uSnow * sin(uTime * 1.3 + seed * 31.0) * 0.7;
  p.z += uSnow * cos(uTime * 1.1 + seed * 17.0) * 0.6;
  vec3 world = uCam + mod(p - uCam + BOX * 0.5, BOX) - BOX * 0.5;
  // Only a share of the drops fall: as many as the amount asks for.
  vAlpha = step(fract(seed * 7.31), uAmount) * smoothstep(0.0, 2.0, world.y);
  vSnow = uSnow;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_PointSize = clamp(mix(26.0, 5.0, uSnow) * (1.0 + seed * 0.4) / -mv.z * 6.0, 1.0, mix(48.0, 14.0, uSnow));
  gl_Position = projectionMatrix * mv;
}`;
const DROP_FRAG = /* glsl */ `
uniform vec3 uTint;
varying float vAlpha;
varying float vSnow;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  // Rain: a thin streak down the middle of the point. Snow: a soft round flake.
  float streak = (1.0 - smoothstep(0.0, 0.05, abs(c.x))) * (1.0 - smoothstep(0.35, 0.5, abs(c.y)));
  float flake = 1.0 - smoothstep(0.15, 0.5, length(c));
  float a = mix(streak * 0.42, flake * 0.9, vSnow) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(uTint, vec3(1.0), vSnow * 0.7), a);
}`;

function makeDrops(level: SceneryLevel) {
  const count = COUNTS[level].drops;
  const rand = seeded(909);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    positions.set([(rand() - 0.5) * 40, rand() * 24, (rand() - 0.5) * 40], i * 3);
    seeds[i] = rand();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("seed", new BufferAttribute(seeds, 1));
  const uniforms = {
    uTime: { value: 0 },
    uAmount: { value: 0 },
    uSnow: { value: 0 },
    uWind: { value: 0 },
    uCam: { value: new Vector3() },
    uTint: { value: new Color("#c9d6e6") },
  };
  const material = new ShaderMaterial({ vertexShader: DROP_VERT, fragmentShader: DROP_FRAG, uniforms, transparent: true, depthWrite: false });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 5;
  return { points: scenery(points), uniforms };
}

// ---------- weather: the sky, light and fog follow the world ----------

/**
 * Eases the live sky toward the world's weather each frame (about two seconds to settle), and runs
 * the clock when the weather says time passes. Lightning comes in random flashes during a storm.
 */
function useWeatherSky(onFrame: (sky: Sky, flash: number, dt: number) => void) {
  const weather = useForge((s) => s.weather);
  const live = useRef<{ sky: Sky; hour: number; from: Weather | undefined; flash: number; next: number }>({
    sky: skyFor(weatherOf({ weather })),
    hour: weatherOf({ weather }).hour,
    from: weather,
    flash: 0,
    next: 3,
  });
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const l = live.current;
    const w = weatherOf({ weather });
    if (l.from !== weather) {
      l.from = weather;
      l.hour = w.hour;
    }
    if (w.flow > 0) l.hour = (l.hour + (dt * w.flow) / 60) % 24;
    const target = skyFor(w.flow > 0 ? { ...w, hour: l.hour } : w);
    l.sky = blendSky(l.sky, target, 1 - Math.exp(-dt / 0.7));
    // Lightning: a double flicker every few seconds, more often the stronger the storm.
    l.next -= dt;
    if (l.sky.storm > 0.2 && l.next <= 0) {
      l.flash = 1;
      l.next = 1.5 + Math.random() * (9 / l.sky.storm);
      lightning.at = performance.now();
    }
    l.flash *= Math.exp(-dt * 7);
    const flicker = l.flash > 0.02 ? l.flash * (0.6 + 0.4 * Math.sin(performance.now() * 0.06)) : 0;
    onFrame(l.sky, flicker, dt);
  });
  return weather;
}

// ---------- shadows on the lab's own bodies ----------

/** Bodies come and go; let every solid one cast and catch the sun's shadow. */
function ShadowFlags() {
  const scene = useThree((s) => s.scene);
  const frame = useRef(0);
  useFrame(() => {
    frame.current += 1;
    if (frame.current % 30 !== 1) return;
    scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || o.userData.scenery || mesh.castShadow) return;
      const material = mesh.material as Material | Material[];
      const solid = (Array.isArray(material) ? material : [material]).every((m) => !m.transparent && m.type !== "MeshBasicMaterial");
      if (solid) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  });
  return null;
}

// ---------- all of it ----------

function useReducedMotion(): boolean {
  return useMemo(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);
}

export function Scenery({ level, shadows, eleven = false }: { level: SceneryLevel; shadows: boolean; eleven?: boolean }) {
  const motion = !useReducedMotion();
  const time = useMemo(() => ({ value: 0 }), []);
  const land = useBuilt(() => makeLand(COUNTS[level].land), [level]);
  const plaza = useBuilt(makePlaza, []);
  const water = useBuilt(makeWater, []);
  const woods = useBuilt(() => makeWoods(level, shadows), [level, shadows]);
  const meadow = useBuilt(() => makeMeadow(level, time, motion, shadows, eleven ? 1.8 : 1), [level, motion, shadows, eleven]);
  const clouds = useBuilt(() => makeClouds(level), [level]);
  const motes = useMemo(() => makeMotes(level, time), [level, time]);
  const drops = useBuilt(() => makeDrops(level).points, [level]);
  // Snow sparkles on the plaza (glint.ts); not on the lowest rung.
  const floorGlint = useMemo(() => (level === "min" ? null : addGlint(plaza.userData.floor as MeshStandardMaterial, 0, 28)), [plaza, level]);
  useEffect(
    () => () => {
      if (motes) disposeTree(motes);
    },
    [motes],
  );
  const sun = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const ambient = useRef<AmbientLight>(null);
  const sunAt = useMemo(() => SUN.clone().multiplyScalar(70), []);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  // The dome you see eases between skies; the one reflections are rendered from jumps to the target.
  const liveSky = useMemo(skyUniforms, []);
  const envSky = useMemo(skyUniforms, []);
  const fogRef = useRef<Fog>(null);
  const wind = useRef(0.2);
  const weather = useWeatherSky((sky, flash, dt) => {
    paintSky(liveSky, sky, flash * 0.5);
    const fog = fogRef.current;
    if (fog) {
      setRgb(fog.color, sky.fog);
      fog.near = sky.fogNear;
      fog.far = sky.fogFar;
    }
    if (scene.background instanceof Color) setRgb(scene.background, sky.horizon);
    const light = sun.current;
    if (light) {
      setRgb(light.color, sky.light);
      light.intensity = sky.sunIntensity + flash * 1.5;
      light.position.set(sky.lightDir[0] * 70, sky.lightDir[1] * 70, sky.lightDir[2] * 70);
    }
    if (hemi.current) {
      setRgb(hemi.current.color, sky.hemiSky);
      setRgb(hemi.current.groundColor, sky.hemiGround);
      hemi.current.intensity = sky.hemiIntensity + flash * 1.2;
    }
    if (ambient.current) ambient.current.intensity = 0.12 + flash * 0.8;
    scene.environmentIntensity = sky.env;
    const glass = plaza.userData.lampGlass as MeshStandardMaterial | undefined;
    const glow = plaza.userData.lampGlow as SpriteMaterial | undefined;
    if (glass) glass.emissiveIntensity = 0.5 + sky.lamps * 3;
    if (glow) glow.opacity = 0.12 + sky.lamps * 0.75;
    const floor = plaza.userData.floor as MeshStandardMaterial | undefined;
    if (floorGlint) floorGlint.uGlint.value = sky.snow * 1.6 + sky.wet * 0.25;
    if (floor) {
      floor.roughness = 0.82 - sky.wet * 0.55;
      floor.color.setScalar(1 - sky.wet * 0.3);
    }
    for (const cloud of clouds.children as Sprite[]) {
      setRgb(cloud.material.color, sky.cloudShade);
      cloud.material.opacity = (cloud.material.userData.opacity as number) * sky.cloudOpacity;
    }
    const amount = Math.max(sky.rain, sky.snow);
    const u = (drops.material as ShaderMaterial).uniforms;
    drops.visible = amount > 0.01;
    if (drops.visible) {
      u.uTime.value += dt;
      u.uAmount.value = amount;
      u.uSnow.value = sky.snow / Math.max(0.001, sky.snow + sky.rain);
      u.uWind.value = sky.wind;
      (u.uCam.value as Vector3).copy(camera.position);
      setRgb(u.uTint.value as Color, sky.fog.map((v) => 0.55 + v * 0.45) as RGB);
    }
    wind.current = sky.wind;
  });
  useLayoutEffect(() => {
    paintSky(envSky, skyFor(weatherOf({ weather })));
  }, [envSky, weather]);

  useLayoutEffect(() => {
    const light = sun.current;
    if (!light) return;
    scene.add(light.target);
    return () => {
      scene.remove(light.target);
    };
  }, [scene]);

  useFrame((_, dt) => {
    if (!motion) return;
    time.value += Math.min(dt, 0.1) * (0.6 + wind.current * 1.6);
    clouds.rotation.y += Math.min(dt, 0.1) * 0.0025;
    const normal = (water.material as MeshStandardMaterial).normalMap;
    if (normal) {
      normal.offset.x += dt * 0.004;
      normal.offset.y += dt * 0.0025;
    }
  });

  const shadowMap = eleven ? 4096 : COUNTS[level].shadowMap;
  return (
    <>
      <color attach="background" args={[SKY.horizon]} />
      <fog ref={fogRef} attach="fog" args={[SKY.fog, FOG_NEAR, FOG_FAR]} />
      <hemisphereLight ref={hemi} args={[SKY.hemiSky, SKY.hemiGround, 0.75]} />
      <ambientLight ref={ambient} intensity={0.12} />
      <directionalLight
        ref={sun}
        position={sunAt}
        intensity={2.3}
        color={SKY.light}
        castShadow={shadows}
        shadow-mapSize={[shadowMap, shadowMap]}
        shadow-camera-left={-34}
        shadow-camera-right={34}
        shadow-camera-top={34}
        shadow-camera-bottom={-34}
        shadow-camera-near={1}
        shadow-camera-far={160}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />
      {/* Reflections and soft light on every material, from the same sky (rendered once). */}
      {/* Rendered again (once) whenever the weather changes. */}
      <Environment key={weather?.label ?? "clear"} frames={1} resolution={level === "full" ? 128 : 64} environmentIntensity={0.55}>
        <SkyDome follow={false} uniforms={envSky} />
      </Environment>
      <SkyDome uniforms={liveSky} />
      <primitive object={land} />
      <primitive object={plaza} />
      <primitive object={water} />
      <primitive object={woods} />
      <primitive object={meadow} />
      <primitive object={clouds} />
      {motes ? <primitive object={motes} /> : null}
      <primitive object={drops} />
      {shadows ? <ShadowFlags /> : null}
    </>
  );
}

/**
 * The flat stage for the lowest rung (?scenery=off): no land, sky dome or reflections, but the same
 * weather. The background and fog take the sky's horizon, the lights its sun and fill, the floor
 * darkens and shines when wet, and rain or snow falls (at the lightest count).
 */
export function FlatStage() {
  const sun = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const fogRef = useRef<Fog>(null);
  const floor = useRef<MeshStandardMaterial>(null);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const drops = useBuilt(() => makeDrops("min").points, []);
  useWeatherSky((sky, flash, dt) => {
    if (scene.background instanceof Color) setRgb(scene.background, sky.horizon.map((v) => v * 0.55) as RGB);
    const fog = fogRef.current;
    if (fog) setRgb(fog.color, sky.horizon.map((v) => v * 0.55) as RGB);
    const light = sun.current;
    if (light) {
      setRgb(light.color, sky.light);
      light.intensity = 0.5 + sky.sunIntensity * 0.6 + flash * 1.5;
      light.position.set(sky.lightDir[0] * 12, Math.max(2, sky.lightDir[1] * 12), sky.lightDir[2] * 12);
    }
    if (hemi.current) {
      setRgb(hemi.current.color, sky.hemiSky);
      setRgb(hemi.current.groundColor, sky.hemiGround);
      hemi.current.intensity = 0.35 + sky.hemiIntensity * 0.6 + flash * 1.2;
    }
    if (floor.current) {
      floor.current.roughness = 1 - sky.wet * 0.65;
      floor.current.metalness = sky.wet * 0.2;
    }
    const amount = Math.max(sky.rain, sky.snow);
    const u = (drops.material as ShaderMaterial).uniforms;
    drops.visible = amount > 0.01;
    if (drops.visible) {
      u.uTime.value += dt;
      u.uAmount.value = amount;
      u.uSnow.value = sky.snow / Math.max(0.001, sky.snow + sky.rain);
      u.uWind.value = sky.wind;
      (u.uCam.value as Vector3).copy(camera.position);
      setRgb(u.uTint.value as Color, sky.fog.map((v) => 0.55 + v * 0.45) as RGB);
    }
  });
  return (
    <>
      <color attach="background" args={["#09090b"]} />
      <fog ref={fogRef} attach="fog" args={["#09090b", 36, 72]} />
      <hemisphereLight ref={hemi} args={["#f3f4f6", "#8b919c", 0.7]} />
      <ambientLight intensity={0.3} />
      <directionalLight ref={sun} position={[7, 11, 5]} intensity={1.55} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, 0]}>
        <circleGeometry args={[30, 80]} />
        <meshStandardMaterial ref={floor} color="#1c2128" roughness={1} metalness={0} />
      </mesh>
      <primitive object={drops} />
    </>
  );
}
