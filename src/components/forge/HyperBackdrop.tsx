/**
 * Behind the whole app, the 4D bubble: a 120-cell (600 corners, 1200 edges) turning slowly through
 * four dimensions, its edges glowing red, violet and green by depth, inside an iridescent haze. Drawn
 * on a 2D canvas at up to 30 frames a second, paused when the page is hidden, still when the person
 * prefers less motion. A tiny tesseract does the same as the brand mark (HyperMark).
 */
import { useEffect, useRef } from "react";
import { hyperColor, project, shapeOf, turnAt, type ShapeName } from "@/engine/polytope";
import { useTheme } from "./theme";

type Painter = { canvas: HTMLCanvasElement; shape: ShapeName; glow: number; speed: number; light: boolean };

function paint(p: Painter, t: number, verts: Float32Array, depth: Float32Array, buckets: number[][]) {
  const { canvas } = p;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const poly = shapeOf(p.shape);
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  project(poly, turnAt(t, p.speed), verts, depth, 2.6);
  // A slow 3D turn on top, so it tumbles as well as turning inside out.
  const a = t * 0.05;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const r = Math.min(w, h) * 0.3;
  const cx = w / 2;
  const cy = h / 2;
  const px = (i: number) => cx + (verts[i * 3] * ca - verts[i * 3 + 2] * sa) * r;
  const py = (i: number) => cy - verts[i * 3 + 1] * r;
  // The bubble's haze.
  const haze = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 2);
  haze.addColorStop(0, p.light ? "rgba(183,123,255,0.12)" : "rgba(183,123,255,0.24)");
  haze.addColorStop(0.5, p.light ? "rgba(255,95,180,0.05)" : "rgba(255,95,180,0.07)");
  haze.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, w, h);
  // Edges by colour bucket (few style changes): a wide soft pass, then a thin bright one.
  for (const b of buckets) b.length = 0;
  poly.edges.forEach(([i, j], e) => {
    const k = Math.max(0, Math.min(buckets.length - 1, Math.floor(((depth[i] + depth[j]) / 2 + 1) / 2 * buckets.length)));
    buckets[k].push(e);
  });
  ctx.globalCompositeOperation = p.light ? "source-over" : "lighter";
  ctx.lineCap = "round";
  for (const [pass, width, alpha] of [
    [0, 8 * p.glow, p.light ? 0.05 : 0.08],
    [1, 1.3 * p.glow, p.light ? 0.55 : 0.8],
  ] as const) {
    ctx.lineWidth = width;
    buckets.forEach((list, k) => {
      if (!list.length) return;
      const [cr, cg, cb] = hyperColor((k + 0.5) / buckets.length * 2 - 1, t);
      const shade = p.light ? 0.6 : 1;
      ctx.strokeStyle = `rgba(${Math.round(cr * 255 * shade)},${Math.round(cg * 255 * shade)},${Math.round(cb * 255 * shade)},${alpha * (pass === 1 ? 0.5 + (k / buckets.length) * 0.5 : 1)})`;
      ctx.beginPath();
      for (const e of list) {
        const [i, j] = poly.edges[e];
        ctx.moveTo(px(i), py(i));
        ctx.lineTo(px(j), py(j));
      }
      ctx.stroke();
    });
  }
  // The bubble's rim: a thin film ring.
  const ring = ctx.createConicGradient ? ctx.createConicGradient(t * 0.2, cx, cy) : null;
  if (ring) {
    ["#ff5fb4", "#ffd27a", "#7afcff", "#b77bff", "#ff5fb4"].forEach((c, i, all) => ring.addColorStop(i / (all.length - 1), c));
    ctx.globalAlpha = p.light ? 0.25 : 0.35;
    ctx.strokeStyle = ring;
    ctx.lineWidth = 1.5 * p.glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.75, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = "source-over";
}

function useHyperCanvas(shape: ShapeName, opts: { glow: number; speed: number; fps: number; dpr: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useTheme();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const poly = shapeOf(shape);
    const verts = new Float32Array(poly.vertices.length * 3);
    const depth = new Float32Array(poly.vertices.length);
    const buckets: number[][] = Array.from({ length: 10 }, () => []);
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, opts.dpr);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    };
    fit();
    const painter: Painter = { canvas, shape, glow: opts.glow * Math.min(window.devicePixelRatio || 1, opts.dpr), speed: opts.speed, light: theme === "light" };
    let frame = 0;
    let last = 0;
    const start = performance.now() - Math.random() * 60000;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (document.hidden || now - last < 1000 / opts.fps) return;
      last = now;
      paint(painter, (now - start) / 1000, verts, depth, buckets);
    };
    const resize = () => {
      fit();
      if (still) paint(painter, 40, verts, depth, buckets);
    };
    window.addEventListener("resize", resize);
    if (still) paint(painter, 40, verts, depth, buckets);
    else frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [shape, theme, opts.glow, opts.speed, opts.fps, opts.dpr]);
  return ref;
}

export function HyperBackdrop() {
  const ref = useHyperCanvas("120-cell", { glow: 1, speed: 0.35, fps: 30, dpr: 1.5 });
  return <canvas ref={ref} className="hyper-backdrop" aria-hidden="true" />;
}

export function HyperMark() {
  const ref = useHyperCanvas("tesseract", { glow: 1.1, speed: 1.4, fps: 30, dpr: 2 });
  return <canvas ref={ref} className="hyper-mark" aria-hidden="true" />;
}
