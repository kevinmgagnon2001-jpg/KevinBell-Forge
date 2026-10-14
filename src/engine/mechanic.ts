/**
 * Mechanics you carry. A mechanic is how something moves (walking, a car, a plane, anything someone
 * invents), packed so it can travel with its owner through a portal and run on any island, any device.
 *
 * Portable: a mechanic is a small WebAssembly module, the engine's common bytecode. It does arithmetic
 * on a fixed block of numbers: the mover's state (where it is, which way it faces, how fast it goes,
 * and seven numbers of its own) and this frame's input (forward, strafe, turn, steer, lift, dt,
 * action). The same bytes run in the browser, in Node and in wasmtime, with the same IEEE results.
 *
 * Safe to run from a stranger, at once: before a module is ever instantiated, checkMover() reads every
 * instruction and accepts only plain arithmetic, locals, memory reads and writes, and forward branches.
 * No loops, no calls, no imports, no growing memory, no hidden state (globals are read-only and memory
 * is reset before every step). So a step can do nothing but compute, and it ends after at most as many
 * instructions as it has: there is nothing to time out.
 *
 * Exactly the same everywhere: a package carries fixtures (inputs and the exact outputs its author got).
 * A receiving engine reruns every one and must get the same bits, or it refuses the package. That is
 * what lets a visitor predict its own movement while the host runs the same mechanic as the authority,
 * with nothing to correct: the transition is seamless in function, whatever the network does.
 *
 * Signed: the author's identity (island.ts) signs the package, so a mechanic keeps its author's name
 * wherever it is carried or kept, and cannot be altered on the way.
 *
 * Mechanics can be written as a recipe (a few lines of arithmetic, compiled here to checked
 * WebAssembly) or as WebAssembly made any other way, as long as it passes checkMover().
 */
import { b64url, canonical, fromB64url, idOf, sha256, type Identity } from "./island.ts";
import { signText, verifyText } from "./device-link.ts";
import type { MoveInput, MoveRule, MoveState } from "./prediction.ts";

// ---------- the block of numbers ----------

export const STATE_NAMES = ["x", "y", "z", "yaw", "pitch", "speed", "vx", "vy", "vz"] as const;
export const CUSTOM_SLOTS = 7;
export const STATE_SLOTS = STATE_NAMES.length + CUSTOM_SLOTS; // 16
export const INPUT_NAMES = ["forward", "strafe", "turn", "steer", "lift", "dt", "action"] as const;
export const INPUT_SLOTS = 8;
/** Byte offsets in the module's memory. */
export const STATE_AT = 0;
export const INPUT_AT = STATE_SLOTS * 8; // 128

export const LOOKS = ["walker", "car", "plane", "hover"] as const;
export type Look = (typeof LOOKS)[number];

/** A frame of input as a mechanic sees it. A steers left (+1), D right (-1); lift is Space (+1) / Shift (-1). */
export type MechanicInput = { forward: number; strafe: number; turn: number; steer: number; lift: number; dt: number; action: number };

const MAX_WASM = 16 * 1024;

// ---------- reading and checking a module ----------

class Reader {
  at = 0;
  bytes: Uint8Array;
  constructor(bytes: Uint8Array, at = 0) {
    this.bytes = bytes;
    this.at = at;
  }
  get done() {
    return this.at >= this.bytes.length;
  }
  byte(): number {
    if (this.at >= this.bytes.length) throw new Error("module ends early");
    return this.bytes[this.at++];
  }
  u32(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      result += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) break;
      shift += 7;
      if (shift > 35) throw new Error("number too long");
    }
    return result;
  }
  /** Skip a signed LEB128 of at most `bits` bits. */
  sleb(bits: number) {
    for (let n = 0; ; n += 7) {
      if (n > bits + 7) throw new Error("number too long");
      if (!(this.byte() & 0x80)) break;
    }
  }
  skip(n: number) {
    if (this.at + n > this.bytes.length) throw new Error("module ends early");
    this.at += n;
  }
  name(): string {
    const n = this.u32();
    const start = this.at;
    this.skip(n);
    return new TextDecoder().decode(this.bytes.subarray(start, start + n));
  }
}

const VALTYPES = new Set([0x7f, 0x7e, 0x7d, 0x7c]);

/** Every instruction a mechanic may use, with how to skip its operands. */
function checkBody(r: Reader, end: number, globalsMutable: boolean[]): string | null {
  let depth = 1;
  while (r.at < end) {
    const op = r.byte();
    if (op === 0x03) return "loops are not allowed";
    if (op === 0x10 || op === 0x11 || op === 0x12 || op === 0x13) return "calls are not allowed";
    if (op === 0x40) return "memory.grow is not allowed";
    if (op === 0x24) return "writing globals is not allowed (no hidden state)";
    if (op === 0x00 || op === 0x01 || op === 0x0f || op === 0x1a || op === 0x1b || op === 0x05) continue;
    if (op === 0x02 || op === 0x04) {
      const bt = r.byte();
      if (bt !== 0x40 && !VALTYPES.has(bt)) return "block types other than a single value are not allowed";
      depth += 1;
      continue;
    }
    if (op === 0x0b) {
      depth -= 1;
      if (depth === 0) return r.at === end ? null : "code after the end of the function";
      continue;
    }
    if (op === 0x0c || op === 0x0d) {
      r.u32();
      continue;
    }
    if (op === 0x0e) {
      const n = r.u32();
      if (n > 64) return "br_table is too large";
      for (let i = 0; i <= n; i += 1) r.u32();
      continue;
    }
    if (op >= 0x20 && op <= 0x22) {
      r.u32();
      continue;
    }
    if (op === 0x23) {
      const g = r.u32();
      if (globalsMutable[g] !== false) return "reads an unknown global";
      continue;
    }
    if (op >= 0x28 && op <= 0x3e) {
      r.u32();
      r.u32();
      continue;
    }
    if (op === 0x3f) {
      if (r.byte() !== 0) return "bad memory.size";
      continue;
    }
    if (op === 0x41) {
      r.sleb(32);
      continue;
    }
    if (op === 0x42) {
      r.sleb(64);
      continue;
    }
    if (op === 0x43) {
      r.skip(4);
      continue;
    }
    if (op === 0x44) {
      r.skip(8);
      continue;
    }
    if (op >= 0x45 && op <= 0xc4) continue;
    if (op === 0xfc) {
      const sub = r.u32();
      if (sub <= 7) continue; // saturating truncations
      return "bulk memory and table instructions are not allowed";
    }
    return `instruction 0x${op.toString(16)} is not allowed in a mechanic`;
  }
  return "function has no end";
}

export type MoverCheck = { ok: true } | { ok: false; reason: string };

/**
 * Is this module a mechanic any island may run? Exports exactly `memory` (one page, fixed) and
 * `step: () -> ()`, imports nothing, and its one function is loop-free and call-free.
 */
export function checkMover(bytes: Uint8Array): MoverCheck {
  const fail = (reason: string): MoverCheck => ({ ok: false, reason });
  if (bytes.length > MAX_WASM) return fail(`a mechanic is at most ${MAX_WASM / 1024} KB`);
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d || bytes[4] !== 1) return fail("not a WebAssembly module");
  try {
    const r = new Reader(bytes, 8);
    let types: { params: number[]; results: number[] }[] = [];
    let funcTypes: number[] = [];
    let memories = 0;
    const globalsMutable: boolean[] = [];
    const exports = new Map<string, { kind: number; index: number }>();
    let bodies = 0;
    let last = 0;
    while (!r.done) {
      const id = r.byte();
      const size = r.u32();
      const end = r.at + size;
      if (end > bytes.length) return fail("a section runs past the end");
      if (id !== 0 && id !== 12) {
        if (id <= last) return fail("sections out of order");
        last = id;
      }
      if (id === 0) {
        r.at = end;
        continue;
      }
      if (id === 1) {
        const n = r.u32();
        types = [];
        for (let i = 0; i < n; i += 1) {
          if (r.byte() !== 0x60) return fail("bad function type");
          const params = Array.from({ length: r.u32() }, () => r.byte());
          const results = Array.from({ length: r.u32() }, () => r.byte());
          types.push({ params, results });
        }
      } else if (id === 2) {
        if (r.u32() !== 0) return fail("a mechanic imports nothing");
      } else if (id === 3) {
        funcTypes = Array.from({ length: r.u32() }, () => r.u32());
        if (funcTypes.length !== 1) return fail("a mechanic has exactly one function");
      } else if (id === 4) {
        if (r.u32() !== 0) return fail("tables are not allowed");
      } else if (id === 5) {
        memories = r.u32();
        if (memories !== 1) return fail("a mechanic has exactly one memory");
        const flags = r.byte();
        const min = r.u32();
        if (flags !== 1) return fail("memory must have a fixed size (max 1 page)");
        const max = r.u32();
        if (min !== 1 || max !== 1) return fail("memory must be exactly one page");
      } else if (id === 6) {
        const n = r.u32();
        for (let i = 0; i < n; i += 1) {
          const type = r.byte();
          const mutable = r.byte();
          if (!VALTYPES.has(type)) return fail("bad global type");
          if (mutable !== 0) return fail("mutable globals are not allowed (no hidden state)");
          globalsMutable.push(false);
          const op = r.byte();
          if (op === 0x41) r.sleb(32);
          else if (op === 0x42) r.sleb(64);
          else if (op === 0x43) r.skip(4);
          else if (op === 0x44) r.skip(8);
          else return fail("globals must be constants");
          if (r.byte() !== 0x0b) return fail("bad global");
        }
      } else if (id === 7) {
        const n = r.u32();
        for (let i = 0; i < n; i += 1) {
          const name = r.name();
          const kind = r.byte();
          const index = r.u32();
          exports.set(name, { kind, index });
        }
      } else if (id === 8) {
        return fail("a start function is not allowed");
      } else if (id === 9) {
        return fail("table elements are not allowed");
      } else if (id === 10) {
        const n = r.u32();
        if (n !== 1) return fail("a mechanic has exactly one function body");
        const size = r.u32();
        const bodyEnd = r.at + size;
        const groups = r.u32();
        let locals = 0;
        for (let i = 0; i < groups; i += 1) {
          locals += r.u32();
          if (!VALTYPES.has(r.byte())) return fail("bad local type");
        }
        if (locals > 512) return fail("too many locals");
        const problem = checkBody(r, bodyEnd, globalsMutable);
        if (problem) return fail(problem);
        bodies = 1;
      } else if (id === 11) {
        const n = r.u32();
        for (let i = 0; i < n; i += 1) {
          if (r.u32() !== 0) return fail("only active data for memory 0 is allowed");
          if (r.byte() !== 0x41) return fail("data offsets must be constants");
          r.sleb(32);
          if (r.byte() !== 0x0b) return fail("bad data offset");
          r.skip(r.u32());
        }
      } else if (id === 12) {
        r.u32();
      } else {
        return fail(`section ${id} is not allowed`);
      }
      if (r.at !== end) return fail(`section ${id} has the wrong size`);
    }
    if (!bodies) return fail("a mechanic needs its step function");
    const step = exports.get("step");
    const memory = exports.get("memory");
    if (exports.size !== 2 || !step || step.kind !== 0 || !memory || memory.kind !== 2) return fail("a mechanic exports exactly `memory` and `step`");
    const type = types[funcTypes[step.index]];
    if (!type || type.params.length || type.results.length) return fail("step takes nothing and returns nothing");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "module could not be read");
  }
  if (typeof WebAssembly !== "undefined" && !WebAssembly.validate(bytes as BufferSource)) return fail("WebAssembly rejected the module");
  return { ok: true };
}

// ---------- running one ----------

/** A checked mechanic, ready to step. Memory is reset before every step, so a step depends only on its inputs. */
export class MoverRuntime {
  private memory: Uint8Array;
  private numbers: Float64Array;
  private pristine: Uint8Array;
  private run: () => void;

  constructor(bytes: Uint8Array) {
    const checked = checkMover(bytes);
    if (!checked.ok) throw new Error(checked.reason);
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource), {});
    const exported = instance.exports as { memory: WebAssembly.Memory; step: () => void };
    this.memory = new Uint8Array(exported.memory.buffer);
    this.numbers = new Float64Array(exported.memory.buffer, 0, STATE_SLOTS + INPUT_SLOTS);
    this.pristine = this.memory.slice();
    this.run = exported.step;
  }

  /** One step. Returns null when the mechanic traps (the caller keeps the old state). */
  step(state: ArrayLike<number>, input: MechanicInput): number[] | null {
    this.memory.set(this.pristine);
    for (let i = 0; i < STATE_SLOTS; i += 1) this.numbers[i] = Number(state[i]) || 0;
    const ins = [input.forward, input.strafe, input.turn, input.steer, input.lift, input.dt, input.action, 0];
    for (let i = 0; i < INPUT_SLOTS; i += 1) this.numbers[STATE_SLOTS + i] = Number.isFinite(ins[i]) ? ins[i] : 0;
    try {
      this.run();
    } catch {
      return null;
    }
    return Array.from(this.numbers.subarray(0, STATE_SLOTS));
  }
}

// ---------- recipes: a few lines of arithmetic, compiled to a checked module ----------

/**
 * A mechanic written as arithmetic. `set` runs in order; each line assigns a state number from an
 * expression over the state, the input and `pi`. Operators: + - * / ( ), comparisons and && || ! (true
 * is 1), and the functions sin cos sqrt abs min max clamp floor ceil sign if(cond, then, else).
 */
export type Recipe = { name: string; look: Look; summary?: string; vars?: string[]; set: [string, string][] };

type Node = { k: "num"; v: number } | { k: "var"; i: number } | { k: "un"; op: string; a: Node } | { k: "bin"; op: string; a: Node; b: Node } | { k: "call"; f: string; args: Node[] };

const FUNCS: Record<string, number> = { sin: 1, cos: 1, sqrt: 1, abs: 1, floor: 1, ceil: 1, sign: 1, min: 2, max: 2, clamp: 3, if: 3 };

function parseExpr(text: string, names: Map<string, number>): Node {
  const tokens = text.match(/\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|<=|>=|==|!=|&&|\|\||[-+*/(),<>!]|\S/gi) ?? [];
  let at = 0;
  let depth = 0;
  const peek = () => tokens[at];
  const take = (want?: string) => {
    const t = tokens[at];
    if (want !== undefined && t !== want) throw new Error(`expected "${want}" but found "${t ?? "the end"}"`);
    at += 1;
    return t;
  };
  const deeper = <T>(fn: () => T): T => {
    if (++depth > 40) throw new Error("expression is nested too deeply");
    try {
      return fn();
    } finally {
      depth -= 1;
    }
  };
  const level = (ops: string[], next: () => Node) => (): Node => {
    let left = next();
    while (ops.includes(peek())) {
      const op = take();
      left = { k: "bin", op, a: left, b: next() };
    }
    return left;
  };
  const primary = (): Node =>
    deeper(() => {
      const t = take();
      if (t === undefined) throw new Error("expression ends early");
      if (t === "(") {
        const inner = or();
        take(")");
        return inner;
      }
      if (t === "-" || t === "!") return { k: "un", op: t, a: primary() };
      if (/^(\d|\.\d)/.test(t)) {
        const v = Number(t);
        if (!Number.isFinite(v)) throw new Error(`bad number ${t}`);
        return { k: "num", v };
      }
      if (/^[A-Za-z_]/.test(t)) {
        if (t === "pi") return { k: "num", v: Math.PI };
        if (peek() === "(") {
          const arity = FUNCS[t];
          if (arity === undefined) throw new Error(`unknown function ${t}`);
          take("(");
          const args: Node[] = [or()];
          while (peek() === ",") {
            take(",");
            args.push(or());
          }
          take(")");
          if (args.length !== arity) throw new Error(`${t} takes ${arity} argument${arity === 1 ? "" : "s"}`);
          return { k: "call", f: t, args };
        }
        const i = names.get(t);
        if (i === undefined) throw new Error(`unknown name ${t}`);
        return { k: "var", i };
      }
      throw new Error(`unexpected "${t}"`);
    });
  const mul = level(["*", "/"], primary);
  const add = level(["+", "-"], mul);
  const cmp = level(["<", ">", "<=", ">=", "==", "!="], add);
  const and = level(["&&"], cmp);
  const or = level(["||"], and);
  const tree = or();
  if (at !== tokens.length) throw new Error(`unexpected "${tokens[at]}"`);
  return tree;
}

const u32 = (n: number): number[] => {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
};
const f64 = (v: number): number[] => Array.from(new Uint8Array(new Float64Array([v]).buffer));
const section = (id: number, body: number[]) => [id, ...u32(body.length), ...body];
const vec = (items: number[][]) => [...u32(items.length), ...items.flat()];
const str = (s: string) => [...u32(s.length), ...Array.from(new TextEncoder().encode(s))];

const OPS: Record<string, number[]> = {
  "+": [0xa0], "-": [0xa1], "*": [0xa2], "/": [0xa3],
  "<": [0x63, 0xb8], ">": [0x64, 0xb8], "<=": [0x65, 0xb8], ">=": [0x66, 0xb8], "==": [0x61, 0xb8], "!=": [0x62, 0xb8],
};
// sin by range reduction and a Taylor series to x^17 (error below 1e-13 on [-pi/2, pi/2]).
const SIN_COEFFS = [1 / 6, 1 / 120, 1 / 5040, 1 / 362880, 1 / 39916800, 1 / 6227020800, 1 / 1307674368000, 1 / 355687428096000].map((c, i) => (i % 2 ? c : -c));

/** Compile a recipe to a module that passes checkMover(). */
export function compileRecipe(recipe: Recipe): Uint8Array {
  if (!recipe || typeof recipe.name !== "string" || !recipe.name.trim() || recipe.name.length > 40) throw new Error("a recipe needs a name (up to 40 characters)");
  if (!LOOKS.includes(recipe.look)) throw new Error(`look must be one of ${LOOKS.join(", ")}`);
  const vars = recipe.vars ?? [];
  if (!Array.isArray(vars) || vars.length > CUSTOM_SLOTS) throw new Error(`a recipe has at most ${CUSTOM_SLOTS} names of its own`);
  const names = new Map<string, number>();
  STATE_NAMES.forEach((n, i) => names.set(n, i));
  for (const [i, v] of vars.entries()) {
    if (!/^[a-z][a-z0-9_]{0,15}$/i.test(v) || names.has(v) || (INPUT_NAMES as readonly string[]).includes(v) || v in FUNCS || v === "pi") throw new Error(`bad name ${v}`);
    names.set(v, STATE_NAMES.length + i);
  }
  const stateCount = STATE_NAMES.length + vars.length;
  INPUT_NAMES.forEach((n, i) => names.set(n, STATE_SLOTS + i));
  if (!Array.isArray(recipe.set) || !recipe.set.length || recipe.set.length > 64) throw new Error("a recipe has 1 to 64 lines");

  let temps = STATE_SLOTS + INPUT_SLOTS;
  const code: number[] = [];
  const emit = (node: Node) => {
    switch (node.k) {
      case "num":
        code.push(0x44, ...f64(node.v));
        return;
      case "var":
        code.push(0x20, ...u32(node.i));
        return;
      case "un":
        emit(node.a);
        if (node.op === "-") code.push(0x9a);
        else code.push(0x44, ...f64(0), 0x61, 0xb8);
        return;
      case "bin":
        if (node.op === "&&" || node.op === "||") {
          emit(node.a);
          code.push(0x44, ...f64(0), 0x62);
          emit(node.b);
          code.push(0x44, ...f64(0), 0x62, node.op === "&&" ? 0x71 : 0x72, 0xb8);
          return;
        }
        emit(node.a);
        emit(node.b);
        code.push(...OPS[node.op]);
        return;
      case "call": {
        const [a, b, c] = node.args;
        if (node.f === "sqrt") return void (emit(a), code.push(0x9f));
        if (node.f === "abs") return void (emit(a), code.push(0x99));
        if (node.f === "floor") return void (emit(a), code.push(0x9c));
        if (node.f === "ceil") return void (emit(a), code.push(0x9b));
        if (node.f === "min") return void (emit(a), emit(b), code.push(0xa4));
        if (node.f === "max") return void (emit(a), emit(b), code.push(0xa5));
        if (node.f === "clamp") return void (emit(a), emit(b), code.push(0xa5), emit(c), code.push(0xa4));
        if (node.f === "if") {
          emit(b);
          emit(c);
          emit(a);
          code.push(0x44, ...f64(0), 0x62, 0x1b);
          return;
        }
        if (node.f === "sign") {
          const t = temps++;
          emit(a);
          code.push(0x21, ...u32(t));
          code.push(0x20, ...u32(t), 0x44, ...f64(0), 0x64, 0xb8, 0x20, ...u32(t), 0x44, ...f64(0), 0x63, 0xb8, 0xa1);
          return;
        }
        // sin and cos
        const r = temps++;
        const q = temps++;
        emit(a);
        if (node.f === "cos") code.push(0x44, ...f64(Math.PI / 2), 0xa0);
        code.push(0x21, ...u32(r));
        // r -= 2pi * nearest(r / 2pi): now in [-pi, pi]
        code.push(0x20, ...u32(r), 0x20, ...u32(r), 0x44, ...f64(1 / (2 * Math.PI)), 0xa2, 0x9e, 0x44, ...f64(2 * Math.PI), 0xa2, 0xa1, 0x21, ...u32(r));
        // fold into [-pi/2, pi/2]
        code.push(0x44, ...f64(Math.PI), 0x20, ...u32(r), 0xa1, 0x20, ...u32(r), 0x20, ...u32(r), 0x44, ...f64(Math.PI / 2), 0x64, 0x1b, 0x21, ...u32(r));
        code.push(0x44, ...f64(-Math.PI), 0x20, ...u32(r), 0xa1, 0x20, ...u32(r), 0x20, ...u32(r), 0x44, ...f64(-Math.PI / 2), 0x63, 0x1b, 0x21, ...u32(r));
        code.push(0x20, ...u32(r), 0x20, ...u32(r), 0xa2, 0x21, ...u32(q));
        const coeffs = [...SIN_COEFFS].reverse();
        code.push(0x44, ...f64(coeffs[0]));
        for (const k of coeffs.slice(1)) code.push(0x20, ...u32(q), 0xa2, 0x44, ...f64(k), 0xa0);
        code.push(0x20, ...u32(q), 0xa2, 0x44, ...f64(1), 0xa0, 0x20, ...u32(r), 0xa2);
        return;
      }
    }
  };

  // Load the state and the input into locals.
  for (let i = 0; i < STATE_SLOTS + INPUT_SLOTS; i += 1) {
    if (i >= stateCount && i < STATE_SLOTS) continue;
    code.push(0x41, 0, 0x2b, 3, ...u32(i * 8), 0x21, ...u32(i));
  }
  for (const line of recipe.set) {
    if (!Array.isArray(line) || line.length !== 2 || typeof line[0] !== "string" || typeof line[1] !== "string") throw new Error("each line is [name, expression]");
    const [target, expr] = line;
    const slot = names.get(target);
    if (slot === undefined || slot >= STATE_SLOTS) throw new Error(`${target} is not a state name (inputs cannot be assigned)`);
    if (expr.length > 2000) throw new Error(`the expression for ${target} is too long`);
    try {
      emit(parseExpr(expr, names));
    } catch (error) {
      throw new Error(`${target}: ${error instanceof Error ? error.message : String(error)}`);
    }
    code.push(0x21, ...u32(slot));
  }
  for (let i = 0; i < stateCount; i += 1) code.push(0x41, 0, 0x20, ...u32(i), 0x39, 3, ...u32(i * 8));
  code.push(0x0b);

  const body = [...vec([[...u32(temps), 0x7c]]), ...code];
  const bytes = [
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0, 0]])),
    ...section(3, vec([[0]])),
    ...section(5, vec([[0x01, 1, 1]])),
    ...section(7, vec([[...str("memory"), 0x02, 0], [...str("step"), 0x00, 0]])),
    ...section(10, vec([[...u32(body.length), ...body]])),
  ];
  return new Uint8Array(bytes);
}

// ---------- the built-in mechanics ----------

export const WALK: Recipe = {
  name: "Walk",
  look: "walker",
  summary: "On foot: W/S walk, A/D turn (or strafe in first person), Space/Shift rise and sink.",
  set: [
    ["yaw", "yaw + clamp(turn, -pi, pi)"],
    ["vx", "clamp(forward, -1, 1)"],
    ["vz", "clamp(strafe, -1, 1)"],
    ["vy", "sqrt(vx * vx + vz * vz)"],
    ["vx", "if(vy > 1, vx / vy, vx)"],
    ["vz", "if(vy > 1, vz / vy, vz)"],
    ["speed", "min(vy, 1) * 4.6"],
    ["x", "x + (sin(yaw) * vx - cos(yaw) * vz) * 4.6 * dt"],
    ["z", "z + (cos(yaw) * vx + sin(yaw) * vz) * 4.6 * dt"],
    ["y", "y + clamp(lift, -1, 1) * 4.6 * dt"],
    ["vy", "0"],
  ],
};

export const CAR: Recipe = {
  name: "Car",
  look: "car",
  summary: "W accelerates, S brakes then reverses, A/D steer. Turns only while rolling.",
  set: [
    ["speed", "speed + (clamp(forward, -1, 1) * if(forward * speed < 0, 18, 9) - speed * 0.35 - sign(speed) * 0.6 * if(abs(speed) > 0.6, 1, 0)) * dt"],
    ["speed", "if(abs(speed) < 0.05 && abs(forward) < 0.01, 0, clamp(speed, -6, 24))"],
    ["yaw", "yaw + clamp(steer, -1, 1) * speed * 0.16 / (1 + abs(speed) * 0.06) * dt"],
    ["vx", "sin(yaw) * speed"],
    ["vz", "cos(yaw) * speed"],
    ["x", "x + vx * dt"],
    ["z", "z + vz * dt"],
  ],
};

export const PLANE: Recipe = {
  name: "Plane",
  look: "plane",
  summary: "W/S throttle, Space/Shift pitch up and down, A/D bank. Needs speed to climb.",
  vars: ["throttle"],
  set: [
    ["throttle", "clamp(throttle + clamp(forward, -1, 1) * 0.5 * dt, 0, 1)"],
    ["speed", "speed + (throttle * 30 - speed * 0.45 - sin(pitch) * 9.8) * dt"],
    ["speed", "clamp(speed, 0, 48)"],
    ["pitch", "clamp(pitch + clamp(lift, -1, 1) * 0.9 * dt, -0.6, 0.6)"],
    ["pitch", "if(y <= 0.46 && pitch < 0, 0, pitch)"],
    ["yaw", "yaw + clamp(steer, -1, 1) * 0.9 * min(speed / 14, 1) * dt"],
    ["vy", "sin(pitch) * speed - max(0, 14 - speed) * 0.5"],
    ["vx", "sin(yaw) * cos(pitch) * speed"],
    ["vz", "cos(yaw) * cos(pitch) * speed"],
    ["x", "x + vx * dt"],
    ["z", "z + vz * dt"],
    ["y", "max(0.45, y + vy * dt)"],
  ],
};

export const BUILT_IN: Recipe[] = [WALK, CAR, PLANE];

/** "Name: …", "Look: …", "Vars: a, b" and "target = expression" lines into a recipe. */
export function readRecipe(text: string): Recipe {
  let name = "";
  let look: Look = "walker";
  let vars: string[] = [];
  const set: [string, string][] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = /^(name|look|vars)\s*:\s*(.*)$/i.exec(line);
    if (header) {
      const key = header[1].toLowerCase();
      if (key === "name") name = header[2].trim();
      else if (key === "look") look = header[2].trim().toLowerCase() as Look;
      else vars = header[2].split(",").map((v) => v.trim()).filter(Boolean);
      continue;
    }
    const assign = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line);
    if (!assign) throw new Error(`I can't read this line: ${line}`);
    set.push([assign[1], assign[2]]);
  }
  if (!LOOKS.includes(look)) throw new Error(`Look must be one of ${LOOKS.join(", ")}`);
  return { name, look, vars, set, summary: "Made in Forge's mechanic editor." };
}


// ---------- packages: signed, with fixtures ----------

export type Fixture = { state: number[]; input: number[]; expect: number[] };

export type MechanicPackage = {
  forge: "mechanic";
  version: 1;
  kind: "mover";
  name: string;
  look: Look;
  summary: string;
  /** The module, base64url. */
  wasm: string;
  /** sha256 of the module bytes (base64url): the mechanic's identity. */
  hash: string;
  /** Where it came from, when it was written as a recipe. Informational: the module is what runs. */
  recipe?: Recipe;
  author: { id: string; key: string; name: string };
  createdAt: number;
  fixtures: Fixture[];
  signature: string;
};

export const PACKAGE_LIMIT = 96 * 1024;

const packageText = (p: Omit<MechanicPackage, "signature">) => `mechanic|${canonical(p)}`;

const inputArray = (i: MechanicInput) => [i.forward, i.strafe, i.turn, i.steer, i.lift, i.dt, i.action, 0];
const inputFrom = (a: number[]): MechanicInput => ({ forward: a[0], strafe: a[1], turn: a[2], steer: a[3], lift: a[4], dt: a[5], action: a[6] });

/** A short drive through every input, used to make fixtures: the same for every mechanic. */
const FIXTURE_DRIVE: MechanicInput[] = [
  { forward: 1, strafe: 0, turn: 0, steer: 0, lift: 0, dt: 1 / 60, action: 0 },
  { forward: 1, strafe: 0, turn: 0.03, steer: 1, lift: 0, dt: 1 / 30, action: 0 },
  { forward: 1, strafe: 0.5, turn: -0.02, steer: -1, lift: 1, dt: 0.05, action: 1 },
  { forward: 0, strafe: -1, turn: 0, steer: 0.5, lift: 1, dt: 0.1, action: 0 },
  { forward: -1, strafe: 0, turn: 0.4, steer: 0, lift: -1, dt: 1 / 60, action: 0 },
  { forward: 0.5, strafe: 1, turn: -1, steer: -0.25, lift: 0, dt: 0.02, action: 1 },
];

export async function packMechanic(source: Recipe | { wasm: Uint8Array; name: string; look: Look; summary?: string }, author: Identity, authorName: string, now = Date.now()): Promise<MechanicPackage> {
  const isRecipe = "set" in source;
  const bytes = isRecipe ? compileRecipe(source) : source.wasm;
  const runtime = new MoverRuntime(bytes);
  const fixtures: Fixture[] = [];
  // Start a little above the ground, already moving, then drive through the inputs twice.
  let state = [1.5, 1.2, -2, 0.3, 0, 6, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0];
  for (const input of [...FIXTURE_DRIVE, ...FIXTURE_DRIVE]) {
    const out = runtime.step(state, input);
    if (!out) throw new Error("the mechanic stopped with an error on a test drive");
    if (!out.every(Number.isFinite)) throw new Error("the mechanic produced a number that is not finite on a test drive");
    fixtures.push({ state: [...state], input: inputArray(input), expect: out });
    state = out;
  }
  const body: Omit<MechanicPackage, "signature"> = {
    forge: "mechanic",
    version: 1,
    kind: "mover",
    name: source.name.trim().slice(0, 40),
    look: source.look,
    summary: (source.summary ?? "").slice(0, 200),
    wasm: b64url(bytes),
    hash: await sha256(bytes),
    ...(isRecipe ? { recipe: source } : {}),
    author: { id: author.id, key: author.publicKey, name: authorName.slice(0, 40) },
    createdAt: now,
    fixtures,
  };
  return { ...body, signature: await signText(author.privateKey, packageText(body)) };
}

export type PackageCheck = { ok: true; runtime: MoverRuntime; bytes: Uint8Array } | { ok: false; reason: string };

/**
 * Everything a receiving engine checks before running a mechanic someone else wrote: the shape, the
 * author's signature, the module (checkMover), and every fixture, bit for bit.
 */
export async function checkMechanic(value: unknown): Promise<PackageCheck> {
  const fail = (reason: string): PackageCheck => ({ ok: false, reason });
  const p = value as MechanicPackage;
  if (!p || p.forge !== "mechanic" || p.version !== 1 || p.kind !== "mover") return fail("not a mechanic package");
  if (canonical(p).length > PACKAGE_LIMIT) return fail(`a package is at most ${PACKAGE_LIMIT / 1024} KB`);
  if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 40) return fail("bad name");
  if (!LOOKS.includes(p.look)) return fail("bad look");
  if (typeof p.summary !== "string" || p.summary.length > 200) return fail("bad summary");
  if (!p.author || typeof p.author.key !== "string" || typeof p.author.name !== "string" || p.author.name.length > 40) return fail("bad author");
  if ((await idOf(p.author.key).catch(() => "")) !== p.author.id) return fail("author id does not match author key");
  const bytes = fromB64url(p.wasm ?? "");
  if (!bytes) return fail("module is not base64url");
  if ((await sha256(bytes)) !== p.hash) return fail("module does not match its hash");
  if (!Array.isArray(p.fixtures) || p.fixtures.length < 4 || p.fixtures.length > 64) return fail("a package carries 4 to 64 fixtures");
  const { signature, ...body } = p;
  if (typeof signature !== "string" || !(await verifyText(p.author.key, packageText(body), signature))) return fail("the author's signature does not check out");
  let runtime: MoverRuntime;
  try {
    runtime = new MoverRuntime(bytes);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "module was refused");
  }
  for (const [i, fx] of p.fixtures.entries()) {
    if (!Array.isArray(fx.state) || fx.state.length !== STATE_SLOTS || !Array.isArray(fx.input) || fx.input.length !== INPUT_SLOTS || !Array.isArray(fx.expect) || fx.expect.length !== STATE_SLOTS) {
      return fail(`fixture ${i + 1} is malformed`);
    }
    const out = runtime.step(fx.state, inputFrom(fx.input));
    if (!out || out.some((v, k) => v !== fx.expect[k])) return fail(`fixture ${i + 1} gives a different result on this engine`);
  }
  return { ok: true, runtime, bytes };
}

// ---------- moving with a mechanic, under an island's rules ----------

/** What an island enforces on every mover, whoever wrote it. */
export type IslandRules = { maxSpeed: number; floor: number; ceiling: number };
export const DEFAULT_RULES: IslandRules = { maxSpeed: 60, floor: 0.45, ceiling: 400 };

export type Box = { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
const BODY = 0.3;
const inside = (b: Box, x: number, z: number) => x > b.min.x - BODY && x < b.max.x + BODY && z > b.min.z - BODY && z < b.max.z + BODY;

/**
 * One step of a carried mechanic, with the island's last word: no faster than its speed limit, not
 * below its floor or above its ceiling, and not through its walls (sliding along them). Both the host
 * and the visitor run exactly this, so they agree.
 */
export function stepUnderRules(runtime: MoverRuntime, slots: number[], input: MechanicInput, blockers: Box[], rules: IslandRules): number[] {
  const dt = Math.min(0.1, Math.max(0, Number.isFinite(input.dt) ? input.dt : 0));
  const out = runtime.step(slots, { ...input, dt });
  if (!out || !out.every(Number.isFinite)) return [...slots];
  const [x0, y0, z0] = slots;
  let dx = out[0] - x0;
  let dy = out[1] - y0;
  let dz = out[2] - z0;
  const limit = rules.maxSpeed * dt;
  const moved = Math.hypot(dx, dy, dz);
  if (moved > limit) {
    const k = limit / moved;
    dx *= k;
    dy *= k;
    dz *= k;
  }
  // In short pieces, so a fast mover cannot jump clean over a thin wall between two frames.
  let x = x0;
  let z = z0;
  const pieces = blockers.length ? Math.max(1, Math.ceil(Math.hypot(dx, dz) / (BODY / 2))) : 1;
  for (let i = 0; i < pieces; i += 1) {
    if (!blockers.some((b) => inside(b, x + dx / pieces, z))) x += dx / pieces;
    if (!blockers.some((b) => inside(b, x, z + dz / pieces))) z += dz / pieces;
  }
  const y = Math.min(rules.ceiling, Math.max(rules.floor, y0 + dy));
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

const unit = (v: unknown) => Math.min(1, Math.max(-1, Number.isFinite(v as number) ? (v as number) : 0));

/** A mover's full state from a plain position and heading (a mechanic's own numbers start at zero). */
export function slotsOf(state: MoveState): number[] {
  if (Array.isArray(state.slots) && state.slots.length === STATE_SLOTS && state.slots.every(Number.isFinite)) {
    const s = [...state.slots];
    s[0] = state.position.x;
    s[1] = state.position.y;
    s[2] = state.position.z;
    s[3] = state.yaw;
    return s;
  }
  return [state.position.x, state.position.y, state.position.z, state.yaw, ...new Array(STATE_SLOTS - 4).fill(0)];
}

/**
 * A carried mechanic as a movement rule for prediction.ts. Inputs are clamped first (a visitor cannot
 * send a stronger push than a key gives), then the island's rules apply. Host and visitor both use this.
 */
export function mechanicRule(runtime: MoverRuntime, rules: IslandRules = DEFAULT_RULES): MoveRule {
  return (state: MoveState, input: MoveInput, blockers: Box[]): MoveState => {
    const out = stepUnderRules(
      runtime,
      slotsOf(state),
      {
        forward: unit(input.forward),
        strafe: unit(input.strafe),
        turn: Math.min(Math.PI, Math.max(-Math.PI, Number.isFinite(input.turn) ? input.turn : 0)),
        steer: unit(input.steer),
        lift: unit(input.lift),
        dt: input.dt,
        action: unit(input.action),
      },
      blockers,
      rules,
    );
    return { position: { x: out[0], y: out[1], z: out[2] }, yaw: out[3], slots: out };
  };
}
