import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject, type ReactNode } from "react";
import type { Group, Vector3Tuple } from "three";
import { CanvasTexture, Matrix4, Object3D, Plane, Quaternion, Raycaster, SRGBColorSpace, Vector2, Vector3, type Texture } from "three";
import type { Mesh } from "three";
import { clusterDag, selectCut } from "@/engine/cluster-lod";
import type { Entity, Vec3 } from "@/engine/types";
import { TEXTURE_PACKS, type TexturePack } from "@/engine/asset-url";
import { loadAlbedo } from "@/engine/albedo";
import { GRAVITY, restoreLab } from "@/engine/manifold";
import { useForge } from "@/engine/store";
import { scenePalette } from "./palette";
import { Pilot } from "./pilot";
import { RoomPicture } from "./picture";
import { probeHardware, qualityFor, softRenderRequested } from "@/engine/hardware";
import { faceLook, pilotKeys, pointerClaim, setAimPoint, setGazeLock, shiftLook, useGazeId, useLook } from "./look";

const UP = new Vector3(0, 1, 0);
const texCache = new Map<string, Texture>();

function paintLabTexture(kind: string): Texture {
  const hit = texCache.get(kind);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    if (kind === "circuit") {
      ctx.fillStyle = "#102033";
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = "#7ee0c8";
      ctx.lineWidth = 2;
      for (let i = 8; i < 128; i += 16) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 128);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(48, i);
        ctx.stroke();
      }
    } else if (kind === "clay") {
      ctx.fillStyle = "#c46a4a";
      ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 420; i += 1) {
        ctx.fillStyle = `rgba(70,28,18,${0.08 + (i % 4) * 0.04})`;
        ctx.fillRect((i * 17) % 128, (i * 29) % 128, 3, 2);
      }
    } else if (kind === "paper") {
      ctx.fillStyle = "#efe6d4";
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = "rgba(90,70,40,0.28)";
      for (let y = 10; y < 128; y += 8) {
        ctx.beginPath();
        ctx.moveTo(6, y);
        ctx.lineTo(122, y);
        ctx.stroke();
      }
    } else if (kind === "steel") {
      ctx.fillStyle = "#c5c9d1";
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = "rgba(70,76,86,0.45)";
      ctx.lineWidth = 2;
      for (let y = 4; y < 128; y += 6) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(128, y + (y % 12 === 0 ? 2 : 0));
        ctx.stroke();
      }
    } else if (kind === "brick") {
      ctx.fillStyle = "#8d4636";
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = "#e7d3c4";
      for (let row = 0; row < 5; row += 1) {
        const y = 4 + row * 25;
        const shift = row % 2 ? 16 : 0;
        for (let x = -16 + shift; x < 128; x += 32) {
          ctx.fillRect(x + 2, y + 2, 26, 18);
        }
      }
    } else if (kind === "grain") {
      ctx.fillStyle = "#b8884e";
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = "rgba(90,48,18,0.35)";
      for (let i = 0; i < 18; i += 1) {
        ctx.beginPath();
        ctx.moveTo(0, i * 7);
        ctx.bezierCurveTo(40, i * 7 + 4, 80, i * 7 - 3, 128, i * 7 + 2);
        ctx.stroke();
      }
    } else if (kind === "night") {
      ctx.fillStyle = "#141822";
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = "#d5d8de";
      for (let i = 0; i < 40; i += 1) {
        const size = i % 5 === 0 ? 2 : 1;
        ctx.fillRect((i * 37) % 124, (i * 19) % 124, size, size);
      }
    } else {
      ctx.fillStyle = "#f4f1ec";
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = "#b7b0a6";
      ctx.lineWidth = 3;
      for (let i = 0; i < 7; i += 1) {
        ctx.beginPath();
        ctx.moveTo(-10, i * 22);
        ctx.bezierCurveTo(30, i * 22 + 18, 70, i * 22 - 12, 140, i * 22 + 8);
        ctx.stroke();
      }
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  texCache.set(kind, texture);
  return texture;
}

function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduce(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return reduce;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexRgb(hex: string): [number, number, number] {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return [0.8, 0.8, 0.8];
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function NeuralCloud({
  seed,
  count,
  palette,
  shape,
}: {
  seed: number;
  count: number;
  palette: string;
  shape: string;
}) {
  const { positions, colors } = useMemo(() => {
    const rand = mulberry32(seed || 1);
    const cols = palette.split(",").map((item) => item.trim()).filter((item) => item.startsWith("#"));
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      let x = 0;
      let y = 0;
      let z = 0;
      if (shape === "column") {
        const angle = rand() * Math.PI * 2;
        const radius = rand() * 0.28;
        x = Math.cos(angle) * radius;
        z = Math.sin(angle) * radius;
        y = (rand() - 0.15) * 1.7;
      } else if (shape === "ring") {
        const angle = rand() * Math.PI * 2;
        const radius = 0.55 + (rand() - 0.5) * 0.14;
        x = Math.cos(angle) * radius;
        z = Math.sin(angle) * radius;
        y = (rand() - 0.5) * 0.16;
      } else if (shape === "slab") {
        x = (rand() - 0.5) * 1.8;
        z = (rand() - 0.5) * 1.8;
        y = (rand() - 0.5) * 0.1;
      } else {
        const theta = rand() * Math.PI * 2;
        const phi = Math.acos(2 * rand() - 1);
        const radius = rand() ** 0.45 * 0.85;
        x = radius * Math.sin(phi) * Math.cos(theta);
        y = radius * Math.cos(phi) * 0.85;
        z = radius * Math.sin(phi) * Math.sin(theta);
      }
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      const rgb = hexRgb(cols[Math.floor(rand() * Math.max(1, cols.length))] ?? "#d7d2cb");
      col[i * 3] = rgb[0];
      col[i * 3 + 1] = rgb[1];
      col[i * 3 + 2] = rgb[2];
    }
    return { positions: pos, colors: col };
  }, [seed, count, palette, shape]);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        vertexColors
        size={shape === "slab" ? 0.06 : 0.042}
        sizeAttenuation
        depthWrite={false}
        transparent
        opacity={0.92}
      />
    </points>
  );
}

function ClusterCut() {
  const dag = useMemo(() => clusterDag(), []);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const ref = useRef<Mesh>(null);
  const seen = useRef("");
  const local = useRef(new Vector3());
  const inverse = useRef(new Matrix4());
  const [cut, setCut] = useState(() => selectCut(dag, { x: 0, y: 0, z: 8 }, 50, 720, 1));
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    mesh.updateWorldMatrix(true, false);
    inverse.current.copy(mesh.matrixWorld).invert();
    local.current.copy(camera.position).applyMatrix4(inverse.current);
    const height = gl.domElement?.clientHeight || gl.domElement?.height || 720;
    const fov = "fov" in camera && typeof camera.fov === "number" ? camera.fov : 50;
    const next = selectCut(dag, { x: local.current.x, y: local.current.y, z: local.current.z }, fov, height, 0.2);
    if (next.key === seen.current) return;
    seen.current = next.key;
    setCut(next);
  });
  return (
    <mesh ref={ref} key={cut.key}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[cut.positions, 3]} />
        <bufferAttribute attach="attributes-normal" args={[cut.normals, 3]} />
        <bufferAttribute attach="attributes-color" args={[cut.colors, 3]} />
      </bufferGeometry>
      <meshStandardMaterial vertexColors roughness={0.4} metalness={0.16} flatShading />
    </mesh>
  );
}

function SplatCloud({
  seed,
  count,
  color,
  size = 0.045,
}: {
  seed: number;
  count: number;
  color: string;
  size?: number;
}) {
  const positions = useMemo(() => {
    const rand = mulberry32(seed || 1);
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const radius = 0.25 + rand() * 0.9;
      arr[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = radius * Math.cos(phi) * 0.72;
      arr[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    return arr;
  }, [seed, count]);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        size={size}
        sizeAttenuation
        depthWrite={false}
        transparent
        opacity={0.9}
      />
    </points>
  );
}

function Solid({
  children,
  selected,
  tone,
  map,
}: {
  children: ReactNode;
  selected: boolean;
  tone: string;
  map?: Texture | null;
}) {
  return (
    <mesh>
      {children}
      <meshStandardMaterial
        color={map ? "#ffffff" : tone}
        map={map ?? undefined}
        roughness={0.62}
        metalness={0.28}
        emissive={selected ? tone : "#12141a"}
        emissiveIntensity={selected ? 0.45 : 0.2}
      />
    </mesh>
  );
}

function useAlbedo(src: string | undefined) {
  const [map, setMap] = useState<Texture | null>(null);
  useEffect(() => {
    if (!src) {
      setMap(null);
      return;
    }
    if (src.startsWith("tex:")) {
      setMap(paintLabTexture(src.slice(4)));
      return;
    }
    let dead = false;
    void loadAlbedo(src).then((texture) => {
      if (!dead) setMap(texture);
    });
    return () => {
      dead = true;
    };
  }, [src]);
  return map;
}

function assetLabel(entity: Entity): string {
  const rep = entity.representation;
  if (rep.kind === "mesh") return rep.assetId;
  if (rep.kind === "gaussian") return "gaussian";
  return "avatar";
}

function LabConsole() {
  const tick = useForge((s) => s.tick);
  const selected = useForge((s) => (s.selectedId == null ? null : (s.entities[s.selectedId] ?? null)));
  const busy = useForge((s) => s.busy);
  const [line, setLine] = useState("");
  const source = selected
    ? `${selected.name} · ${assetLabel(selected)} · ${selected.customData.color || "default"} · ${selected.transform.position.x.toFixed(1)}, ${selected.transform.position.y.toFixed(1)}, ${selected.transform.position.z.toFixed(1)}`
    : `tick ${String(tick).padStart(4, "0")} · click a body`;
  const paint = (color: string) => {
    if (!selected || selected.tags.includes("architect")) return;
    useForge.getState().dispatchManual("set_color", { id: String(selected.id), color });
  };
  const act = (name: string, args: Record<string, string>) => {
    useForge.getState().dispatchManual(name, args);
    if (name === "apply_velocity") useForge.getState().setRunning(true);
  };
  const nudge = (x: number, y: number, z: number) => {
    const current = useForge.getState();
    const body = current.selectedId == null ? null : current.entities[current.selectedId];
    if (!body || body.tags.includes("floor") || body.tags.includes("tetris")) return;
    const p = body.transform.position;
    current.dispatchManual("set_transform", {
      id: String(body.id),
      x: String(Math.round((p.x + x) * 100) / 100),
      y: String(Math.round((p.y + y) * 100) / 100),
      z: String(Math.round((p.z + z) * 100) / 100),
    });
  };
  const play = (kind: "tetris" | "marble") => {
    act("build_play", { kind });
    useForge.getState().setRunning(true);
  };
  const wrapTexture = () => {
    const current = useForge.getState();
    const body = current.selectedId == null ? null : current.entities[current.selectedId];
    if (!body || body.tags.includes("architect")) return;
    const order = ["marble", "circuit", "clay", "paper"];
    const now = body.customData.src?.startsWith("tex:") ? body.customData.src.slice(4) : "";
    const next = order[(order.indexOf(now) + 1) % order.length] ?? "marble";
    act("set_asset", { id: String(body.id), src: `tex:${next}`, title: next });
  };
  const importMesh = () => {
    const current = useForge.getState();
    const body = current.selectedId == null ? null : current.entities[current.selectedId];
    const order = ["gem", "knot", "vase", "crystal"];
    if (body && !body.tags.includes("floor") && !body.tags.includes("architect") && !body.tags.includes("tetris")) {
      const asset = body.representation.kind === "mesh" ? body.representation.assetId : "";
      const next = order[(Math.max(0, order.indexOf(asset)) + (order.includes(asset) ? 1 : 0)) % order.length] ?? "gem";
      act("edit_entity", { id: String(body.id), asset: next });
      return;
    }
    act("spawn_entity", { name: "Gem", asset: "gem", x: "2.2", y: "0", z: "1.3" });
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const intent = line.trim();
    if (!intent) return;
    setLine("");
    void useForge.getState().submitIntent(intent);
  };
  return (
    <form className="lab-console" onSubmit={onSubmit}>
      <div className="lab-console-head">
        <strong>Forge computer</strong>
        <span>{source}</span>
      </div>
      <div className="lab-actions">
        <button type="button" onClick={() => paint("teal")} disabled={!selected || selected.tags.includes("architect")}>
          Paint teal
        </button>
        <button type="button" onClick={() => paint("gold")} disabled={!selected || selected.tags.includes("architect")}>
          Paint gold
        </button>
        <button type="button" onClick={() => nudge(-0.85, 0, 0)} disabled={!selected || selected.tags.includes("floor") || selected.tags.includes("tetris")}>
          Nudge left
        </button>
        <button type="button" onClick={() => nudge(0.85, 0, 0)} disabled={!selected || selected.tags.includes("floor") || selected.tags.includes("tetris")}>
          Nudge right
        </button>
        <button type="button" onClick={wrapTexture} disabled={!selected || selected.tags.includes("architect")}>
          Wrap texture
        </button>
        <button type="button" onClick={importMesh}>
          Import mesh
        </button>
        <button type="button" onClick={() => play("tetris")}>
          Tetris
        </button>
        <button type="button" onClick={() => play("marble")}>
          Marble run
        </button>
        <button type="button" onClick={() => act("play_move", { move: "left" })}>
          Piece left
        </button>
        <button type="button" onClick={() => act("play_move", { move: "rotate" })}>
          Rotate
        </button>
        <button type="button" onClick={() => act("play_move", { move: "drop" })}>
          Drop piece
        </button>
        <button
          type="button"
          onClick={() => {
            const orb = Object.values(useForge.getState().entities).find((entity) => entity.name === "DropOrb");
            if (!orb) return;
            act("apply_velocity", { id: String(orb.id), vx: "0", vy: "6", vz: "0" });
          }}
        >
          Drop orb
        </button>
        <button
          type="button"
          onClick={() => {
            act("spawn_agent", { role: "critic", name: "Critic" });
            if (!useForge.getState().criticPower) useForge.getState().setCriticPower(true);
          }}
        >
          Spawn critic
        </button>
        <button
          type="button"
          onClick={() => selected && useForge.getState().despawn(selected.id)}
          disabled={!selected || selected.tags.includes("architect") || selected.tags.includes("helm")}
        >
          {!selected ? "Delete" : selected.tags.includes("architect") ? "Avatar stays" : selected.tags.includes("helm") ? "Helm stays" : "Delete"}
        </button>
      </div>
      <label className="lab-line">
        <span>Ask</span>
        <input
          value={line}
          onChange={(event) => setLine(event.target.value)}
          placeholder="Edit the selected body, or tell the forge what to build"
          disabled={busy}
        />
      </label>
    </form>
  );
}

function entityTone(entity: Entity): string {
  return entity.customData.color || scenePalette.steel[entity.id % scenePalette.steel.length] || scenePalette.steel[0];
}

function AssetMesh({
  asset,
  selected,
  tone,
  map,
  screen,
}: {
  asset: string;
  selected: boolean;
  tone: string;
  map?: Texture | null;
  screen?: boolean;
}) {
  if (asset === "card") {
    if (!screen) {
      return (
        <mesh>
          <planeGeometry args={[1, 1.15]} />
          <meshStandardMaterial color={map ? "#ffffff" : tone} map={map ?? undefined} roughness={0.55} metalness={0.05} />
        </mesh>
      );
    }
    return (
      <group>
        <mesh position={[0, 0, -0.04]}>
          <boxGeometry args={[1.12, 1.28, 0.08]} />
          <meshStandardMaterial color={scenePalette.ground} roughness={0.42} metalness={0.48} />
        </mesh>
        <mesh position={[0, 0, 0.05]}>
          <planeGeometry args={[0.92, 0.62]} />
          <meshStandardMaterial color={scenePalette.grid} emissive={scenePalette.mark} emissiveIntensity={0.08} roughness={0.35} metalness={0.2} />
        </mesh>
      </group>
    );
  }
  if (asset === "sphere") {
    return (
      <Solid selected={selected} tone={tone} map={map}>
        <sphereGeometry args={[0.5, 28, 18]} />
      </Solid>
    );
  }
  if (asset === "gem") {
    return (
      <Solid selected={selected} tone={tone} map={map}>
        <icosahedronGeometry args={[0.62, 0]} />
      </Solid>
    );
  }
  if (asset === "crystal") {
    return (
      <Solid selected={selected} tone={tone} map={map}>
        <octahedronGeometry args={[0.62, 0]} />
      </Solid>
    );
  }
  if (asset === "knot") {
    return (
      <Solid selected={selected} tone={tone} map={map}>
        <torusKnotGeometry args={[0.34, 0.11, 80, 12]} />
      </Solid>
    );
  }
  if (asset === "vase") {
    return (
      <group>
        <Solid selected={selected} tone={tone} map={map}>
          <cylinderGeometry args={[0.32, 0.2, 0.55, 24]} />
        </Solid>
        <mesh position={[0, 0.42, 0]}>
          <cylinderGeometry args={[0.18, 0.3, 0.38, 24]} />
          <meshStandardMaterial color={map ? "#ffffff" : tone} map={map ?? undefined} roughness={0.55} metalness={0.08} />
        </mesh>
      </group>
    );
  }
  if (asset === "ring") {
    return (
      <mesh rotation={[Math.PI / 2.5, 0.15, 0]}>
        <torusGeometry args={[0.62, 0.08, 16, 48]} />
        <meshStandardMaterial color={tone} roughness={0.42} metalness={0.35} />
      </mesh>
    );
  }
  if (asset === "portal") {
    return (
      <group position={[0, 1.15, 0]}>
        <mesh>
          <torusGeometry args={[0.95, 0.09, 16, 64]} />
          <meshStandardMaterial color={tone} emissive={tone} emissiveIntensity={0.55} roughness={0.3} metalness={0.4} />
        </mesh>
        <mesh>
          <circleGeometry args={[0.88, 48]} />
          <meshBasicMaterial color={tone} transparent opacity={0.22} depthWrite={false} />
        </mesh>
      </group>
    );
  }
  if (asset === "visitor") {
    return (
      <group position={[0, 0.45, 0]}>
        <mesh>
          <capsuleGeometry args={[0.2, 0.55, 6, 14]} />
          <meshStandardMaterial color={tone} roughness={0.5} metalness={0.2} />
        </mesh>
      </group>
    );
  }
  if (asset === "pillar") {
    return (
      <Solid selected={selected} tone={tone} map={map}>
        <cylinderGeometry args={[0.5, 0.5, 1, 24]} />
      </Solid>
    );
  }
  if (asset === "platform") {
    return (
      <Solid selected={selected} tone={tone} map={map}>
        <boxGeometry args={[1, 1, 1]} />
      </Solid>
    );
  }
  return (
    <Solid selected={selected} tone={tone} map={map}>
      <boxGeometry args={[1, 1, 1]} />
    </Solid>
  );
}

function AvatarMesh({ tone }: { tone: string }) {
  const helm = useForge((s) => Object.values(s.entities).find((entity) => entity.tags.includes("helm")) ?? null);
  const select = useForge((s) => s.select);
  const frame = helm?.customData.color || "#d4a24a";
  return (
    <group>
      <mesh position={[0, 0.05, 0]}>
        <capsuleGeometry args={[0.22, 0.62, 6, 16]} />
        <meshStandardMaterial color={tone} roughness={0.48} metalness={0.34} />
      </mesh>
      <mesh position={[0, 0.62, 0]}>
        <sphereGeometry args={[0.16, 20, 16]} />
        <meshStandardMaterial color={tone} roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.62, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.06, 0.16, 8]} />
        <meshStandardMaterial color="#1c2430" roughness={0.4} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.78, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.28, 0.012, 8, 32]} />
        <meshBasicMaterial color={tone} />
      </mesh>
      {helm ? (
        <group
          position={[0, 0.64, 0.04]}
          onPointerDown={(event) => {
            event.stopPropagation();
            pointerClaim.entity = true;
            select(helm.id);
          }}
        >
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.2, 0.018, 8, 28]} />
            <meshStandardMaterial color={frame} metalness={0.72} roughness={0.28} />
          </mesh>
          <mesh position={[-0.08, 0.02, 0.16]}>
            <boxGeometry args={[0.13, 0.075, 0.018]} />
            <meshStandardMaterial color="#b7f3f4" emissive="#2f8f93" emissiveIntensity={0.45} metalness={0.05} roughness={0.08} transparent opacity={0.72} />
          </mesh>
          <mesh position={[0.08, 0.02, 0.16]}>
            <boxGeometry args={[0.13, 0.075, 0.018]} />
            <meshStandardMaterial color="#b7f3f4" emissive="#2f8f93" emissiveIntensity={0.45} metalness={0.05} roughness={0.08} transparent opacity={0.72} />
          </mesh>
          <mesh position={[0, 0.025, 0.13]}>
            <boxGeometry args={[0.028, 0.018, 0.02]} />
            <meshStandardMaterial color={frame} metalness={0.65} roughness={0.3} />
          </mesh>
        </group>
      ) : null}
    </group>
  );
}

function Body({ entity, selected }: { entity: Entity; selected: boolean }) {
  const tone = entityTone(entity);
  const map = useAlbedo(entity.customData.src);
  const rep = entity.representation;
  const plate =
    map && rep.kind === "hybrid" ? (
      <mesh position={[0.42, 0.7, 0.15]}>
        <planeGeometry args={[0.46, 0.46]} />
        <meshStandardMaterial map={map} roughness={0.5} metalness={0.04} />
      </mesh>
    ) : null;
  const neural =
    entity.customData.neural === "splat" ? (
      <NeuralCloud
        seed={Number(entity.customData.seed) || entity.id}
        count={Math.max(80, Math.min(320, Number(entity.customData.count) || 220))}
        palette={entity.customData.palette || tone}
        shape={entity.customData.shape || "blob"}
      />
    ) : null;
  if (entity.customData.method === "nanite") return <ClusterCut />;
  if (rep.kind === "hybrid") {
    return (
      <>
        <AvatarMesh tone={tone} />
        {plate}
        {neural ?? <SplatCloud seed={entity.id * 17} count={56} color={tone} size={0.028} />}
      </>
    );
  }
  if (rep.kind === "gaussian") {
    if (neural) return neural;
    return (
      <SplatCloud
        seed={entity.id * 13}
        count={Math.min(360, Math.max(40, rep.particleCount))}
        color={tone}
      />
    );
  }
  return (
    <>
      {neural}
      {neural ? null : (
        <AssetMesh asset={rep.assetId} selected={selected} tone={tone} map={map} screen={entity.customData.role === "terminal"} />
      )}
    </>
  );
}

function VelocityMark({ velocity }: { velocity: Vec3 }) {
  const length = Math.hypot(velocity.x, velocity.y, velocity.z);
  const quaternion = useMemo(() => {
    const dir = new Vector3(velocity.x, velocity.y, velocity.z);
    if (dir.lengthSq() < 1e-6) return new Quaternion();
    return new Quaternion().setFromUnitVectors(UP, dir.normalize());
  }, [velocity.x, velocity.y, velocity.z]);
  if (length < 0.08) return null;
  const span = Math.min(1.6, Math.max(0.35, length * 0.45));
  return (
    <mesh position={[velocity.x * 0.12, velocity.y * 0.12, velocity.z * 0.12]} quaternion={quaternion}>
      <cylinderGeometry args={[0.018, 0.018, span, 6]} />
      <meshBasicMaterial color={scenePalette.mark} />
    </mesh>
  );
}

type DragSession = { id: number; y: number; snap: Record<number, Entity> };

function DragSurface({
  drag,
  setDragging,
}: {
  drag: MutableRefObject<DragSession | null>;
  setDragging: (on: boolean) => void;
}) {
  const { camera, gl, controls } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const hit = new Vector3();
    const finish = () => {
      const session = drag.current;
      if (!session) return;
      drag.current = null;
      setDragging(false);
      const orbit = controls as { enabled?: boolean } | null;
      if (orbit) orbit.enabled = true;
      const now = useForge.getState().entities[session.id];
      const before = session.snap[session.id];
      if (!now || !before) return;
      const moved =
        Math.hypot(now.transform.position.x - before.transform.position.x, now.transform.position.z - before.transform.position.z) > 0.05;
      if (!moved) return;
      useForge.setState((state) => {
        const seq = state.logSeq;
        return {
          undo: [...(state.undo ?? []), { entities: session.snap, nextId: state.nextId, skills: state.skills ?? [] }].slice(-16),
          history: [...state.history, { id: seq, tone: "engine" as const, title: "Move", body: `${now.name} repositioned` }].slice(-80),
          logSeq: seq + 1,
        };
      });
    };
    const onMove = (event: PointerEvent) => {
      const session = drag.current;
      if (!session) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -session.y), hit)) return;
      useForge.setState((state) => {
        const current = state.entities[session.id];
        if (!current) return {};
        return {
          entities: {
            ...state.entities,
            [session.id]: {
              ...current,
              transform: { ...current.transform, position: { x: hit.x, y: session.y, z: hit.z } },
            },
          },
        };
      });
    };
    el.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      el.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [camera, gl, controls, drag, setDragging]);
  return null;
}

function EntityNode({
  entity,
  selected,
  drag,
  setDragging,
  gazed,
}: {
  entity: Entity;
  selected: boolean;
  drag: MutableRefObject<DragSession | null>;
  setDragging: (on: boolean) => void;
  gazed: boolean;
}) {
  const ref = useRef<Group>(null);
  const reduce = useReducedMotion();
  const select = useForge((s) => s.select);
  const controls = useThree((state) => state.controls) as { enabled?: boolean } | null;
  const mode = useLook().mode;
  const p = entity.transform.position;
  const s = entity.transform.scale;
  const q = entity.transform.rotation;
  const fixed = entity.tags.includes("floor") || entity.tags.includes("tetris");
  const yaw = Number(entity.customData.yaw) || 0;
  const facing = entity.tags.includes("architect") || entity.tags.includes("agent");
  const half = yaw / 2;
  const quat: [number, number, number, number] = facing ? [0, Math.sin(half), 0, Math.cos(half)] : [q.x, q.y, q.z, q.w];

  useLayoutEffect(() => {
    if (ref.current && !reduce) ref.current.scale.setScalar(0.94);
  }, [reduce, entity.id]);

  useFrame((_, delta) => {
    const group = ref.current;
    if (!group || reduce) return;
    const current = group.scale.x;
    const next = current + (1 - current) * Math.min(1, delta * 8);
    group.scale.setScalar(next);
  });

  if (entity.tags.includes("helm")) return null;
  if (mode === "first" && entity.tags.includes("architect")) return null;

  return (
    <group
      ref={ref}
      position={[p.x, p.y, p.z]}
      userData={{ forgeId: entity.id }}
      onPointerDown={(event) => {
        event.stopPropagation();
        select(entity.id);
        if (mode !== "bench" || fixed) return;
        pointerClaim.entity = true;
        if (controls) controls.enabled = false;
        drag.current = {
          id: entity.id,
          y: useForge.getState().entities[entity.id]?.transform.position.y ?? p.y,
          snap: useForge.getState().entities,
        };
        setDragging(true);
      }}
    >
      <group scale={[s.x, s.y, s.z] as Vector3Tuple} quaternion={quat}>
        <Body entity={entity} selected={selected} />
      </group>
      {entity.physics ? <VelocityMark velocity={entity.physics.velocity} /> : null}
      {(selected || gazed) && !entity.tags.includes("floor") ? (
        <mesh raycast={() => null} scale={[s.x * 1.08, s.y * 1.08, s.z * 1.08]} quaternion={quat}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={gazed && !selected ? "#7ee0c8" : scenePalette.mark} wireframe transparent opacity={0.95} />
        </mesh>
      ) : null}
    </group>
  );
}

function GazeLock() {
  const { camera, scene, gl } = useThree();
  const mode = useLook().mode;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const ray = useRef(new Raycaster());
  const ndc = useRef(new Vector2(0, 0));
  const live = useRef(false);
  useEffect(() => {
    const el = gl.domElement;
    const place = (event: PointerEvent) => {
      if (modeRef.current !== "bench") return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      ndc.current.set(x * 2 - 1, -(y * 2 - 1));
      live.current = true;
      setAimPoint(x * 100, y * 100, true);
    };
    const onLeave = () => {
      live.current = false;
      ndc.current.set(0, 0);
      setAimPoint(50, 50, false);
    };
    el.addEventListener("pointermove", place);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", place);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [gl]);
  useFrame(() => {
    if (mode !== "bench") {
      ndc.current.set(0, 0);
      setAimPoint(50, 50, true);
    } else if (!live.current) {
      setGazeLock(null);
      return;
    }
    ray.current.params.Points.threshold = 0.03;
    ray.current.params.Line.threshold = 0.02;
    ray.current.setFromCamera(ndc.current, camera);
    const hits = ray.current.intersectObjects(scene.children, true);
    let meshId: number | null = null;
    let pointId: number | null = null;
    for (const hit of hits) {
      let node: Object3D | null = hit.object;
      let id: number | null = null;
      while (node) {
        const tagged = node.userData?.forgeId;
        if (typeof tagged === "number") {
          id = tagged;
          break;
        }
        node = node.parent;
      }
      if (id == null) continue;
      const entity = useForge.getState().entities[id];
      if (!entity || entity.tags.includes("floor") || entity.tags.includes("helm") || entity.tags.includes("architect")) continue;
      if ((hit.object as { isPoints?: boolean }).isPoints === true) {
        pointId ??= id;
        continue;
      }
      meshId = id;
      break;
    }
    setGazeLock(meshId ?? pointId);
  }, 1);
  return null;
}

const MESH_PACKS = ["gem", "knot", "vase", "crystal"] as const;

function packPreview(kind: string): string {
  const texture = paintLabTexture(kind);
  const image = texture.image as HTMLCanvasElement | undefined;
  return image?.toDataURL?.() ?? "";
}

function TextureDeck() {
  const gaze = useGazeId();
  const mode = useLook().mode;
  const selectedId = useForge((s) => s.selectedId);
  const [note, setNote] = useState("");
  const previews = useMemo(() => {
    const rows: Record<string, string> = {};
    for (const pack of TEXTURE_PACKS) rows[pack] = packPreview(pack);
    return rows;
  }, []);
  const target = (() => {
    const state = useForge.getState();
    const pick = (id: number | null) => {
      if (id == null) return null;
      const entity = state.entities[id];
      if (!entity || entity.tags.includes("floor") || entity.tags.includes("helm") || entity.tags.includes("architect")) return null;
      return entity;
    };
    return pick(gaze) ?? pick(selectedId);
  })();
  const applyTexture = (pack: TexturePack) => {
    if (!target) {
      setNote("Look at a solid first");
      return;
    }
    setNote(pack);
    useForge.getState().dispatchManual("set_asset", { id: String(target.id), src: `tex:${pack}`, title: pack });
  };
  const applyMesh = (asset: (typeof MESH_PACKS)[number]) => {
    if (!target) {
      useForge.getState().dispatchManual("spawn_entity", { name: asset[0].toUpperCase() + asset.slice(1), asset, x: "2.2", y: "0", z: "1.3" });
      setNote(asset);
      return;
    }
    setNote(asset);
    useForge.getState().dispatchManual("edit_entity", { id: String(target.id), asset });
  };
  return (
    <div className="tex-deck" aria-label="Texture deck">
      <p className="tex-deck-note">{note || (target ? target.name : mode === "bench" ? "Select a solid" : "Look to wrap")}</p>
      {TEXTURE_PACKS.map((pack, index) => {
        const angle = Math.PI + ((index / (TEXTURE_PACKS.length - 1)) - 0.5) * 2.15;
        const radius = 118;
        return (
          <button
            key={pack}
            type="button"
            className="tex-sphere"
            style={{ transform: `translate(${Math.cos(angle) * radius}px, ${Math.sin(angle) * radius}px)` }}
            onClick={() => applyTexture(pack)}
            aria-label={`Wrap ${pack} on ${target?.name ?? "the solid you are looking at"}`}
          >
            <span className="tex-ball" style={{ backgroundImage: previews[pack] ? `url(${previews[pack]})` : undefined }} />
            <span className="tex-name">{pack}</span>
          </button>
        );
      })}
      {MESH_PACKS.map((asset, index) => {
        const angle = Math.PI + ((index / (MESH_PACKS.length - 1)) - 0.5) * 1.15;
        const radius = 58;
        return (
          <button
            key={asset}
            type="button"
            className="tex-sphere is-asset"
            style={{ transform: `translate(${Math.cos(angle) * radius}px, ${Math.sin(angle) * radius}px)` }}
            onClick={() => applyMesh(asset)}
            aria-label={`Use the ${asset} mesh on ${target?.name ?? "a new solid"}`}
          >
            <span className="tex-ball is-asset" />
            <span className="tex-name">{asset}</span>
          </button>
        );
      })}
    </div>
  );
}

function Stage() {
  const entities = useForge((s) => s.entities);
  const selectedId = useForge((s) => s.selectedId);
  const gazeId = useGazeId();
  const mode = useLook().mode;
  const [dragging, setDragging] = useState(false);
  const drag = useRef<DragSession | null>(null);
  const list = Object.values(entities)
    .filter((entity) => !entity.tags.includes("helm"))
    .sort((a, b) => a.id - b.id);

  return (
    <>
      <color attach="background" args={[scenePalette.bg]} />
      <fog attach="fog" args={[scenePalette.fog, 36, 72]} />
      <hemisphereLight args={[scenePalette.key, scenePalette.fill, 0.7]} />
      <ambientLight intensity={0.38} />
      <directionalLight position={[7, 11, 5]} intensity={1.55} color={scenePalette.key} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, 0]}>
        <circleGeometry args={[30, 80]} />
        <meshStandardMaterial color="#1c2128" roughness={1} metalness={0} />
      </mesh>
      <gridHelper args={[40, 40, scenePalette.gridMajor, scenePalette.grid]} position={[0, 0, 0]} />
      <DragSurface drag={drag} setDragging={setDragging} />
      <GazeLock />
      {list.map((entity) => (
        <EntityNode
          key={entity.id}
          entity={entity}
          selected={entity.id === selectedId}
          gazed={entity.id === gazeId && entity.id !== selectedId}
          drag={drag}
          setDragging={setDragging}
        />
      ))}
      <Pilot />
      <OrbitControls
        makeDefault
        enableDamping
        enabled={mode === "bench" && !dragging}
        dampingFactor={0.08}
        target={[0.2, 0.2, 0.4]}
        maxPolarAngle={1.05}
        minPolarAngle={0.2}
        minDistance={8}
        maxDistance={32}
      />
    </>
  );
}

function HoldKey({ code, label }: { code: string; label: string }) {
  return (
    <button
      type="button"
      className="visor-key"
      onPointerDown={(event) => {
        event.preventDefault();
        pilotKeys.add(code);
      }}
      onPointerUp={() => pilotKeys.delete(code)}
      onPointerLeave={() => pilotKeys.delete(code)}
      onPointerCancel={() => pilotKeys.delete(code)}
    >
      {label}
    </button>
  );
}

function Steer() {
  const mode = useLook().mode;
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  if (mode === "bench") return null;
  const home = () => {
    faceLook(0, mode === "first" ? -0.08 : -0.16);
    useForge.setState((state) => restoreLab(state));
  };
  return (
    <div className="steer">
      <div className="dpad" aria-label="Move">
        <p>Move</p>
        <HoldKey code="KeyW" label="Forward" />
        <div className="dpad-row">
          <HoldKey code="KeyA" label={mode === "first" ? "Left" : "Turn L"} />
          <HoldKey code="KeyS" label="Back" />
          <HoldKey code="KeyD" label={mode === "first" ? "Right" : "Turn R"} />
        </div>
      </div>
      <button type="button" className="steer-home" onClick={home}>
        Find room
      </button>
      <div
        className="look-pad"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.id !== event.pointerId) return;
          shiftLook(event.clientX - current.x, event.clientY - current.y);
          current.x = event.clientX;
          current.y = event.clientY;
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <strong>Look</strong>
        <span>drag here</span>
      </div>
    </div>
  );
}

function ModeBar() {
  const { mode, setMode, immersive, setImmersive } = useLook();
  return (
    <div className="mode-bar" role="toolbar" aria-label="View">
      <button type="button" className={mode === "third" ? "is-on" : ""} onClick={() => setMode("third")}>
        3rd
      </button>
      <button type="button" className={mode === "first" ? "is-on" : ""} onClick={() => setMode("first")}>
        Helm
      </button>
      <button type="button" className={mode === "bench" ? "is-on" : ""} onClick={() => setMode("bench")}>
        Bench
      </button>
      <button type="button" className={immersive ? "is-on" : ""} onClick={() => setImmersive(!immersive)}>
        {immersive ? "Window" : "Fill"}
      </button>
    </div>
  );
}

function Visor() {
  const { mode, immersive } = useLook();
  const gaze = useGazeId();
  const looked = useForge((s) => (gaze == null ? null : (s.entities[gaze] ?? null)));
  const last = useForge((s) => s.history[s.history.length - 1]);
  const busy = useForge((s) => s.busy);
  const [line, setLine] = useState("");
  if (mode === "bench") return null;
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const intent = line.trim();
    if (!intent) return;
    setLine("");
    void useForge.getState().submitIntent(intent);
  };
  return (
    <div className={mode === "first" ? "visor is-first" : "visor"}>
      <div className="visor-frame" />
      <div className="visor-cross" aria-hidden="true" />
      <p className="visor-read">
        {looked ? `Looking at ${looked.name}` : "Looking at the lab"}
        {last ? ` · ${last.title}: ${last.body.replace(/\s+/g, " ").slice(0, 72)}` : ""}
      </p>
      <p className="visor-hint">Drag the view or the Look pad. Move walks the body. Find room puts the exhibits in front of you.</p>
      {immersive ? (
        <form className="visor-ask" onSubmit={onSubmit}>
          <label>
            <span>Helm</span>
            <input
              value={line}
              onChange={(event) => setLine(event.target.value)}
              placeholder="Tell the helm what to change in the world"
              disabled={busy}
            />
          </label>
        </form>
      ) : null}
    </div>
  );
}

export function Viewport() {
  const hardware = useMemo(() => probeHardware(), []);
  const quality = useMemo(() => qualityFor(hardware), [hardware]);
  // The flat software picture is a debug view for machines with no GPU output.
  // It is off by default because it paints over the real renderer.
  const soft = useMemo(() => softRenderRequested(), []);
  const tick = useForge((s) => s.tick);
  const count = useForge((s) => Object.keys(s.entities).length);
  const { mode } = useLook();
  const gaze = useGazeId();
  const selected = useForge((s) =>
    s.selectedId == null ? null : (s.entities[s.selectedId] ?? null),
  );
  const looked = useForge((s) => (gaze == null ? null : (s.entities[gaze] ?? null)));
  const aim = looked ?? selected;

  return (
    <div className="view">
      <Canvas
        camera={{ position: [10.4, 6.8, 10.2], fov: 42, near: 0.1, far: 80 }}
        dpr={quality.dpr}
        gl={{ antialias: quality.antialias, alpha: false, powerPreference: quality.powerPreference, failIfMajorPerformanceCaveat: false, preserveDrawingBuffer: soft }}
        style={{ width: "100%", height: "100%", touchAction: "none" }}
      >
        <Stage />
      </Canvas>
      {soft ? <RoomPicture /> : null}
      <div className="hud">
        <p className="hud-readout">
          <span>tick {String(tick).padStart(4, "0")}</span>
          <span>
            {count} {count === 1 ? "entity" : "entities"}
          </span>
          <span>{aim ? (aim.tags.includes("architect") ? "Architect · you" : aim.tags.includes("helm") ? "Helm · visor" : mode === "bench" ? aim.name : `looking at ${aim.name}`) : "nothing in the crosshair"}</span>
          <span>g {GRAVITY.toFixed(2)}</span>
        </p>
        <ModeBar />
      </div>
      <Visor />
      <Steer />
      <TextureDeck />
      {mode === "bench" ? <LabConsole /> : null}
    </div>
  );
}
