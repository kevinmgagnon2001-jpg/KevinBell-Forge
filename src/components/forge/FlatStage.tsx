import { useEffect, useRef, useState } from "react";
import { GRAVITY } from "@/engine/manifold";
import { useForge } from "@/engine/store";
import type { Entity } from "@/engine/types";

function project(x: number, y: number, z: number, yaw: number, cx: number, cy: number, scale: number) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const rx = x * cos - z * sin;
  const rz = x * sin + z * cos;
  return { sx: cx + rx * scale, sy: cy + rz * scale * 0.55 - y * scale, depth: rz };
}

function paint(canvas: HTMLCanvasElement, yaw: number, selectedId: number | null) {
  const parent = canvas.parentElement;
  const width = parent?.clientWidth || 320;
  const height = parent?.clientHeight || 320;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, width, height);
  const cx = width * 0.5;
  const cy = height * 0.62;
  const scale = Math.min(width, height) * 0.085;
  ctx.strokeStyle = "#2a2c32";
  ctx.lineWidth = 1;
  for (let i = -8; i <= 8; i += 1) {
    const a = project(i, 0, -8, yaw, cx, cy, scale);
    const b = project(i, 0, 8, yaw, cx, cy, scale);
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.stroke();
    const c = project(-8, 0, i, yaw, cx, cy, scale);
    const d = project(8, 0, i, yaw, cx, cy, scale);
    ctx.beginPath();
    ctx.moveTo(c.sx, c.sy);
    ctx.lineTo(d.sx, d.sy);
    ctx.stroke();
  }
  const list = Object.values(useForge.getState().entities).sort(
    (a, b) =>
      project(a.transform.position.x, 0, a.transform.position.z, yaw, cx, cy, scale).depth -
      project(b.transform.position.x, 0, b.transform.position.z, yaw, cx, cy, scale).depth,
  );
  for (const entity of list) drawEntity(ctx, entity, yaw, cx, cy, scale, entity.id === selectedId);
}

function drawEntity(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  yaw: number,
  cx: number,
  cy: number,
  scale: number,
  selected: boolean,
) {
  const p = entity.transform.position;
  const pos = project(p.x, p.y, p.z, yaw, cx, cy, scale);
  const color = entity.customData.color || "#d7c4a3";
  const rep = entity.representation;
  ctx.fillStyle = color;
  if (entity.tags.includes("architect") || rep.kind === "hybrid") {
    ctx.fillRect(pos.sx - 7, pos.sy - 28, 14, 22);
    ctx.beginPath();
    ctx.arc(pos.sx, pos.sy - 34, 7, 0, Math.PI * 2);
    ctx.fill();
  } else if (rep.kind === "gaussian") {
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(pos.sx, pos.sy - 12, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (rep.kind === "mesh" && rep.assetId === "platform") {
    ctx.globalAlpha = 0.95;
    ctx.fillRect(pos.sx - 40, pos.sy - 8, 80, 14);
    ctx.globalAlpha = 1;
  } else if (rep.kind === "mesh" && rep.assetId === "pillar") {
    ctx.fillRect(pos.sx - 6, pos.sy - 42, 12, 42);
  } else if (rep.kind === "mesh" && rep.assetId === "ring") {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(pos.sx, pos.sy - 4, 20, 8, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const radius = 11 * (entity.transform.scale.x || 1);
    ctx.beginPath();
    ctx.arc(pos.sx, pos.sy - radius, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  if (selected) {
    ctx.strokeStyle = "#f2f3f5";
    ctx.lineWidth = 1;
    ctx.strokeRect(pos.sx - 20, pos.sy - 48, 40, 54);
  }
  ctx.fillStyle = "#9aa1ab";
  ctx.font = "11px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(entity.tags.includes("architect") ? "you" : entity.name, pos.sx, pos.sy + 16);
}

export function FlatStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [yaw, setYaw] = useState(0.6);
  const drag = useRef<{ x: number; yaw: number } | null>(null);
  const tick = useForge((s) => s.tick);
  const count = useForge((s) => Object.keys(s.entities).length);
  const selectedId = useForge((s) => s.selectedId);
  const selected = useForge((s) => (s.selectedId == null ? null : (s.entities[s.selectedId] ?? null)));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    paint(canvas, yaw, selectedId);
  }, [yaw, tick, count, selectedId]);

  return (
    <div
      className="view"
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, yaw };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        setYaw(drag.current.yaw + (event.clientX - drag.current.x) * 0.008);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", touchAction: "none" }} />
      <div className="hud">
        <p className="hud-readout">
          <span>tick {String(tick).padStart(4, "0")}</span>
          <span>
            {count} {count === 1 ? "entity" : "entities"}
          </span>
          <span>{selected ? (selected.tags.includes("architect") ? "Architect · you" : selected.name) : "nothing selected"}</span>
          <span>g {GRAVITY.toFixed(2)}</span>
        </p>
        <p className="hud-hint">Drag to turn the view. The model loads beside this.</p>
      </div>
    </div>
  );
}
