/**
 * Hyper Breakout, the screen (rules in src/engine/breakout.ts). Neon bricks in the 4D palette with a
 * soft bloom, a ball that leaves a light trail, sparks when a brick breaks, a little shake when it
 * hits hard, and a glassy bubble paddle. Drag anywhere (or the mouse, or the arrow keys) to move;
 * tap, click or Space to launch. The best score is kept in the save (arcade.ts withBest).
 */
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { screenKeys } from "./body-state";
import { BALL, FIELD, newBreakout, PADDLE, stepBreakout, type BreakoutEvent, type BreakoutState } from "@/engine/breakout";

/** Red, rose, violet, indigo, teal, lime: the 4D bubble's colours. */
const TONES = ["#ff4d6d", "#ff7ab6", "#b77bff", "#7a6bff", "#4de2c5", "#9cff6b"];
const POWER_TONE = { multi: "#7afcff", wide: "#ffd36b", slow: "#b77bff" } as const;

type Spark = { x: number; y: number; vx: number; vy: number; life: number; tone: string; size: number };

let audio: AudioContext | null = null;
function blip(freq: number, length = 0.06, volume = 0.04, type: OscillatorType = "triangle") {
  try {
    audio ??= new AudioContext();
    const at = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, at + length);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + length + 0.02);
  } catch {
    // No sound here; play on.
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
}

export function BreakoutGame({ best, onBest, onExit }: { best: number; onBest: (score: number) => void; onExit: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<BreakoutState>(newBreakout((Date.now() & 0xffff) + 1, best));
  const input = useRef({ target: null as number | null, keys: new Set<string>(), launch: false });
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const [over, setOver] = useState<{ score: number; best: number; record: boolean } | null>(null);
  const bestRef = useRef(best);
  const onBestRef = useRef(onBest);
  onBestRef.current = onBest;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const restart = useCallback(() => {
    game.current = newBreakout((Date.now() & 0xffff) + 1, Math.max(bestRef.current, game.current.best));
    setOver(null);
    setPaused(false);
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const g = el.getContext("2d");
    if (!g) return;
    const sparks: Spark[] = [];
    const trails = new Map<number, { x: number; y: number }[]>();
    const stars = Array.from({ length: 90 }, (_, i) => ({ x: (i * 0.618) % 1, y: (i * 0.377 + 0.13) % 1, s: 0.4 + ((i * 7) % 5) * 0.25, tw: i * 1.7 }));
    let shake = 0;
    let flash = 0;
    let banner = { text: "", life: 0 };
    let frame = 0;
    let last = performance.now();
    let clock = 0;
    const view = { scale: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };

    const fit = () => {
      const rect = el.getBoundingClientRect();
      view.dpr = Math.min(2, window.devicePixelRatio || 1);
      el.width = Math.max(1, Math.round(rect.width * view.dpr));
      el.height = Math.max(1, Math.round(rect.height * view.dpr));
      view.w = rect.width;
      view.h = rect.height;
      const top = 64;
      const bottom = 24;
      view.scale = Math.min((rect.width - 24) / FIELD.width, (rect.height - top - bottom) / FIELD.height);
      view.ox = (rect.width - FIELD.width * view.scale) / 2;
      view.oy = top + (rect.height - top - bottom - FIELD.height * view.scale) / 2;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);

    const burst = (e: BreakoutEvent, count: number, power = 1) => {
      const tone = e.tone != null ? TONES[e.tone % TONES.length] : "#ffffff";
      for (let i = 0; i < count; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const v = (0.15 + Math.random() * 0.45) * power;
        sparks.push({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.1, life: 0.5 + Math.random() * 0.5, tone, size: 1.5 + Math.random() * 2.5 });
      }
    };

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden) return;
      const s = game.current;
      const inp = input.current;
      if (!pausedRef.current && !s.over) {
        clock += dt;
        const move = (inp.keys.has("ArrowRight") || inp.keys.has("KeyD") ? 1 : 0) - (inp.keys.has("ArrowLeft") || inp.keys.has("KeyA") ? 1 : 0);
        const events = stepBreakout(s, { target: move ? null : inp.target, move, launch: inp.launch }, dt);
        if (move) inp.target = null;
        inp.launch = false;
        for (const e of events) {
          if (e.kind === "break") {
            burst(e, 16, 1);
            shake = Math.min(1, shake + 0.25);
            blip(520 + (e.tone ?? 0) * 70, 0.07, 0.035);
          } else if (e.kind === "hit") {
            burst(e, 5, 0.6);
            blip(320 + (e.tone ?? 0) * 40, 0.04, 0.025, "square");
          } else if (e.kind === "paddle") blip(240, 0.05, 0.03);
          else if (e.kind === "wall") blip(180, 0.03, 0.015);
          else if (e.kind === "power") {
            burst({ ...e, tone: undefined }, 22, 1.2);
            flash = 0.5;
            banner = { text: e.power === "multi" ? "×3" : e.power === "wide" ? "↔" : "◷", life: 1.2 };
            blip(660, 0.12, 0.04, "sine");
            blip(990, 0.16, 0.03, "sine");
          } else if (e.kind === "lost") {
            shake = 1;
            flash = 0.35;
            blip(140, 0.25, 0.05, "sawtooth");
          } else if (e.kind === "level") {
            flash = 0.8;
            banner = { text: `${s.level}`, life: 1.6 };
            for (const f of [523, 659, 784, 1047]) blip(f, 0.12, 0.03, "sine");
          } else if (e.kind === "over") {
            const record = s.score > bestRef.current;
            if (record) {
              bestRef.current = s.score;
              onBestRef.current(s.score);
            }
            setOver({ score: s.score, best: Math.max(bestRef.current, s.score), record });
          }
        }
      }

      // ---- draw ----
      const { scale, ox, oy, dpr } = view;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = g.createRadialGradient(view.w / 2, view.h * 0.35, 0, view.w / 2, view.h * 0.35, Math.max(view.w, view.h) * 0.8);
      bg.addColorStop(0, "#1a0f33");
      bg.addColorStop(0.55, "#0b0718");
      bg.addColorStop(1, "#040208");
      g.fillStyle = bg;
      g.fillRect(0, 0, view.w, view.h);
      for (const st of stars) {
        g.globalAlpha = 0.25 + 0.25 * Math.sin(clock * 1.3 + st.tw);
        g.fillStyle = "#cbb8ff";
        g.fillRect(st.x * view.w, st.y * view.h, st.s, st.s);
      }
      g.globalAlpha = 1;
      const sx = shake > 0.01 ? (Math.random() - 0.5) * shake * 8 : 0;
      const sy = shake > 0.01 ? (Math.random() - 0.5) * shake * 8 : 0;
      shake *= Math.exp(-dt * 9);
      g.save();
      g.translate(ox + sx, oy + sy);
      const X = (v: number) => v * scale;

      // The field: a frosted pane with a thin-film rim.
      roundRect(g, -6, -6, X(FIELD.width) + 12, X(FIELD.height) + 12, 18);
      g.fillStyle = "rgba(20, 12, 44, 0.55)";
      g.fill();
      const rim = g.createLinearGradient(0, 0, X(FIELD.width), X(FIELD.height));
      rim.addColorStop(0, "rgba(255,122,217,0.55)");
      rim.addColorStop(0.5, "rgba(122,252,255,0.45)");
      rim.addColorStop(1, "rgba(183,123,255,0.55)");
      g.strokeStyle = rim;
      g.lineWidth = 1.5;
      g.stroke();
      // A faint perspective grid on the floor of the field.
      g.strokeStyle = "rgba(122,252,255,0.06)";
      g.lineWidth = 1;
      for (let i = 1; i < 10; i += 1) {
        g.beginPath();
        g.moveTo(X(i / 10), 0);
        g.lineTo(X(i / 10), X(FIELD.height));
        g.stroke();
      }
      for (let i = 1; i < 14; i += 1) {
        g.beginPath();
        g.moveTo(0, X(i / 10));
        g.lineTo(X(FIELD.width), X(i / 10));
        g.stroke();
      }

      // Bricks: a soft glow behind, a glossy face, cracks when hurt.
      g.globalCompositeOperation = "lighter";
      for (const b of s.bricks) {
        const tone = TONES[b.tone % TONES.length];
        g.globalAlpha = 0.16;
        g.fillStyle = tone;
        roundRect(g, X(b.x) - 4, X(b.y) - 4, X(b.w) + 8, X(b.h) + 8, 8);
        g.fill();
      }
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      for (const b of s.bricks) {
        const tone = TONES[b.tone % TONES.length];
        const face = g.createLinearGradient(0, X(b.y), 0, X(b.y + b.h));
        face.addColorStop(0, "#ffffff");
        face.addColorStop(0.18, tone);
        face.addColorStop(1, "#1b0b33");
        g.globalAlpha = 0.55 + 0.45 * (b.hp / b.max);
        g.fillStyle = face;
        roundRect(g, X(b.x), X(b.y), X(b.w), X(b.h), 5);
        g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = "rgba(255,255,255,0.35)";
        g.lineWidth = 1;
        g.stroke();
        if (b.hp < b.max) {
          g.strokeStyle = "rgba(10,4,20,0.7)";
          g.beginPath();
          g.moveTo(X(b.x + b.w * 0.3), X(b.y));
          g.lineTo(X(b.x + b.w * 0.45), X(b.y + b.h * 0.55));
          g.lineTo(X(b.x + b.w * 0.38), X(b.y + b.h));
          if (b.max - b.hp > 1) {
            g.moveTo(X(b.x + b.w * 0.7), X(b.y));
            g.lineTo(X(b.x + b.w * 0.62), X(b.y + b.h * 0.6));
          }
          g.stroke();
        }
        if (b.max > 1) {
          // Tough bricks show their strength as pips.
          g.fillStyle = "rgba(255,255,255,0.8)";
          for (let k = 0; k < b.hp; k += 1) g.fillRect(X(b.x + b.w / 2) - 6 + k * 5, X(b.y + b.h / 2) - 1, 3, 2);
        }
      }

      // Capsules.
      for (const d of s.drops) {
        const tone = POWER_TONE[d.kind];
        g.globalCompositeOperation = "lighter";
        const glow = g.createRadialGradient(X(d.x), X(d.y), 0, X(d.x), X(d.y), X(0.05));
        glow.addColorStop(0, tone);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = glow;
        g.fillRect(X(d.x - 0.05), X(d.y - 0.05), X(0.1), X(0.1));
        g.globalCompositeOperation = "source-over";
        roundRect(g, X(d.x - 0.03), X(d.y - 0.011), X(0.06), X(0.022), X(0.011));
        g.fillStyle = "rgba(255,255,255,0.9)";
        g.fill();
        g.fillStyle = tone;
        g.font = `700 ${Math.max(9, X(0.02))}px system-ui, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(d.kind === "multi" ? "•••" : d.kind === "wide" ? "↔" : "◷", X(d.x), X(d.y) + 0.5);
      }

      // The ball(s), with light trails.
      g.globalCompositeOperation = "lighter";
      s.balls.forEach((b, i) => {
        const trail = trails.get(i) ?? [];
        trail.push({ x: b.x, y: b.y });
        if (trail.length > 14) trail.shift();
        trails.set(i, trail);
        trail.forEach((p, k) => {
          const t = k / trail.length;
          g.globalAlpha = t * 0.35;
          g.fillStyle = s.slow > 0 ? "#b77bff" : "#7afcff";
          g.beginPath();
          g.arc(X(p.x), X(p.y), X(BALL.r) * (0.4 + t * 0.8), 0, Math.PI * 2);
          g.fill();
        });
        g.globalAlpha = 1;
        const halo = g.createRadialGradient(X(b.x), X(b.y), 0, X(b.x), X(b.y), X(BALL.r * 5));
        halo.addColorStop(0, "rgba(255,255,255,0.9)");
        halo.addColorStop(0.25, "rgba(122,252,255,0.45)");
        halo.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = halo;
        g.fillRect(X(b.x - BALL.r * 5), X(b.y - BALL.r * 5), X(BALL.r * 10), X(BALL.r * 10));
      });
      for (const key of [...trails.keys()]) if (key >= s.balls.length) trails.delete(key);
      g.globalCompositeOperation = "source-over";
      for (const b of s.balls) {
        g.fillStyle = "#ffffff";
        g.beginPath();
        g.arc(X(b.x), X(b.y), X(BALL.r), 0, Math.PI * 2);
        g.fill();
      }

      // The paddle: a glassy bubble bar with a thin film sliding across it.
      const pw = X(s.paddle.w);
      const px = X(s.paddle.x) - pw / 2;
      const py = X(PADDLE.y);
      const ph = X(PADDLE.h);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.35;
      g.fillStyle = "#ff7ad9";
      roundRect(g, px - 6, py - 5, pw + 12, ph + 10, ph);
      g.fill();
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      const film = g.createLinearGradient(px, 0, px + pw, 0);
      const shift = (clock * 0.25) % 1;
      film.addColorStop(0, "#ff7ad9");
      film.addColorStop((0.33 + shift) % 1, "#7afcff");
      film.addColorStop((0.66 + shift) % 1, "#b77bff");
      film.addColorStop(1, "#ffd36b");
      roundRect(g, px, py, pw, ph, ph / 2);
      g.fillStyle = film;
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.55)";
      roundRect(g, px + ph * 0.6, py + 2, pw - ph * 1.2, ph * 0.32, ph * 0.2);
      g.fill();

      // Sparks.
      g.globalCompositeOperation = "lighter";
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const p = sparks[i];
        p.life -= dt;
        if (p.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        p.vy += 0.9 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        g.globalAlpha = Math.min(1, p.life * 2);
        g.fillStyle = p.tone;
        g.fillRect(X(p.x) - p.size / 2, X(p.y) - p.size / 2, p.size, p.size);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";

      // The waiting ball's hint, the banner for a level or a capsule.
      if (s.balls.some((b) => b.stuck) && !s.over) {
        g.globalAlpha = 0.5 + 0.3 * Math.sin(clock * 4);
        g.strokeStyle = "#7afcff";
        g.setLineDash([4, 6]);
        g.beginPath();
        g.moveTo(X(s.paddle.x), py - 10);
        g.lineTo(X(s.paddle.x + 0.06), py - X(0.14));
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
      }
      if (banner.life > 0) {
        banner.life -= dt;
        g.globalAlpha = Math.min(1, banner.life * 2);
        g.fillStyle = "#ffffff";
        g.font = `800 ${X(0.16)}px system-ui, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.shadowColor = "#b77bff";
        g.shadowBlur = 24;
        g.fillText(banner.text, X(0.5), X(FIELD.height * 0.55));
        g.shadowBlur = 0;
        g.globalAlpha = 1;
      }
      g.restore();
      if (flash > 0.01) {
        g.fillStyle = `rgba(183,123,255,${flash * 0.25})`;
        g.fillRect(0, 0, view.w, view.h);
        flash *= Math.exp(-dt * 6);
      }

      // Score along the top.
      g.font = "700 22px system-ui, sans-serif";
      g.textBaseline = "middle";
      g.textAlign = "left";
      g.fillStyle = "#ffffff";
      g.fillText(String(s.score), ox, 32);
      g.font = "600 13px system-ui, sans-serif";
      g.fillStyle = "rgba(220,205,255,0.7)";
      const info = `★ ${Math.max(s.best, bestRef.current)}   ◆ ${s.level}`;
      const infoX = ox + g.measureText(String(s.score)).width * 1.7 + 14;
      g.fillText(info, infoX, 33);
      const livesX = infoX + g.measureText(info).width + 18;
      for (let i = 0; i < s.lives; i += 1) {
        g.fillStyle = "#7afcff";
        g.beginPath();
        g.arc(livesX + i * 14, 33, 4.5, 0, Math.PI * 2);
        g.fill();
      }
    };
    frame = requestAnimationFrame(loop);

    const toField = (clientX: number) => {
      const rect = el.getBoundingClientRect();
      return (clientX - rect.left - view.ox) / view.scale;
    };
    const down = (e: PointerEvent) => {
      input.current.target = toField(e.clientX);
      input.current.launch = true;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || e.buttons) input.current.target = toField(e.clientX);
    };
    const keyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter" || e.code === "ArrowUp") {
        input.current.launch = true;
        e.preventDefault();
      }
      if (e.code === "Escape") onExitRef.current();
      if (e.code === "KeyP") setPaused((p) => !p);
      input.current.keys.add(e.code);
    };
    const keyUp = (e: KeyboardEvent) => input.current.keys.delete(e.code);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    // The arcade passes our keys on (it keeps them from walking the body meanwhile).
    screenKeys.down = keyDown;
    window.addEventListener("keyup", keyUp);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      if (screenKeys.down === keyDown) screenKeys.down = null;
      window.removeEventListener("keyup", keyUp);
    };
  }, []);

  return (
    <div className="bko">
      <canvas ref={canvas} className="bko-canvas" aria-label="Hyper Breakout: drag to move the paddle, tap to launch" />
      <div className="bko-bar">
        <button type="button" className="visor-key bubble-icon" aria-label={paused ? "Resume" : "Pause"} title={paused ? "Resume (P)" : "Pause (P)"} onClick={() => setPaused((p) => !p)}>
          {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
        </button>
        <button type="button" className="visor-key bubble-icon" aria-label="Walk away" title="Walk away (Esc)" onClick={onExit}>
          <X aria-hidden />
        </button>
      </div>
      {over ? (
        <div className="bko-over" role="dialog" aria-label="Game over">
          <p className="bko-score">{over.score}</p>
          <p className="bko-best">{over.record ? "★ new best" : `★ ${over.best}`}</p>
          <div className="bko-actions">
            <button type="button" className="visor-key bubble-icon" aria-label="Play again" title="Play again" onClick={restart}>
              <RotateCcw aria-hidden />
            </button>
            <button type="button" className="visor-key bubble-icon" aria-label="Walk away" title="Walk away" onClick={onExit}>
              <X aria-hidden />
            </button>
          </div>
        </div>
      ) : paused ? (
        <div className="bko-over is-paused" aria-live="polite">
          <button type="button" className="visor-key bubble-icon bko-big" aria-label="Resume" title="Resume (P)" onClick={() => setPaused(false)}>
            <Play aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
