/**
 * The performance overlay and auto quality (src/engine/perf.ts).
 *
 *   PerfProbe     inside the 3D view: frame times and what the renderer drew, every frame; twice a
 *                 second it updates the numbers and lets auto quality step the picture up or down.
 *   PerfOverlay   the panel (the Stats button by the view buttons): frame rate and a frame-time
 *                 graph, worst frame, draw calls, triangles, memory, the quality rung, and on Android
 *                 the battery, its temperature and the phone's heat level. Auto on/off, a manual
 *                 rung, and Copy report.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AUTO, autoStart, autoStep, frameStats, LADDER, type AutoState } from "@/engine/perf";
import { EMPTY_SAMPLE, type LiveSample } from "@/engine/gauges";
import { sendDiagnostics, startRecorder } from "./diagnostics-recorder";
import { GaugePicker } from "./GaugePicker";

type Health = { battery: number; temperature: number; charging: boolean; thermal: number; headroom: number; memPct: number; watts: number };

/**
 * The newest reading of the device, for the lab's gauges (Gauges.tsx). A plain object, refreshed
 * twice a second by PerfProbe and every few seconds from the phone; the gauges read it every frame
 * without causing any React renders.
 */
export const liveSample: LiveSample = { ...EMPTY_SAMPLE };
/** The fastest the screen has shown, snapped to a real refresh rate (60, 90, 120, 144). */
let fastest = 60;
type Perf = {
  open: boolean;
  auto: boolean;
  /** The rung in use (index into LADDER). */
  rung: number;
  /** null until the view starts; then the hardware's start rung, and whether the URL fixed it. */
  start: number | null;
  forced: boolean;
  fps: number;
  avg: number;
  worst: number;
  calls: number;
  triangles: number;
  textures: number;
  geometries: number;
  heapMb: number;
  health: Health | null;
  log: string[];
};

const PREFS = "forge-quality";
let perf: Perf = { open: false, auto: true, rung: 0, start: null, forced: false, fps: 0, avg: 0, worst: 0, calls: 0, triangles: 0, textures: 0, geometries: 0, heapMb: 0, health: null, log: [] };
const listeners = new Set<() => void>();
function set(next: Partial<Perf>) {
  perf = { ...perf, ...next };
  listeners.forEach((notify) => notify());
}
export function usePerf(): Perf {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => perf,
    () => perf,
  );
}
/** The last frame times, for the graph. Kept outside React so drawing it costs no renders. */
const frames: number[] = [];
const FRAME_KEEP = 180;

function savePrefs() {
  try {
    globalThis.localStorage?.setItem(PREFS, JSON.stringify({ auto: perf.auto, rung: perf.auto ? undefined : perf.rung }));
  } catch {
    /* kept for this session */
  }
}

let auto: AutoState | null = null;
function note(line: string) {
  set({ log: [...perf.log.slice(-11), `${new Date().toLocaleTimeString()} ${line}`] });
}

/**
 * Start the controller once the hardware tier is known. `forced` (?scenery=...) fixes the rung and
 * turns auto off. Returns the rung to use.
 */
export function startQuality(start: number, forced: boolean) {
  if (perf.start !== null) return;
  let rung = start;
  let isAuto = !forced;
  if (!forced) {
    try {
      const saved = JSON.parse(globalThis.localStorage?.getItem(PREFS) ?? "{}") as { auto?: boolean; rung?: number };
      if (saved.auto === false && typeof saved.rung === "number" && saved.rung >= 0 && saved.rung < LADDER.length) {
        isAuto = false;
        rung = saved.rung;
      }
    } catch {
      /* defaults */
    }
  }
  auto = autoStart(rung, performance.now());
  auto.ceiling = start;
  set({ start, forced, rung, auto: isAuto });
}

export function setAuto(on: boolean) {
  if (perf.forced) return;
  if (on && auto) auto = { ...auto, rung: perf.rung, lowSince: null, highSince: null, lastChange: performance.now() };
  set({ auto: on });
  savePrefs();
  note(on ? "auto quality on" : "auto quality off");
}

export function chooseRung(rung: number) {
  if (perf.forced) return;
  set({ rung, auto: false });
  savePrefs();
  note(`picked ${LADDER[rung].name}`);
}

/** The performance state right now, outside React (the diagnostics recorder reads it). */
export function perfNow(): Perf {
  return perf;
}

export function togglePerf() {
  set({ open: !perf.open });
}

/** Inside the Canvas: measure every frame, publish twice a second, and drive auto quality. */
export function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const last = useRef(0);
  useFrame((_, delta) => {
    frames.push(Math.min(delta * 1000, 1000));
    if (frames.length > FRAME_KEEP) frames.splice(0, frames.length - FRAME_KEEP);
    const now = performance.now();
    if (now - last.current < 500) return;
    last.current = now;
    // The last second of frames.
    let sum = 0;
    let n = 0;
    for (let i = frames.length - 1; i >= 0 && sum < 1000; i -= 1) {
      sum += frames[i];
      n += 1;
    }
    const stats = frameStats(frames.slice(frames.length - n));
    const info = gl.info;
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    if (stats.fps > fastest * 1.08) fastest = [60, 90, 120, 144, 165, 240].find((hz) => hz >= stats.fps * 0.95) ?? 240;
    liveSample.fps = stats.fps;
    liveSample.frameMs = stats.avg;
    liveSample.refresh = fastest;
    liveSample.draws = info.render.calls;
    liveSample.triangles = info.render.triangles;
    liveSample.heapMb = memory ? memory.usedJSHeapSize / 1048576 : -1;
    const next: Partial<Perf> = {
      fps: stats.fps,
      avg: stats.avg,
      worst: Math.max(...frames.slice(-180)),
      calls: info.render.calls,
      triangles: info.render.triangles,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      heapMb: memory ? memory.usedJSHeapSize / 1048576 : 0,
    };
    if (perf.auto && auto && document.visibilityState === "visible") {
      const before = auto.rung;
      auto = autoStep({ ...auto, rung: perf.rung }, { now, fps: stats.fps, thermal: perf.health?.thermal ?? -1 });
      if (auto.rung !== before) {
        next.rung = auto.rung;
        const why = (perf.health?.thermal ?? 0) >= 2 ? "phone is warm" : auto.rung > before ? `${Math.round(stats.fps)} fps` : "room to spare";
        set(next);
        note(`${auto.rung > before ? "down" : "up"} to ${LADDER[auto.rung].name} (${why})`);
        return;
      }
    }
    // Twice a second is plenty; skip the update while nobody is looking and nothing changed.
    if (perf.open) set(next);
  });
  return null;
}

type Bridge = { deviceHealth?: () => string };
function readHealth(): Health | null {
  const android = (globalThis as { ForgeAndroid?: Bridge }).ForgeAndroid;
  if (!android?.deviceHealth) return null;
  try {
    const h = JSON.parse(android.deviceHealth()) as Partial<Health> & { memTotalMb?: number; memAvailMb?: number };
    const total = Number(h.memTotalMb ?? 0);
    const avail = Number(h.memAvailMb ?? 0);
    const watts = Number(h.watts ?? -999);
    return {
      battery: Number(h.battery ?? -1),
      temperature: Number(h.temperature ?? -1),
      charging: !!h.charging,
      thermal: Number(h.thermal ?? -1),
      headroom: Number(h.headroom ?? -1),
      memPct: total > 0 ? ((total - avail) / total) * 100 : -1,
      watts: watts <= -900 ? Number.NaN : watts,
    };
  } catch {
    return null;
  }
}

const HEAT = ["cool", "warm", "hot", "very hot", "critical", "emergency", "shutting down"];

/** Keep the phone's health fresh (auto quality listens to its heat even when the panel is closed). */
export function useDeviceHealth() {
  useEffect(() => {
    startRecorder();
    const share = (h: Health) => {
      liveSample.battery = h.battery;
      liveSample.charging = h.charging;
      liveSample.tempC = h.temperature;
      liveSample.thermal = h.thermal;
      liveSample.headroom = h.headroom;
      liveSample.memPct = h.memPct;
      liveSample.watts = h.watts;
    };
    const read = () => {
      const h = readHealth();
      if (h) {
        share(h);
        set({ health: h });
      }
    };
    read();
    // Outside the Android app, the browser may still say how the battery is doing.
    type BatteryLike = { level: number; charging: boolean; addEventListener: (type: string, fn: () => void) => void };
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (!readHealth() && nav.getBattery) {
      nav
        .getBattery()
        .then((b) => {
          const update = () => {
            liveSample.battery = Math.round(b.level * 100);
            liveSample.charging = b.charging;
          };
          update();
          b.addEventListener("levelchange", update);
          b.addEventListener("chargingchange", update);
        })
        .catch(() => undefined);
    }
    const timer = window.setInterval(read, 3000);
    return () => window.clearInterval(timer);
  }, []);
}

function Graph() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const draw = () => {
      const c = canvas.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      const w = c.width;
      const h = c.height;
      ctx.clearRect(0, 0, w, h);
      // 16.7 ms (60 fps) and 33 ms (30 fps) lines.
      const y = (ms: number) => h - Math.min(1, ms / 50) * h;
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      for (const ms of [16.7, 33.3]) {
        ctx.beginPath();
        ctx.moveTo(0, y(ms));
        ctx.lineTo(w, y(ms));
        ctx.stroke();
      }
      const shown = frames.slice(-w);
      shown.forEach((ms, i) => {
        ctx.fillStyle = ms > 33.3 ? "#d4524a" : ms > 20 ? "#d4a24a" : "#7ee0c8";
        const top = y(ms);
        ctx.fillRect(w - shown.length + i, top, 1, h - top);
      });
    };
    const timer = window.setInterval(draw, 250);
    return () => window.clearInterval(timer);
  }, []);
  return <canvas ref={canvas} className="perf-graph" width={180} height={40} aria-label="Frame times, last 3 seconds" />;
}

export function PerfOverlay() {
  const p = usePerf();
  const [copied, setCopied] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState("");
  useDeviceHealth();
  if (!p.open || p.start === null) return null;
  const rung = LADDER[p.rung];
  const h = p.health;
  const report = () => {
    const lines = [
      `Forge performance report ${new Date().toISOString()}`,
      `fps ${p.fps.toFixed(1)} avg ${p.avg.toFixed(1)} ms worst ${p.worst.toFixed(0)} ms`,
      `quality ${rung.name} (scenery ${rung.scenery}, dpr ${rung.dpr}, shadows ${rung.shadows ? "on" : "off"}) auto ${p.auto ? "on" : "off"}${p.forced ? " (set by address)" : ""}`,
      `draw calls ${p.calls} triangles ${p.triangles} textures ${p.textures} geometries ${p.geometries} js heap ${p.heapMb.toFixed(0)} MB`,
      h ? `battery ${h.battery}% ${h.temperature.toFixed(1)} C ${h.charging ? "charging" : ""} thermal ${h.thermal}` : "battery: not available",
      `screen ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio} ${navigator.userAgent}`,
      ...p.log,
    ].join("\n");
    void navigator.clipboard?.writeText(lines).then(
      () => setCopied("Copied"),
      () => setCopied("Could not copy"),
    );
  };
  return (
    <section className="perf" aria-label="Performance">
      <div className="perf-head">
        <strong className={p.fps < AUTO.lowFps ? "is-bad" : p.fps < 50 ? "is-meh" : "is-good"}>{Math.round(p.fps)} fps</strong>
        <span>
          {p.avg.toFixed(1)} ms · worst {Math.round(p.worst)}
        </span>
      </div>
      <Graph />
      <dl className="perf-grid">
        <dt>Draws</dt>
        <dd>{p.calls}</dd>
        <dt>Triangles</dt>
        <dd>{p.triangles >= 1000 ? `${Math.round(p.triangles / 1000)}k` : p.triangles}</dd>
        <dt>Textures</dt>
        <dd>{p.textures}</dd>
        <dt>Memory</dt>
        <dd>{p.heapMb ? `${Math.round(p.heapMb)} MB` : "n/a"}</dd>
        {h ? (
          <>
            <dt>Battery</dt>
            <dd>
              {h.battery >= 0 ? `${h.battery}%` : "?"}
              {h.charging ? " ⚡" : ""}
            </dd>
            <dt>Heat</dt>
            <dd className={h.thermal >= 2 ? "is-bad" : h.thermal === 1 ? "is-meh" : ""}>
              {h.temperature >= 0 ? `${h.temperature.toFixed(1)}°C · ` : ""}
              {h.thermal >= 0 ? (HEAT[h.thermal] ?? `level ${h.thermal}`) : "n/a"}
            </dd>
          </>
        ) : null}
      </dl>
      <p className="perf-quality">
        Quality <strong>{rung.name}</strong>: scenery {rung.scenery}, sharpness {rung.dpr}×, shadows {rung.shadows ? "on" : "off"}
        {p.forced ? " (set by the address)" : ""}
      </p>
      <div className="perf-row">
        <button type="button" className={`perf-chip ${p.auto ? "is-on" : ""}`} onClick={() => setAuto(!p.auto)} disabled={p.forced}>
          Auto {p.auto ? "on" : "off"}
        </button>
        {LADDER.map((r, i) => (
          <button key={r.name} type="button" className={`perf-chip ${i === p.rung ? "is-on" : ""}`} onClick={() => chooseRung(i)} disabled={p.forced} title={`${r.scenery}, ${r.dpr}×, shadows ${r.shadows ? "on" : "off"}`}>
            {r.name}
          </button>
        ))}
      </div>
      {p.log.length ? <p className="perf-log">{p.log[p.log.length - 1]}</p> : null}
      <GaugePicker />
      <div className="perf-row">
        <button type="button" className="perf-chip" onClick={report}>
          Copy report
        </button>
        {copied ? <span className="perf-copied">{copied}</span> : null}
      </div>
      <div className="perf-row">
        <input className="perf-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's wrong? (optional)" maxLength={500} aria-label="Note for the report" />
        <button
          type="button"
          className="perf-chip"
          title="Opens a pre-filled GitHub issue with the last few minutes of readings. Nothing is sent until you submit it."
          onClick={() => {
            setSent("Opening…");
            void sendDiagnostics(note).then(
              (ok) => setSent(ok ? "Review and submit the issue" : "Could not open the browser"),
              () => setSent("Could not build the report"),
            );
          }}
        >
          Send to Claude
        </button>
        {sent ? <span className="perf-copied">{sent}</span> : null}
        <button type="button" className="perf-chip" onClick={togglePerf}>
          Close
        </button>
      </div>
    </section>
  );
}
