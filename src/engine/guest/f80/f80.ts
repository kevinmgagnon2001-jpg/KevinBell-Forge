/**
 * The x87 soft-float (f80.c, compiled by scripts/build-f80.mjs) for the interpreter: the same
 * WebAssembly functions the lowered modules embed, instantiated once on their own, so both engines
 * compute identical bits.
 */
import { F80_FUNCS } from "./f80-wasm.ts";

export type F80Name = (typeof F80_FUNCS)[number]["name"];
const I32 = 0x7f;

function leb(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const F80_BODIES: number[][] = F80_FUNCS.map((f) => Array.from(fromBase64(f.body)));

/** The function's type entry as the type section encodes it. */
export const f80Type = (i: number) => [0x60, ...leb(F80_FUNCS[i].params.length), ...F80_FUNCS[i].params, ...leb(F80_FUNCS[i].results.length), ...F80_FUNCS[i].results];

let exports: Record<string, (...args: (bigint | number)[]) => unknown> | null = null;

function build() {
  const sec = (id: number, body: number[]) => [id, ...leb(body.length), ...body];
  const n = F80_FUNCS.length;
  const types = F80_FUNCS.flatMap((_, i) => f80Type(i));
  const funcs = F80_FUNCS.map((_, i) => leb(i)).flat();
  const exps = F80_FUNCS.flatMap((f, i) => [...leb(f.name.length), ...[...f.name].map((c) => c.charCodeAt(0)), 0, ...leb(i)]);
  const code = F80_BODIES.flatMap((b) => [...leb(b.length), ...b]);
  const bytes = Uint8Array.from([
    0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...sec(1, [...leb(n), ...types]),
    ...sec(3, [...leb(n), ...funcs]),
    ...sec(7, [...leb(n), ...exps]),
    ...sec(10, [...leb(n), ...code]),
  ]);
  exports = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports as typeof exports;
}

/** Call a soft-float function with IR values (64-bit); results come back as 64-bit values. */
export function f80Call(name: string, args: bigint[]): bigint[] {
  if (!exports) build();
  const i = F80_FUNCS.findIndex((f) => f.name === name);
  if (i < 0) throw new Error(`no soft-float function ${name}`);
  const f = F80_FUNCS[i];
  const raw = exports![name](...args.map((v, k) => (f.params[k] === I32 ? Number(BigInt.asUintN(32, v)) | 0 : BigInt.asIntN(64, v))));
  const list = f.results.length === 1 ? [raw] : (raw as unknown[]);
  return list.map((v, k) => (f.results[k] === I32 ? BigInt((v as number) >>> 0) : BigInt.asUintN(64, v as bigint)));
}

export const f80Index = (name: string) => F80_FUNCS.findIndex((f) => f.name === name);
