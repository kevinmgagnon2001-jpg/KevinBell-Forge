/**
 * Skill registry. A skill is an engine feature: a name, an argument schema, an implementation the
 * sandbox can run, and fixtures that prove it works. A frontier model (or a person) proposes skills;
 * a skill enters the local registry only after every fixture passes here, on this device. After that
 * it runs offline forever. A small model never runs code itself: it only picks a skill and fills its
 * arguments, and those arguments are checked against the schema before anything runs.
 *
 * Implementations
 *   wasm   a WebAssembly module with no imports; the named export takes the schema's arguments in
 *          order (integers as i64 or i32, booleans as 0/1) and returns one number.
 *   linux  a static Linux executable for x86-64 or AArch64, run through Forge's Linux layer.
 *          Arguments arrive on stdin as canonical JSON; the result is read from stdout as JSON.
 */
import { exportSignature, runWasmBounded } from "./bounded.ts";
import { runLinux } from "./guest/linux.ts";
import { readElf } from "./guest/elf.ts";
import { b64url, canonical, fromB64url, sha256 } from "./island.ts";

export type PropSchema =
  | { type: "integer"; minimum?: number; maximum?: number; description?: string }
  | { type: "number"; minimum?: number; maximum?: number; description?: string }
  | { type: "boolean"; description?: string }
  | { type: "string"; enum?: string[]; maxLength?: number; description?: string };
export type ArgSchema = { type: "object"; properties: Record<string, PropSchema>; required?: string[] };

export type SkillImpl = { kind: "wasm"; module: string; export: string } | { kind: "linux"; elf: string };
export type Fixture = { args: Record<string, unknown>; expect: unknown };
export type Skill = {
  name: string;
  version: number;
  description: string;
  examples?: string[];
  schema: ArgSchema;
  impl: SkillImpl;
  fixtures: Fixture[];
  author?: string;
};
export type AcceptedSkill = Skill & { sha256: string; acceptedAt: string };
export type Registry = { version: 1; skills: Record<string, AcceptedSkill> };

export const emptyRegistry = (): Registry => ({ version: 1, skills: {} });

const NAME = /^[a-z][a-z0-9-]{1,47}$/;

// ---------- schema ----------

export function checkSchema(schema: unknown): string | null {
  if (!schema || typeof schema !== "object") return "schema must be an object";
  const s = schema as ArgSchema;
  if (s.type !== "object" || !s.properties || typeof s.properties !== "object") return "schema must be { type: 'object', properties }";
  const names = Object.keys(s.properties);
  if (names.length > 8) return "at most 8 arguments";
  for (const [name, prop] of Object.entries(s.properties)) {
    if (!/^[a-z][a-zA-Z0-9_]{0,31}$/.test(name)) return `bad argument name ${name}`;
    if (!prop || !["integer", "number", "boolean", "string"].includes((prop as PropSchema).type)) return `argument ${name} has an unsupported type`;
  }
  if (s.required && (!Array.isArray(s.required) || s.required.some((r) => !names.includes(r)))) return "required names an unknown argument";
  return null;
}

export function validateArgs(schema: ArgSchema, args: unknown): { ok: true; args: Record<string, unknown> } | { ok: false; reason: string } {
  if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false, reason: "arguments must be an object" };
  const input = args as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!(key in schema.properties)) return { ok: false, reason: `unknown argument ${key}` };
  for (const name of schema.required ?? []) if (input[name] === undefined) return { ok: false, reason: `missing ${name}` };
  for (const [name, prop] of Object.entries(schema.properties)) {
    const v = input[name];
    if (v === undefined) continue;
    if (prop.type === "integer" && !(typeof v === "number" && Number.isSafeInteger(v))) return { ok: false, reason: `${name} must be an integer` };
    if (prop.type === "number" && !(typeof v === "number" && Number.isFinite(v))) return { ok: false, reason: `${name} must be a number` };
    if (prop.type === "boolean" && typeof v !== "boolean") return { ok: false, reason: `${name} must be true or false` };
    if (prop.type === "string") {
      if (typeof v !== "string") return { ok: false, reason: `${name} must be text` };
      if (prop.enum && !prop.enum.includes(v)) return { ok: false, reason: `${name} must be one of ${prop.enum.join(", ")}` };
      if (v.length > (prop.maxLength ?? 1000)) return { ok: false, reason: `${name} is too long` };
    }
    if ((prop.type === "integer" || prop.type === "number") && typeof v === "number") {
      if (prop.minimum !== undefined && v < prop.minimum) return { ok: false, reason: `${name} must be at least ${prop.minimum}` };
      if (prop.maximum !== undefined && v > prop.maximum) return { ok: false, reason: `${name} must be at most ${prop.maximum}` };
    }
  }
  return { ok: true, args: input };
}

// ---------- running ----------

const enc = new TextEncoder();

export async function invokeSkill(skill: Skill, args: Record<string, unknown>, timeoutMs = 2000): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }> {
  const checked = validateArgs(skill.schema, args);
  if (!checked.ok) return checked;
  const order = Object.keys(skill.schema.properties);
  if (skill.impl.kind === "wasm") {
    const bytes = fromB64url(skill.impl.module);
    if (!bytes) return { ok: false, reason: "module is not valid base64url" };
    const sig = exportSignature(bytes, skill.impl.export);
    if (!sig) return { ok: false, reason: `module has no function export ${skill.impl.export}` };
    if (sig.params.length !== order.length) return { ok: false, reason: "export arity does not match the schema" };
    if (sig.results.length !== 1) return { ok: false, reason: "export must return one value" };
    for (const [i, name] of order.entries()) {
      const prop = skill.schema.properties[name];
      if (prop.type === "string") return { ok: false, reason: "wasm skills take numbers and booleans only" };
      if (prop.type === "integer" && !["i32", "i64"].includes(sig.params[i])) return { ok: false, reason: `${name} needs an integer parameter` };
    }
    const values = order.map((name, i) => {
      const v = args[name];
      const n = typeof v === "boolean" ? (v ? 1 : 0) : ((v ?? 0) as number);
      return sig.params[i] === "i64" ? BigInt(Math.trunc(n)) : n;
    });
    const ran = await runWasmBounded(bytes, skill.impl.export, values, timeoutMs);
    if (!ran.ok) return ran;
    const value = typeof ran.value === "bigint" ? (ran.value >= BigInt(Number.MIN_SAFE_INTEGER) && ran.value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(ran.value) : ran.value.toString()) : ran.value;
    return { ok: true, value };
  }
  const elf = fromB64url(skill.impl.elf);
  if (!elf) return { ok: false, reason: "executable is not valid base64url" };
  const report = runLinux(elf, { stdin: enc.encode(canonical(args)), fuel: 200_000_000, memBytes: 16 * 1024 * 1024 });
  if (!report.ok) return { ok: false, reason: report.detail };
  try {
    return { ok: true, value: JSON.parse(report.stdout) };
  } catch {
    return { ok: false, reason: "program output is not JSON" };
  }
}

// ---------- accepting ----------

export async function implHash(impl: SkillImpl): Promise<string> {
  const raw = fromB64url(impl.kind === "wasm" ? impl.module : impl.elf) ?? new Uint8Array();
  return sha256(new Uint8Array([...enc.encode(`${impl.kind}|${impl.kind === "wasm" ? impl.export : ""}|`), ...raw]));
}

export type Verdict = { ok: true; registry: Registry; skill: AcceptedSkill; detail: string } | { ok: false; registry: Registry; reason: string };

/** The only way into the registry: shape checks, then every fixture must pass in the sandbox. */
export async function proposeSkill(registry: Registry, proposal: unknown): Promise<Verdict> {
  const reject = (reason: string): Verdict => ({ ok: false, registry, reason });
  if (!proposal || typeof proposal !== "object") return reject("proposal must be an object");
  const s = proposal as Skill;
  if (typeof s.name !== "string" || !NAME.test(s.name)) return reject("name must be lowercase letters, digits and hyphens");
  if (!Number.isInteger(s.version) || s.version < 1) return reject("version must be a positive integer");
  if (typeof s.description !== "string" || s.description.length < 8 || s.description.length > 300) return reject("description must be 8 to 300 characters");
  const schemaError = checkSchema(s.schema);
  if (schemaError) return reject(schemaError);
  if (!s.impl || (s.impl.kind !== "wasm" && s.impl.kind !== "linux")) return reject("implementation must be wasm or linux");
  if (s.impl.kind === "wasm") {
    const bytes = fromB64url(s.impl.module);
    if (!bytes || !WebAssembly.validate(bytes as BufferSource)) return reject("module is not valid WebAssembly");
    if (WebAssembly.Module.imports(new WebAssembly.Module(bytes as BufferSource)).length) return reject("module asks for imports; skills get none");
  } else {
    const bytes = fromB64url(s.impl.elf);
    const elf = bytes ? readElf(bytes) : null;
    if (!elf || !elf.ok) return reject(`executable rejected: ${elf && !elf.ok ? elf.reason : "bad encoding"}`);
  }
  if (!Array.isArray(s.fixtures) || s.fixtures.length < 1) return reject("at least one fixture is required");
  if (s.fixtures.length > 32) return reject("at most 32 fixtures");
  const existing = registry.skills[s.name];
  if (existing && existing.version >= s.version) return reject(`version ${existing.version} is already installed; propose a higher version`);
  for (const [i, fx] of s.fixtures.entries()) {
    const ran = await invokeSkill(s, fx.args);
    if (!ran.ok) return reject(`fixture ${i + 1} failed to run: ${ran.reason}`);
    if (canonical(ran.value) !== canonical(fx.expect)) return reject(`fixture ${i + 1} expected ${canonical(fx.expect)} but got ${canonical(ran.value)}`);
  }
  const accepted: AcceptedSkill = {
    name: s.name,
    version: s.version,
    description: s.description,
    examples: Array.isArray(s.examples) ? s.examples.filter((x) => typeof x === "string").slice(0, 8) : [],
    schema: s.schema,
    impl: s.impl,
    fixtures: s.fixtures,
    author: typeof s.author === "string" ? s.author.slice(0, 80) : undefined,
    sha256: await implHash(s.impl),
    acceptedAt: new Date().toISOString(),
  };
  return {
    ok: true,
    registry: { version: 1, skills: { ...registry.skills, [s.name]: accepted } },
    skill: accepted,
    detail: `${s.name} v${s.version} passed ${s.fixtures.length} fixture${s.fixtures.length === 1 ? "" : "s"} and is installed locally.`,
  };
}

/** Load a saved registry. Anything whose implementation no longer matches its recorded hash is dropped. */
export async function loadRegistry(saved: unknown): Promise<{ registry: Registry; dropped: string[] }> {
  const registry = emptyRegistry();
  const dropped: string[] = [];
  if (!saved || typeof saved !== "object" || (saved as Registry).version !== 1) return { registry, dropped };
  for (const [name, skill] of Object.entries((saved as Registry).skills ?? {})) {
    if (!skill || skill.name !== name || (await implHash(skill.impl).catch(() => "")) !== skill.sha256) {
      dropped.push(name);
      continue;
    }
    registry.skills[name] = skill;
  }
  return { registry, dropped };
}

// ---------- routing ----------

export type Pick = { skill: string; args: Record<string, unknown> };
/** A small local model, or anything else, that maps intent to a pick. Its output is never trusted. */
export type Picker = (intent: string, catalog: { name: string; description: string; schema: ArgSchema; examples: string[] }[]) => Promise<Pick | null> | Pick | null;

export type RouteResult =
  | { status: "ran"; skill: string; args: Record<string, unknown>; value: unknown }
  | { status: "needs"; skill: string; reason: string }
  | { status: "failed"; skill: string; reason: string }
  | { status: "none"; reason: string };

const STOP = new Set(["the", "a", "an", "of", "to", "is", "what", "whats", "what's", "me", "please", "for", "and", "in", "on", "with", "my", "give", "tell", "find", "compute", "calculate", "get"]);
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w))
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));

/** Default picker: word overlap with the skill's name, description and examples; numbers fill numeric arguments in order. */
export const lexicalPicker: Picker = (intent, catalog) => {
  const want = new Set(words(intent));
  let best: { name: string; score: number } | null = null;
  for (const skill of catalog) {
    const vocab = new Set(words(`${skill.name} ${skill.description} ${skill.examples.join(" ")}`));
    let score = 0;
    for (const w of want) if (vocab.has(w)) score += words(skill.name).includes(w) ? 3 : 1;
    if (score > 0 && (!best || score > best.score)) best = { name: skill.name, score };
  }
  if (!best) return null;
  const skill = catalog.find((s) => s.name === best!.name)!;
  const numbers = [...intent.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  const quoted = [...intent.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  const args: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(skill.schema.properties)) {
    if ((prop.type === "integer" || prop.type === "number") && numbers.length) args[name] = numbers.shift();
    else if (prop.type === "string" && prop.enum) {
      const hit = prop.enum.find((option) => intent.toLowerCase().includes(option.toLowerCase()));
      if (hit) args[name] = hit;
    } else if (prop.type === "string" && quoted.length) args[name] = quoted.shift();
    else if (prop.type === "boolean") args[name] = /\b(yes|true|on)\b/i.test(intent);
  }
  return { skill: skill.name, args };
};

export async function route(registry: Registry, intent: string, picker: Picker = lexicalPicker): Promise<RouteResult> {
  const catalog = Object.values(registry.skills).map((s) => ({ name: s.name, description: s.description, schema: s.schema, examples: s.examples ?? [] }));
  if (!catalog.length) return { status: "none", reason: "no skills are installed" };
  let pick: Pick | null = null;
  try {
    pick = await picker(intent, catalog);
  } catch (error) {
    return { status: "none", reason: `picker failed: ${String(error)}` };
  }
  if (!pick || typeof pick.skill !== "string") return { status: "none", reason: "no installed skill matches" };
  const skill = registry.skills[pick.skill];
  if (!skill) return { status: "none", reason: `picker chose ${pick.skill}, which is not installed` };
  const checked = validateArgs(skill.schema, pick.args ?? {});
  if (!checked.ok) return { status: "needs", skill: skill.name, reason: checked.reason };
  const ran = await invokeSkill(skill, checked.args);
  return ran.ok ? { status: "ran", skill: skill.name, args: checked.args, value: ran.value } : { status: "failed", skill: skill.name, reason: ran.reason };
}

export const encodeBytes = b64url;
