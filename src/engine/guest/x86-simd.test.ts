/**
 * SSE2 integer operations (work item N8) in WebAssembly against the reference (ir.ts vecValue). The
 * reference is checked against the x86-64 CPU by fixtures/linux/sse2.c; this drives each op's lowering
 * directly over special and random lanes, shift counts at and past the lane width included, and
 * requires bit-identical results. (A program-level test can pass while a lowering is wrong, because
 * new code runs in the interpreter first.)
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Stop, XMM, type VecOp } from "./ir.ts";
import { newProgram } from "./lift.ts";
import { GuestState, Interpreter } from "./machine.ts";
import { instantiate, lowerProgram } from "./wasm.ts";

const MEM = 1 << 20;
const PC = 0x10000n;
let seed = 0x13198a2e03707344n;
function rnd(): bigint {
  seed ^= (seed << 13n) & 0xffffffffffffffffn;
  seed ^= seed >> 7n;
  seed ^= (seed << 17n) & 0xffffffffffffffffn;
  return seed;
}
const SPECIAL = [0n, 0xffffffffffffffffn, 0x8000800080008000n, 0x7fff7fff7fff7fffn, 0x80007fffffff0001n, 0x7f80ff0001fe7f81n, 0x0000000100000002n, 0xffffffff80000000n];
const half = () => (rnd() % 3n === 0n ? SPECIAL[Number(rnd() % BigInt(SPECIAL.length))] : rnd());
const COUNTS = [0n, 1n, 7n, 8n, 15n, 16n, 17n, 31n, 32n, 33n, 63n, 64n, 65n, 1n << 40n, 0xffffffffffffffffn];

const OPS: VecOp[] = [
  "packss16", "packus16", "packss32", "packus32", "qadds8", "qaddu8", "qadds16", "qaddu16", "qsubs8", "qsubu8", "qsubs16", "qsubu16",
  "avgu8", "avgu16", "mulhs16", "mulhu16", "madd16", "muludq", "sad8",
  "shlv16", "shlv32", "shlv64", "shrv16", "shrv32", "shrv64", "sarv16", "sarv32",
];

test("SSE2 integer ops: WebAssembly and the reference agree bit for bit", () => {
  for (const op of OPS) {
    const program = newProgram("x86_64", [[PC, PC + 4n]]);
    // d = xmm0, a = xmm0, b = xmm1 (as the decoder emits them), and d = a = b on xmm2
    program.insns.set(PC, {
      pc: PC, len: 4, next: PC + 4n, fall: false, text: op,
      ops: [{ k: "vec", op, d: 0, a: 0, b: 1, imm: 0 }, { k: "vec", op, d: 2, a: 2, b: 2, imm: 0 }, { k: "halt", why: "test" }],
    });
    const wasm = instantiate(lowerProgram(program, MEM));
    const wst = new GuestState(new Uint8Array(wasm.mem.buffer));
    const ist = new GuestState(new Uint8Array(MEM));
    const interp = new Interpreter(program, ist);
    const shift = op.includes("v");
    for (let i = 0; i < 400; i += 1) {
      const a = [half(), half()];
      const b = shift ? [COUNTS[i % COUNTS.length], half()] : [half(), half()];
      const c = [half(), half()];
      for (const st of [ist, wst]) {
        st.mem.fill(0, 0, 0x1000);
        st.setReg(XMM(0), a[0]); st.setReg(XMM(0, 1), a[1]);
        st.setReg(XMM(1), b[0]); st.setReg(XMM(1, 1), b[1]);
        st.setReg(XMM(2), c[0]); st.setReg(XMM(2, 1), c[1]);
        st.pc = PC;
        st.fuel = 100n;
      }
      assert.equal(interp.run(), Stop.halt);
      assert.equal(wasm.run(), Stop.halt);
      for (const x of [0, 2]) {
        const want = [ist.reg(XMM(x)), ist.reg(XMM(x, 1))];
        const got = [wst.reg(XMM(x)), wst.reg(XMM(x, 1))];
        assert.deepEqual(got, want, `${op} xmm${x} a=${a.map((v) => v.toString(16))} b=${b.map((v) => v.toString(16))}`);
      }
    }
  }
});
