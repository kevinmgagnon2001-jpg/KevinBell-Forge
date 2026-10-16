import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject, type ReactNode } from "react";
import type { Group, Vector3Tuple } from "three";
import { AdditiveBlending, BoxGeometry, DoubleSide, EdgesGeometry, Matrix4, Object3D, Plane, Quaternion, Raycaster, Vector2, Vector3, type Texture } from "three";
import type { Mesh, MeshStandardMaterial } from "three";
import { clusterDag, selectCut } from "@/engine/cluster-lod";
import type { Entity, Vec3 } from "@/engine/types";
import { localTexture, TEXTURE_PACKS, type TexturePack } from "@/engine/asset-url";
import { packPreview, surfaceFor, type Surface } from "./surfaces";
import { loadAlbedo } from "@/engine/albedo";
import { GRAVITY, restoreLab } from "@/engine/manifold";
import { useForge } from "@/engine/store";
import { carryOf, SCREEN_TAG } from "@/engine/device-apps";
import { scenePalette } from "./palette";
import { Pilot } from "./pilot";
import { RoomPicture } from "./picture";
import { probeHardware, qualityFor, sceneryRequested, softRenderRequested, type SceneryLevel } from "@/engine/hardware";
import { FlatStage, Scenery } from "./Scenery";
import { PerfOverlay, PerfProbe, startQuality, togglePerf, usePerf } from "./PerfOverlay";
import { LADDER, startRung } from "@/engine/perf";
import { faceLook, lookStick, pilotKeys, pilotStick, pointerClaim, setAimPoint, setGazeLock, useGazeId, useLook } from "./look";
import { DeviceButton } from "./DeviceScreen";
import { nativeTv, useTvPicture, useTvView, watchBig } from "./TvRemote";
import { TV_SCREEN, TV_TAG } from "@/engine/tv";
import { GAUGE_TAG } from "@/engine/gauges";
import { GaugeMesh } from "./Gauges";
import { AvatarFigure } from "./Avatar";
import { Arcade } from "./Arcade";
import { MovesButton, MovesOverlay } from "./Moves";
import { HelmAsk } from "./HelmAsk";
import { toggleFlight, townBodies, useArcadePlaying, useFlight } from "./body-state";
import { stepBodies } from "@/engine/physics";
import { rotationLabel, setRotation, useRotation } from "./rotation";
import { nextRotation } from "@/engine/view";
import { addGlint, glintsAllowed, setGlintsAllowed } from "./glint";
import { SoundStage } from "./SoundStage";
import { PostFX } from "./PostFX";
import { HyperBubble } from "./Hyper";
import { Ropes } from "./Rope";
import { ROPE_TAG } from "@/engine/rope";
import type { ShapeName } from "@/engine/polytope";
import { Activity, ArrowBigUp, Eye, House, LayoutGrid, Maximize2, Minimize2, Move, PersonStanding, PlaneLanding, RotateCw, ScanEye, Wind } from "lucide-react";
import type { Post } from "@/engine/perf";
import { Town } from "./Town";
import { NPC_TAG } from "@/engine/town";

const UP = new Vector3(0, 1, 0);

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

/** A lab texture pack wrapped on this body (surfaces.ts), for the solids inside it. */
const SurfaceContext = createContext<Surface | null>(null);
/** Sparkle on this body's surfaces (customData.finish "glint"; glint.ts). */
const GlintContext = createContext(false);

/** A ref for a body's material that gives it flakes when the body asks for them. */
function useGlintRef(on: boolean) {
  return useMemo(() => (material: MeshStandardMaterial | null) => {
    if (material && on) addGlint(material, 1.2, 70);
  }, [on]);
}

function Solid({
  children,
  selected,
  tone,
  map,
  polished = false,
}: {
  children: ReactNode;
  selected: boolean;
  tone: string;
  map?: Texture | null;
  /** Floors: polished stone that mirrors the sky. */
  polished?: boolean;
}) {
  const surface = useContext(SurfaceContext);
  const glint = useContext(GlintContext) && glintsAllowed();
  const glintRef = useGlintRef(glint);
  if (surface) {
    // A new material per surface: maps appearing or going need the shader rebuilt.
    return (
      <mesh>
        {children}
        <meshStandardMaterial
          ref={glintRef}
          key={`${surface.key}${glint ? "-glint" : ""}`}
          color="#ffffff"
          map={surface.map}
          normalMap={surface.normalMap}
          normalScale={[surface.normalScale, surface.normalScale]}
          roughnessMap={surface.roughnessMap}
          roughness={surface.roughness}
          metalness={surface.metalness}
          emissiveMap={surface.emissiveMap}
          emissive={selected ? tone : (surface.emissive ?? "#000000")}
          emissiveIntensity={selected ? 0.45 : (surface.emissiveIntensity ?? 0)}
        />
      </mesh>
    );
  }
  return (
    <mesh>
      {children}
      <meshStandardMaterial
        ref={glintRef}
        key={`${map ? "mapped" : "plain"}${glint ? "-glint" : ""}`}
        color={map ? "#ffffff" : tone}
        map={map ?? undefined}
        roughness={polished ? 0.2 : 0.62}
        metalness={polished ? 0.12 : 0.28}
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
      // Lab packs are full surfaces (surfaces.ts), set up in Body.
      setMap(null);
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
  const play = (kind: "tetris" | "marble" | "blocks") => {
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
        <button type="button" onClick={() => act("build_play", { kind: "blocks" })}>
          Blocks
        </button>
        <button type="button" onClick={() => act("build_play", { kind: "breakout" })}>
          Breakout
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

// Box outline for the selected or gazed body: the 12 edges only, so flat panels show no diagonal seams.
const OUTLINE_EDGES = new EdgesGeometry(new BoxGeometry(1, 1, 1));

function entityTone(entity: Entity): string {
  return entity.customData.color || scenePalette.steel[entity.id % scenePalette.steel.length] || scenePalette.steel[0];
}

function AssetMesh({
  asset,
  selected,
  tone,
  map,
  screen,
  floor,
}: {
  asset: string;
  selected: boolean;
  tone: string;
  map?: Texture | null;
  screen?: boolean;
  floor?: boolean;
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
      <Solid selected={selected} tone={tone} map={map} polished={floor}>
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

/** The screen of this phone or computer (device-apps.ts): a lit face with a few app tiles, facing +z. */
/**
 * Your phone (or computer) as a thing in the world (device-apps.ts). Waiting to be picked up it
 * floats and turns with a soft glow, so you can find it; in your hand it holds still, screen on.
 */
function DeviceMesh({ entity }: { entity: Entity }) {
  const spin = useRef<Group>(null);
  const glow = useRef<MeshStandardMaterial>(null);
  const waiting = carryOf(entity) === "lying" && !entity.customData.flight;
  const reduce = useReducedMotion();
  const phone = entity.customData.kind !== "computer";
  useFrame(({ clock }) => {
    const group = spin.current;
    if (!group) return;
    const t = clock.elapsedTime;
    if (waiting && !reduce) {
      group.rotation.y = t * 1.1;
      group.position.y = Math.sin(t * 2.2) * 0.18;
    } else {
      group.rotation.y = 0;
      group.position.y = 0;
    }
    if (glow.current) glow.current.emissiveIntensity = waiting ? 0.7 + Math.sin(t * 3) * 0.25 : 0.55;
  });
  const cols = phone ? 3 : 4;
  const rows = phone ? 4 : 2;
  const tiles = ["#4c8df5", "#8fbfa8", "#d4a24a", "#d48a86", "#9fd4d6", "#c4a574", "#7ee0c8", "#b49cff", "#ff8a5c", "#ffe066", "#f7a1c4", "#6fa8ff"];
  const sc = entity.transform.scale;
  const ground = entity.transform.position.y - 0.02;
  return (
    <>
      {waiting ? (
        // A beam and a ring on the ground, so it can be found from across the plaza (or wherever it was
        // dropped). Undo the body's scale, so they are drawn in metres.
        <group scale={[1 / sc.x, 1 / sc.y, 1 / sc.z]}>
          <mesh position={[0, 1.1 - ground * 0.5, 0]} raycast={() => null}>
            <cylinderGeometry args={[0.16, 0.3, 2.2 + ground, 20, 1, true]} />
            <meshBasicMaterial color="#7ee0c8" transparent opacity={0.13} depthWrite={false} side={DoubleSide} blending={AdditiveBlending} />
          </mesh>
          <mesh position={[0, -ground, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
            <ringGeometry args={[0.32, 0.42, 40]} />
            <meshBasicMaterial color="#7ee0c8" transparent opacity={0.75} depthWrite={false} />
          </mesh>
        </group>
      ) : null}
      <group ref={spin}>
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#1b1e24" roughness={0.3} metalness={0.75} />
        </mesh>
        {[0.51, -0.51].map((z) => (
          <mesh key={z} position={[0, 0, z]} rotation={[0, z < 0 ? Math.PI : 0, 0]}>
            <planeGeometry args={[0.88, 0.9]} />
            <meshStandardMaterial ref={z > 0 ? glow : undefined} color="#0c1622" emissive="#2a6fd6" emissiveIntensity={0.55} roughness={0.15} />
          </mesh>
        ))}
        {tiles.slice(0, cols * rows).map((color, i) => {
          const x = (i % cols) - (cols - 1) / 2;
          const y = (rows - 1) / 2 - Math.floor(i / cols);
          return (
            <mesh key={color} position={[x * (0.72 / cols), y * (0.72 / rows) - 0.03, 0.52]}>
              <planeGeometry args={[0.5 / cols, 0.5 / rows]} />
              <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
          );
        })}
        {phone ? (
          <mesh position={[0, 0.46, 0.52]}>
            <planeGeometry args={[0.18, 0.025]} />
            <meshBasicMaterial color="#05070a" />
          </mesh>
        ) : null}
      </group>
    </>
  );
}

/**
 * The TV (tv.ts): a screen on a stand. Switched on, the live channel plays on it: the real player,
 * placed in the world with CSS 3D so it turns and shrinks with the screen. It is only mounted while
 * the TV is on, near enough to see and facing you, and not on the big screen.
 */
const TV_PIXELS = { width: 640, height: 360 };

function TvMesh() {
  const picture = useTvPicture();
  const { big } = useTvView();
  const camera = useThree((s) => s.camera);
  const [inView, setInView] = useState(false);
  const front = useRef(new Vector3());
  const toCamera = useRef(new Vector3());
  const screenRef = useRef<Mesh>(null);
  useFrame(() => {
    const screen = screenRef.current;
    if (!screen || !picture) return;
    screen.getWorldPosition(toCamera.current);
    const distance = toCamera.current.distanceTo(camera.position);
    front.current.set(0, 0, 1).applyQuaternion(screen.getWorldQuaternion(new Quaternion()));
    toCamera.current.subVectors(camera.position, toCamera.current).normalize();
    const visible = distance < 22 && front.current.dot(toCamera.current) > 0.05;
    if (visible !== inView) setInView(visible);
  });
  const W = TV_SCREEN.width;
  const H = TV_SCREEN.height;
  const on = !!picture;
  return (
    <group>
      {[-0.55, 0.55].map((x) => (
        <mesh key={x} position={[x, (TV_SCREEN.y - H / 2) / 2, -0.02]}>
          <cylinderGeometry args={[0.025, 0.035, TV_SCREEN.y - H / 2, 10]} />
          <meshStandardMaterial color="#25282e" roughness={0.4} metalness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, 0.02, -0.02]}>
        <boxGeometry args={[1.3, 0.04, 0.36]} />
        <meshStandardMaterial color="#25282e" roughness={0.4} metalness={0.7} />
      </mesh>
      <mesh position={[0, TV_SCREEN.y, -0.03]}>
        <boxGeometry args={[W + 0.1, H + 0.1, 0.07]} />
        <meshStandardMaterial color="#121418" roughness={0.35} metalness={0.6} />
      </mesh>
      <mesh ref={screenRef} position={[0, TV_SCREEN.y, 0.006]}>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial color={on ? "#0b0d12" : "#050608"} emissive={on ? "#2a3b66" : "#000000"} emissiveIntensity={on ? 0.6 : 0} roughness={0.12} metalness={0.2} />
      </mesh>
      <mesh position={[W / 2 - 0.05, TV_SCREEN.y - H / 2 - 0.035, 0.01]}>
        <circleGeometry args={[0.012, 12]} />
        <meshBasicMaterial color={on ? "#7ee0c8" : "#d4524a"} />
      </mesh>
      {picture && inView && !big && nativeTv() ? (
        // The Android app cannot embed the player in its page; it plays on the big screen instead.
        <Html transform position={[0, TV_SCREEN.y, 0.012]} distanceFactor={(400 * W) / TV_PIXELS.width} zIndexRange={[5, 0]} className="tv-in-world">
          <button type="button" className="tv-card" style={{ width: TV_PIXELS.width, height: TV_PIXELS.height }} onClick={watchBig}>
            <span className="tv-card-live">LIVE</span>
            <strong>{picture.channel.name}</strong>
            <span>▶ Tap to watch</span>
          </button>
        </Html>
      ) : null}
      {picture && inView && !big && !nativeTv() ? (
        <Html transform position={[0, TV_SCREEN.y, 0.012]} distanceFactor={(400 * W) / TV_PIXELS.width} zIndexRange={[5, 0]} className="tv-in-world">
          <iframe
            src={picture.src}
            title={picture.channel.name}
            width={TV_PIXELS.width}
            height={TV_PIXELS.height}
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            style={{ border: 0, display: "block", background: "#000" }}
          />
        </Html>
      ) : null}
    </group>
  );
}

function VehicleMesh({ look, tone, scale }: { look: string; tone: string; scale: Vec3 }) {
  const inv: Vector3Tuple = [1 / (scale.x || 1), 1 / (scale.y || 1), 1 / (scale.z || 1)];
  const paint = <meshStandardMaterial color={tone} roughness={0.42} metalness={0.35} />;
  const dark = <meshStandardMaterial color="#1c2026" roughness={0.6} metalness={0.2} />;
  if (look === "car") {
    return (
      <group scale={inv}>
        <mesh position={[0, 0.32, 0]}>
          <boxGeometry args={[1.1, 0.42, 2.2]} />
          {paint}
        </mesh>
        <mesh position={[0, 0.66, -0.15]}>
          <boxGeometry args={[0.9, 0.34, 1.1]} />
          <meshStandardMaterial color="#b7d7e8" roughness={0.15} metalness={0.1} transparent opacity={0.8} />
        </mesh>
        {[
          [-0.58, 0.72],
          [0.58, 0.72],
          [-0.58, -0.72],
          [0.58, -0.72],
        ].map(([x, z]) => (
          <mesh key={`${x}${z}`} position={[x, 0.2, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.2, 0.2, 0.16, 14]} />
            {dark}
          </mesh>
        ))}
      </group>
    );
  }
  if (look === "plane") {
    return (
      <group scale={inv}>
        <mesh position={[0, 0.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.18, 0.12, 2.4, 12]} />
          {paint}
        </mesh>
        <mesh position={[0, 0.4, 1.25]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.18, 0.3, 12]} />
          {dark}
        </mesh>
        <mesh position={[0, 0.4, 0.15]}>
          <boxGeometry args={[2.8, 0.05, 0.5]} />
          {paint}
        </mesh>
        <mesh position={[0, 0.42, -1.05]}>
          <boxGeometry args={[1, 0.04, 0.3]} />
          {paint}
        </mesh>
        <mesh position={[0, 0.65, -1.05]}>
          <boxGeometry args={[0.04, 0.42, 0.3]} />
          {paint}
        </mesh>
      </group>
    );
  }
  return (
    <group scale={inv}>
      <mesh position={[0, 0.35, 0]}>
        <cylinderGeometry args={[0.7, 0.8, 0.18, 28]} />
        {paint}
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <torusGeometry args={[0.72, 0.04, 8, 32]} />
        <meshBasicMaterial color="#7ee0c8" />
      </mesh>
    </group>
  );
}

function AvatarMesh({ entity, tone }: { entity: Entity; tone: string }) {
  const helm = useForge((s) => Object.values(s.entities).find((e) => e.tags.includes("helm")) ?? null);
  const select = useForge((s) => s.select);
  const frame = helm?.customData.color || "#d4a24a";
  const you = entity.tags.includes("architect");
  // The helm (the visor computer) rides on the architect's head.
  const visor =
    you && helm ? (
      <group
        position={[0, 0.0, 0.03]}
        onPointerDown={(event) => {
          event.stopPropagation();
          pointerClaim.entity = true;
          select(helm.id);
        }}
      >
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.13, 0.014, 8, 28]} />
          <meshStandardMaterial color={frame} metalness={0.72} roughness={0.28} />
        </mesh>
        <mesh position={[-0.048, 0.012, 0.1]}>
          <boxGeometry args={[0.085, 0.05, 0.014]} />
          <meshStandardMaterial color="#b7f3f4" emissive="#2f8f93" emissiveIntensity={0.45} metalness={0.05} roughness={0.08} transparent opacity={0.72} />
        </mesh>
        <mesh position={[0.048, 0.012, 0.1]}>
          <boxGeometry args={[0.085, 0.05, 0.014]} />
          <meshStandardMaterial color="#b7f3f4" emissive="#2f8f93" emissiveIntensity={0.45} metalness={0.05} roughness={0.08} transparent opacity={0.72} />
        </mesh>
        <mesh position={[0, 0.015, 0.098]}>
          <boxGeometry args={[0.02, 0.014, 0.016]} />
          <meshStandardMaterial color={frame} metalness={0.65} roughness={0.3} />
        </mesh>
      </group>
    ) : null;
  return (
    <group>
      <AvatarFigure entity={entity} tone={tone} live={you} head={visor} />
      {/* A faint ring over your own head, so you can pick yourself out from far away. */}
      {you ? (
        <mesh position={[0, 0.98, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.16, 0.008, 6, 32]} />
          <meshBasicMaterial color={tone} transparent opacity={0.7} />
        </mesh>
      ) : null}
    </group>
  );
}

function Body({ entity, selected }: { entity: Entity; selected: boolean }) {
  const surface = useBodySurface(entity);
  if (!surface) return <BodyInner entity={entity} selected={selected} />;
  return (
    <SurfaceContext.Provider value={surface}>
      <BodyInner entity={entity} selected={selected} />
    </SurfaceContext.Provider>
  );
}

/** The lab pack wrapped on a body, tiled to its size; null for anything else. */
function useBodySurface(entity: Entity): Surface | null {
  const pack = localTexture(entity.customData.src ?? "");
  const { x, y, z } = entity.transform.scale;
  return useMemo(() => (pack ? surfaceFor(pack, { x, y, z }) : null), [pack, x, y, z]);
}

function BodyInner({ entity, selected }: { entity: Entity; selected: boolean }) {
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
  // Ropes are drawn in world space by <Ropes>; the entity is only their handle.
  if (entity.tags.includes(ROPE_TAG)) return null;
  if (entity.customData.hyper) return <HyperBubble shape={entity.customData.hyper as ShapeName} />;
  if (entity.tags.includes(SCREEN_TAG)) return <DeviceMesh entity={entity} />;
  if (entity.tags.includes(TV_TAG)) return <TvMesh />;
  if (entity.tags.includes(GAUGE_TAG)) return <GaugeMesh entity={entity} />;
  const look = entity.customData.look;
  if (look === "car" || look === "plane" || look === "hover") return <VehicleMesh look={look} tone={tone} scale={entity.transform.scale} />;
  if (rep.kind === "hybrid") {
    return (
      <>
        <AvatarMesh entity={entity} tone={tone} />
        {plate}
        {neural ?? (entity.tags.includes(NPC_TAG) ? null : <SplatCloud seed={entity.id * 17} count={56} color={tone} size={0.028} />)}
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
        <GlintContext.Provider value={entity.customData.finish === "glint"}>
          <AssetMesh asset={rep.assetId} selected={selected} tone={tone} map={map} screen={entity.customData.role === "terminal"} floor={entity.tags.includes("floor")} />
        </GlintContext.Provider>
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
  // While playing a game the camera is behind you, so you step out of the picture.
  const playing = useArcadePlaying();
  const p = entity.transform.position;
  const s = entity.transform.scale;
  const q = entity.transform.rotation;
  const fixed = entity.tags.includes("floor") || entity.tags.includes("tetris");
  const yaw = Number(entity.customData.yaw) || 0;
  const facing = entity.tags.includes("architect") || entity.tags.includes("agent") || entity.tags.includes("presence") || entity.tags.includes("device-screen") || entity.tags.includes(TV_TAG) || entity.tags.includes(GAUGE_TAG);
  const half = yaw / 2;
  const quat: [number, number, number, number] = facing ? [0, Math.sin(half), 0, Math.cos(half)] : [q.x, q.y, q.z, q.w];

  useLayoutEffect(() => {
    if (ref.current && !reduce) ref.current.scale.setScalar(0.94);
  }, [reduce, entity.id]);

  const turn = useRef<Group>(null);
  const npc = entity.tags.includes(NPC_TAG);
  useFrame((_, delta) => {
    const group = ref.current;
    // Townsfolk move between commits: follow the live town (Town.tsx).
    const live = npc ? townBodies[entity.id] : undefined;
    if (group && live) {
      group.position.x = live.x;
      group.position.z = live.z;
      turn.current?.quaternion.set(0, Math.sin(live.yaw / 2), 0, Math.cos(live.yaw / 2));
    }
    if (!group || reduce) return;
    const current = group.scale.x;
    const next = current + (1 - current) * Math.min(1, delta * 8);
    group.scale.setScalar(next);
  });

  if (entity.tags.includes("helm")) return null;
  if ((mode === "first" || playing) && entity.tags.includes("architect")) return null;
  // A phone in your pocket is out of sight.
  if (entity.tags.includes(SCREEN_TAG) && carryOf(entity) === "pocket") return null;

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
      <group ref={turn} scale={[s.x, s.y, s.z] as Vector3Tuple} quaternion={quat}>
        <Body entity={entity} selected={selected} />
      </group>
      {entity.physics ? <VelocityMark velocity={entity.physics.velocity} /> : null}
      {(selected || gazed) && !entity.tags.includes("floor") ? (
        <lineSegments raycast={() => null} geometry={OUTLINE_EDGES} dispose={null} scale={[s.x * 1.08, s.y * 1.08, s.z * 1.08]} quaternion={quat}>
          <lineBasicMaterial color={gazed && !selected ? "#7ee0c8" : scenePalette.mark} transparent opacity={0.95} />
        </lineSegments>
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
    // Walking about, only what is within arm's reach (past the camera's own distance) counts as looked at.
    if (mode === "bench") ray.current.far = Infinity;
    else {
      const me = Object.values(useForge.getState().entities).find((e) => e.tags.includes("architect"));
      const p = me?.transform.position;
      ray.current.far = (p ? camera.position.distanceTo(new Vector3(p.x, p.y, p.z)) : 0) + 2.2;
    }
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
      // The phone in your hand is not something you are looking at.
      if (entity.tags.includes(SCREEN_TAG) && carryOf(entity) !== "lying") continue;
      if ((hit.object as { isPoints?: boolean }).isPoints === true) {
        pointId ??= id;
        continue;
      }
      meshId = id;
      break;
    }
    setGazeLock(meshId ?? pointId);
    // Default priority on purpose: any positive priority tells react-three-fiber that this hook
    // renders the frame itself, which switched off automatic rendering and left the view blank.
  });
  return null;
}

const MESH_PACKS = ["gem", "knot", "vase", "crystal"] as const;


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

function Stage({ scenery, shadows, post }: { scenery: SceneryLevel | "off"; shadows: boolean; post: Post }) {
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
      {scenery === "off" ? (
        <>
          <FlatStage />
          <gridHelper args={[40, 40, scenePalette.gridMajor, scenePalette.grid]} position={[0, 0, 0]} />
        </>
      ) : (
        <>
          <Scenery level={scenery} shadows={shadows} eleven={post === "eleven"} />
          {/* The building grid, faint over the plaza's 1 m tiles. */}
          <gridHelper args={[30, 30, "#3d3a35", "#4d4943"]} position={[0, 0.004, 0]} material-transparent material-opacity={0.32} material-depthWrite={false} />
        </>
      )}
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
      <Settle paused={dragging} />
      <SoundStage />
      <Town />
      <Ropes />
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

/**
 * Loose objects keep moving on their own: they fall, slide, bounce and come to rest, whether or not
 * the world's clock (Run) is going. Asleep, they cost nothing (physics.ts returns the same world).
 * With Run on, the world's own steps do this instead.
 */
function Settle({ paused }: { paused: boolean }) {
  useFrame((_, delta) => {
    if (paused) return;
    const state = useForge.getState();
    if (state.running) return;
    const dt = Math.min(delta, 1 / 30);
    const next = stepBodies(state.entities, dt, state.gravity);
    if (next !== state.entities) useForge.setState({ entities: next });
  });
  return null;
}

function HoldKey({ code, label, icon }: { code: string; label: string; icon?: ReactNode }) {
  return (
    <button
      type="button"
      className={icon ? "visor-key bubble-icon" : "visor-key"}
      aria-label={label}
      title={label}
      onPointerDown={(event) => {
        event.preventDefault();
        pilotKeys.add(code);
      }}
      onPointerUp={() => pilotKeys.delete(code)}
      onPointerLeave={() => pilotKeys.delete(code)}
      onPointerCancel={() => pilotKeys.delete(code)}
      // A long press is "keep walking", not "select this text" or "open a menu".
      onContextMenu={(event) => event.preventDefault()}
    >
      {icon ?? label}
    </button>
  );
}

/**
 * A thumbstick. The left one walks: further is faster, sideways turns (third person) or strafes
 * (helm). The right one looks: hold it off centre and the view keeps turning. Both spring back when
 * you let go. Dragging the view itself stays, for fine aim.
 */
function Stick({ target, label, side }: { target: { x: number; y: number }; label: string; side: "move" | "look" }) {
  const base = useRef<HTMLDivElement>(null);
  const finger = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const release = () => {
    finger.current = null;
    target.x = 0;
    target.y = 0;
    setKnob({ x: 0, y: 0 });
  };
  useEffect(() => release, []);
  const follow = (clientX: number, clientY: number) => {
    const rect = base.current?.getBoundingClientRect();
    if (!rect) return;
    const reach = rect.width * 0.36;
    let dx = clientX - (rect.left + rect.width / 2);
    let dy = clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(dx, dy);
    if (length > reach) {
      dx = (dx / length) * reach;
      dy = (dy / length) * reach;
    }
    setKnob({ x: dx, y: dy });
    const nx = dx / reach;
    const ny = -dy / reach;
    // A small dead zone, so resting a thumb on it does not creep.
    const strength = Math.hypot(nx, ny);
    const k = strength < 0.12 ? 0 : (strength - 0.12) / 0.88 / strength;
    target.x = nx * k;
    target.y = ny * k;
  };
  return (
    <div
      ref={base}
      className={`stick is-${side}`}
      role="application"
      aria-label={`${label}: drag the stick`}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        finger.current = event.pointerId;
        follow(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (finger.current === event.pointerId) follow(event.clientX, event.clientY);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="stick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      <span className="stick-label" aria-hidden="true">
        {side === "move" ? <Move /> : <Eye />}
      </span>
    </div>
  );
}

function Steer() {
  const mode = useLook().mode;
  const flying = useFlight();
  const playing = useArcadePlaying();
  // A game being played has its own buttons (Arcade.tsx).
  if (mode === "bench" || playing) return null;
  const home = () => {
    faceLook(0, mode === "first" ? -0.08 : -0.16);
    useForge.setState((state) => restoreLab(state));
  };
  return (
    <div className="steer">
      <div className="pad-left">
        <Stick target={pilotStick} label="Move" side="move" />
        <div className="lift" aria-label={flying ? "Flying" : "Jump and fly"}>
          {/* Flying steers by looking (climb and dive with the view), so it needs no up and down. */}
          {flying ? null : <HoldKey code="Space" label="Jump" icon={<ArrowBigUp aria-hidden="true" />} />}
          <button type="button" className={`visor-key bubble-icon ${flying ? "is-on" : ""}`} aria-pressed={flying} aria-label={flying ? "Land" : "Fly"} title={flying ? "Land (F)" : "Fly (F): steer by looking, W boosts, S hovers"} onClick={toggleFlight}>
            {flying ? <PlaneLanding aria-hidden="true" /> : <Wind aria-hidden="true" />}
          </button>
        </div>
      </div>
      <div className="steer-actions">
        <DeviceButton className="steer-home bubble-icon" />
        <button type="button" className="steer-home bubble-icon" aria-label="Find room" title="Back to the room" onClick={home}>
          <House aria-hidden="true" />
        </button>
      </div>
      <Stick target={lookStick} label="Look" side="look" />
    </div>
  );
}

function ModeBar() {
  const { mode, setMode, immersive, setImmersive } = useLook();
  const perfOpen = usePerf().open;
  const rotation = useRotation();
  return (
    <div className="mode-bar" role="toolbar" aria-label="View">
      <button type="button" className={`bubble-icon ${mode === "third" ? "is-on" : ""}`} aria-label="Third person" title="Third person" onClick={() => setMode("third")}>
        <PersonStanding aria-hidden="true" />
      </button>
      <button type="button" className={`bubble-icon ${mode === "first" ? "is-on" : ""}`} aria-label="Helm" title="Helm: first person" onClick={() => setMode("first")}>
        <ScanEye aria-hidden="true" />
      </button>
      <button type="button" className={`bubble-icon ${mode === "bench" ? "is-on" : ""}`} aria-label="Bench" title="Bench: the whole lab from above" onClick={() => setMode("bench")}>
        <LayoutGrid aria-hidden="true" />
      </button>
      <button type="button" className={`bubble-icon ${immersive ? "is-on" : ""}`} aria-label={immersive ? "Window" : "Fill"} title={immersive ? "Back to the window" : "Fill the screen"} onClick={() => setImmersive(!immersive)}>
        {immersive ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
      </button>
      <button type="button" className={`bubble-icon ${rotation !== "system" ? "is-on" : ""}`} onClick={() => setRotation(nextRotation(rotation))} aria-label={`Screen rotation: ${rotationLabel(rotation)}`} title={`Screen rotation: ${rotationLabel(rotation)}`}>
        <RotateCw aria-hidden="true" />
      </button>
      <MovesButton />
      <button type="button" className={`bubble-icon ${perfOpen ? "is-on" : ""}`} onClick={togglePerf} aria-label="Performance" title="Stats and quality">
        <Activity aria-hidden="true" />
      </button>
    </div>
  );
}

function Visor() {
  const { mode, immersive } = useLook();
  const gaze = useGazeId();
  const looked = useForge((s) => (gaze == null ? null : (s.entities[gaze] ?? null)));
  const last = useForge((s) => s.history[s.history.length - 1]);
  if (mode === "bench") return null;
  return (
    <div className={mode === "first" ? "visor is-first" : "visor"}>
      <div className="visor-frame" />
      <div className="visor-cross" aria-hidden="true" />
      <p className="visor-read">
        {looked ? `Looking at ${looked.name}` : "Looking at the lab"}
        {last ? ` · ${last.title}: ${last.body.replace(/\s+/g, " ").slice(0, 72)}` : ""}
      </p>
      <p className="visor-hint">The stick walks where you push it: a little walks, all the way runs. WASD jogs, Shift runs, Q/E dash, Space jumps. F flies: look to steer, W boosts, S hovers.</p>
      {immersive ? <HelmAsk /> : null}
    </div>
  );
}

export function Viewport() {
  const hardware = useMemo(() => probeHardware(), []);
  const quality = useMemo(() => qualityFor(hardware), [hardware]);
  // The quality rung: where the hardware starts, then auto quality (PerfOverlay.tsx) moves it.
  // ?scenery=... fixes it.
  const begin = useMemo(() => {
    const asked = sceneryRequested();
    return asked ? { start: Math.max(0, LADDER.findIndex((r) => r.scenery === asked)), forced: true } : { start: startRung(quality), forced: false };
  }, [quality]);
  useMemo(() => startQuality(begin.start, begin.forced), [begin]);
  const perfState = usePerf();
  const rung = LADDER[perfState.start === null ? begin.start : perfState.rung];
  const scenery = rung.scenery;
  const shadows = rung.shadows && scenery !== "off" && scenery !== "min";
  setGlintsAllowed(scenery !== "off" && scenery !== "min");
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
  const playing = useArcadePlaying();

  return (
    <div className={playing ? "view is-playing" : "view"}>
      <Canvas
        camera={{ position: [10.4, 6.8, 10.2], fov: 42, near: 0.1, far: scenery === "off" ? 80 : 900 }}
        shadows={shadows}
        dpr={[1, rung.dpr]}
        gl={{ antialias: quality.antialias, alpha: false, powerPreference: quality.powerPreference, failIfMajorPerformanceCaveat: false, preserveDrawingBuffer: soft }}
        style={{ width: "100%", height: "100%", touchAction: "none" }}
      >
        <Stage scenery={scenery} shadows={shadows} post={scenery === "off" ? "none" : rung.post} />
        <PostFX post={scenery === "off" ? "none" : rung.post} />
        <PerfProbe />
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
        {/* The TV remote docks here (TvRemote.tsx) so it never covers the TV. */}
        <div className="tv-slot" />
      </div>
      <Visor />
      <Steer />
      <Arcade />
      <TextureDeck />
      <PerfOverlay />
      <MovesOverlay />
      {mode === "bench" ? <LabConsole /> : null}
    </div>
  );
}
