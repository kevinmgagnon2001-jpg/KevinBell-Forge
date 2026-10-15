/**
 * Read the diagnostics reports people sent from the app (src/engine/diagnostics.ts): every open issue
 * labelled "diagnostics", with its findings and readings, newest first. For build sessions and
 * workflows; docs/DIAGNOSTICS.md.
 *
 *   node --experimental-strip-types scripts/diagnostics.ts            summaries
 *   node --experimental-strip-types scripts/diagnostics.ts --json     the parsed reports, as JSON
 *
 * GITHUB_TOKEN (or GH_TOKEN) is used when set; a public repository needs none.
 */
import { findings, parseReport, REPORT_LABEL, REPORT_REPO, type Diagnostics } from "../src/engine/diagnostics.ts";

type Issue = { number: number; title: string; html_url: string; created_at: string; body: string | null; pull_request?: unknown };

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const res = await fetch(`https://api.github.com/repos/${REPORT_REPO}/issues?state=open&labels=${REPORT_LABEL}&per_page=30`, {
  headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
});
if (!res.ok) {
  console.error(`GitHub said ${res.status}: ${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}
const issues = ((await res.json()) as Issue[]).filter((issue) => !issue.pull_request);
const reports = issues.map((issue) => ({ issue: issue.number, url: issue.html_url, title: issue.title, report: parseReport(issue.body ?? "") }));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(reports, null, 2));
} else if (!reports.length) {
  console.log("No open diagnostics reports.");
} else {
  for (const { issue, url, title, report } of reports) {
    console.log(`#${issue} ${title}\n  ${url}`);
    if (!report) {
      console.log("  (no forge-diagnostics block)\n");
      continue;
    }
    const d: Diagnostics = report;
    const s = d.summary;
    const show = (label: string, key: string) => (s[key] ? `${label} ${s[key]!.min}/${s[key]!.avg}/${s[key]!.max}` : null);
    console.log(`  ${d.when} · ${d.build} · ${d.device.screen} · quality ${d.quality.rung}`);
    if (d.note) console.log(`  note: ${d.note}`);
    console.log(`  findings: ${findings(d).join("; ") || "none"}`);
    console.log(`  ${[show("fps", "fps"), show("°C", "tempC"), show("headroom", "headroom"), show("mem%", "memPct"), show("W", "watts")].filter(Boolean).join(" · ")} (min/avg/max)`);
    for (const e of d.errors) console.log(`  error ${e.ago}s ago at ${e.where}: ${e.message}`);
    console.log("");
  }
}
