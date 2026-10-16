/**
 * Draws and steps cloth (src/engine/cloth.ts): your cape, pinned across your shoulders and pushed out
 * of your body, and flags on their poles. Fabric is a double-sided sheen material, so folds catch
 * the light like cloth; flags carry a pattern (the 4D bubble's film, a rainbow, a pirate's skull, or
 * plain white). The weather's wind blows them.
 */
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, SRGBColorSpace } from "three";
import { useShallow } from "zustand/react/shallow";
import { makeCloth, stepCloth, FLAG_TAG, type Capsule, type Cloth } from "@/engine/cloth";
import { groundAt } from "@/engine/physics";
import { useForge } from "@/engine/store";
import { weatherOf } from "@/engine/weather";
import { arcadePlaying, useArcadePlaying } from "./body-state";
import { useLook } from "./look";

type P = { x: number; y: number; z: number };

function gridGeometry(cols: number, rows: number): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(cols * rows * 3), 3));
  const uv = new Float32Array(cols * rows * 2);
  for (let r = 0; r < rows; r += 1)
    for (let c = 0; c < cols; c += 1) {
      uv[(r * cols + c) * 2] = c / (cols - 1);
      uv[(r * cols + c) * 2 + 1] = 1 - r / (rows - 1);
    }
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  const index: number[] = [];
  for (let r = 0; r < rows - 1; r += 1)
    for (let c = 0; c < cols - 1; c += 1) {
      const a = r * cols + c;
      index.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  g.setIndex(index);
  return g;
}

function upload(g: BufferGeometry, cloth: Cloth) {
  const attr = g.getAttribute("position") as BufferAttribute;
  for (let i = 0; i < cloth.cols * cloth.rows; i += 1) attr.setXYZ(i, cloth.pos[i * 3], cloth.pos[i * 3 + 1], cloth.pos[i * 3 + 2]);
  attr.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
}

/** The weather's wind, gusting, m/s across the ground. */
function windNow(t: number, seed: number): P {
  const w = weatherOf(useForge.getState()).wind;
  const gust = w * 9 * (0.65 + 0.35 * Math.sin(t * 0.6 + seed) + 0.2 * Math.sin(t * 1.9 + seed * 2));
  return { x: gust * 0.8, y: 0, z: gust * 0.6 };
}

// ---------- the cape ----------

const CAPE = { width: 0.56, length: 0.98, cols: 9, rows: 13 };

/** Shoulder points and body capsules for the figure at `p` facing `yaw` (entity space, Avatar.tsx). */
function bodyFrame(p: P, yaw: number) {
  const cx = Math.cos(yaw);
  const sx = Math.sin(yaw);
  const at = (lx: number, ly: number, lz: number): P => ({ x: p.x + cx * lx + sx * lz, y: p.y + ly, z: p.z - sx * lx + cx * lz });
  const pins = [at(0.2, 0.47, -0.09), at(0, 0.5, -0.14), at(-0.2, 0.47, -0.09)];
  const capsules: Capsule[] = [
    { a: at(0, -0.05, -0.01), b: at(0, 0.42, -0.01), r: 0.165 },
    { a: at(0.09, 0.02, 0), b: at(0.09, -0.58, 0), r: 0.075 },
    { a: at(-0.09, 0.02, 0), b: at(-0.09, -0.58, 0), r: 0.075 },
    { a: at(0, 0.55, 0), b: at(0, 0.7, 0), r: 0.13 },
  ];
  return { pins, capsules, across: { x: -cx, y: 0, z: sx } };
}

export function Cape() {
  const color = useForge((s) => Object.values(s.entities).find((e) => e.tags.includes("architect"))?.customData.cape ?? "");
  const mode = useLook().mode;
  const playing = useArcadePlaying();
  if (!color || mode === "first" || playing) return null;
  return <CapeCloth color={color} />;
}

function CapeCloth({ color }: { color: string }) {
  const sim = useRef<{ cloth: Cloth; t: number } | null>(null);
  const geometry = useMemo(() => gridGeometry(CAPE.cols, CAPE.rows), []);
  useFrame((_, delta) => {
    const me = Object.values(useForge.getState().entities).find((e) => e.tags.includes("architect"));
    if (!me || arcadePlaying.get()) return;
    const frame = bodyFrame(me.transform.position, Number(me.customData.yaw) || 0);
    const was = sim.current?.cloth.pinned[1];
    const jumped = was != null && sim.current ? Math.hypot(sim.current.cloth.pos[was * 3] - frame.pins[1].x, sim.current.cloth.pos[was * 3 + 2] - frame.pins[1].z) > 1.5 : false;
    if (!sim.current || jumped) {
      // New, or the body was carried off somewhere (a portal, a reset): hang it fresh.
      const left = frame.pins[0];
      sim.current = { cloth: makeCloth(CAPE.width, CAPE.length, CAPE.cols, CAPE.rows, left, frame.across, "top"), t: sim.current?.t ?? 0 };
    }
    const s = sim.current;
    s.t += delta;
    // Pins in cloth order: the top-left corner, the middle of the top, the top-right corner.
    stepCloth(s.cloth, frame.pins, delta, { ground: groundAt, wind: windNow(s.t, 1), capsules: frame.capsules, time: s.t });
    upload(geometry, s.cloth);
  });
  return (
    <mesh geometry={geometry} castShadow receiveShadow frustumCulled={false}>
      <meshPhysicalMaterial color={color} side={DoubleSide} roughness={0.78} sheen={1} sheenRoughness={0.45} sheenColor="#ffd6ff" />
    </mesh>
  );
}

// ---------- flags ----------

const FLAG = { width: 1.25, height: 0.8, cols: 14, rows: 9 };

const flagTextures: Record<string, CanvasTexture> = {};
function flagTexture(style: string): CanvasTexture | null {
  if (flagTextures[style]) return flagTextures[style];
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 160;
  const g = c.getContext("2d");
  if (!g) return null;
  if (style === "rainbow") {
    const bands = ["#e8384f", "#fd8c3a", "#fde84a", "#3cc864", "#3b82f6", "#8b5cf6"];
    bands.forEach((b, i) => {
      g.fillStyle = b;
      g.fillRect(0, (i * 160) / bands.length, 256, 160 / bands.length + 1);
    });
  } else if (style === "pirate") {
    g.fillStyle = "#101014";
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = "#f2efe6";
    g.font = "bold 110px serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("☠", 128, 84);
  } else if (style === "white") {
    g.fillStyle = "#f4f2ee";
    g.fillRect(0, 0, 256, 160);
  } else {
    // The 4D bubble: a thin-film sweep with a tesseract drawn in its middle.
    const film = g.createLinearGradient(0, 0, 256, 160);
    film.addColorStop(0, "#ff4d6d");
    film.addColorStop(0.35, "#b77bff");
    film.addColorStop(0.65, "#4de2c5");
    film.addColorStop(1, "#9cff6b");
    g.fillStyle = film;
    g.fillRect(0, 0, 256, 160);
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 4;
    const sq = (x: number, y: number, s: number) => g.strokeRect(x - s / 2, y - s / 2, s, s);
    sq(128, 80, 84);
    sq(128, 80, 40);
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      g.beginPath();
      g.moveTo(128 + dx * 42, 80 + dy * 42);
      g.lineTo(128 + dx * 20, 80 + dy * 20);
      g.stroke();
    }
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  flagTextures[style] = tex;
  return tex;
}

export function Flags() {
  const keys = useForge(
    useShallow((s) =>
      Object.values(s.entities)
        .filter((e) => e.tags.includes(FLAG_TAG))
        .map((e) => `${e.id}|${e.customData.flag ?? "4d"}`),
    ),
  );
  return (
    <>
      {keys.map((key) => {
        const [id, style] = key.split("|");
        return <FlagCloth key={key} id={Number(id)} style={style} />;
      })}
    </>
  );
}

function FlagCloth({ id, style }: { id: number; style: string }) {
  const sim = useRef<{ cloth: Cloth; t: number; at: string } | null>(null);
  const geometry = useMemo(() => gridGeometry(FLAG.cols, FLAG.rows), []);
  const map = flagTexture(style);
  useFrame((_, delta) => {
    const pole = useForge.getState().entities[id];
    if (!pole) return;
    const p = pole.transform.position;
    const top = { x: p.x + 0.045, y: p.y + Math.abs(pole.transform.scale.y) / 2 - 0.06, z: p.z };
    const at = `${top.x.toFixed(2)},${top.y.toFixed(2)},${top.z.toFixed(2)}`;
    if (!sim.current || sim.current.at !== at) {
      // Built (or rebuilt when the pole moves) streaming the way the wind blows.
      const w = windNow(0, id);
      const len = Math.hypot(w.x, w.z) || 1;
      const across = len > 0.1 ? { x: w.x / len, y: 0, z: w.z / len } : { x: 1, y: 0, z: 0 };
      sim.current = { cloth: makeCloth(FLAG.width, FLAG.height, FLAG.cols, FLAG.rows, top, across, "left"), t: sim.current?.t ?? 0, at };
    }
    const s = sim.current;
    s.t += delta;
    const pins = s.cloth.pinned.map((_, r) => ({ x: top.x, y: top.y - (r * FLAG.height) / (FLAG.rows - 1), z: top.z }));
    stepCloth(s.cloth, pins, delta, { ground: groundAt, wind: windNow(s.t, id), time: s.t });
    upload(geometry, s.cloth);
  });
  const pole = useForge((s) => s.entities[id]);
  const finial = pole ? { x: pole.transform.position.x, y: pole.transform.position.y + Math.abs(pole.transform.scale.y) / 2 + 0.05, z: pole.transform.position.z } : null;
  return (
    <>
      <mesh geometry={geometry} castShadow receiveShadow frustumCulled={false}>
        <meshPhysicalMaterial map={map} color="#ffffff" side={DoubleSide} roughness={0.72} sheen={0.8} sheenRoughness={0.5} sheenColor="#ffffff" />
      </mesh>
      {finial ? (
        <mesh position={[finial.x, finial.y, finial.z]} castShadow>
          <sphereGeometry args={[0.07, 16, 12]} />
          <meshStandardMaterial color="#d8b25a" metalness={0.9} roughness={0.25} />
        </mesh>
      ) : null}
    </>
  );
}
