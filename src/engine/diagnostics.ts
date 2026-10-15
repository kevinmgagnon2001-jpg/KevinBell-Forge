/**
 * Diagnostics: what Forge saw on a real device, in a form the next build session can read.
 *
 * The app records a few minutes of readings (frame rate, heat, throttle, memory, battery, power, the
 * quality rung), the last errors, the gauges in the room and the device's profile. "Send to Claude"
 * turns that into a GitHub issue on this repository, opened pre-filled in the browser: nothing is sent
 * until the person reads it and taps Submit, and the app holds no token.
 *
 * The issue body is Markdown for people plus one fenced `forge-diagnostics` JSON block for tools.
 * `parseReport` reads it back, so a session (or a workflow) can pick up every open report, see what
 * went wrong on the phone, fix it and close the issue. Guide: docs/DIAGNOSTICS.md.
 */
export const REPORT_REPO = "kevinmgagnon2001-jpg/KevinBell-Forge";
export const REPORT_LABEL = "diagnostics";
export const REPORT_VERSION = 1;
/** GitHub and Android both cope with this; longer pre-filled links get cut off. */
export const MAX_URL = 7800;

/** One reading every few seconds. -1 / null where the device does not say. */
export type DiagSample = {
  /** Seconds before the report was made. */
  ago: number;
  fps: number;
  frameMs: number;
  tempC: number;
  /** 0..1, 1 = throttling starts. */
  headroom: number;
  memPct: number;
  heapMb: number;
  battery: number;
  watts: number | null;
  draws: number;
  /** Index into the quality ladder (0 = Ultra). */
  rung: number;
};

export type DiagError = { ago: number; message: string; where: string };

export type Diagnostics = {
  v: number;
  when: string;
  /** "0.6.1 android aarch64", or "web". */
  build: string;
  /** What the person said, if anything. */
  note: string;
  device: { ua: string; screen: string; refresh: number; tier: string; renderer: string; cores: number; memoryGb: number };
  quality: { rung: string; auto: boolean; log: string[] };
  gauges: { stat: string; mesh: string; skin: string }[];
  summary: Record<string, { min: number; avg: number; max: number; last: number } | null>;
  samples: DiagSample[];
  errors: DiagError[];
};

const SUMMARY_KEYS = ["fps", "frameMs", "tempC", "headroom", "memPct", "heapMb", "battery", "watts", "draws"] as const;

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

/** min / avg / max / last of each reading, skipping samples where the device said nothing. */
export function summarize(samples: DiagSample[]): Diagnostics["summary"] {
  const out: Diagnostics["summary"] = {};
  for (const key of SUMMARY_KEYS) {
    const values = samples.map((s) => s[key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0);
    out[key] = values.length
      ? { min: round(Math.min(...values), 2), avg: round(values.reduce((a, b) => a + b, 0) / values.length, 2), max: round(Math.max(...values), 2), last: round(values[values.length - 1], 2) }
      : null;
  }
  return out;
}

/** Things worth a look, worked out from the readings, so the issue title says what happened. */
export function findings(d: Diagnostics): string[] {
  const out: string[] = [];
  const s = d.summary;
  if (d.errors.length) out.push(`${d.errors.length} error${d.errors.length === 1 ? "" : "s"}`);
  if (s.fps && s.fps.avg < 30) out.push(`low frame rate (avg ${s.fps.avg} fps)`);
  if (s.headroom && s.headroom.max >= 0.9) out.push(`near throttling (headroom ${s.headroom.max})`);
  if (s.tempC && s.tempC.max >= 42) out.push(`hot (${s.tempC.max} °C)`);
  if (s.memPct && s.memPct.max >= 90) out.push(`memory tight (${s.memPct.max} %)`);
  const downs = d.quality.log.filter((line) => / down to /.test(line)).length;
  if (downs >= 2) out.push(`quality stepped down ${downs} times`);
  return out;
}

export function reportTitle(d: Diagnostics): string {
  const found = findings(d);
  const lead = d.note.trim() ? d.note.trim().replace(/\s+/g, " ").slice(0, 60) : found.length ? found.slice(0, 2).join(", ") : "all well";
  return `[diagnostics] ${lead} · ${d.build}`;
}

const fence = "```";

export function reportBody(d: Diagnostics): string {
  const s = d.summary;
  const row = (label: string, key: keyof Diagnostics["summary"], unit = "") => {
    const v = s[key];
    return v ? `| ${label} | ${v.min} | ${v.avg} | ${v.max} | ${v.last}${unit} |` : `| ${label} | – | – | – | no reading |`;
  };
  const found = findings(d);
  return [
    d.note.trim() ? `> ${d.note.trim().replace(/\n/g, "\n> ")}\n` : "",
    `**${d.build}** · ${d.device.screen} @ ${d.device.refresh} Hz · tier ${d.device.tier} · ${d.device.cores} cores · quality ${d.quality.rung}${d.quality.auto ? " (auto)" : ""}`,
    "",
    found.length ? `Findings: ${found.join("; ")}` : "Findings: none",
    "",
    "| Reading | min | avg | max | last |",
    "| --- | --- | --- | --- | --- |",
    row("Frame rate (fps)", "fps"),
    row("Frame time (ms)", "frameMs"),
    row("Heat (°C)", "tempC"),
    row("Headroom (1 = throttling)", "headroom"),
    row("Memory (%)", "memPct"),
    row("JS heap (MB)", "heapMb"),
    row("Battery (%)", "battery"),
    row("Power (W)", "watts"),
    row("Draw calls", "draws"),
    "",
    d.errors.length ? `Errors:\n${d.errors.map((e) => `- ${e.ago}s ago, ${e.where}: ${e.message}`).join("\n")}\n` : "",
    "<details><summary>Data for the build session</summary>",
    "",
    `${fence}forge-diagnostics`,
    JSON.stringify(d),
    fence,
    "</details>",
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
}

/**
 * The pre-filled "new issue" link. When it is too long: shorten long error messages, thin the
 * samples (keeping at least 8), keep only the last errors and log lines, then thin the samples further.
 */
export function issueUrl(input: Diagnostics, max = MAX_URL): string {
  let d: Diagnostics = { ...input, samples: [...input.samples], errors: [...input.errors], quality: { ...input.quality, log: [...input.quality.log] } };
  const build = () =>
    `https://github.com/${REPORT_REPO}/issues/new?` +
    new URLSearchParams({ title: reportTitle(d), labels: REPORT_LABEL, body: reportBody(d) }).toString();
  const thin = (keep: number) => (d.samples.length > keep ? { ...d, samples: d.samples.filter((_, i, all) => (all.length - 1 - i) % 2 === 0) } : null);
  const steps: (() => Diagnostics | null)[] = [
    () => (d.errors.some((e) => e.message.length > 160) ? { ...d, errors: d.errors.map((e) => ({ ...e, message: e.message.slice(0, 160) })) } : null),
    () => thin(8),
    () => (d.errors.length > 4 ? { ...d, errors: d.errors.slice(-4) } : null),
    () => (d.quality.log.length > 2 ? { ...d, quality: { ...d.quality, log: d.quality.log.slice(-2) } } : null),
    () => thin(2),
  ];
  let url = build();
  for (const step of steps) {
    while (url.length > max) {
      const next = step();
      if (!next) break;
      d = next;
      url = build();
    }
  }
  return url;
}

/** The report inside an issue body, or null if there is none (or it is from a newer Forge). */
export function parseReport(body: string): Diagnostics | null {
  const match = body.match(/```forge-diagnostics\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  try {
    const d = JSON.parse(match[1]) as Diagnostics;
    if (typeof d !== "object" || d === null || d.v !== REPORT_VERSION || !Array.isArray(d.samples)) return null;
    return d;
  } catch {
    return null;
  }
}
