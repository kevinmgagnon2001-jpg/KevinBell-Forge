import { useEffect, useRef } from "react";
import { PerspectiveCamera, Vector3, type Camera } from "three";
import type { Entity } from "@/engine/types";
import { useForge } from "@/engine/store";

/** The live three camera and the GPU canvas. The picture copies the GPU when it has pixels. */
export const stageCamera: { current: Camera | null } = { current: null };
export const stageGl: { current: HTMLCanvasElement | null } = { current: null };

const fallback = new PerspectiveCamera(48, 1, 0.1, 80);
fallback.position.set(6.4, 4.8, 8.2);
fallback.lookAt(0.2, 0.6, 0.2);

const P = new Vector3();
const scratch = new Vector3();

type Pt = { x: number; y: number; z: number; front: boolean };
type Face = { pts: Pt[]; color: string; depth: number };

function project(camera: Camera, x: number, y: number, z: number, width: number, height: number): Pt {
  scratch.set(x, y, z);
  scratch.applyMatrix4(camera.matrixWorldInverse);
  const inFront = scratch.z < -0.05;
  P.copy(scratch).applyMatrix4(camera.projectionMatrix);
  return {
    x: (P.x * 0.5 + 0.5) * width,
    y: (-P.y * 0.5 + 0.5) * height,
    z: P.z,
    front: inFront,
  };
}

function shade(hex: string, mul: number): string {
  const n = /^#([0-9a-f]{6})$/i.exec(hex)?.[1] ?? "d7c4a3";
  const r = Math.max(0, Math.min(255, Math.round(parseInt(n.slice(0, 2), 16) * mul)));
  const g = Math.max(0, Math.min(255, Math.round(parseInt(n.slice(2, 4), 16) * mul)));
  const b = Math.max(0, Math.min(255, Math.round(parseInt(n.slice(4, 6), 16) * mul)));
  return `rgb(${r},${g},${b})`;
}

function pushFace(faces: Face[], pts: Pt[], color: string) {
  if (pts.some((p) => !p.front)) return;
  const cross = (pts[1].x - pts[0].x) * (pts[2].y - pts[0].y) - (pts[1].y - pts[0].y) * (pts[2].x - pts[0].x);
  if (cross <= 0) return;
  let depth = 0;
  for (const p of pts) depth += p.z;
  faces.push({ pts, color, depth: depth / pts.length });
}

function pushBox(
  faces: Face[],
  camera: Camera,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  color: string,
  width: number,
  height: number,
) {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const c = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
  ].map(([x, y, z]) => project(camera, cx + x, cy + y, cz + z, width, height));
  const sides: [number, number, number, number, number][] = [
    [0, 1, 2, 3, 0.62],
    [5, 4, 7, 6, 0.78],
    [3, 2, 6, 7, 1.12],
    [4, 5, 1, 0, 0.42],
    [1, 5, 6, 2, 0.9],
    [4, 0, 3, 7, 0.72],
  ];
  for (const [a, b, d, e, mul] of sides) pushFace(faces, [c[a], c[b], c[d], c[e]], shade(color, mul));
}

function pushCylinder(
  faces: Face[],
  camera: Camera,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  color: string,
  width: number,
  height: number,
) {
  const radius = Math.max(sx, sz) / 2;
  const hy = sy / 2;
  const sides = 12;
  const top: Pt[] = [];
  const bot: Pt[] = [];
  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    top.push(project(camera, cx + x, cy + hy, cz + z, width, height));
    bot.push(project(camera, cx + x, cy - hy, cz + z, width, height));
  }
  for (let i = 0; i < sides; i += 1) {
    const j = (i + 1) % sides;
    const light = 0.55 + 0.5 * (0.5 + 0.5 * Math.cos((i / sides) * Math.PI * 2));
    pushFace(faces, [bot[i], bot[j], top[j], top[i]], shade(color, light));
  }
  pushFace(faces, top, shade(color, 1.15));
  pushFace(faces, [...bot].reverse(), shade(color, 0.4));
}

function pushSphere(
  faces: Face[],
  camera: Camera,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  color: string,
  width: number,
  height: number,
) {
  const lat = 7;
  const lon = 10;
  const rings: Pt[][] = [];
  for (let i = 0; i <= lat; i += 1) {
    const v = (i / lat) * Math.PI;
    const y = Math.cos(v) * radius;
    const rr = Math.sin(v) * radius;
    const ring: Pt[] = [];
    for (let j = 0; j < lon; j += 1) {
      const u = (j / lon) * Math.PI * 2;
      ring.push(project(camera, cx + Math.cos(u) * rr, cy + y, cz + Math.sin(u) * rr, width, height));
    }
    rings.push(ring);
  }
  for (let i = 0; i < lat; i += 1) {
    for (let j = 0; j < lon; j += 1) {
      const k = (j + 1) % lon;
      const light = 0.4 + 0.75 * (1 - i / lat);
      pushFace(faces, [rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]], shade(color, light));
    }
  }
}

function pushTorus(
  faces: Face[],
  camera: Camera,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  color: string,
  width: number,
  height: number,
) {
  const R = 0.62;
  const tube = 0.09;
  const seg = 20;
  const sides = 7;
  const tilt = Math.PI / 2.5;
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);
  const at = (u: number, v: number) => {
    const cxr = R + tube * Math.cos(v);
    const lx = Math.cos(u) * cxr;
    const ly = Math.sin(u) * cxr;
    const lz = Math.sin(v) * tube;
    const y = ly * cosT - lz * sinT;
    const z = ly * sinT + lz * cosT;
    return project(camera, cx + lx * sx, cy + y * sy, cz + z * sz, width, height);
  };
  for (let i = 0; i < seg; i += 1) {
    const u0 = (i / seg) * Math.PI * 2;
    const u1 = ((i + 1) / seg) * Math.PI * 2;
    for (let j = 0; j < sides; j += 1) {
      const v0 = (j / sides) * Math.PI * 2;
      const v1 = ((j + 1) / sides) * Math.PI * 2;
      const light = 0.5 + 0.55 * (0.5 + 0.5 * Math.cos(v0));
      pushFace(faces, [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], shade(color, light));
    }
  }
}

function assetOf(entity: Entity): string {
  if (entity.representation.kind === "mesh") return entity.representation.assetId;
  if (entity.representation.kind === "gaussian") return "gaussian";
  return "avatar";
}

function addEntity(faces: Face[], entity: Entity, camera: Camera, width: number, height: number) {
  const p = entity.transform.position;
  const s = entity.transform.scale;
  const color = entity.customData.color || "#d7c4a3";
  const asset = assetOf(entity);
  if (entity.tags.includes("architect")) {
    const eye = project(camera, p.x, p.y + 0.7, p.z, width, height);
    if (eye.front && eye.z < 0.2) return;
    pushCylinder(faces, camera, p.x, p.y + 0.15, p.z, 0.44, 0.7, 0.44, color, width, height);
    pushSphere(faces, camera, p.x, p.y + 0.62, p.z, 0.16, color, width, height);
    return;
  }
  if (asset === "pillar") {
    pushCylinder(faces, camera, p.x, p.y, p.z, s.x, s.y, s.z, color, width, height);
    return;
  }
  if (asset === "ring") {
    pushTorus(faces, camera, p.x, p.y, p.z, s.x, s.y, s.z, color, width, height);
    return;
  }
  if (asset === "sphere") {
    pushSphere(faces, camera, p.x, p.y, p.z, Math.max(s.x, s.y, s.z) / 2, color, width, height);
    return;
  }
  if (asset === "gaussian") {
    pushSphere(faces, camera, p.x, p.y, p.z, 0.42, color, width, height);
    pushSphere(faces, camera, p.x, p.y + 0.35, p.z, 0.28, "#d5e7f7", width, height);
    return;
  }
  pushBox(faces, camera, p.x, p.y, p.z, Math.max(s.x, 0.08), Math.max(s.y, 0.08), Math.max(s.z, 0.08), color, width, height);
}

function gpuHasPicture(src: HTMLCanvasElement, ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  if (src.width < 2 || src.height < 2) return false;
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(src, 0, 0, width, height);
    let min = 765;
    let max = 0;
    for (let y = 0.3; y <= 0.75; y += 0.15) {
      for (let x = 0.25; x <= 0.75; x += 0.16) {
        const px = ctx.getImageData(Math.max(0, Math.floor(x * width) - 1), Math.max(0, Math.floor(y * height) - 1), 1, 1).data;
        const l = px[0] + px[1] + px[2];
        if (l < min) min = l;
        if (l > max) max = l;
      }
    }
    return max > 90 && max - min > 36;
  } catch {
    return false;
  }
}

function paintSolids(ctx: CanvasRenderingContext2D, camera: Camera, width: number, height: number) {
  camera.updateMatrixWorld();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#14181e";
  ctx.fillRect(0, 0, width, height);
  const faces: Face[] = [];
  const entities = Object.values(useForge.getState().entities).filter((entity) => !entity.tags.includes("helm"));
  for (const entity of entities) addEntity(faces, entity, camera, width, height);
  faces.sort((a, b) => b.depth - a.depth);
  for (const face of faces) {
    ctx.beginPath();
    ctx.moveTo(face.pts[0].x, face.pts[0].y);
    for (let i = 1; i < face.pts.length; i += 1) ctx.lineTo(face.pts[i].x, face.pts[i].y);
    ctx.closePath();
    ctx.fillStyle = face.color;
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(154, 161, 171, 0.35)";
  ctx.lineWidth = 1;
  for (let i = -8; i <= 8; i += 2) {
    const a = project(camera, i, 0.02, -8, width, height);
    const b = project(camera, i, 0.02, 8, width, height);
    const c = project(camera, -8, 0.02, i, width, height);
    const d = project(camera, 8, 0.02, i, width, height);
    if (a.front && b.front) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    if (c.front && d.front) {
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }
  }
}

function paint(canvas: HTMLCanvasElement) {
  const parent = canvas.parentElement;
  const width = Math.max(2, parent?.clientWidth || 320);
  const height = Math.max(2, parent?.clientHeight || 320);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const gl = stageGl.current;
  if (gl && gpuHasPicture(gl, ctx, width, height)) return;
  const camera = stageCamera.current ?? fallback;
  if (camera === fallback) {
    fallback.aspect = width / height;
    fallback.updateProjectionMatrix();
  }
  paintSolids(ctx, camera, width, height);
}

export function RoomPicture() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    const draw = () => {
      try {
        paint(canvas);
      } catch {
        /* keep the last frame if one sample fails */
      }
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={canvasRef} className="room-picture" aria-hidden="true" />;
}
