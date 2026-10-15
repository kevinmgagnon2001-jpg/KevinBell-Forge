import { test } from "node:test";
import assert from "node:assert/strict";
import { findings, issueUrl, MAX_URL, parseReport, REPORT_REPO, reportTitle, summarize, type DiagSample, type Diagnostics } from "./diagnostics.ts";

const sample = (i: number, over: Partial<DiagSample> = {}): DiagSample => ({
  ago: 300 - i * 5,
  fps: 58 + (i % 3),
  frameMs: 17,
  tempC: 36 + i * 0.1,
  headroom: 0.4,
  memPct: 61,
  heapMb: 180,
  battery: 80,
  watts: null,
  draws: 140,
  rung: 0,
  ...over,
});

function report(over: Partial<Diagnostics> = {}): Diagnostics {
  const samples = Array.from({ length: 60 }, (_, i) => sample(i));
  return {
    v: 1,
    when: "2026-10-15T12:00:00.000Z",
    build: "0.6.1 android aarch64",
    note: "",
    device: { ua: "Mozilla/5.0 (Linux; Android 16; SM-S948U)", screen: "412x915@3.5", refresh: 120, tier: "high", renderer: "Adreno (TM) 840", cores: 8, memoryGb: 8 },
    quality: { rung: "Ultra", auto: true, log: [] },
    gauges: [{ stat: "heat", mesh: "thermometer", skin: "brass" }],
    summary: summarize(samples),
    samples,
    errors: [],
    ...over,
  };
}

test("summaries skip readings the device did not give", () => {
  const s = summarize([sample(0), sample(1, { tempC: -1 })]);
  assert.equal(s.tempC?.min, 36);
  assert.equal(s.tempC?.last, 36);
  assert.equal(s.watts, null);
  assert.equal(s.fps?.max, 59);
});

test("findings name what went wrong, and the title leads with the person's note", () => {
  const hot = report({ samples: [sample(0, { fps: 22, headroom: 0.95, tempC: 44 })], errors: [{ ago: 3, message: "boom", where: "Gauges.tsx:12" }] });
  hot.summary = summarize(hot.samples);
  assert.deepEqual(findings(hot), ["1 error", "low frame rate (avg 22 fps)", "near throttling (headroom 0.95)", "hot (44 °C)"]);
  assert.match(reportTitle(hot), /^\[diagnostics\] 1 error, low frame rate/);
  assert.equal(reportTitle(report({ note: "the boiler flickers" })), "[diagnostics] the boiler flickers · 0.6.1 android aarch64");
  assert.match(reportTitle(report()), /all well/);
});

test("the issue link fits, and the report reads back from the issue body", () => {
  const big = report({ errors: Array.from({ length: 12 }, (_, i) => ({ ago: i, message: "x".repeat(300), where: "page" })) });
  const url = issueUrl(big);
  assert.ok(url.length <= MAX_URL, `${url.length}`);
  assert.ok(url.startsWith(`https://github.com/${REPORT_REPO}/issues/new?`));
  const params = new URL(url).searchParams;
  assert.equal(params.get("labels"), "diagnostics");
  const back = parseReport(params.get("body") ?? "");
  assert.ok(back);
  assert.equal(back.build, big.build);
  assert.ok(back.samples.length >= 2 && back.samples.length < big.samples.length);
  // Small reports go through whole.
  const few = Array.from({ length: 5 }, (_, i) => sample(i));
  const small = report({ samples: few, summary: summarize(few) });
  assert.deepEqual(parseReport(new URL(issueUrl(small)).searchParams.get("body") ?? ""), small);
  assert.equal(parseReport("no block here"), null);
  assert.equal(parseReport("```forge-diagnostics\n{\"v\":99}\n```"), null);
});
