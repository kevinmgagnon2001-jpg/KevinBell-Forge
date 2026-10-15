/**
 * Keeps the last few minutes of what the device did (src/engine/diagnostics.ts) and turns it into a
 * "Send to Claude" report: a pre-filled GitHub issue the person reviews and submits.
 *
 * Starts once (useDeviceHealth calls startRecorder). A reading every 5 s from liveSample, the last 12
 * uncaught errors and rejected promises. Nothing leaves the device until the person submits the issue.
 */
import { issueUrl, REPORT_VERSION, summarize, type DiagError, type DiagSample, type Diagnostics } from "@/engine/diagnostics";
import { gauges } from "@/engine/gauges";
import { probeHardware } from "@/engine/hardware";
import { LADDER } from "@/engine/perf";
import { useForge } from "@/engine/store";
import { whoAmI } from "@/engine/updates";
import { liveSample, perfNow } from "./PerfOverlay";

const EVERY_MS = 5000;
const KEEP_SAMPLES = 72; // 6 minutes
const KEEP_ERRORS = 12;

type Stamped<T> = T & { at: number };
const samples: Stamped<Omit<DiagSample, "ago">>[] = [];
const errors: Stamped<Omit<DiagError, "ago">>[] = [];
let started = false;

function noteError(message: string, where: string) {
  // The same error every frame is one error.
  const last = errors[errors.length - 1];
  if (last && last.message === message) return;
  errors.push({ at: performance.now(), message: message.slice(0, 300), where: where.slice(0, 120) });
  if (errors.length > KEEP_ERRORS) errors.shift();
}

export function startRecorder() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("error", (e) => noteError(String(e.message || e.error || "error"), e.filename ? `${e.filename.split("/").pop()}:${e.lineno}` : "page"));
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason as { message?: string } | string | undefined;
    noteError(typeof reason === "string" ? reason : (reason?.message ?? "promise rejected"), "promise");
  });
  const take = () => {
    const s = liveSample;
    samples.push({
      at: performance.now(),
      fps: Math.round(s.fps * 10) / 10,
      frameMs: Math.round(s.frameMs * 10) / 10,
      tempC: s.tempC,
      headroom: Math.round(s.headroom * 100) / 100,
      memPct: Math.round(s.memPct),
      heapMb: Math.round(s.heapMb),
      battery: s.battery,
      watts: Number.isFinite(s.watts) ? Math.round(s.watts * 100) / 100 : null,
      draws: s.draws,
      rung: perfNow().rung,
    });
    if (samples.length > KEEP_SAMPLES) samples.shift();
  };
  window.setInterval(() => {
    if (document.visibilityState === "visible") take();
  }, EVERY_MS);
}

/** Everything recorded so far, as a report. */
export async function collectDiagnostics(note: string): Promise<Diagnostics> {
  const now = performance.now();
  const ago = (at: number) => Math.round((now - at) / 1000);
  const me = await whoAmI().catch(() => null);
  const hw = probeHardware();
  const perf = perfNow();
  const room = gauges(useForge.getState());
  const recorded = samples.map(({ at, ...rest }) => ({ ago: ago(at), ...rest }));
  return {
    v: REPORT_VERSION,
    when: new Date().toISOString(),
    build: me ? `${me.version} ${me.platform.os} ${me.platform.arch}` : "web",
    note: note.trim().slice(0, 500),
    device: {
      ua: navigator.userAgent.slice(0, 200),
      screen: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
      refresh: liveSample.refresh,
      tier: hw.tier,
      renderer: hw.renderer.slice(0, 80),
      cores: hw.cores,
      memoryGb: hw.memoryGb,
    },
    quality: { rung: LADDER[perf.rung]?.name ?? String(perf.rung), auto: perf.auto, log: perf.log.slice(-8) },
    gauges: room.map((g) => ({ stat: g.customData.stat, mesh: g.customData.mesh, skin: g.customData.skin })),
    summary: summarize(recorded),
    samples: recorded,
    errors: errors.map(({ at, ...rest }) => ({ ago: ago(at), ...rest })),
  };
}

/**
 * Open the pre-filled issue. On Android the app's bridge opens the browser (only for this
 * repository's new-issue page); elsewhere a new tab. Returns false if nothing could be opened.
 */
export async function sendDiagnostics(note: string): Promise<boolean> {
  const url = issueUrl(await collectDiagnostics(note));
  const android = (globalThis as { ForgeAndroid?: { reportIssue?: (u: string) => boolean } }).ForgeAndroid;
  if (android?.reportIssue) return android.reportIssue(url);
  // With noopener the browser never hands back the window, so there is nothing to check here.
  window.open(url, "_blank", "noopener");
  return true;
}
