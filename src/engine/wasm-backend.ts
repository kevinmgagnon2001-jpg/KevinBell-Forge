import type { IrOp, Reg } from "./isa.ts";

/**
 * Third backend for the compat IR. x86-64 and AArch64 are the two machine targets;
 * WebAssembly is the one that runs on both of them, in a browser, and on a server.
 * Same IR in, same answer out, no emulator needed for the ops the map knows.
 *
 * Registers x0..x3 are i32 locals 0..3. The function takes the seed in x0 and returns x0,
 * matching `step()` in isa.ts: 32-bit wraparound, first `ret` ends the program.
 */
const LOCAL: Record<Reg, number> = { x0: 0, x1: 1, x2: 2, x3: 3 };

function uleb(value: number): number[] {
  const out: number[] = [];
  let n = value >>> 0;
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    out.push(byte);
  } while (n !== 0);
  return out;
}

function sleb(value: number): number[] {
  const out: number[] = [];
  let n = value | 0;
  for (;;) {
    const byte = n & 0x7f;
    n >>= 7;
    const done = (n === 0 && (byte & 0x40) === 0) || (n === -1 && (byte & 0x40) !== 0);
    out.push(done ? byte : byte | 0x80);
    if (done) return out;
  }
}

function section(id: number, body: number[]): number[] {
  return [id, ...uleb(body.length), ...body];
}

export function lowerToWasm(ops: IrOp[]): Uint8Array {
  const code: number[] = [];
  let returned = false;
  for (const op of ops) {
    if (op.op === "ret") {
      code.push(0x20, 0, 0x0f); // local.get 0 ; return
      returned = true;
      break;
    }
    if (op.op === "mov") {
      code.push(0x41, ...sleb(op.imm), 0x21, LOCAL[op.rd]); // i32.const ; local.set
    } else {
      code.push(0x20, LOCAL[op.rn], 0x41, ...sleb(op.imm), op.op === "add" ? 0x6a : 0x6b, 0x21, LOCAL[op.rd]);
    }
  }
  if (!returned) code.push(0x20, 0); // fall off the end: x0 is the result
  code.push(0x0b);

  const locals = [1, 3, 0x7f]; // one group: three i32 locals (x1..x3)
  const body = [...locals, ...code];
  const name = [..."run"].map((ch) => ch.charCodeAt(0));
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [1, 0x60, 1, 0x7f, 1, 0x7f]), // type 0: (i32) -> i32
    ...section(3, [1, 0]), // one function, type 0
    ...section(7, [1, name.length, ...name, 0x00, 0]), // export "run" = func 0
    ...section(10, [1, ...uleb(body.length), ...body]), // code
  ]);
}

/** Lower, validate, instantiate and run. Nothing outside the module is reachable: it has no imports. */
export function runOnWasm(ops: IrOp[], seed = 0): number {
  const bytes = lowerToWasm(ops);
  if (!WebAssembly.validate(bytes as BufferSource)) throw new Error("lowered module failed validation");
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource), {});
  const run = instance.exports.run as (seed: number) => number;
  return run(seed | 0);
}
