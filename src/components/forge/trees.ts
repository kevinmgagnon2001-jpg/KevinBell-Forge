/**
 * Trees made like a game studio makes them, for the best scenery rung: a real trunk and boughs,
 * and a crown of leaf cards (alpha-cut textures painted here on canvas) whose normals point out from
 * the crown's centre, so the canopy shades as one soft volume with ragged, see-through edges
 * instead of a faceted blob. Pines are tiers of drooping needle sprays round a tapering trunk.
 * Trunks wear the scanned pine bark. Everything is instanced: two draws per kind of tree.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { seeded, type Spot } from "@/engine/terrain";
import { addDetail } from "./detail";

function canvas(size: number, paint: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const el = document.createElement("canvas");
  el.width = el.height = size;
  const ctx = el.getContext("2d")!;
  paint(ctx);
  const tex = new CanvasTexture(el);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A cluster of broad leaves, each with a lit side, a shaded side and a midrib. */
function leafClusterTexture(): CanvasTexture {
  return canvas(256, (ctx) => {
    const rand = seeded(71);
    for (let i = 0; i < 70; i += 1) {
      const r = Math.sqrt(rand()) * 100;
      const a = rand() * Math.PI * 2;
      const x = 128 + Math.cos(a) * r;
      const y = 128 + Math.sin(a) * r * 0.85;
      const len = 16 + rand() * 14;
      const rot = a + (rand() - 0.5) * 1.2;
      const g = 0.75 + rand() * 0.5;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      const grad = ctx.createLinearGradient(0, -len * 0.4, 0, len * 0.4);
      grad.addColorStop(0, `rgb(${Math.round(120 * g)}, ${Math.round(170 * g)}, ${Math.round(70 * g)})`);
      grad.addColorStop(1, `rgb(${Math.round(55 * g)}, ${Math.round(95 * g)}, ${Math.round(38 * g)})`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.quadraticCurveTo(0, -len * 0.42, len, 0);
      ctx.quadraticCurveTo(0, len * 0.42, -len, 0);
      ctx.fill();
      ctx.strokeStyle = "rgba(220, 240, 170, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-len * 0.9, 0);
      ctx.lineTo(len * 0.9, 0);
      ctx.stroke();
      ctx.restore();
    }
    // Twigs through the cluster.
    ctx.strokeStyle = "rgba(70, 50, 34, 0.9)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i += 1) {
      const a = rand() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(128, 128);
      ctx.lineTo(128 + Math.cos(a) * 80, 128 + Math.sin(a) * 70);
      ctx.stroke();
    }
  });
}

/** A spray of needles along a twig, drooping, darker underneath. */
function needleSprayTexture(): CanvasTexture {
  return canvas(256, (ctx) => {
    const rand = seeded(83);
    ctx.lineCap = "round";
    for (let side = 0; side < 4; side += 1) {
      const y0 = 128 + (side - 1.5) * 40;
      ctx.strokeStyle = "rgb(74, 52, 36)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(10, y0);
      ctx.quadraticCurveTo(128, y0 - 14, 246, y0 + 8);
      ctx.stroke();
      for (let i = 0; i < 260; i += 1) {
        const t = rand();
        const x = 10 + t * 236;
        const y = y0 - 14 * 4 * t * (1 - t) + 8 * t;
        const up = rand() > 0.5 ? -1 : 1;
        const len = 14 + rand() * 22 * (1 - t * 0.45);
        const g = 0.7 + rand() * 0.5;
        ctx.strokeStyle = `rgb(${Math.round(42 * g)}, ${Math.round(88 * g)}, ${Math.round(52 * g)})`;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len * 0.55, y + up * len);
        ctx.stroke();
      }
    }
  });
}

/** Normals that point from `center` (scaled by `squash`), so cards shade like one round crown. */
function crownNormals(g: BufferGeometry, center: Vector3, squash: Vector3) {
  const pos = g.attributes.position as BufferAttribute;
  const n = new Float32Array(pos.count * 3);
  const v = new Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(center).divide(squash).normalize();
    n.set([v.x, v.y, v.z], i * 3);
  }
  g.setAttribute("normal", new BufferAttribute(n, 3));
}

/** A card: a unit quad turned to `dir`, at `at`, `size` across. */
function card(at: Vector3, dir: Vector3, size: number, spin: number): BufferGeometry {
  const g = new PlaneGeometry(size, size);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), dir.clone().normalize());
  const m = new Matrix4().makeRotationZ(spin).premultiply(new Matrix4().makeRotationFromQuaternion(q));
  m.setPosition(at);
  g.applyMatrix4(m);
  return g;
}

function broadleafCrown(): BufferGeometry {
  const rand = seeded(5);
  const cards: BufferGeometry[] = [];
  const center = new Vector3(0, 3.0, 0);
  const radii = new Vector3(1.6, 1.35, 1.6);
  for (let i = 0; i < 46; i += 1) {
    // Mostly in the outer shell, where leaves catch light.
    const dir = new Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
    const r = 0.55 + Math.sqrt(rand()) * 0.5;
    const at = center.clone().add(dir.clone().multiply(radii).multiplyScalar(r));
    const face = dir.clone().add(new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.9));
    cards.push(card(at, face, 1.25 + rand() * 0.6, rand() * Math.PI * 2));
  }
  const crown = mergeGeometries(cards)!;
  crownNormals(crown, center.clone().setY(2.6), radii);
  return crown;
}

function pineCrown(): BufferGeometry {
  const rand = seeded(9);
  const cards: BufferGeometry[] = [];
  const tiers = 10;
  for (let t = 0; t < tiers; t += 1) {
    const h = 0.9 + t * 0.4;
    const reach = 1.8 * (1 - t / (tiers + 1.0)) + 0.2;
    const around = 8 - Math.floor(t / 3);
    for (let k = 0; k < around; k += 1) {
      const a = (k / around) * Math.PI * 2 + t * 0.6 + rand() * 0.3;
      // A bough: a card from the trunk outward, drooping, facing mostly up.
      const g = new PlaneGeometry(reach * 1.5, reach * 1.05);
      g.rotateX(-Math.PI / 2 + 0.6);
      g.translate(reach * 0.55, 0, 0);
      g.rotateZ(-0.32 - rand() * 0.12);
      g.rotateY(-a);
      g.translate(0, h, 0);
      cards.push(g);
    }
  }
  const tip = new PlaneGeometry(0.5, 0.9);
  tip.translate(0, 0.9 + tiers * 0.4 + 0.2, 0);
  cards.push(tip, tip.clone().rotateY(Math.PI / 2));
  const crown = mergeGeometries(cards)!;
  crownNormals(crown, new Vector3(0, 2.2, 0), new Vector3(1.2, 2.4, 1.2));
  return crown;
}

function trunk(height: number, r0: number, r1: number, boughs: number, seed: number): BufferGeometry {
  const rand = seeded(seed);
  const parts: BufferGeometry[] = [new CylinderGeometry(r1, r0, height, 9, 4).translate(0, height / 2, 0)];
  for (let i = 0; i < boughs; i += 1) {
    const len = 0.9 + rand() * 0.6;
    const b = new CylinderGeometry(r1 * 0.35, r1 * 0.6, len, 6).translate(0, len / 2, 0);
    b.rotateZ(0.7 + rand() * 0.4);
    b.rotateY(rand() * Math.PI * 2);
    b.translate(0, height * (0.55 + rand() * 0.35), 0);
    parts.push(b);
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

function place(mesh: InstancedMesh, spots: Spot[], shape: (spot: Spot, o: Object3D, c: Color) => void, shadows: boolean): InstancedMesh {
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
  mesh.count = spots.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  mesh.computeBoundingSphere();
  return mesh;
}

export type TreeKit = { pines: InstancedMesh[]; leafy: InstancedMesh[]; materials: Material[] };

/** The full-quality woods: card crowns and scanned bark, swaying with `wind` (Scenery treeWind). */
export function makeCardTrees(pines: Spot[], leafy: Spot[], shadows: boolean, sway?: (m: MeshStandardMaterial) => void): TreeKit {
  const bark = new MeshStandardMaterial({ color: "#8a7462", roughness: 0.95 });
  addDetail(bark, { a: "pine_bark", scaleA: 0.6, bump: 1.4, tint: 0.85, amount: 1, far: 50, key: "bark" });
  const leaves = new MeshStandardMaterial({ map: leafClusterTexture(), alphaTest: 0.45, side: DoubleSide, roughness: 0.78, color: "#ffffff" });
  const needles = new MeshStandardMaterial({ map: needleSprayTexture(), alphaTest: 0.4, side: DoubleSide, roughness: 0.82, color: "#ffffff" });
  // Light through leaves: a little of the sky's colour glows from the side away from the sun.
  for (const m of [leaves, needles]) {
    m.emissive.set("#1d2a12");
    m.emissiveIntensity = 0.6;
    sway?.(m);
  }
  sway?.(bark);
  const pineTrunk = new InstancedMesh(trunk(4.3, 0.2, 0.06, 0, 31), bark, Math.max(1, pines.length));
  const pineTop = new InstancedMesh(pineCrown(), needles, Math.max(1, pines.length));
  const leafTrunk = new InstancedMesh(trunk(2.6, 0.22, 0.13, 4, 37), bark, Math.max(1, leafy.length));
  const leafTop = new InstancedMesh(broadleafCrown(), leaves, Math.max(1, leafy.length));
  const pineShape = (s: Spot, o: Object3D, c: Color) => {
    o.scale.set(s.scale * 1.1, s.scale * (1.05 + s.tint * 0.8), s.scale * 1.1);
    c.setRGB(0.8 + s.tint * 0.3, 0.9 + s.tint * 0.2, 0.85 + s.tint * 0.15);
  };
  const leafShape = (s: Spot, o: Object3D, c: Color) => {
    o.scale.multiplyScalar(1.15);
    if (s.tint > 0.82) c.setRGB(1.7, 1.05, 0.45);
    else c.setRGB(0.85 + s.tint * 0.3, 0.92 + s.tint * 0.2, 0.8);
  };
  return {
    pines: [place(pineTrunk, pines, pineShape, shadows), place(pineTop, pines, pineShape, shadows)],
    leafy: [place(leafTrunk, leafy, (s, o) => o.scale.multiplyScalar(1.15), shadows), place(leafTop, leafy, leafShape, shadows)],
    materials: [bark, leaves, needles],
  };
}
