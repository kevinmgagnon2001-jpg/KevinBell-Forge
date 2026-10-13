/**
 * ARM floating point in WebAssembly against the reference interpreter. The reference rules (ir.ts:
 * armFop, armRound, armF2i, armFcmpNzcv, armFma) are checked against ARM64 hardware by the NEON corpus
 * (fixtures/linux/neon.c); this drives the WebAssembly helpers directly over many more operands,
 * special values and cancellation cases included, and requires bit-identical results.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { STATE, Stop, XMM, type FpRound, type Op } from "./ir.ts";
import { newProgram } from "./lift.ts";
import { GuestState, Interpreter } from "./machine.ts";
import { instantiate, lowerProgram } from "./wasm.ts";

const MEM = 1 << 20;
const PC = 0x10000n;

const D = [
  0x0000000000000000n, 0x8000000000000000n, 0x3ff0000000000000n, 0xbff0000000000000n, 0x3fe0000000000000n, 0x3ff8000000000000n,
  0x4004000000000000n, 0xc004000000000000n, 0x7ff0000000000000n, 0xfff0000000000000n, 0x7ff8000000000000n, 0x7ff4000000000001n,
  0xfff8000000000abcn, 0x0000000000000001n, 0x000fffffffffffffn, 0x7fefffffffffffffn, 0x43e0000000000000n, 0xc3e0000000000000n,
  0x41dfffffffc00000n, 0x4330000000000001n, 0x3fdfffffffffffffn, 0xc1e0000000200000n, 0x0010000000000000n, 0x8010000000000001n,
];
const S = [
  0x00000000n, 0x80000000n, 0x3f800000n, 0xbf800000n, 0x3f000000n, 0x3fc00000n, 0x40200000n, 0xc0200000n, 0x7f800000n, 0xff800000n,
  0x7fc00000n, 0x7fa00001n, 0xffc00abcn, 0x00000001n, 0x007fffffn, 0x7f7fffffn, 0x5f000000n, 0xdf000000n, 0x4effffffn, 0x4b000001n,
  0x3effffffn, 0xcf000001n, 0x00800000n, 0x80800001n,
];

let seed = 0x243f6a8885a308d3n;
function rnd(): bigint {
  seed ^= (seed << 13n) & 0xffffffffffffffffn;
  seed ^= seed >> 7n;
  seed ^= (seed << 17n) & 0xffffffffffffffffn;
  return seed;
}
/** An operand: a special value, random bits, or a value near a power of two (for cancellation). */
function operand(size: 4 | 8): bigint {
  const pick = Number(rnd() % 4n);
  const list = size === 8 ? D : S;
  if (pick === 0) return list[Number(rnd() % BigInt(list.length))];
  if (pick === 1) return rnd() & (size === 8 ? 0xffffffffffffffffn : 0xffffffffn);
  // modest exponents so products and sums interact; random mantissa
  const m = rnd();
  if (size === 8) return (m & 0x800fffffffffffffn) | ((0x3c0n + (rnd() % 0x80n)) << 52n);
  return (m & 0x807fffffn) | ((0x60n + (rnd() % 0x40n)) << 23n);
}

/** Run one instruction (ops + halt) on both engines over many inputs and compare all registers. */
function differential(name: string, ops: Op[], size: 4 | 8, count: number, inputs?: (i: number) => [bigint, bigint, bigint]) {
  const program = newProgram("aarch64", [[PC, PC + 4n]]);
  program.insns.set(PC, { pc: PC, len: 4, next: PC + 4n, ops: [...ops, { k: "halt", why: "test" }], fall: false, text: name });
  const wasm = instantiate(lowerProgram(program, MEM));
  const wmem = new Uint8Array(wasm.mem.buffer);
  const imem = new Uint8Array(MEM);
  const ist = new GuestState(imem);
  const wst = new GuestState(wmem);
  const interp = new Interpreter(program, ist);
  for (let i = 0; i < count; i += 1) {
    const [a, b, c] = inputs ? inputs(i) : [operand(size), operand(size), operand(size)];
    // the high halves and the bits above a single hold junk, as they can on the CPU
    const junk = rnd();
    for (const st of [ist, wst]) {
      st.mem.fill(0, 0, 0x1000);
      st.setReg(XMM(0), size === 4 ? (junk & 0xffffffff00000000n) | a : a);
      st.setReg(XMM(1), size === 4 ? (junk << 32n) | b : b);
      st.setReg(XMM(2), c);
      st.setReg(XMM(0, 1), junk);
      st.pc = PC;
      st.fuel = 100n;
      st.flags = { z: 1, s: 0, c: 1, o: 0, k: 0 };
    }
    const ci = interp.run();
    const cw = wasm.run();
    assert.equal(ci, Stop.halt);
    assert.equal(cw, Stop.halt);
    const regs = (st: GuestState) => Array.from({ length: 106 }, (_, r) => st.reg(r));
    const ri = regs(ist);
    const rw = regs(wst);
    const fi = ist.flags;
    const fw = wst.flags;
    const where = `${name} a=${a.toString(16)} b=${b.toString(16)} c=${c.toString(16)}`;
    for (let r = 0; r < 106; r += 1) if (ri[r] !== rw[r]) assert.fail(`${where}: r${r} interpreter ${ri[r].toString(16)} wasm ${rw[r].toString(16)}`);
    assert.deepEqual([fw.z, fw.s, fw.c ^ fw.k, fw.o], [fi.z, fi.s, fi.c ^ fi.k, fi.o], where);
    void STATE;
  }
}

test("ARM floating point: arithmetic, min/max and NaN rules match the reference in wasm", () => {
  for (const size of [4, 8] as const) {
    for (const op of ["add", "sub", "mul", "div", "sqrt", "max", "min", "maxnm", "minnm"] as const) {
      differential(`f${op}${size * 8}`, [{ k: "fop", op, d: 3, a: 0, b: 1, size, arm: true }], size, 3000);
    }
  }
});

test("ARM floating point: frint, conversions to integers and compares match the reference in wasm", () => {
  for (const size of [4, 8] as const) {
    for (const mode of ["n", "p", "m", "z", "a"] as FpRound[]) {
      differential(`frint${mode}${size * 8}`, [{ k: "fround", d: 3, a: 0, size, mode }], size, 1500);
      for (const w of [32, 64] as const) {
        for (const unsigned of [false, true]) {
          differential(`fcvt${mode}${unsigned ? "u" : "s"}${w}.${size * 8}`, [{ k: "fcvt", kind: "f2i", d: 5, a: 0, w, size, trunc: mode === "z", arm: { round: mode, unsigned } }], size, 600);
        }
      }
    }
    differential(`fcmp${size * 8}`, [{ k: "fcmp", a: 0, b: 1, size, arm: true }], size, 3000);
    differential(`fccmp${size * 8}`, [{ k: "fcmp", a: 0, b: 1, size, arm: true, cond: "ne", nzcv: 5 }, { k: "fcmp", a: 1, b: 0, size, arm: true, cond: "eq", nzcv: 9 }], size, 2000);
    for (const unsigned of [false, true]) {
      differential(`${unsigned ? "u" : "s"}cvtf${size * 8}`, [
        { k: "fcvt", kind: "i2f", d: 3, s: { r: 7 }, w: 64, size, unsigned },
        { k: "fcvt", kind: "i2f", d: 4, s: { r: 8 }, w: 32, size, unsigned },
      ], size, 1000);
    }
  }
});

test("ARM floating point: fused multiply-add rounds once, like the CPU, in wasm", () => {
  for (const size of [4, 8] as const) {
    for (const [negProduct, negAddend] of [[false, false], [true, false], [true, true], [false, true]]) {
      const op: Op = { k: "fma", d: 3, a: 0, b: 1, c: 2, size, negProduct, negAddend };
      differential(`fma${size * 8}${negProduct ? "-p" : ""}${negAddend ? "-c" : ""}`, [op], size, 4000);
      // near-total cancellation: c close to -(a*b)
      differential(`fma-cancel${size * 8}`, [op], size, 3000, () => {
        const a = operand(size);
        const b = operand(size);
        const view = new DataView(new ArrayBuffer(8));
        let c: bigint;
        if (size === 8) {
          view.setBigUint64(0, a);
          const x = view.getFloat64(0);
          view.setBigUint64(0, b);
          view.setFloat64(0, -(x * view.getFloat64(0)));
          c = view.getBigUint64(0) + (rnd() % 5n) - 2n;
        } else {
          view.setUint32(0, Number(a));
          const x = view.getFloat32(0);
          view.setUint32(0, Number(b));
          view.setFloat32(0, -(x * view.getFloat32(0)));
          c = BigInt(view.getUint32(0)) + (rnd() % 5n) - 2n;
        }
        return [a, b, c & (size === 8 ? 0xffffffffffffffffn : 0xffffffffn)];
      });
    }
  }
});
