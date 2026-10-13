import assert from "node:assert/strict";
import test from "node:test";
import { runGatedScript, runInWorker } from "./script-runtime.ts";

const world: { name: string; tags: string[] }[] = [
  { name: "Bench", tags: ["lab"] },
  { name: "Clay", tags: ["lab", "material"] },
];

const api = (log: string[]) => ({
  log: (text: unknown) => void log.push(String(text)),
  query: (tag: unknown) => world.filter((e) => e.tags.includes(String(tag))).map((e) => e.name),
  spawn: (name: unknown) => {
    world.push({ name: String(name), tags: ["spawned"] });
    return world.length;
  },
});

test("a gated script runs in its own worker and reaches the world only by asking", async () => {
  const log: string[] = [];
  const run = await runGatedScript(
    `export default async function (forge: any) {
       const lab: string[] = await forge.query("lab");
       await forge.log("lab has " + lab.join(", "));
       const count = await forge.spawn("Lantern");
       return { lab: lab.length, count };
     }`,
    "tour.ts",
    api(log),
  );
  assert.equal(run.ok, true, JSON.stringify(run));
  if (!run.ok) return;
  assert.deepEqual(run.value, { lab: 2, count: 3 });
  assert.deepEqual(log, ["lab has Bench, Clay"]);
  assert.equal(run.calls, 3);
});

test("calls the host does not offer are refused inside the script", async () => {
  const run = await runGatedScript(`export default async function (forge: any) { return await forge.deleteEverything(); }`, "x.ts", api([]));
  assert.equal(run.ok, false);
  assert.match(!run.ok && run.stage === "run" ? run.error : "", /forge\.deleteEverything is not offered/);
});

test("the second layer holds even for code that never went through the gate", async () => {
  const cases: [string, RegExp][] = [
    ["export default async () => { await fetch('https://example.com'); }", /fetch is not available/],
    ["export default () => (function () {}).constructor('return 1')()", /Function constructor is not available/],
    ["export default () => eval('1 + 1')", /eval is not available/],
    ["export default () => { Object.prototype.polluted = 1; return ({}).polluted; }", /read only|not extensible|Cannot add property/],
    ["export default () => new Worker('x.js')", /Worker is not available/],
  ];
  for (const [js, why] of cases) {
    const run = await runInWorker(js, {});
    assert.equal(run.ok, false, js);
    assert.match(!run.ok && run.stage === "run" ? run.error : "", why, js);
  }
});

test("a script that never ends is stopped", async () => {
  const run = await runInWorker("export default () => { for (;;) {} }", {}, 300);
  assert.equal(run.ok, false);
  assert.match(!run.ok && run.stage === "run" ? run.error : "", /stopped after 300 ms/);
});

test("scripts the gate refuses never reach a worker", async () => {
  const run = await runGatedScript(`export default () => fetch("https://example.com")`, "x.ts", api([]));
  assert.equal(run.ok, false);
  assert.equal(!run.ok ? run.stage : "", "gate");
});
