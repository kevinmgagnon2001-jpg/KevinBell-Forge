/**
 * The 4D bubble, drawn: a regular polytope turning through four dimensions (polytope.ts) inside a
 * thin-film bubble with a haze round it, and the hyper sword, whose blade is a hypercube turning
 * through w with ghost cubes glitching off it. Edges are coloured by depth in w (red, violet, green)
 * and drawn past white, so the bloom on the higher quality rungs makes them glow.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, CanvasTexture, Color, FrontSide, LineBasicMaterial, LineSegments, Points, PointsMaterial, ShaderMaterial, type Group, type Mesh, type MeshBasicMaterial } from "three";
import { hyperColor, project, shapeOf, turnAt, type ShapeName, type Vec4 } from "@/engine/polytope";

const BUBBLE_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const BUBBLE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float rim = pow(1.0 - facing, 2.4);
  // Thin film: the colour turns with the angle and the film's slow swirl.
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (rim * 1.6 + vec3(0.0, 0.33, 0.67)) + uTime * 0.35 + vNormal.y * 2.0);
  float glint = pow(max(dot(reflect(-normalize(vView), normalize(vNormal)), normalize(vec3(0.4, 0.8, 0.3))), 0.0), 60.0);
  vec3 col = film * (0.25 + rim * 1.4) + vec3(glint * 2.5);
  gl_FragColor = vec4(col * uStrength, (rim * 0.7 + 0.05 + glint) * uStrength);
}`;

function hazeTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(200,160,255,0.55)");
    r.addColorStop(0.45, "rgba(255,90,170,0.18)");
    r.addColorStop(0.75, "rgba(90,255,200,0.06)");
    r.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  }
  return new CanvasTexture(c);
}

/** A polytope's edges as glowing lines (and its vertices as sparks), turned every frame. */
function useWireframe(shape: ShapeName | "blade", speed: number, stretch: Vec4 = [1, 1, 1, 1]) {
  const poly = shapeOf(shape === "blade" ? "tesseract" : shape);
  const built = useMemo(() => {
    const geometry = new BufferGeometry();
    const positions = new Float32Array(poly.edges.length * 6);
    const colors = new Float32Array(poly.edges.length * 6);
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    // Many edges over each other add up to white: the denser the shape, the fainter each edge.
    const opacity = poly.edges.length > 1000 ? 0.32 : poly.edges.length > 500 ? 0.45 : 0.95;
    const lines = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    lines.frustumCulled = false;
    const sparkGeo = new BufferGeometry();
    const sparkPos = new Float32Array(poly.vertices.length * 3);
    sparkGeo.setAttribute("position", new BufferAttribute(sparkPos, 3));
    const sparks = new Points(sparkGeo, new PointsMaterial({ color: new Color(1.6, 1.3, 2.2), size: poly.vertices.length > 200 ? 0.018 : 0.045, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    sparks.frustumCulled = false;
    return { lines, sparks, positions, colors, sparkPos, verts: new Float32Array(poly.vertices.length * 3), depth: new Float32Array(poly.vertices.length) };
  }, [poly]);
  useEffect(
    () => () => {
      built.lines.geometry.dispose();
      (built.lines.material as LineBasicMaterial).dispose();
      built.sparks.geometry.dispose();
      (built.sparks.material as PointsMaterial).dispose();
    },
    [built],
  );
  const clock = useRef(Math.random() * 100);
  useFrame((_, delta) => {
    clock.current += Math.min(delta, 0.1);
    const t = clock.current;
    const turn = turnAt(t, speed);
    // The blade turns only in planes that leave its length (y) alone, so it stays a blade.
    if (shape === "blade") {
      turn[0] = 0;
      turn[3] = 0;
      turn[4] = 0;
    }
    project(poly, turn, built.verts, built.depth, 2.6, stretch);
    const { positions, colors, verts, depth } = built;
    // Drawn hotter than white: the bloom on the high rungs turns them into light.
    const hot = poly.edges.length > 500 ? 1.25 : 1.8;
    poly.edges.forEach(([a, b], e) => {
      const o = e * 6;
      positions[o] = verts[a * 3];
      positions[o + 1] = verts[a * 3 + 1];
      positions[o + 2] = verts[a * 3 + 2];
      positions[o + 3] = verts[b * 3];
      positions[o + 4] = verts[b * 3 + 1];
      positions[o + 5] = verts[b * 3 + 2];
      const ca = hyperColor(depth[a], t);
      const cb = hyperColor(depth[b], t);
      colors[o] = ca[0] * hot;
      colors[o + 1] = ca[1] * hot;
      colors[o + 2] = ca[2] * hot;
      colors[o + 3] = cb[0] * hot;
      colors[o + 4] = cb[1] * hot;
      colors[o + 5] = cb[2] * hot;
    });
    built.sparkPos.set(verts);
    built.lines.geometry.attributes.position.needsUpdate = true;
    built.lines.geometry.attributes.color.needsUpdate = true;
    built.sparks.geometry.attributes.position.needsUpdate = true;
  });
  return built;
}

function useBubbleMaterial(strength = 1, inside = false) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: BUBBLE_VERT,
        fragmentShader: BUBBLE_FRAG,
        uniforms: { uTime: { value: 0 }, uStrength: { value: strength } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: inside ? BackSide : FrontSide,
      }),
    [strength, inside],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, delta) => {
    material.uniforms.uTime.value += Math.min(delta, 0.1);
  });
  return material;
}

/** A 4D bubble: the polytope, a thin-film bubble round it, and a haze. Sized to a unit box. */
export function HyperBubble({ shape }: { shape: ShapeName }) {
  const wire = useWireframe(shape, shape === "120-cell" ? 0.8 : 1.2);
  const bubble = useBubbleMaterial(1);
  const inner = useBubbleMaterial(0.35, true);
  const haze = useMemo(hazeTexture, []);
  useEffect(() => () => haze.dispose(), [haze]);
  const spin = useRef<Group>(null);
  useFrame((_, delta) => {
    if (spin.current) spin.current.rotation.y += Math.min(delta, 0.1) * 0.12;
  });
  // The polytope sits on the unit 3-sphere; projected from w = 2.6 it reaches about 1.6 across.
  return (
    <group>
      <group ref={spin} scale={0.27}>
        <primitive object={wire.lines} />
        <primitive object={wire.sparks} />
      </group>
      <mesh material={bubble} raycast={() => null}>
        <sphereGeometry args={[0.5, 48, 32]} />
      </mesh>
      <mesh material={inner} raycast={() => null} scale={0.96}>
        <sphereGeometry args={[0.5, 32, 24]} />
      </mesh>
      <sprite scale={1.7} raycast={() => null}>
        <spriteMaterial map={haze} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </sprite>
    </group>
  );
}

const ECHOES = [
  { color: "#ff5fb4", at: 0.15 },
  { color: "#b77bff", at: 0.32 },
  { color: "#5fd6ff", at: 0.5 },
  { color: "#ff8a5c", at: 0.66 },
  { color: "#9dff8a", at: 0.82 },
];

/**
 * The hyper sword: a grip and a guard, and a blade that is a long thin hypercube turning through w,
 * with ghost cubes slipping off it in the colours of the 4D bubble. Points up its own +y from the grip
 * at the origin; about 1 m long.
 */
export function HyperSword() {
  const wire = useWireframe("blade", 2.2, [0.22, 1, 0.06, 0.22]);
  const echoes = useRef<(Mesh | null)[]>([]);
  const haze = useMemo(hazeTexture, []);
  useEffect(() => () => haze.dispose(), [haze]);
  const clock = useRef(0);
  useFrame((_, delta) => {
    clock.current += Math.min(delta, 0.1);
    const t = clock.current;
    echoes.current.forEach((m, i) => {
      if (!m) return;
      // Each ghost slips sideways and back in its own rhythm, flickering, like a glitch in 4D.
      const phase = t * (2.1 + i * 0.37) + i * 1.7;
      m.position.x = Math.sin(phase) * 0.07 + Math.sin(phase * 3.1) * 0.02;
      m.position.z = Math.cos(phase * 0.8) * 0.05;
      m.rotation.set(phase * 0.6, phase * 0.4, phase * 0.9);
      const mat = m.material as MeshBasicMaterial;
      mat.opacity = 0.18 + 0.22 * Math.max(0, Math.sin(phase * 2.3));
    });
  });
  return (
    <group>
      {/* Grip and guard. */}
      <mesh position={[0, -0.06, 0]} castShadow>
        <cylinderGeometry args={[0.022, 0.026, 0.2, 10]} />
        <meshStandardMaterial color="#2b1a3a" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, -0.17, 0]}>
        <sphereGeometry args={[0.035, 12, 10]} />
        <meshStandardMaterial color="#b77bff" emissive="#7a3cff" emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.05, 0]} castShadow>
        <boxGeometry args={[0.22, 0.035, 0.05]} />
        <meshStandardMaterial color="#3a2450" roughness={0.35} metalness={0.7} />
      </mesh>
      {/* The blade: a hypercube about 0.85 m long, turning through w. */}
      <group position={[0, 0.5, 0]} scale={0.84}>
        <primitive object={wire.lines} />
        <primitive object={wire.sparks} />
      </group>
      {/* A light core down the blade. */}
      <mesh position={[0, 0.5, 0]} raycast={() => null}>
        <boxGeometry args={[0.025, 0.8, 0.008]} />
        <meshBasicMaterial color={new Color(2.2, 0.9, 2.6)} transparent opacity={0.85} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      {ECHOES.map((e, i) => (
        <mesh
          key={e.color}
          ref={(m) => {
            echoes.current[i] = m;
          }}
          position={[0, 0.12 + e.at * 0.78, 0]}
          raycast={() => null}
        >
          <boxGeometry args={[0.1, 0.1, 0.1]} />
          <meshBasicMaterial color={e.color} transparent opacity={0.3} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      <sprite position={[0, 0.5, 0]} scale={[0.5, 1.2, 1]} raycast={() => null}>
        <spriteMaterial map={haze} transparent opacity={0.6} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </sprite>
    </group>
  );
}
