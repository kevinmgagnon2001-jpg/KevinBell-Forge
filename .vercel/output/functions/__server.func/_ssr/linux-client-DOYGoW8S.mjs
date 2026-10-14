import { n as readElf } from "./routes-CZadCkxY.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/linux-client-DOYGoW8S.js
/**
* Byte shuffles, as in wasm i8x16.shuffle: 16 indexes, 0..15 pick from a, 16..31 from b.
* Decoders register a shuffle once and refer to it by number, so the IR stays small.
*/
var vecShuffles = [];
function shuffleId(lanes) {
	const key = lanes.join(",");
	const at = vecShuffles.findIndex((x) => x.join(",") === key);
	if (at >= 0) return at;
	vecShuffles.push(lanes);
	return vecShuffles.length - 1;
}
var toBytes = (lo, hi) => {
	const b = /* @__PURE__ */ new Uint8Array(16);
	const dv = new DataView(b.buffer);
	dv.setBigUint64(0, lo, true);
	dv.setBigUint64(8, hi, true);
	return b;
};
var fromBytes = (b) => {
	const dv = new DataView(b.buffer, b.byteOffset, 16);
	return [dv.getBigUint64(0, true), dv.getBigUint64(8, true)];
};
/** Reference semantics of a vector op on (lo, hi) pairs. Mirrors the wasm SIMD lowering. */
function vecValue(op, a, b, immv) {
	if (op === "and") return [a[0] & b[0], a[1] & b[1]];
	if (op === "or") return [a[0] | b[0], a[1] | b[1]];
	if (op === "xor") return [a[0] ^ b[0], a[1] ^ b[1]];
	if (op === "andn") return [a[0] & ~b[0] & M64, a[1] & ~b[1] & M64];
	const A = toBytes(a[0], a[1]);
	const B = toBytes(b[0], b[1]);
	const R = /* @__PURE__ */ new Uint8Array(16);
	if (op === "shuffle") {
		const lanes = vecShuffles[immv];
		for (let i = 0; i < 16; i += 1) R[i] = lanes[i] < 16 ? A[lanes[i]] : B[lanes[i] - 16];
		return fromBytes(R);
	}
	const size = Number(/\d+/.exec(op)[0]) / 8;
	const n = 16 / size;
	const av = new DataView(A.buffer);
	const bv = new DataView(B.buffer);
	const rv = new DataView(R.buffer);
	const lm = (1n << BigInt(size * 8)) - 1n;
	const get = (v, i) => {
		let x = 0n;
		for (let k = size - 1; k >= 0; k -= 1) x = x << 8n | BigInt(v.getUint8(i * size + k));
		return x;
	};
	const put = (i, x) => {
		for (let k = 0; k < size; k += 1) rv.setUint8(i * size + k, Number(x >> BigInt(8 * k) & 255n));
	};
	const sgn = (x) => BigInt.asIntN(size * 8, x);
	for (let i = 0; i < n; i += 1) {
		const x = get(av, i);
		const y = get(bv, i);
		let r = 0n;
		if (op.startsWith("add")) r = x + y & lm;
		else if (op.startsWith("sub")) r = x - y & lm;
		else if (op.startsWith("eq")) r = x === y ? lm : 0n;
		else if (op.startsWith("gt")) r = sgn(x) > sgn(y) ? lm : 0n;
		else if (op === "minu8") r = x < y ? x : y;
		else if (op === "maxu8") r = x > y ? x : y;
		else if (op === "mins16") r = sgn(x) < sgn(y) ? x : y;
		else if (op === "maxs16") r = sgn(x) > sgn(y) ? x : y;
		else if (op.startsWith("shl")) r = x << BigInt(immv) & lm;
		else if (op.startsWith("shr")) r = x >> BigInt(immv);
		else if (op.startsWith("sar")) r = BigInt.asUintN(size * 8, sgn(x) >> BigInt(immv));
		put(i, r);
	}
	return fromBytes(R);
}
/** Why the machine stopped. Same codes from the interpreter and from the WebAssembly module. */
var Stop = {
	running: 0,
	syscall: 1,
	fuel: 2,
	unmapped: 3,
	gap: 4,
	fault: 5,
	div0: 6,
	smc: 7,
	unsupported: 8,
	halt: 9
};
var STOP_NAME = {
	0: "running",
	1: "syscall",
	2: "out of fuel",
	3: "jumped to an address with no translation",
	4: "reached bytes the map does not know (not executed)",
	5: "memory fault",
	6: "divide error (by zero, or the quotient does not fit)",
	7: "program tried to modify its own code",
	8: "unsupported operation",
	9: "halted"
};
/** Guest memory layout. Address 0..0x1000 is the null page; the WebAssembly backend keeps CPU state there. */
var NULL_PAGE = 4096;
var STATE = {
	regs: 0,
	pc: 768,
	flags: 776,
	fuel: 800,
	code: 808,
	fault: 816
};
var M64 = (1n << 64n) - 1n;
var mask = (w) => w >= 64 ? M64 : (1n << BigInt(w)) - 1n;
var u64 = (v) => v & M64;
var sx = (v, w) => BigInt.asIntN(w, v);
var imm = (v) => ({ imm: u64(BigInt(v)) });
var reg = (r) => ({ r });
function evalCond(c, f) {
	const carm = f.c ^ f.k;
	switch (c) {
		case "eq": return f.z === 1;
		case "ne": return f.z === 0;
		case "b": return f.c === 1;
		case "ae": return f.c === 0;
		case "be": return (f.c | f.z) === 1;
		case "a": return (f.c | f.z) === 0;
		case "s": return f.s === 1;
		case "ns": return f.s === 0;
		case "o": return f.o === 1;
		case "no": return f.o === 0;
		case "lt": return (f.s ^ f.o) === 1;
		case "ge": return (f.s ^ f.o) === 0;
		case "le": return (f.z | f.s ^ f.o) === 1;
		case "gt": return (f.z | f.s ^ f.o) === 0;
		case "cs": return carm === 1;
		case "cc": return carm === 0;
		case "hi": return carm === 1 && f.z === 0;
		case "ls": return carm === 0 || f.z === 1;
		case "al": return true;
		case "p": return f.p === 1;
		case "np": return f.p !== 1;
	}
}
/** Result of an ALU op at width w, as an unsigned w-bit value. */
function aluValue(op, a, b, w, cin = 0) {
	const m = mask(w);
	const aw = a & m;
	const bw = b & m;
	const sh = bw & (w === 64 ? 63n : 31n);
	switch (op) {
		case "add": return aw + bw & m;
		case "adc": return aw + bw + BigInt(cin) & m;
		case "ctz": {
			if (aw === 0n) return BigInt(w);
			let n = 0n;
			while ((aw >> n & 1n) === 0n) n += 1n;
			return n;
		}
		case "clz": {
			if (aw === 0n) return BigInt(w);
			let n = 0n;
			while ((aw >> BigInt(w) - 1n - n & 1n) === 0n) n += 1n;
			return n;
		}
		case "sbb": return aw - bw - BigInt(cin) & m;
		case "sub": return aw - bw & m;
		case "and": return aw & bw;
		case "or": return aw | bw;
		case "xor": return aw ^ bw;
		case "shl": return aw << sh & m;
		case "shr": return aw >> sh;
		case "sar": return BigInt.asUintN(w, sx(aw, w) >> sh);
		case "ror": {
			const n = bw % BigInt(w);
			return (aw >> n | aw << BigInt(w) - n) & m;
		}
		case "mul": return aw * bw & m;
		case "umulh": return aw * bw >> BigInt(w) & m;
		case "smulh": return BigInt.asUintN(w, sx(aw, w) * sx(bw, w) >> BigInt(w));
		case "udiv": return bw === 0n ? 0n : aw / bw;
		case "urem": return bw === 0n ? aw : aw % bw;
		case "sdiv":
			if (bw === 0n) return 0n;
			return BigInt.asUintN(w, sx(aw, w) / sx(bw, w));
		case "srem":
			if (bw === 0n) return aw;
			return BigInt.asUintN(w, sx(aw, w) % sx(bw, w));
	}
}
/** 1 when the low byte has an even number of set bits. */
function parity(r) {
	let b = Number(r & 255n);
	b ^= b >> 4;
	b ^= b >> 2;
	b ^= b >> 1;
	return b & 1 ^ 1;
}
function flagsAfter(op, mode, a, b, r, w, prev) {
	if (mode === "none") return prev;
	const m = mask(w);
	const top = BigInt(w - 1);
	const aw = a & m;
	const bw = b & m;
	const z = r === 0n ? 1 : 0;
	const s = Number(r >> top & 1n);
	const p = parity(r);
	if (mode === "logic" || mode === "shift") return {
		z,
		s,
		c: 0,
		o: 0,
		k: 0,
		p
	};
	const isSub = op === "sub" || op === "sbb";
	const o = isSub ? Number(((aw ^ bw) & (aw ^ r)) >> top & 1n) : Number(((aw ^ r) & (bw ^ r)) >> top & 1n);
	if (mode === "inc") return {
		z,
		s,
		c: prev.c,
		o,
		k: prev.k,
		p
	};
	const cin = BigInt(prev.c);
	return {
		z,
		s,
		c: op === "adc" ? aw + bw + cin > m ? 1 : 0 : op === "sbb" ? aw < bw + cin ? 1 : 0 : isSub ? aw < bw ? 1 : 0 : aw + bw > m ? 1 : 0,
		o,
		k: isSub ? 1 : 0,
		p
	};
}
function nzcvFlags(nzcv, p) {
	return {
		s: nzcv >> 3 & 1,
		z: nzcv >> 2 & 1,
		c: nzcv >> 1 & 1,
		o: nzcv & 1,
		k: 0,
		p
	};
}
/** Value written into a register of old value `old` by a w-bit write of `v`. */
function writeWidth(old, v, w) {
	if (w === 64) return v & M64;
	if (w === 32) return v & 4294967295n;
	const m = mask(w);
	return old & ~m & M64 | v & m;
}
/** The CPU the guest is told it runs on: x86-64 baseline (v1). Leaf -> [eax, ebx, ecx, edx]. */
var CPUID = [
	[0, [
		1,
		1735552838,
		1431323508,
		1919506021
	]],
	[1, [
		198313,
		2048,
		0,
		125862161
	]],
	[2147483648, [
		2147483649,
		0,
		0,
		0
	]],
	[2147483649, [
		0,
		0,
		1,
		537921536
	]]
];
var f64 = /* @__PURE__ */ new Float64Array(1);
var u64v = new BigUint64Array(f64.buffer);
var f32 = /* @__PURE__ */ new Float32Array(1);
var u32v = new Uint32Array(f32.buffer);
var bitsToF64 = (b) => (u64v[0] = b & M64, f64[0]);
var f64ToBits = (x) => (f64[0] = x, u64v[0]);
var bitsToF32 = (b) => (u32v[0] = Number(b & 4294967295n), f32[0]);
var f32ToBits = (x) => (f32[0] = x, BigInt(u32v[0]));
/** x86 result for a NaN-producing operation: the default quiet NaN, negative. */
var QNAN64 = 18444492273895866368n;
var QNAN32 = 4290772992n;
function floatOp(op, a, b, size) {
	const round = size === 4 ? Math.fround : (x) => x;
	switch (op) {
		case "add": return round(a + b);
		case "sub": return round(a - b);
		case "mul": return round(a * b);
		case "div": return round(a / b);
		case "sqrt": return round(Math.sqrt(b));
		case "min": return a < b ? a : b;
		case "max": return a > b ? a : b;
	}
}
/** cvt(t)sd2si: out of range or NaN gives the "integer indefinite" value (only the top bit set). */
function floatToInt(x, w, trunc) {
	const v = trunc ? Math.trunc(x) : roundEven(x);
	const lim = w === 64 ? 2 ** 63 : 2 ** 31;
	if (!(v >= -lim && v < lim)) return w === 64 ? 9223372036854775808n : 2147483648n;
	return BigInt.asUintN(w, BigInt(v));
}
function roundEven(x) {
	if (!Number.isFinite(x)) return x;
	const r = Math.round(x);
	return Math.abs(x - Math.trunc(x)) === .5 && r % 2 !== 0 ? r - 1 : r;
}
var isNaNBits = (b, size) => size === 8 ? (b & 9218868437227405312n) === 9218868437227405312n && (b & 4503599627370495n) !== 0n : (b & 2139095040n) === 2139095040n && (b & 8388607n) !== 0n;
/**
* The NaN an x86 SSE operation returns: a NaN first operand (made quiet), else a NaN second operand,
* else the default negative quiet NaN (for invalid operations such as 0/0 or sqrt(-1)).
*/
function nanResult(aBits, bBits, size, op) {
	const a = size === 8 ? aBits & M64 : aBits & 4294967295n;
	const b = size === 8 ? bBits & M64 : bBits & 4294967295n;
	const quiet = size === 8 ? 2251799813685248n : 4194304n;
	if (op !== "sqrt" && isNaNBits(a, size)) return a | quiet;
	if (isNaNBits(b, size)) return b | quiet;
	return size === 8 ? QNAN64 : QNAN32;
}
/** int64 -> single precision with one correct rounding (to nearest even), as cvtsi2ss does. */
function i64ToF32(v) {
	const neg = v < 0n;
	let m = neg ? -v : v;
	if (m < 1n << 53n) return Math.fround(Number(v));
	let shift = 0n;
	while (m >> shift >= 1n << 26n) shift += 1n;
	const sticky = (m & (1n << shift) - 1n) !== 0n ? 1n : 0n;
	m = m >> shift | sticky;
	const x = Number(m) * 2 ** Number(shift);
	return Math.fround(neg ? -x : x);
}
/**
* AArch64 front end: one 32-bit instruction in, guest IR out.
*
* Covers the integer A64 base that compilers emit with -mgeneral-regs-only: move wide, add/sub
* (immediate, shifted, extended), logical (immediate and shifted), bitfield moves, mul/div/mulh,
* conditional select and compare, every branch form, loads and stores (unsigned offset, unscaled,
* pre/post-index, register offset, literal, pairs), adr/adrp, svc and the hint space.
* SIMD/FP, exclusives, atomics and system registers are gaps. Encodings follow the Arm ARM (DDI 0487).
*/
var SP = 31;
var LR = 30;
var CONDS = [
	"eq",
	"ne",
	"cs",
	"cc",
	"s",
	"ns",
	"o",
	"no",
	"hi",
	"ls",
	"ge",
	"lt",
	"gt",
	"le",
	"al",
	"al"
];
var bits = (v, hi, lo) => v >>> lo & (1 << hi - lo + 1) - 1;
var sext = (v, n) => v << 32 - n >> 32 - n;
function decodeBitMasks(n, imms, immr, size) {
	const combined = n << 6 | ~imms & 63;
	let len = -1;
	for (let i = 6; i >= 0; i -= 1) if (combined & 1 << i) {
		len = i;
		break;
	}
	if (len < 1) return null;
	const levels = (1 << len) - 1;
	const s = imms & levels;
	const r = immr & levels;
	if (s === levels) return null;
	const esize = 1 << len;
	if (esize > size) return null;
	const emask = mask(esize);
	const welem = mask(s + 1);
	const rot = BigInt(r);
	const elem = (welem >> rot | welem << BigInt(esize) - rot) & emask;
	let out = 0n;
	for (let i = 0; i < size; i += esize) out |= elem << BigInt(i);
	return out & mask(size);
}
function decodeArm(fetch, pc) {
	const raw = [];
	for (let i = 0n; i < 4n; i += 1n) {
		const b = fetch(pc + i);
		if (b === void 0) return { gap: {
			pc,
			bytes: raw.map((x) => x.toString(16).padStart(2, "0")).join(" "),
			reason: "instruction runs off mapped code"
		} };
		raw.push(b);
	}
	const word = (raw[0] | raw[1] << 8 | raw[2] << 16 | raw[3] << 24) >>> 0;
	const hexWord = raw.map((x) => x.toString(16).padStart(2, "0")).join(" ");
	const next = pc + 4n;
	const ops = [];
	let targets = [];
	let fall = true;
	let text = "";
	const fail = (reason) => ({ gap: {
		pc,
		bytes: hexWord,
		reason
	} });
	const done = () => {
		return {
			insn: {
				pc,
				len: 4,
				next,
				ops,
				fall,
				text: text || hexWord
			},
			targets: targets.map(u64)
		};
	};
	const rd = bits(word, 4, 0);
	const rn = bits(word, 9, 5);
	const rm = bits(word, 20, 16);
	const sf = word >>> 31;
	const W_ = sf ? 64 : 32;
	/** Source register: 31 is xzr unless the encoding says sp. */
	const R = (n, sp = false) => n === 31 ? sp ? reg(SP) : imm(0) : reg(n);
	/** Destination register: 31 discards unless the encoding says sp. */
	const D = (n, sp = false) => n === 31 ? sp ? SP : 35 : n;
	/** Apply a shift to a register operand into a temp, returning the operand. */
	const shifted = (src, type, amount, w, tmp) => {
		if (amount === 0) return src;
		const op = type === 0 ? "shl" : type === 1 ? "shr" : type === 2 ? "sar" : "ror";
		ops.push({
			k: "alu",
			op,
			d: tmp,
			a: src,
			b: imm(amount),
			w,
			f: "none"
		});
		return reg(tmp);
	};
	/** Extended register operand (uxtb..sxtx) with left shift. */
	const extended = (src, option, amount, tmp) => {
		const from = [
			8,
			16,
			32,
			64
		][option & 3];
		const signed = option >= 4;
		let out = src;
		if (from < 64) {
			ops.push({
				k: "ext",
				d: tmp,
				s: src,
				from,
				signed,
				w: 64
			});
			out = reg(tmp);
		}
		if (amount) {
			ops.push({
				k: "alu",
				op: "shl",
				d: tmp,
				a: out,
				b: imm(amount),
				w: 64,
				f: "none"
			});
			out = reg(tmp);
		}
		return out;
	};
	if ((word & 4294963231) >>> 0 === 3573751839) {
		text = "hint";
		return done();
	}
	if ((word & 4294963359) >>> 0 === 3573756063) {
		text = "barrier";
		return done();
	}
	if ((word & 4292870175) >>> 0 === 3556769793) {
		text = "svc";
		ops.push({ k: "sys" });
		return done();
	}
	if ((word & 4292870175) >>> 0 === 3558866944) return fail("brk breakpoint");
	if ((word & 2080374784) >>> 0 === 335544320) {
		const t = u64(pc + BigInt(sext(bits(word, 25, 0), 26) * 4));
		if (word >>> 31) {
			text = "bl";
			ops.push({
				k: "mov",
				d: LR,
				s: imm(next),
				w: 64
			});
			targets = [t, next];
		} else {
			text = "b";
			targets = [t];
		}
		ops.push({
			k: "jmp",
			t
		});
		fall = false;
		return done();
	}
	if ((word & 4278190096) >>> 0 === 1409286144) {
		const t = u64(pc + BigInt(sext(bits(word, 23, 5), 19) * 4));
		const c = CONDS[word & 15];
		text = `b.${c}`;
		if (c === "al") {
			ops.push({
				k: "jmp",
				t
			});
			fall = false;
		} else ops.push({
			k: "br",
			c,
			t
		});
		targets = [t];
		return done();
	}
	if ((word & 2113929216) >>> 0 === 872415232) {
		const t = u64(pc + BigInt(sext(bits(word, 23, 5), 19) * 4));
		const nz = (word >>> 24 & 1) === 1;
		text = nz ? "cbnz" : "cbz";
		ops.push({
			k: "cbz",
			s: R(rd),
			w: W_,
			nz,
			t
		});
		targets = [t];
		return done();
	}
	if ((word & 2113929216) >>> 0 === 905969664) {
		const t = u64(pc + BigInt(sext(bits(word, 18, 5), 14) * 4));
		const bit = word >>> 31 << 5 | bits(word, 23, 19);
		const nz = (word >>> 24 & 1) === 1;
		text = nz ? "tbnz" : "tbz";
		ops.push({
			k: "tbz",
			s: R(rd),
			bit,
			nz,
			t
		});
		targets = [t];
		return done();
	}
	if ((word & 4288674847) >>> 0 === 3592355840) {
		const opc = bits(word, 22, 21);
		if (opc === 3) return fail("unknown branch-register form");
		ops.push({
			k: "mov",
			d: 33,
			s: R(rn),
			w: 64
		});
		if (opc === 1) {
			text = "blr";
			ops.push({
				k: "mov",
				d: LR,
				s: imm(next),
				w: 64
			});
			targets = [next];
		} else text = opc === 2 ? "ret" : "br";
		ops.push({
			k: "jmpr",
			s: reg(33)
		});
		fall = false;
		return done();
	}
	if ((word & 520093696) >>> 0 === 268435456) {
		const immv = bits(word, 23, 5) << 2 | bits(word, 30, 29);
		const off = BigInt(sext(immv, 21));
		if (word >>> 31) {
			text = "adrp";
			ops.push({
				k: "mov",
				d: D(rd),
				s: imm((pc & -4096n) + (off << 12n)),
				w: 64
			});
		} else {
			text = "adr";
			ops.push({
				k: "mov",
				d: D(rd),
				s: imm(pc + off),
				w: 64
			});
		}
		return done();
	}
	if ((word & 528482304) >>> 0 === 285212672) {
		const sub = (word >>> 30 & 1) === 1;
		const setf = (word >>> 29 & 1) === 1;
		const sh = word >>> 22 & 1;
		const value = BigInt(bits(word, 21, 10)) << (sh ? 12n : 0n);
		text = `${sub ? "sub" : "add"}${setf ? "s" : ""}`;
		ops.push({
			k: "alu",
			op: sub ? "sub" : "add",
			d: D(rd, !setf),
			a: R(rn, true),
			b: imm(value),
			w: W_,
			f: setf ? "arith" : "none"
		});
		return done();
	}
	if ((word & 528482304) >>> 0 === 301989888) {
		const opc = bits(word, 30, 29);
		const n = word >>> 22 & 1;
		if (!sf && n) return fail("invalid 32-bit logical immediate");
		const value = decodeBitMasks(n, bits(word, 15, 10), bits(word, 21, 16), W_);
		if (value === null) return fail("invalid logical immediate");
		const op = [
			"and",
			"or",
			"xor",
			"and"
		][opc];
		text = [
			"and",
			"orr",
			"eor",
			"ands"
		][opc];
		ops.push({
			k: "alu",
			op,
			d: D(rd, opc !== 3),
			a: R(rn),
			b: imm(value),
			w: W_,
			f: opc === 3 ? "logic" : "none"
		});
		return done();
	}
	if ((word & 528482304) >>> 0 === 310378496) {
		const opc = bits(word, 30, 29);
		const hw = bits(word, 22, 21);
		if (!sf && hw > 1) return fail("invalid move wide");
		const sh = BigInt(hw * 16);
		const v = BigInt(bits(word, 20, 5)) << sh;
		const d = D(rd);
		if (opc === 0) {
			text = "movn";
			ops.push({
				k: "mov",
				d,
				s: imm(~v & mask(W_)),
				w: W_
			});
		} else if (opc === 2) {
			text = "movz";
			ops.push({
				k: "mov",
				d,
				s: imm(v),
				w: W_
			});
		} else if (opc === 3) {
			text = "movk";
			ops.push({
				k: "alu",
				op: "and",
				d: 32,
				a: R(rd),
				b: imm(~(65535n << sh) & M64),
				w: W_,
				f: "none"
			});
			ops.push({
				k: "alu",
				op: "or",
				d,
				a: reg(32),
				b: imm(v),
				w: W_,
				f: "none"
			});
		} else return fail("invalid move wide");
		return done();
	}
	if ((word & 528482304) >>> 0 === 318767104) {
		const opc = bits(word, 30, 29);
		if ((word >>> 22 & 1) !== sf || opc === 3) return fail("invalid bitfield move");
		const r = bits(word, 21, 16);
		const s = bits(word, 15, 10);
		const w = W_;
		const src = R(rn);
		const d = D(rd);
		if (opc === 2) {
			text = "ubfm";
			if (s >= r) {
				ops.push({
					k: "alu",
					op: "shr",
					d: 32,
					a: src,
					b: imm(r),
					w,
					f: "none"
				});
				ops.push({
					k: "alu",
					op: "and",
					d,
					a: reg(32),
					b: imm(mask(s - r + 1)),
					w,
					f: "none"
				});
			} else {
				ops.push({
					k: "alu",
					op: "and",
					d: 32,
					a: src,
					b: imm(mask(s + 1)),
					w,
					f: "none"
				});
				ops.push({
					k: "alu",
					op: "shl",
					d,
					a: reg(32),
					b: imm(w - r),
					w,
					f: "none"
				});
			}
		} else if (opc === 0) {
			text = "sbfm";
			const up = w - 1 - s;
			ops.push({
				k: "alu",
				op: "shl",
				d: 32,
				a: src,
				b: imm(up),
				w,
				f: "none"
			});
			if (s >= r) ops.push({
				k: "alu",
				op: "sar",
				d,
				a: reg(32),
				b: imm(up + r),
				w,
				f: "none"
			});
			else {
				ops.push({
					k: "alu",
					op: "sar",
					d: 32,
					a: reg(32),
					b: imm(up),
					w,
					f: "none"
				});
				ops.push({
					k: "alu",
					op: "shl",
					d,
					a: reg(32),
					b: imm(w - r),
					w,
					f: "none"
				});
			}
		} else {
			text = "bfm";
			let field;
			if (s >= r) {
				ops.push({
					k: "alu",
					op: "shr",
					d: 32,
					a: src,
					b: imm(r),
					w,
					f: "none"
				});
				field = mask(s - r + 1);
			} else {
				ops.push({
					k: "alu",
					op: "shl",
					d: 32,
					a: src,
					b: imm(w - r),
					w,
					f: "none"
				});
				field = mask(s + 1) << BigInt(w - r) & mask(w);
			}
			ops.push({
				k: "alu",
				op: "and",
				d: 32,
				a: reg(32),
				b: imm(field),
				w,
				f: "none"
			});
			ops.push({
				k: "alu",
				op: "and",
				d: 34,
				a: R(rd),
				b: imm(~field & mask(w)),
				w,
				f: "none"
			});
			ops.push({
				k: "alu",
				op: "or",
				d,
				a: reg(34),
				b: reg(32),
				w,
				f: "none"
			});
		}
		return done();
	}
	if ((word & 528482304) >>> 0 === 327155712) {
		if (rn !== rm) return fail("extr with two sources is not in the map");
		text = "ror";
		ops.push({
			k: "alu",
			op: "ror",
			d: D(rd),
			a: R(rn),
			b: imm(bits(word, 15, 10)),
			w: W_,
			f: "none"
		});
		return done();
	}
	if ((word & 520093696) >>> 0 === 167772160) {
		const opc = bits(word, 30, 29);
		const invert = (word >>> 21 & 1) === 1;
		const amount = bits(word, 15, 10);
		if (!sf && amount > 31) return fail("invalid shift");
		let b = shifted(R(rm), bits(word, 23, 22), amount, W_, 32);
		if (!b) return fail("invalid shift");
		if (invert) {
			ops.push({
				k: "alu",
				op: "xor",
				d: 32,
				a: b,
				b: imm(-1),
				w: W_,
				f: "none"
			});
			b = reg(32);
		}
		const op = [
			"and",
			"or",
			"xor",
			"and"
		][opc];
		text = [
			"and",
			"orr",
			"eor",
			"ands"
		][opc] + (invert ? "n" : "");
		ops.push({
			k: "alu",
			op,
			d: D(rd),
			a: R(rn),
			b,
			w: W_,
			f: opc === 3 ? "logic" : "none"
		});
		return done();
	}
	if ((word & 522190848) >>> 0 === 184549376) {
		const sub = (word >>> 30 & 1) === 1;
		const setf = (word >>> 29 & 1) === 1;
		const type = bits(word, 23, 22);
		if (type === 3) return fail("invalid shift");
		const b = shifted(R(rm), type, bits(word, 15, 10), W_, 32);
		text = `${sub ? "sub" : "add"}${setf ? "s" : ""}`;
		ops.push({
			k: "alu",
			op: sub ? "sub" : "add",
			d: D(rd),
			a: R(rn),
			b,
			w: W_,
			f: setf ? "arith" : "none"
		});
		return done();
	}
	if ((word & 522190848) >>> 0 === 186646528) {
		const sub = (word >>> 30 & 1) === 1;
		const setf = (word >>> 29 & 1) === 1;
		const amount = bits(word, 12, 10);
		if (amount > 4) return fail("invalid extend shift");
		const b = extended(R(rm), bits(word, 15, 13), amount, 32);
		text = `${sub ? "sub" : "add"}${setf ? "s" : ""}`;
		ops.push({
			k: "alu",
			op: sub ? "sub" : "add",
			d: D(rd, !setf),
			a: R(rn, true),
			b,
			w: W_,
			f: setf ? "arith" : "none"
		});
		return done();
	}
	if ((word & 520093696) >>> 0 === 452984832) {
		const op31 = bits(word, 23, 21);
		const o0 = word >>> 15 & 1;
		const ra = bits(word, 14, 10);
		const d = D(rd);
		if (op31 === 0) {
			text = o0 ? "msub" : "madd";
			ops.push({
				k: "alu",
				op: "mul",
				d: 32,
				a: R(rn),
				b: R(rm),
				w: W_,
				f: "none"
			});
			ops.push({
				k: "alu",
				op: o0 ? "sub" : "add",
				d,
				a: R(ra),
				b: reg(32),
				w: W_,
				f: "none"
			});
			return done();
		}
		if (!sf) return fail("invalid 3-source op");
		if (op31 === 1 || op31 === 5) {
			const signed = op31 === 1;
			text = `${signed ? "s" : "u"}m${o0 ? "sub" : "add"}l`;
			ops.push({
				k: "ext",
				d: 32,
				s: R(rn),
				from: 32,
				signed,
				w: 64
			});
			ops.push({
				k: "ext",
				d: 33,
				s: R(rm),
				from: 32,
				signed,
				w: 64
			});
			ops.push({
				k: "alu",
				op: "mul",
				d: 32,
				a: reg(32),
				b: reg(33),
				w: 64,
				f: "none"
			});
			ops.push({
				k: "alu",
				op: o0 ? "sub" : "add",
				d,
				a: R(ra),
				b: reg(32),
				w: 64,
				f: "none"
			});
			return done();
		}
		if ((op31 === 2 || op31 === 6) && o0 === 0) {
			text = op31 === 2 ? "smulh" : "umulh";
			ops.push({
				k: "alu",
				op: op31 === 2 ? "smulh" : "umulh",
				d,
				a: R(rn),
				b: R(rm),
				w: 64,
				f: "none"
			});
			return done();
		}
		return fail("3-source op is not in the map");
	}
	if ((word & 2145386496) >>> 0 === 448790528) {
		const op = {
			2: "udiv",
			3: "sdiv",
			8: "shl",
			9: "shr",
			10: "sar",
			11: "ror"
		}[bits(word, 15, 10)];
		if (!op) return fail("2-source op is not in the map");
		text = op;
		ops.push({
			k: "alu",
			op,
			d: D(rd),
			a: R(rn),
			b: R(rm),
			w: W_,
			f: "none"
		});
		return done();
	}
	if ((word & 534773760) >>> 0 === 444596224) {
		const op = word >>> 30 & 1;
		const op2 = bits(word, 11, 10);
		if (word >>> 29 & 1 || op2 > 1) return fail("invalid conditional select");
		const c = CONDS[bits(word, 15, 12)];
		let b = R(rm);
		if (op === 0 && op2 === 1) {
			ops.push({
				k: "alu",
				op: "add",
				d: 32,
				a: b,
				b: imm(1),
				w: W_,
				f: "none"
			});
			b = reg(32);
		}
		if (op === 1 && op2 === 0) {
			ops.push({
				k: "alu",
				op: "xor",
				d: 32,
				a: b,
				b: imm(-1),
				w: W_,
				f: "none"
			});
			b = reg(32);
		}
		if (op === 1 && op2 === 1) {
			ops.push({
				k: "alu",
				op: "sub",
				d: 32,
				a: imm(0),
				b,
				w: W_,
				f: "none"
			});
			b = reg(32);
		}
		text = [
			"csel",
			"csinc",
			"csinv",
			"csneg"
		][op * 2 + op2];
		ops.push({
			k: "csel",
			d: D(rd),
			c,
			a: R(rn),
			b,
			w: W_
		});
		return done();
	}
	if ((word & 534773776) >>> 0 === 440401920 && (word >>> 29 & 1) === 1) {
		const neg = (word >>> 30 & 1) === 0;
		const isImm = (word >>> 11 & 1) === 1;
		const c = CONDS[bits(word, 15, 12)];
		text = neg ? "ccmn" : "ccmp";
		ops.push({
			k: "ccmp",
			c,
			a: R(rn),
			b: isImm ? imm(rm) : R(rm),
			w: W_,
			neg,
			nzcv: word & 15
		});
		return done();
	}
	if ((word & 989855744) >>> 0 === 402653184) {
		if (word >>> 26 & 1) return fail("SIMD/FP literal load is not in the map");
		const opc = word >>> 30;
		const ea = {
			base: null,
			index: null,
			scale: 1,
			disp: u64(pc + BigInt(sext(bits(word, 23, 5), 19) * 4))
		};
		text = "ldr";
		if (opc === 0) ops.push({
			k: "load",
			d: D(rd),
			ea,
			size: 4,
			signed: false,
			w: 64
		});
		else if (opc === 1) ops.push({
			k: "load",
			d: D(rd),
			ea,
			size: 8,
			signed: false,
			w: 64
		});
		else if (opc === 2) ops.push({
			k: "load",
			d: D(rd),
			ea,
			size: 4,
			signed: true,
			w: 64
		});
		else text = "prfm";
		return done();
	}
	if ((word & 973078528) >>> 0 === 671088640) {
		if (word >>> 26 & 1) return fail("SIMD/FP pair is not in the map");
		const opc = word >>> 30;
		const mode = bits(word, 24, 23);
		const load = (word >>> 22 & 1) === 1;
		if (opc === 3 || opc === 1 && !load) return fail("invalid pair");
		const size = opc === 2 ? 8 : 4;
		const off = BigInt(sext(bits(word, 21, 15), 7) * size);
		const rt2 = bits(word, 14, 10);
		const base = rn === 31 ? SP : rn;
		const signed = opc === 1;
		text = load ? "ldp" : "stp";
		ops.push({
			k: "lea",
			d: 34,
			ea: {
				base,
				index: null,
				scale: 1,
				disp: mode === 1 ? 0n : u64(off)
			},
			w: 64
		});
		const at = (k) => ({
			base: 34,
			index: null,
			scale: 1,
			disp: BigInt(k * size)
		});
		if (load) {
			ops.push({
				k: "load",
				d: 32,
				ea: at(0),
				size,
				signed,
				w: 64
			});
			ops.push({
				k: "load",
				d: 33,
				ea: at(1),
				size,
				signed,
				w: 64
			});
		} else {
			ops.push({
				k: "store",
				s: R(rd),
				ea: at(0),
				size
			});
			ops.push({
				k: "store",
				s: R(rt2),
				ea: at(1),
				size
			});
		}
		if (mode === 1) ops.push({
			k: "alu",
			op: "add",
			d: base,
			a: reg(base),
			b: imm(off),
			w: 64,
			f: "none"
		});
		if (mode === 3) ops.push({
			k: "mov",
			d: base,
			s: reg(34),
			w: 64
		});
		if (load) {
			ops.push({
				k: "mov",
				d: D(rd),
				s: reg(32),
				w: 64
			});
			ops.push({
				k: "mov",
				d: D(rt2),
				s: reg(33),
				w: 64
			});
		}
		return done();
	}
	if ((word & 989855744) >>> 0 === 956301312 || (word & 991952896) >>> 0 === 939524096 || (word & 991955968) >>> 0 === 941623296) {
		if (word >>> 26 & 1) return fail("SIMD/FP load/store is not in the map");
		const sizeLog = word >>> 30;
		const size = 1 << sizeLog;
		const opc = bits(word, 23, 22);
		const base = rn === 31 ? SP : rn;
		const unsignedOff = (word & 989855744) >>> 0 === 956301312;
		const regOff = !unsignedOff && (word & 991955968) >>> 0 === 941623296;
		let ea;
		let writeback = null;
		if (unsignedOff) ea = {
			base,
			index: null,
			scale: 1,
			disp: BigInt(bits(word, 21, 10)) << BigInt(sizeLog)
		};
		else if (regOff) {
			const option = bits(word, 15, 13);
			if (!(option & 2)) return fail("invalid register-offset extend");
			const s = word >>> 12 & 1;
			const idx = option === 3 || option === 7 ? R(rm) : extended(R(rm), option, 0, 33);
			if (!("r" in idx)) ea = {
				base,
				index: null,
				scale: 1,
				disp: 0n
			};
			else ea = {
				base,
				index: idx.r,
				scale: s ? size : 1,
				disp: 0n
			};
		} else {
			const imm9 = BigInt(sext(bits(word, 20, 12), 9));
			const mode = bits(word, 11, 10);
			if (mode === 1) {
				writeback = {
					mode: "post",
					off: imm9
				};
				ea = {
					base,
					index: null,
					scale: 1,
					disp: 0n
				};
			} else if (mode === 3) {
				writeback = {
					mode: "pre",
					off: imm9
				};
				ea = {
					base,
					index: null,
					scale: 1,
					disp: u64(imm9)
				};
			} else ea = {
				base,
				index: null,
				scale: 1,
				disp: u64(imm9)
			};
		}
		if (writeback) {
			ops.push({
				k: "lea",
				d: 34,
				ea,
				w: 64
			});
			ea = {
				base: 34,
				index: null,
				scale: 1,
				disp: 0n
			};
		}
		if (opc === 0) {
			text = "str";
			ops.push({
				k: "store",
				s: R(rd),
				ea,
				size
			});
		} else if (opc === 1) {
			text = "ldr";
			ops.push({
				k: "load",
				d: 32,
				ea,
				size,
				signed: false,
				w: 64
			});
		} else {
			if (size === 8) {
				if (opc === 2) {
					text = "prfm";
					if (writeback) return fail("invalid prfm");
					return done();
				}
				return fail("invalid load");
			}
			if (size === 4 && opc === 3) return fail("invalid load");
			text = "ldrs";
			ops.push({
				k: "load",
				d: 32,
				ea,
				size,
				signed: true,
				w: opc === 3 ? 32 : 64
			});
		}
		if (writeback) {
			const base2 = base;
			if (writeback.mode === "pre") ops.push({
				k: "mov",
				d: base2,
				s: reg(34),
				w: 64
			});
			else ops.push({
				k: "alu",
				op: "add",
				d: base2,
				a: reg(base2),
				b: imm(writeback.off),
				w: 64,
				f: "none"
			});
		}
		if (opc !== 0) {
			const last = ops[ops.length - (writeback ? 2 : 1)];
			ops.push({
				k: "mov",
				d: D(rd),
				s: reg(32),
				w: last.signed && opc === 3 ? 32 : 64
			});
		}
		return done();
	}
	if ((word & 1056964608) >>> 0 === 134217728) return fail("exclusive/atomic access is not in the map");
	if ((word & 234881024) >>> 0 === 234881024 || (word & 234881024) >>> 0 === 201326592) return fail("SIMD/FP is not in the map");
	if ((word & 4290772992) >>> 0 === 3573547008 || (word & 4293918720) >>> 0 === 3576692736 || (word & 4293918720) >>> 0 === 3574595584) return fail("system register access is not in the map");
	return fail("instruction is not in the map");
}
/**
* x86-64 front end: one instruction of machine code in, guest IR out.
*
* Covers the integer core that compilers emit for ordinary programs built with
* -mgeneral-regs-only: mov/movzx/movsx/lea, the ALU group, shifts, mul/imul/div/idiv,
* test/cmp, jcc/jmp/call/ret, setcc/cmovcc, push/pop/leave, cdq/cqo, syscall and the nop forms.
* Anything else (SSE, x87, segment overrides, string ops, adc/sbb, rotates by flag...) is a gap.
* Encodings follow the Intel SDM, Volume 2.
*/
var CC = [
	"o",
	"no",
	"b",
	"ae",
	"eq",
	"ne",
	"be",
	"a",
	"s",
	"ns",
	"p",
	"np",
	"lt",
	"ge",
	"le",
	"gt"
];
var ALU = [
	"add",
	"or",
	"adc",
	"sbb",
	"and",
	"sub",
	"xor",
	"cmp"
];
var RSP = 4;
var RBP = 5;
var RAX = 0;
var RDX = 2;
var RCX = 1;
var Gapped = class extends Error {};
/**
* Set CF = OF = bit (a 0/1 value in register r), as mul/imul do. Uses (bit << 63) + (bit << 63):
* the sum's carry and signed overflow both equal bit. ZF and SF are architecturally undefined after
* a multiply; here they read as 1 and 0.
*/
function overflowFlags(r) {
	return [{
		k: "alu",
		op: "shl",
		d: 34,
		a: reg(r),
		b: imm(63),
		w: 64,
		f: "none"
	}, {
		k: "alu",
		op: "add",
		d: null,
		a: reg(34),
		b: reg(34),
		w: 64,
		f: "arith"
	}];
}
/** movss/movsd between registers: replace only the low 32 bits of d. */
function mergeLow32(d, s) {
	return [
		{
			k: "alu",
			op: "and",
			d: 34,
			a: reg(s),
			b: imm(4294967295n),
			w: 64,
			f: "none"
		},
		{
			k: "alu",
			op: "and",
			d,
			a: reg(d),
			b: imm(18446744069414584320n),
			w: 64,
			f: "none"
		},
		{
			k: "alu",
			op: "or",
			d,
			a: reg(d),
			b: reg(34),
			w: 64,
			f: "none"
		}
	];
}
var HIGH = 1e3;
var isHigh = (r) => typeof r === "number" && r >= HIGH;
var srcHigh = (x) => "r" in x && isHigh(x.r);
function usesHigh(op) {
	switch (op.k) {
		case "mov": return isHigh(op.d) || srcHigh(op.s);
		case "alu": return isHigh(op.d) || srcHigh(op.a) || srcHigh(op.b);
		case "ext": return isHigh(op.d) || srcHigh(op.s);
		case "load": return isHigh(op.d);
		case "store": return srcHigh(op.s);
		case "set": return isHigh(op.d);
		case "csel": return isHigh(op.d) || srcHigh(op.a) || srcHigh(op.b);
		case "flagsz":
		case "setflag": return srcHigh(op.v);
		default: return false;
	}
}
/** Turn pseudo high-byte registers into: read = (r >> 8), write = merge into bits 8..15. */
function rewriteHigh(ops) {
	const out = [];
	for (const op of ops) {
		if (!usesHigh(op)) {
			out.push(op);
			continue;
		}
		const scratch = [34, 35];
		const read = (x) => {
			if (!srcHigh(x)) return x;
			const t = scratch.shift();
			if (t === void 0) throw new Gapped("too many high-byte operands");
			out.push({
				k: "alu",
				op: "shr",
				d: t,
				a: reg(x.r - HIGH),
				b: imm(8),
				w: 64,
				f: "none"
			});
			return reg(t);
		};
		const copy = { ...op };
		for (const key of [
			"s",
			"a",
			"b",
			"v"
		]) if (key in copy && copy[key]) copy[key] = read(copy[key]);
		const d = copy.d;
		if (isHigh(d)) {
			const base = d - HIGH;
			const t = 34;
			copy.d = t;
			if (copy.w !== 8) return null;
			out.push(copy);
			out.push({
				k: "alu",
				op: "and",
				d: t,
				a: reg(t),
				b: imm(255),
				w: 64,
				f: "none"
			});
			out.push({
				k: "alu",
				op: "shl",
				d: t,
				a: reg(t),
				b: imm(8),
				w: 64,
				f: "none"
			});
			out.push({
				k: "alu",
				op: "and",
				d: base,
				a: reg(base),
				b: imm(-65281n),
				w: 64,
				f: "none"
			});
			out.push({
				k: "alu",
				op: "or",
				d: base,
				a: reg(base),
				b: reg(t),
				w: 64,
				f: "none"
			});
		} else out.push(copy);
	}
	return out;
}
function decodeX86(fetch, pc) {
	let p = pc;
	const raw = [];
	const byte = () => {
		const b = fetch(p);
		if (b === void 0) throw new Gapped("instruction runs off mapped code");
		raw.push(b);
		p += 1n;
		return b;
	};
	const s8 = () => BigInt.asIntN(8, BigInt(byte()));
	const u16 = () => BigInt(byte() | byte() << 8);
	const s32 = () => BigInt.asIntN(32, BigInt((byte() | byte() << 8 | byte() << 16 | byte() << 24) >>> 0));
	const u64v = () => {
		let v = 0n;
		for (let i = 0n; i < 8n; i += 1n) v |= BigInt(byte()) << 8n * i;
		return v;
	};
	const hexRaw = () => raw.map((b) => b.toString(16).padStart(2, "0")).join(" ");
	const fail = (reason) => {
		if (!raw.length) {
			const b = fetch(pc);
			if (b !== void 0) raw.push(b);
		}
		return { gap: {
			pc,
			bytes: hexRaw(),
			reason
		} };
	};
	try {
		let opsize16 = false;
		let rep = false;
		let repne = false;
		let fs = false;
		let addr32 = false;
		for (;;) {
			const b = fetch(p);
			if (b === 102) {
				opsize16 = true;
				byte();
				continue;
			}
			if (b === 243) {
				rep = true;
				byte();
				continue;
			}
			if (b === 242) {
				repne = true;
				byte();
				continue;
			}
			if (b === 46 || b === 62 || b === 240) {
				byte();
				continue;
			}
			if (b === 100) {
				fs = true;
				byte();
				continue;
			}
			if (b === 101) return fail("gs segment is not in the map");
			if (b === 103) {
				addr32 = true;
				byte();
				continue;
			}
			if (b === 38 || b === 54) {
				byte();
				continue;
			}
			break;
		}
		let rex = 0;
		if (((fetch(p) ?? 0) & 240) === 64) rex = byte();
		const rexW = (rex & 8) !== 0;
		const rexR = (rex & 4) !== 0 ? 8 : 0;
		const rexX = (rex & 2) !== 0 ? 8 : 0;
		const rexB = (rex & 1) !== 0 ? 8 : 0;
		const w = rexW ? 64 : opsize16 ? 16 : 32;
		const ops = [];
		const eas = [];
		let targets = [];
		let fall = true;
		let text = "";
		const modrm = () => {
			const m = byte();
			const mod = m >> 6;
			const regf = m >> 3 & 7 | rexR;
			const rmLow = m & 7;
			if (mod === 3) return {
				mod,
				reg: regf,
				rm: rmLow | rexB,
				ea: null
			};
			let base = null;
			let index = null;
			let scale = 1;
			let disp = 0n;
			let rip = false;
			if (rmLow === 4) {
				const sib = byte();
				scale = 1 << (sib >> 6);
				const idx = sib >> 3 & 7 | rexX;
				index = idx === 4 ? null : idx;
				const bs = sib & 7;
				if (bs === 5 && mod === 0) {
					base = null;
					disp = s32();
				} else base = bs | rexB;
			} else if (rmLow === 5 && mod === 0) {
				rip = true;
				disp = s32();
			} else base = rmLow | rexB;
			if (mod === 1) disp = s8();
			else if (mod === 2) disp = s32();
			const ea = {
				base,
				index,
				scale,
				disp: u64(disp),
				rip,
				...fs ? { seg: 36 } : {},
				...addr32 ? { a32: true } : {}
			};
			eas.push(ea);
			return {
				mod,
				reg: regf,
				rm: rmLow | rexB,
				ea
			};
		};
		const byteReg = (r) => !rex && r >= 4 && r <= 7 ? HIGH + (r - 4) : r;
		const sizeOf = (bits) => bits / 8;
		/** Read an r/m operand as a source. Memory goes through a temp. */
		const readRm = (m, bits, tmp = 32) => {
			if (!m.ea) return reg(bits === 8 ? byteReg(m.rm) : m.rm);
			ops.push({
				k: "load",
				d: tmp,
				ea: m.ea,
				size: sizeOf(bits),
				signed: false,
				w: 64
			});
			return reg(tmp);
		};
		/** d = a * b (signed, width w), with CF = OF = the product did not fit. */
		const imulFlags = (a, b, d) => {
			ops.push({
				k: "alu",
				op: "smulh",
				d: 33,
				a,
				b,
				w,
				f: "none"
			});
			ops.push({
				k: "alu",
				op: "mul",
				d: 35,
				a,
				b,
				w: 64,
				f: "none"
			});
			ops.push({
				k: "alu",
				op: "sar",
				d: 34,
				a: reg(35),
				b: imm(w - 1),
				w,
				f: "none"
			});
			ops.push({
				k: "mov",
				d,
				s: reg(35),
				w
			});
			ops.push({
				k: "alu",
				op: "sub",
				d: null,
				a: reg(34),
				b: reg(33),
				w,
				f: "arith"
			});
			ops.push({
				k: "set",
				d: 33,
				c: "ne",
				w: 64
			});
			ops.push(...overflowFlags(33));
		};
		const immOf = (bits) => bits === 8 ? s8() : bits === 16 ? u16() : s32();
		/** dst op= src, with flags; writes back to r/m (register or memory) unless it is cmp/test. */
		const aluRm = (name, m, src, bits) => {
			if (name === null) throw new Gapped("adc/sbb are not in the map");
			const op = name === "cmp" ? "sub" : name;
			const flags = name === "add" || name === "sub" || name === "cmp" || name === "adc" || name === "sbb" ? "arith" : "logic";
			if (!m.ea) {
				const r = bits === 8 ? byteReg(m.rm) : m.rm;
				ops.push({
					k: "alu",
					op,
					d: name === "cmp" ? null : r,
					a: reg(r),
					b: src,
					w: bits,
					f: flags
				});
				return;
			}
			ops.push({
				k: "load",
				d: 32,
				ea: m.ea,
				size: sizeOf(bits),
				signed: false,
				w: 64
			});
			ops.push({
				k: "alu",
				op,
				d: name === "cmp" ? null : 32,
				a: reg(32),
				b: src,
				w: bits,
				f: flags
			});
			if (name !== "cmp") ops.push({
				k: "store",
				s: reg(32),
				ea: m.ea,
				size: sizeOf(bits)
			});
		};
		const writeRm = (m, src, bits) => {
			if (!m.ea) ops.push({
				k: "mov",
				d: bits === 8 ? byteReg(m.rm) : m.rm,
				s: src,
				w: bits
			});
			else ops.push({
				k: "store",
				s: src,
				ea: m.ea,
				size: sizeOf(bits)
			});
		};
		const push = (src) => {
			ops.push({
				k: "alu",
				op: "sub",
				d: RSP,
				a: reg(RSP),
				b: imm(8),
				w: 64,
				f: "none"
			});
			ops.push({
				k: "store",
				s: src,
				ea: {
					base: RSP,
					index: null,
					scale: 1,
					disp: 0n
				},
				size: 8
			});
		};
		const pop = (d) => {
			ops.push({
				k: "load",
				d: 33,
				ea: {
					base: RSP,
					index: null,
					scale: 1,
					disp: 0n
				},
				size: 8,
				signed: false,
				w: 64
			});
			ops.push({
				k: "alu",
				op: "add",
				d: RSP,
				a: reg(RSP),
				b: imm(8),
				w: 64,
				f: "none"
			});
			ops.push({
				k: "mov",
				d,
				s: reg(33),
				w: 64
			});
		};
		const op = byte();
		const finish = () => {
			const next = p;
			if (ops.some(usesHigh)) {
				const rewritten = rewriteHigh(ops);
				if (!rewritten) throw new Gapped("this use of ah/ch/dh/bh is not in the map");
				ops.splice(0, ops.length, ...rewritten);
			}
			for (const ea of eas) if (ea.rip) {
				ea.disp = u64(next + ea.disp);
				ea.rip = false;
			}
			targets = targets.map(u64);
			return {
				insn: {
					pc,
					len: Number(next - pc),
					next,
					ops,
					fall,
					text: text || hexRaw()
				},
				targets
			};
		};
		if (op < 64 && (op & 7) <= 5) {
			const name = ALU[op >> 3];
			if (name === null) return fail("adc/sbb are not in the map");
			const form = op & 7;
			text = name;
			if (form === 0 || form === 1) {
				const bits = form === 0 ? 8 : w;
				const m = modrm();
				aluRm(name, m, reg(bits === 8 ? byteReg(m.reg) : m.reg), bits);
			} else if (form === 2 || form === 3) {
				const bits = form === 2 ? 8 : w;
				const m = modrm();
				const src = readRm(m, bits);
				const r = bits === 8 ? byteReg(m.reg) : m.reg;
				const aop = name === "cmp" ? "sub" : name;
				ops.push({
					k: "alu",
					op: aop,
					d: name === "cmp" ? null : r,
					a: reg(r),
					b: src,
					w: bits,
					f: name === "and" || name === "or" || name === "xor" ? "logic" : "arith"
				});
			} else {
				const bits = form === 4 ? 8 : w;
				const value = immOf(bits === 64 ? 32 : bits);
				aluRm(name, {
					mod: 3,
					reg: 0,
					rm: RAX,
					ea: null
				}, imm(value), bits);
			}
			return finish();
		}
		if (op >= 80 && op <= 87) {
			text = "push";
			push(reg(op & 7 | rexB));
			return finish();
		}
		if (op >= 88 && op <= 95) {
			text = "pop";
			pop(op & 7 | rexB);
			return finish();
		}
		if (op === 99) {
			text = "movsxd";
			const m = modrm();
			const src = m.ea ? (ops.push({
				k: "load",
				d: 32,
				ea: m.ea,
				size: 4,
				signed: false,
				w: 64
			}), reg(32)) : reg(m.rm);
			ops.push({
				k: "ext",
				d: m.reg,
				s: src,
				from: 32,
				signed: rexW,
				w
			});
			return finish();
		}
		if (op === 104 || op === 106) {
			text = "push";
			push(imm(op === 104 ? s32() : s8()));
			return finish();
		}
		if (op === 105 || op === 107) {
			text = "imul";
			const m = modrm();
			const src = readRm(m, w);
			const value = op === 105 ? immOf(w === 64 ? 32 : w) : s8();
			if ("r" in src && src.r !== 32) ops.push({
				k: "mov",
				d: 32,
				s: src,
				w: 64
			});
			imulFlags(reg(32), imm(value), m.reg);
			return finish();
		}
		if (op >= 112 && op <= 127) {
			const c = CC[op & 15];
			if (!c) return fail("parity conditions are not in the map");
			const rel = s8();
			text = `j${c}`;
			const t = u64(p + rel);
			ops.push({
				k: "br",
				c,
				t
			});
			targets = [t];
			return finish();
		}
		if (op === 128 || op === 129 || op === 131) {
			const bits = op === 128 ? 8 : w;
			const m = modrm();
			const name = ALU[m.reg & 7];
			if (name === null) return fail("adc/sbb are not in the map");
			const value = op === 129 ? immOf(bits === 64 ? 32 : bits) : s8();
			text = name;
			aluRm(name, m, imm(value), bits);
			return finish();
		}
		if (op === 132 || op === 133) {
			const bits = op === 132 ? 8 : w;
			const m = modrm();
			text = "test";
			const src = readRm(m, bits);
			ops.push({
				k: "alu",
				op: "and",
				d: null,
				a: src,
				b: reg(bits === 8 ? byteReg(m.reg) : m.reg),
				w: bits,
				f: "logic"
			});
			return finish();
		}
		if (op === 134) {
			const m = modrm();
			text = "xchg";
			const a = byteReg(m.reg);
			const src = readRm(m, 8, 33);
			ops.push({
				k: "mov",
				d: 32,
				s: reg(a),
				w: 64
			});
			ops.push({
				k: "mov",
				d: a,
				s: src,
				w: 8
			});
			writeRm(m, reg(32), 8);
			return finish();
		}
		if (op >= 145 && op <= 151) {
			const r = op & 7 | rexB;
			text = "xchg";
			ops.push({
				k: "mov",
				d: 32,
				s: reg(RAX),
				w: 64
			}, {
				k: "mov",
				d: RAX,
				s: reg(r),
				w
			}, {
				k: "mov",
				d: r,
				s: reg(32),
				w
			});
			return finish();
		}
		if (op === 135) {
			const m = modrm();
			text = "xchg";
			const a = m.reg;
			const src = readRm(m, w, 33);
			ops.push({
				k: "mov",
				d: 32,
				s: reg(a),
				w: 64
			});
			ops.push({
				k: "mov",
				d: a,
				s: src,
				w
			});
			writeRm(m, reg(32), w);
			return finish();
		}
		if (op >= 136 && op <= 139) {
			const bits = op & 1 ? w : 8;
			const m = modrm();
			text = "mov";
			const r = bits === 8 ? byteReg(m.reg) : m.reg;
			if (op <= 137) writeRm(m, reg(r), bits);
			else if (m.ea) ops.push({
				k: "load",
				d: r,
				ea: m.ea,
				size: sizeOf(bits),
				signed: false,
				w: bits
			});
			else ops.push({
				k: "mov",
				d: r,
				s: reg(bits === 8 ? byteReg(m.rm) : m.rm),
				w: bits
			});
			return finish();
		}
		if (op === 141) {
			const m = modrm();
			if (!m.ea) return fail("lea with a register operand is invalid");
			text = "lea";
			delete m.ea.seg;
			ops.push({
				k: "lea",
				d: m.reg,
				ea: m.ea,
				w
			});
			return finish();
		}
		if (op === 144) {
			text = rep ? "pause" : "nop";
			if (rexB) return fail("xchg r8 is not in the map");
			return finish();
		}
		if (op === 152) {
			text = rexW ? "cdqe" : "cwde";
			if (opsize16) return fail("cbw is not in the map");
			ops.push({
				k: "ext",
				d: RAX,
				s: reg(RAX),
				from: rexW ? 32 : 16,
				signed: true,
				w
			});
			return finish();
		}
		if (op === 153) {
			text = rexW ? "cqo" : "cdq";
			ops.push({
				k: "alu",
				op: "sar",
				d: RDX,
				a: reg(RAX),
				b: imm(w - 1),
				w,
				f: "none"
			});
			return finish();
		}
		if (op === 168 || op === 169) {
			const bits = op === 168 ? 8 : w;
			text = "test";
			ops.push({
				k: "alu",
				op: "and",
				d: null,
				a: reg(RAX),
				b: imm(immOf(bits === 64 ? 32 : bits)),
				w: bits,
				f: "logic"
			});
			return finish();
		}
		if (op >= 176 && op <= 183) {
			text = "mov";
			ops.push({
				k: "mov",
				d: byteReg(op & 7 | rexB),
				s: imm(byte()),
				w: 8
			});
			return finish();
		}
		if (op >= 184 && op <= 191) {
			text = "mov";
			const value = rexW ? u64v() : opsize16 ? u16() : BigInt.asUintN(32, s32());
			ops.push({
				k: "mov",
				d: op & 7 | rexB,
				s: imm(value),
				w
			});
			return finish();
		}
		if (op === 192 || op === 193 || op === 208 || op === 209 || op === 210 || op === 211) {
			const bits = op & 1 ? w : 8;
			const m = modrm();
			const kind = m.reg & 7;
			let count = op <= 193 ? imm(byte()) : op <= 209 ? imm(1) : reg(RCX);
			if (kind === 0 || kind === 1) {
				if (bits < 32) return fail("8/16-bit rotates are not in the map");
				const written = count;
				if (kind === 0) {
					ops.push({
						k: "alu",
						op: "sub",
						d: 33,
						a: imm(0),
						b: count,
						w: 64,
						f: "none"
					});
					count = reg(33);
				}
				text = kind === 0 ? "rol" : "ror";
				const rawCount = op <= 209 ? written : null;
				let res;
				if (!m.ea) {
					ops.push({
						k: "alu",
						op: "ror",
						d: m.rm,
						a: reg(m.rm),
						b: count,
						w: bits,
						f: "none"
					});
					res = m.rm;
				} else {
					ops.push({
						k: "load",
						d: 32,
						ea: m.ea,
						size: sizeOf(bits),
						signed: false,
						w: 64
					});
					ops.push({
						k: "alu",
						op: "ror",
						d: 32,
						a: reg(32),
						b: count,
						w: bits,
						f: "none"
					});
					ops.push({
						k: "store",
						s: reg(32),
						ea: m.ea,
						size: sizeOf(bits)
					});
					res = 32;
				}
				const cmask = bits === 64 ? 63 : 31;
				const when = (eq) => op >= 210 ? {
					s: reg(RCX),
					mask: cmask,
					...eq === void 0 ? {} : { eq }
				} : null;
				const immCount = op >= 210 ? -1 : op >= 208 ? 1 : Number((rawCount?.imm ?? 0n) & BigInt(cmask));
				if (immCount !== 0) {
					ops.push({
						k: "setflag",
						flag: "c",
						v: reg(res),
						bit: kind === 0 ? 0 : bits - 1,
						when: when()
					});
					if (immCount === 1 || immCount === -1) {
						if (kind === 0) ops.push({
							k: "alu",
							op: "shr",
							d: 34,
							a: reg(res),
							b: imm(bits - 1),
							w: bits,
							f: "none"
						}, {
							k: "alu",
							op: "xor",
							d: 34,
							a: reg(34),
							b: reg(res),
							w: 64,
							f: "none"
						});
						else ops.push({
							k: "alu",
							op: "shl",
							d: 34,
							a: reg(res),
							b: imm(1),
							w: bits,
							f: "none"
						}, {
							k: "alu",
							op: "xor",
							d: 34,
							a: reg(34),
							b: reg(res),
							w: 64,
							f: "none"
						});
						ops.push({
							k: "setflag",
							flag: "o",
							v: reg(34),
							bit: kind === 0 ? 0 : bits - 1,
							when: when(1) ?? (immCount === 1 ? null : {
								s: imm(0),
								mask: 1,
								eq: 1
							})
						});
					}
				}
				return finish();
			}
			const name = kind === 4 || kind === 6 ? "shl" : kind === 5 ? "shr" : kind === 7 ? "sar" : null;
			if (!name) return fail("rcl/rcr are not in the map");
			text = name;
			const target = m.ea ? 32 : bits === 8 ? byteReg(m.rm) : m.rm;
			if (m.ea) ops.push({
				k: "load",
				d: 32,
				ea: m.ea,
				size: sizeOf(bits),
				signed: false,
				w: 64
			});
			const cmask = bits === 64 ? 63 : 31;
			const variable = op >= 210;
			const n = variable ? -1 : Number((count.imm ?? 0n) & BigInt(cmask));
			const carry = bits >= 32 && n !== 0;
			if (carry) {
				if (variable) {
					ops.push({
						k: "alu",
						op: "and",
						d: 33,
						a: reg(RCX),
						b: imm(cmask),
						w: 64,
						f: "none"
					});
					if (name === "shl") ops.push({
						k: "alu",
						op: "sub",
						d: 33,
						a: imm(bits),
						b: reg(33),
						w: 64,
						f: "none"
					});
					else ops.push({
						k: "alu",
						op: "sub",
						d: 33,
						a: reg(33),
						b: imm(1),
						w: 64,
						f: "none"
					});
					ops.push({
						k: "alu",
						op: name === "sar" ? "sar" : "shr",
						d: 35,
						a: reg(target),
						b: reg(33),
						w: bits,
						f: "none"
					});
				} else ops.push({
					k: "alu",
					op: name === "sar" ? "sar" : "shr",
					d: 35,
					a: reg(target),
					b: imm(name === "shl" ? bits - n : n - 1),
					w: bits,
					f: "none"
				});
				ops.push({
					k: "alu",
					op: "shr",
					d: 33,
					a: reg(target),
					b: imm(bits - 1),
					w: bits,
					f: "none"
				});
			}
			ops.push({
				k: "alu",
				op: name,
				d: target,
				a: reg(target),
				b: count,
				w: bits,
				f: "none"
			});
			if (n !== 0) ops.push({
				k: "flagsz",
				v: reg(target),
				w: bits,
				when: variable ? {
					s: reg(RCX),
					mask: cmask
				} : null
			});
			if (carry) {
				const when = variable ? {
					s: reg(RCX),
					mask: cmask
				} : null;
				ops.push({
					k: "setflag",
					flag: "c",
					v: reg(35),
					bit: 0,
					when
				});
				if (n === 1 || variable) {
					const one = variable ? {
						s: reg(RCX),
						mask: cmask,
						eq: 1
					} : null;
					if (name === "shr") ops.push({
						k: "setflag",
						flag: "o",
						v: reg(33),
						bit: 0,
						when: one
					});
					if (name === "shl") {
						ops.push({
							k: "alu",
							op: "shr",
							d: 33,
							a: reg(target),
							b: imm(bits - 1),
							w: bits,
							f: "none"
						});
						ops.push({
							k: "alu",
							op: "xor",
							d: 33,
							a: reg(33),
							b: reg(35),
							w: 64,
							f: "none"
						});
						ops.push({
							k: "setflag",
							flag: "o",
							v: reg(33),
							bit: 0,
							when: one
						});
					}
				}
			}
			if (m.ea) ops.push({
				k: "store",
				s: reg(32),
				ea: m.ea,
				size: sizeOf(bits)
			});
			return finish();
		}
		if (op === 194 || op === 195) {
			text = "ret";
			const extra = op === 194 ? u16() : 0n;
			ops.push({
				k: "load",
				d: 33,
				ea: {
					base: RSP,
					index: null,
					scale: 1,
					disp: 0n
				},
				size: 8,
				signed: false,
				w: 64
			});
			ops.push({
				k: "alu",
				op: "add",
				d: RSP,
				a: reg(RSP),
				b: imm(8n + extra),
				w: 64,
				f: "none"
			});
			ops.push({
				k: "jmpr",
				s: reg(33)
			});
			fall = false;
			return finish();
		}
		if (op === 198 || op === 199) {
			const bits = op === 198 ? 8 : w;
			const m = modrm();
			if ((m.reg & 7) !== 0) return fail("c6/c7 extension is not mov");
			text = "mov";
			writeRm(m, imm(immOf(bits === 64 ? 32 : bits)), bits);
			return finish();
		}
		if (op === 201) {
			text = "leave";
			ops.push({
				k: "mov",
				d: RSP,
				s: reg(RBP),
				w: 64
			});
			pop(RBP);
			return finish();
		}
		if (op === 164 || op === 165 || op === 170 || op === 171) {
			const size = sizeOf(op & 1 ? w : 8);
			const movs = op <= 165;
			const RSI = 6;
			const RDI = 7;
			text = `${rep ? "rep " : ""}${movs ? "movs" : "stos"}`;
			if (rep) ops.push({
				k: "cbz",
				s: reg(RCX),
				w: 64,
				nz: false,
				t: p
			});
			if (movs) {
				ops.push({
					k: "load",
					d: 32,
					ea: {
						base: RSI,
						index: null,
						scale: 1,
						disp: 0n
					},
					size,
					signed: false,
					w: 64
				});
				ops.push({
					k: "store",
					s: reg(32),
					ea: {
						base: RDI,
						index: null,
						scale: 1,
						disp: 0n
					},
					size
				});
				ops.push({
					k: "alu",
					op: "add",
					d: RSI,
					a: reg(RSI),
					b: imm(size),
					w: 64,
					f: "none"
				});
			} else ops.push({
				k: "store",
				s: reg(RAX),
				ea: {
					base: RDI,
					index: null,
					scale: 1,
					disp: 0n
				},
				size
			});
			ops.push({
				k: "alu",
				op: "add",
				d: RDI,
				a: reg(RDI),
				b: imm(size),
				w: 64,
				f: "none"
			});
			if (rep) {
				ops.push({
					k: "alu",
					op: "sub",
					d: RCX,
					a: reg(RCX),
					b: imm(1),
					w: 64,
					f: "none"
				});
				ops.push({
					k: "jmp",
					t: pc
				});
				fall = false;
				targets = [pc, p];
			}
			return finish();
		}
		if (op === 217 || op === 221 || op === 219) {
			const m = modrm();
			const kind = m.reg & 7;
			if (op === 217 && m.ea && kind === 7) {
				text = "fnstcw";
				ops.push({
					k: "store",
					s: imm(895),
					ea: m.ea,
					size: 2
				});
				return finish();
			}
			if (op === 217 && m.ea && kind === 5) {
				text = "fldcw";
				return finish();
			}
			return fail("x87 floating point is not in the map");
		}
		if (op === 204) return fail("int3 breakpoint");
		if (op === 232) {
			const rel = s32();
			const t = u64(p + rel);
			text = "call";
			push(imm(p));
			ops.push({
				k: "jmp",
				t
			});
			fall = false;
			targets = [t, p];
			return finish();
		}
		if (op === 233 || op === 235) {
			const rel = op === 233 ? s32() : s8();
			const t = u64(p + rel);
			text = "jmp";
			ops.push({
				k: "jmp",
				t
			});
			fall = false;
			targets = [t];
			return finish();
		}
		if (op === 244) {
			text = "hlt";
			ops.push({
				k: "halt",
				why: "hlt"
			});
			fall = false;
			return finish();
		}
		if (op === 246 || op === 247) {
			const bits = op === 246 ? 8 : w;
			const m = modrm();
			const kind = m.reg & 7;
			if (kind === 0 || kind === 1) {
				text = "test";
				const src = readRm(m, bits);
				ops.push({
					k: "alu",
					op: "and",
					d: null,
					a: src,
					b: imm(immOf(bits === 64 ? 32 : bits)),
					w: bits,
					f: "logic"
				});
				return finish();
			}
			if (kind === 2 || kind === 3) {
				text = kind === 2 ? "not" : "neg";
				const src = readRm(m, bits);
				if (kind === 2) ops.push({
					k: "alu",
					op: "xor",
					d: 32,
					a: src,
					b: imm(-1),
					w: bits,
					f: "none"
				});
				else ops.push({
					k: "alu",
					op: "sub",
					d: 32,
					a: imm(0),
					b: src,
					w: bits,
					f: "arith"
				});
				writeRm(m, reg(32), bits);
				return finish();
			}
			if (bits === 8) return fail("8-bit mul/div are not in the map");
			const src = readRm(m, bits, 33);
			if (kind === 4 || kind === 5) {
				text = kind === 4 ? "mul" : "imul";
				ops.push({
					k: "alu",
					op: kind === 4 ? "umulh" : "smulh",
					d: 32,
					a: reg(RAX),
					b: src,
					w: bits,
					f: "none"
				});
				ops.push({
					k: "alu",
					op: "mul",
					d: RAX,
					a: reg(RAX),
					b: src,
					w: bits,
					f: "none"
				});
				ops.push({
					k: "mov",
					d: RDX,
					s: reg(32),
					w: bits
				});
				if (kind === 4) ops.push({
					k: "alu",
					op: "sub",
					d: null,
					a: imm(0),
					b: reg(32),
					w: bits,
					f: "arith"
				}, {
					k: "set",
					d: 33,
					c: "b",
					w: 64
				});
				else ops.push({
					k: "alu",
					op: "sar",
					d: 33,
					a: reg(RAX),
					b: imm(bits - 1),
					w: bits,
					f: "none"
				}, {
					k: "alu",
					op: "sub",
					d: null,
					a: reg(33),
					b: reg(32),
					w: bits,
					f: "arith"
				}, {
					k: "set",
					d: 33,
					c: "ne",
					w: 64
				});
				ops.push(...overflowFlags(33));
				return finish();
			}
			text = kind === 6 ? "div" : "idiv";
			ops.push({
				k: "div2",
				signed: kind === 7,
				s: src,
				w: bits
			});
			return finish();
		}
		if (op === 254 || op === 255) {
			const bits = op === 254 ? 8 : w;
			const m = modrm();
			const kind = m.reg & 7;
			if (kind === 0 || kind === 1) {
				text = kind === 0 ? "inc" : "dec";
				const src = readRm(m, bits);
				ops.push({
					k: "alu",
					op: kind === 0 ? "add" : "sub",
					d: 32,
					a: src,
					b: imm(1),
					w: bits,
					f: "inc"
				});
				writeRm(m, reg(32), bits);
				return finish();
			}
			if (op === 254) return fail("fe extension is not in the map");
			if (kind === 2 || kind === 4) {
				const target = readRm(m, 64, 33);
				if ("r" in target && target.r !== 33) ops.push({
					k: "mov",
					d: 33,
					s: target,
					w: 64
				});
				if (kind === 2) {
					text = "call";
					push(imm(p));
					targets = [p];
				} else text = "jmp";
				ops.push({
					k: "jmpr",
					s: reg(33)
				});
				fall = false;
				return finish();
			}
			if (kind === 6) {
				text = "push";
				push(readRm(m, 64, 32));
				return finish();
			}
			return fail("far call/jmp are not in the map");
		}
		if (op === 15) {
			const op2 = byte();
			{
				const X = (n) => 37 + 2 * n;
				const XT = 16;
				const eaPlus = (ea, k) => {
					const copy = {
						...ea,
						disp: u64(ea.disp + BigInt(k))
					};
					eas.push(copy);
					return copy;
				};
				/** xmm operand from r/m: a register, or memory loaded into the temp vector. */
				const xrm = (m, size) => {
					if (!m.ea) return m.rm;
					ops.push({
						k: "load",
						d: X(XT),
						ea: m.ea,
						size: size === 16 ? 8 : size,
						signed: false,
						w: 64
					});
					if (size === 16) ops.push({
						k: "load",
						d: X(XT) + 1,
						ea: eaPlus(m.ea, 8),
						size: 8,
						signed: false,
						w: 64
					});
					else ops.push({
						k: "mov",
						d: X(XT) + 1,
						s: imm(0),
						w: 64
					});
					return XT;
				};
				const storeX = (ea, x, size) => {
					ops.push({
						k: "store",
						s: reg(X(x)),
						ea,
						size: size === 16 ? 8 : size
					});
					if (size === 16) ops.push({
						k: "store",
						s: reg(X(x) + 1),
						ea: eaPlus(ea, 8),
						size: 8
					});
				};
				const copyX = (d, a) => {
					if (d === a) return;
					ops.push({
						k: "mov",
						d: X(d),
						s: reg(X(a)),
						w: 64
					});
					ops.push({
						k: "mov",
						d: X(d) + 1,
						s: reg(X(a) + 1),
						w: 64
					});
				};
				const vec = (vop, d, a, b, immv = 0) => ops.push({
					k: "vec",
					op: vop,
					d,
					a,
					b,
					imm: immv
				});
				const lanesUnpack = (size, high) => {
					const out = [];
					const per = 16 / size;
					for (let j = 0; j < per; j += 1) {
						const lane = (high ? per / 2 : 0) + (j >> 1);
						for (let k = 0; k < size; k += 1) out.push((j & 1 ? 16 : 0) + lane * size + k);
					}
					return shuffleId(out);
				};
				const dwordShuffle = (pick) => {
					const out = [];
					for (let i = 0; i < 4; i += 1) for (let k = 0; k < 4; k += 1) out.push(pick(i) * 4 + k);
					return shuffleId(out);
				};
				const wordShuffle = (pick) => {
					const out = [];
					for (let i = 0; i < 8; i += 1) for (let k = 0; k < 2; k += 1) out.push(pick(i) * 2 + k);
					return shuffleId(out);
				};
				const zeroTemp = () => {
					ops.push({
						k: "mov",
						d: X(XT),
						s: imm(0),
						w: 64
					});
					ops.push({
						k: "mov",
						d: X(XT) + 1,
						s: imm(0),
						w: 64
					});
				};
				const p66 = opsize16 && !rep && !repne;
				const none = !opsize16 && !rep && !repne;
				const BIT = {
					219: "and",
					235: "or",
					239: "xor",
					84: "and",
					86: "or",
					87: "xor"
				};
				const PACKED = {
					100: "gt8",
					101: "gt16",
					102: "gt32",
					116: "eq8",
					117: "eq16",
					118: "eq32",
					212: "add64",
					252: "add8",
					253: "add16",
					254: "add32",
					248: "sub8",
					249: "sub16",
					250: "sub32",
					251: "sub64",
					218: "minu8",
					222: "maxu8",
					234: "mins16",
					238: "maxs16"
				};
				const sseDone = (name) => {
					text = name;
					return finish();
				};
				if ((op2 === 16 || op2 === 17) && (none || p66)) {
					const m = modrm();
					const xr = m.reg;
					if (op2 === 16) copyX(xr, xrm(m, 16));
					else if (m.ea) storeX(m.ea, xr, 16);
					else copyX(m.rm, xr);
					return sseDone("movups");
				}
				if ((op2 === 40 || op2 === 41) && (none || p66)) {
					const m = modrm();
					if (op2 === 40) copyX(m.reg, xrm(m, 16));
					else if (m.ea) storeX(m.ea, m.reg, 16);
					else copyX(m.rm, m.reg);
					return sseDone("movaps");
				}
				if ((op2 === 111 || op2 === 127) && (p66 || rep && !repne)) {
					const m = modrm();
					if (op2 === 111) copyX(m.reg, xrm(m, 16));
					else if (m.ea) storeX(m.ea, m.reg, 16);
					else copyX(m.rm, m.reg);
					return sseDone(rep ? "movdqu" : "movdqa");
				}
				if (op2 === 43 && (none || p66) || op2 === 231 && p66) {
					const m = modrm();
					if (!m.ea) throw new Gapped("non-temporal store needs memory");
					storeX(m.ea, m.reg, 16);
					return sseDone("movnt");
				}
				if ((op2 === 16 || op2 === 17) && (rep || repne)) {
					const size = rep ? 4 : 8;
					const m = modrm();
					const xr = m.reg;
					if (op2 === 17) {
						if (m.ea) ops.push({
							k: "store",
							s: reg(X(xr)),
							ea: m.ea,
							size
						});
						else if (size === 8) ops.push({
							k: "mov",
							d: X(m.rm),
							s: reg(X(xr)),
							w: 64
						});
						else ops.push(...mergeLow32(X(m.rm), X(xr)));
					} else if (m.ea) {
						ops.push({
							k: "load",
							d: X(xr),
							ea: m.ea,
							size,
							signed: false,
							w: 64
						});
						ops.push({
							k: "mov",
							d: X(xr) + 1,
							s: imm(0),
							w: 64
						});
					} else if (size === 8) ops.push({
						k: "mov",
						d: X(xr),
						s: reg(X(m.rm)),
						w: 64
					});
					else ops.push(...mergeLow32(X(xr), X(m.rm)));
					return sseDone(rep ? "movss" : "movsd");
				}
				if ((rep || repne) && !(rep && repne) && [
					81,
					88,
					89,
					92,
					93,
					94,
					95
				].includes(op2)) {
					const size = repne ? 8 : 4;
					const m = modrm();
					const b = xrm(m, size);
					const fname = {
						81: "sqrt",
						88: "add",
						89: "mul",
						92: "sub",
						93: "min",
						94: "div",
						95: "max"
					}[op2];
					ops.push({
						k: "fop",
						op: fname,
						d: m.reg,
						a: m.reg,
						b,
						size
					});
					return sseDone(`${fname}s${size === 8 ? "d" : "s"}`);
				}
				if ((rep || repne) && op2 === 42) {
					const m = modrm();
					const src = readRm(m, rexW ? 64 : 32, 32);
					ops.push({
						k: "fcvt",
						kind: "i2f",
						d: m.reg,
						s: src,
						w: rexW ? 64 : 32,
						size: repne ? 8 : 4
					});
					return sseDone("cvtsi2s");
				}
				if ((rep || repne) && (op2 === 44 || op2 === 45)) {
					const m = modrm();
					const a = xrm(m, repne ? 8 : 4);
					ops.push({
						k: "fcvt",
						kind: "f2i",
						d: m.reg,
						a,
						w: rexW ? 64 : 32,
						size: repne ? 8 : 4,
						trunc: op2 === 44
					});
					return sseDone(op2 === 44 ? "cvtts2si" : "cvts2si");
				}
				if ((rep || repne) && op2 === 90) {
					const m = modrm();
					const from = repne ? 8 : 4;
					const a = xrm(m, from);
					ops.push({
						k: "fcvt",
						kind: "f2f",
						d: m.reg,
						a,
						from
					});
					return sseDone(repne ? "cvtsd2ss" : "cvtss2sd");
				}
				if ((op2 === 46 || op2 === 47) && (none || p66)) {
					const m = modrm();
					const size = p66 ? 8 : 4;
					ops.push({
						k: "fcmp",
						a: m.reg,
						b: xrm(m, size),
						size
					});
					return sseDone(op2 === 46 ? "ucomis" : "comis");
				}
				if ((op2 === 18 || op2 === 19 || op2 === 22 || op2 === 23) && (none || p66)) {
					const m = modrm();
					const high = op2 >= 22;
					const half = (x) => X(x) + (high ? 1 : 0);
					if (op2 === 19 || op2 === 23) {
						if (!m.ea) throw new Gapped("movlps/movhps store needs memory");
						ops.push({
							k: "store",
							s: reg(half(m.reg)),
							ea: m.ea,
							size: 8
						});
					} else if (m.ea) ops.push({
						k: "load",
						d: half(m.reg),
						ea: m.ea,
						size: 8,
						signed: false,
						w: 64
					});
					else if (none) ops.push({
						k: "mov",
						d: half(m.reg),
						s: reg(X(m.rm) + (high ? 0 : 1)),
						w: 64
					});
					else throw new Gapped("movlpd/movhpd with a register is invalid");
					return sseDone(high ? "movhps" : "movlps");
				}
				if (BIT[op2] && (p66 || op2 < 96 && none) || op2 === 85 && (none || p66) || op2 === 223 && p66) {
					const m = modrm();
					const b = xrm(m, 16);
					if (op2 === 223 || op2 === 85) vec("andn", m.reg, b, m.reg);
					else vec(BIT[op2], m.reg, m.reg, b);
					return sseDone("pbitwise");
				}
				if (PACKED[op2] && p66) {
					const m = modrm();
					vec(PACKED[op2], m.reg, m.reg, xrm(m, 16));
					return sseDone("packed");
				}
				if (p66 && (op2 >= 96 && op2 <= 98 || op2 >= 104 && op2 <= 106 || op2 === 108 || op2 === 109)) {
					const m = modrm();
					const size = op2 === 108 || op2 === 109 ? 8 : 1 << (op2 & 3);
					const high = op2 >= 104 && op2 !== 108;
					vec("shuffle", m.reg, m.reg, xrm(m, 16), lanesUnpack(size, high));
					return sseDone("punpck");
				}
				if ((op2 === 20 || op2 === 21) && (none || p66)) {
					const m = modrm();
					vec("shuffle", m.reg, m.reg, xrm(m, 16), lanesUnpack(none ? 4 : 8, op2 === 21));
					return sseDone("unpck");
				}
				if (op2 === 112 && (p66 || rep || repne)) {
					const m = modrm();
					const src = xrm(m, 16);
					const k = byte();
					if (p66) vec("shuffle", m.reg, src, src, dwordShuffle((i) => k >> 2 * i & 3));
					else if (repne) vec("shuffle", m.reg, src, src, wordShuffle((i) => i < 4 ? k >> 2 * i & 3 : i));
					else vec("shuffle", m.reg, src, src, wordShuffle((i) => i < 4 ? i : 4 + (k >> 2 * (i - 4) & 3)));
					return sseDone("pshuf");
				}
				if (op2 === 198 && none) {
					const m = modrm();
					const src = xrm(m, 16);
					const k = byte();
					vec("shuffle", m.reg, m.reg, src, dwordShuffle((i) => i < 2 ? k >> 2 * i & 3 : 4 + (k >> 2 * i & 3)));
					return sseDone("shufps");
				}
				if (p66 && op2 >= 113 && op2 <= 115) {
					const m = modrm();
					if (m.ea) throw new Gapped("vector shift by immediate needs a register");
					const kind = m.reg & 7;
					const n = byte();
					const x = m.rm;
					if (op2 === 115 && (kind === 3 || kind === 7)) {
						zeroTemp();
						vec("shuffle", x, x, XT, shuffleId(Array.from({ length: 16 }, (_, i) => kind === 3 ? i + n < 16 ? i + n : 16 : i >= n ? i - n : 16)));
						return sseDone(kind === 3 ? "psrldq" : "pslldq");
					}
					const width = op2 === 113 ? 16 : op2 === 114 ? 32 : 64;
					const name = kind === 2 ? "shr" : kind === 4 ? "sar" : kind === 6 ? "shl" : null;
					if (!name || name === "sar" && width === 64) throw new Gapped("vector shift form is not in the map");
					if (n >= width && name !== "sar") vec("xor", x, x, x);
					else vec(`${name}${width}`, x, x, x, Math.min(n, width - 1));
					return sseDone(`p${name}`);
				}
				if (op2 === 110 && p66) {
					const m = modrm();
					const src = m.ea ? (ops.push({
						k: "load",
						d: 32,
						ea: m.ea,
						size: rexW ? 8 : 4,
						signed: false,
						w: 64
					}), reg(32)) : reg(m.rm);
					ops.push({
						k: "mov",
						d: X(m.reg),
						s: src,
						w: rexW ? 64 : 32
					});
					ops.push({
						k: "mov",
						d: X(m.reg) + 1,
						s: imm(0),
						w: 64
					});
					return sseDone(rexW ? "movq" : "movd");
				}
				if (op2 === 126 && p66) {
					const m = modrm();
					if (m.ea) ops.push({
						k: "store",
						s: reg(X(m.reg)),
						ea: m.ea,
						size: rexW ? 8 : 4
					});
					else ops.push({
						k: "mov",
						d: m.rm,
						s: reg(X(m.reg)),
						w: rexW ? 64 : 32
					});
					return sseDone(rexW ? "movq" : "movd");
				}
				if (op2 === 126 && rep && !repne || op2 === 214 && p66) {
					const m = modrm();
					if (op2 === 126) {
						const src = xrm(m, 8);
						ops.push({
							k: "mov",
							d: X(m.reg),
							s: reg(X(src)),
							w: 64
						});
						ops.push({
							k: "mov",
							d: X(m.reg) + 1,
							s: imm(0),
							w: 64
						});
					} else if (m.ea) ops.push({
						k: "store",
						s: reg(X(m.reg)),
						ea: m.ea,
						size: 8
					});
					else {
						ops.push({
							k: "mov",
							d: X(m.rm),
							s: reg(X(m.reg)),
							w: 64
						});
						ops.push({
							k: "mov",
							d: X(m.rm) + 1,
							s: imm(0),
							w: 64
						});
					}
					return sseDone("movq");
				}
				if (op2 === 215 && p66) {
					const m = modrm();
					if (m.ea) throw new Gapped("pmovmskb needs a register");
					ops.push({
						k: "vmask",
						d: m.reg,
						a: m.rm,
						lanes: 16
					});
					return sseDone("pmovmskb");
				}
				if (op2 === 80 && none) {
					const m = modrm();
					if (m.ea) throw new Gapped("movmskps needs a register");
					ops.push({
						k: "vmask",
						d: m.reg,
						a: m.rm,
						lanes: 4
					});
					return sseDone("movmskps");
				}
				if (op2 === 24 || op2 === 13) {
					modrm();
					return sseDone("prefetch");
				}
				if (op2 === 174 && none) {
					const m = modrm();
					const kind = m.reg & 7;
					if (!m.ea && kind >= 5) return sseDone("fence");
					if (m.ea && kind === 2) return sseDone("ldmxcsr");
					if (m.ea && kind === 3) {
						ops.push({
							k: "store",
							s: imm(8064),
							ea: m.ea,
							size: 4
						});
						return sseDone("stmxcsr");
					}
					throw new Gapped("0f ae form is not in the map");
				}
			}
			if (op2 === 5) {
				text = "syscall";
				ops.push({ k: "sys" });
				return finish();
			}
			if (op2 === 162) {
				text = "cpuid";
				ops.push({ k: "cpuid" });
				return finish();
			}
			if (op2 === 11) {
				text = "ud2";
				ops.push({
					k: "halt",
					why: "ud2"
				});
				fall = false;
				return finish();
			}
			if (op2 === 31) {
				text = "nop";
				modrm();
				return finish();
			}
			if (op2 === 30 && rep) {
				const b = byte();
				if (b === 250 || b === 251) {
					text = "endbr";
					return finish();
				}
				if ((b & 248) === 200) {
					text = "rdssp";
					return finish();
				}
				return fail("0f 1e form is not in the map");
			}
			if (op2 >= 64 && op2 <= 79) {
				const c = CC[op2 & 15];
				if (!c) return fail("parity conditions are not in the map");
				const m = modrm();
				const src = readRm(m, w);
				text = `cmov${c}`;
				ops.push({
					k: "csel",
					d: m.reg,
					c,
					a: src,
					b: reg(m.reg),
					w
				});
				return finish();
			}
			if (op2 >= 128 && op2 <= 143) {
				const c = CC[op2 & 15];
				if (!c) return fail("parity conditions are not in the map");
				const rel = s32();
				const t = u64(p + rel);
				text = `j${c}`;
				ops.push({
					k: "br",
					c,
					t
				});
				targets = [t];
				return finish();
			}
			if (op2 >= 144 && op2 <= 159) {
				const c = CC[op2 & 15];
				if (!c) return fail("parity conditions are not in the map");
				const m = modrm();
				text = `set${c}`;
				if (!m.ea) ops.push({
					k: "set",
					d: byteReg(m.rm),
					c,
					w: 8
				});
				else {
					ops.push({
						k: "set",
						d: 32,
						c,
						w: 64
					});
					ops.push({
						k: "store",
						s: reg(32),
						ea: m.ea,
						size: 1
					});
				}
				return finish();
			}
			if (op2 === 164 || op2 === 165 || op2 === 172 || op2 === 173) {
				if (w === 16) return fail("16-bit shld/shrd is not in the map");
				const left = op2 <= 165;
				const m = modrm();
				const cmask = w === 64 ? 63 : 31;
				const variable = op2 === 165 || op2 === 173;
				const n = variable ? -1 : byte() & cmask;
				if (n === 0) {
					text = left ? "shld" : "shrd";
					if (!m.ea && w === 32) ops.push({
						k: "mov",
						d: m.rm,
						s: reg(m.rm),
						w: 32
					});
					return finish();
				}
				const dst = readRm(m, w, 32);
				if ("r" in dst && dst.r !== 32) ops.push({
					k: "mov",
					d: 32,
					s: dst,
					w: 64
				});
				const count = variable ? reg(34) : imm(n);
				if (variable) ops.push({
					k: "alu",
					op: "and",
					d: 34,
					a: reg(RCX),
					b: imm(cmask),
					w: 64,
					f: "none"
				});
				const back = variable ? reg(35) : imm(w - 1 - n);
				if (variable) ops.push({
					k: "alu",
					op: "sub",
					d: 35,
					a: imm(w - 1),
					b: reg(34),
					w: 64,
					f: "none"
				});
				ops.push({
					k: "alu",
					op: left ? "shr" : "shl",
					d: 33,
					a: reg(m.reg),
					b: imm(1),
					w,
					f: "none"
				});
				ops.push({
					k: "alu",
					op: left ? "shr" : "shl",
					d: 33,
					a: reg(33),
					b: back,
					w,
					f: "none"
				});
				if (left) {
					ops.push({
						k: "alu",
						op: "shr",
						d: 71,
						a: reg(32),
						b: imm(1),
						w,
						f: "none"
					});
					ops.push({
						k: "alu",
						op: "shr",
						d: 71,
						a: reg(71),
						b: back,
						w,
						f: "none"
					});
				} else {
					ops.push({
						k: "alu",
						op: "sub",
						d: 71,
						a: count,
						b: imm(1),
						w: 64,
						f: "none"
					});
					ops.push({
						k: "alu",
						op: "shr",
						d: 71,
						a: reg(32),
						b: reg(71),
						w,
						f: "none"
					});
				}
				ops.push({
					k: "alu",
					op: left ? "shl" : "shr",
					d: 32,
					a: reg(32),
					b: count,
					w,
					f: "none"
				});
				ops.push({
					k: "alu",
					op: "or",
					d: 32,
					a: reg(32),
					b: reg(33),
					w,
					f: "none"
				});
				const when = variable ? {
					s: reg(RCX),
					mask: cmask
				} : null;
				ops.push({
					k: "flagsz",
					v: reg(32),
					w,
					when
				});
				ops.push({
					k: "setflag",
					flag: "c",
					v: reg(71),
					bit: 0,
					when
				});
				writeRm(m, reg(32), w);
				text = left ? "shld" : "shrd";
				return finish();
			}
			if (op2 === 163 || op2 === 171 || op2 === 179 || op2 === 187 || op2 === 186) {
				const m = modrm();
				let kind;
				let index;
				if (op2 === 186) {
					kind = m.reg & 7;
					if (kind < 4) return fail("0f ba form is not in the map");
					index = imm(byte() & w - 1);
				} else {
					kind = {
						163: 4,
						171: 5,
						179: 6,
						187: 7
					}[op2];
					index = reg(m.reg);
				}
				let target = m.ea;
				if (target && "r" in index) {
					const shift = Math.log2(w);
					ops.push({
						k: "alu",
						op: "sar",
						d: 34,
						a: index,
						b: imm(shift),
						w: 64,
						f: "none"
					});
					ops.push({
						k: "alu",
						op: "shl",
						d: 34,
						a: reg(34),
						b: imm(Math.log2(w / 8)),
						w: 64,
						f: "none"
					});
					ops.push({
						k: "lea",
						d: 34,
						ea: {
							...target,
							index: 34,
							scale: 1
						},
						w: 64
					});
					target = {
						base: 34,
						index: null,
						scale: 1,
						disp: 0n
					};
				}
				const mm = {
					...m,
					ea: target
				};
				const value = readRm(mm, w, 32);
				if ("r" in value && value.r !== 32) ops.push({
					k: "mov",
					d: 32,
					s: value,
					w: 64
				});
				ops.push({
					k: "alu",
					op: "shr",
					d: 33,
					a: reg(32),
					b: index,
					w,
					f: "none"
				});
				ops.push({
					k: "alu",
					op: "and",
					d: 33,
					a: reg(33),
					b: imm(1),
					w: 64,
					f: "none"
				});
				ops.push({
					k: "alu",
					op: "sub",
					d: null,
					a: imm(0),
					b: reg(33),
					w: 64,
					f: "arith"
				});
				text = [
					"bt",
					"bts",
					"btr",
					"btc"
				][kind - 4];
				if (kind === 4) return finish();
				ops.push({
					k: "alu",
					op: "shl",
					d: 33,
					a: imm(1),
					b: index,
					w,
					f: "none"
				});
				if (kind === 5) ops.push({
					k: "alu",
					op: "or",
					d: 32,
					a: reg(32),
					b: reg(33),
					w,
					f: "none"
				});
				if (kind === 6) {
					ops.push({
						k: "alu",
						op: "xor",
						d: 33,
						a: reg(33),
						b: imm(-1),
						w,
						f: "none"
					});
					ops.push({
						k: "alu",
						op: "and",
						d: 32,
						a: reg(32),
						b: reg(33),
						w,
						f: "none"
					});
				}
				if (kind === 7) ops.push({
					k: "alu",
					op: "xor",
					d: 32,
					a: reg(32),
					b: reg(33),
					w,
					f: "none"
				});
				writeRm(mm, reg(32), w);
				return finish();
			}
			if (op2 === 188 || op2 === 189) {
				const m = modrm();
				const src = readRm(m, w, 33);
				const bsr = op2 === 189;
				if (rep) {
					text = bsr ? "lzcnt" : "tzcnt";
					ops.push({
						k: "alu",
						op: bsr ? "clz" : "ctz",
						d: m.reg,
						a: src,
						b: imm(0),
						w,
						f: "logic"
					});
					ops.push({
						k: "setflag",
						flag: "c",
						v: reg(m.reg),
						bit: Math.log2(w),
						when: null
					});
					return finish();
				}
				text = bsr ? "bsr" : "bsf";
				ops.push({
					k: "alu",
					op: bsr ? "clz" : "ctz",
					d: 32,
					a: src,
					b: imm(0),
					w,
					f: "none"
				});
				if (bsr) ops.push({
					k: "alu",
					op: "sub",
					d: 32,
					a: imm(w - 1),
					b: reg(32),
					w,
					f: "none"
				});
				ops.push({
					k: "alu",
					op: "and",
					d: null,
					a: src,
					b: src,
					w,
					f: "logic"
				});
				ops.push({
					k: "csel",
					d: m.reg,
					c: "ne",
					a: reg(32),
					b: reg(m.reg),
					w
				});
				return finish();
			}
			if (op2 === 176 || op2 === 177) {
				const bits = op2 === 176 ? 8 : w;
				const m = modrm();
				const cur = readRm(m, bits, 32);
				if ("r" in cur && cur.r !== 32) ops.push({
					k: "mov",
					d: 32,
					s: cur,
					w: bits === 8 ? 64 : bits
				});
				ops.push({
					k: "alu",
					op: "sub",
					d: null,
					a: reg(RAX),
					b: reg(32),
					w: bits,
					f: "arith"
				});
				if (!m.ea && bits !== 8) {
					ops.push({
						k: "mov",
						d: 33,
						s: reg(m.reg),
						w: bits
					});
					ops.push({
						k: "csel",
						d: m.rm,
						c: "eq",
						a: reg(33),
						b: reg(m.rm),
						w: 64
					});
				} else {
					ops.push({
						k: "csel",
						d: 33,
						c: "eq",
						a: reg(bits === 8 ? byteReg(m.reg) : m.reg),
						b: reg(32),
						w: 64
					});
					writeRm(m, reg(33), bits);
				}
				if (bits === 8) ops.push({
					k: "csel",
					d: 33,
					c: "eq",
					a: reg(RAX),
					b: reg(32),
					w: 64
				}, {
					k: "mov",
					d: RAX,
					s: reg(33),
					w: 8
				});
				else ops.push({
					k: "csel",
					d: RAX,
					c: "eq",
					a: reg(RAX),
					b: reg(32),
					w: 64
				});
				text = "cmpxchg";
				return finish();
			}
			if (op2 === 192 || op2 === 193) {
				const bits = op2 === 192 ? 8 : w;
				const m = modrm();
				const cur = readRm(m, bits, 32);
				if ("r" in cur && cur.r !== 32) ops.push({
					k: "mov",
					d: 32,
					s: cur,
					w: 64
				});
				const r = bits === 8 ? byteReg(m.reg) : m.reg;
				ops.push({
					k: "alu",
					op: "add",
					d: 33,
					a: reg(32),
					b: reg(r),
					w: bits,
					f: "arith"
				});
				ops.push({
					k: "mov",
					d: r,
					s: reg(32),
					w: bits
				});
				writeRm(m, reg(33), bits);
				text = "xadd";
				return finish();
			}
			if (op2 >= 200 && op2 <= 207) {
				const r = op2 & 7 | rexB;
				text = "bswap";
				ops.push({
					k: "mov",
					d: 32,
					s: imm(0),
					w: 64
				});
				const n = w === 64 ? 8 : 4;
				for (let i = 0; i < n; i += 1) {
					ops.push({
						k: "alu",
						op: "shr",
						d: 33,
						a: reg(r),
						b: imm(8 * i),
						w: 64,
						f: "none"
					});
					ops.push({
						k: "alu",
						op: "and",
						d: 33,
						a: reg(33),
						b: imm(255),
						w: 64,
						f: "none"
					});
					ops.push({
						k: "alu",
						op: "shl",
						d: 33,
						a: reg(33),
						b: imm(8 * (n - 1 - i)),
						w: 64,
						f: "none"
					});
					ops.push({
						k: "alu",
						op: "or",
						d: 32,
						a: reg(32),
						b: reg(33),
						w: 64,
						f: "none"
					});
				}
				ops.push({
					k: "mov",
					d: r,
					s: reg(32),
					w: w === 64 ? 64 : 32
				});
				return finish();
			}
			if (op2 === 175) {
				const m = modrm();
				const src = readRm(m, w);
				text = "imul";
				if ("r" in src && src.r !== 32) ops.push({
					k: "mov",
					d: 32,
					s: src,
					w: 64
				});
				imulFlags(reg(m.reg), reg(32), m.reg);
				return finish();
			}
			if (op2 === 182 || op2 === 183 || op2 === 190 || op2 === 191) {
				const from = op2 & 1 ? 16 : 8;
				const signed = op2 >= 190;
				const m = modrm();
				text = signed ? "movsx" : "movzx";
				let src;
				if (m.ea) {
					ops.push({
						k: "load",
						d: 32,
						ea: m.ea,
						size: from / 8,
						signed: false,
						w: 64
					});
					src = reg(32);
				} else src = reg(from === 8 ? byteReg(m.rm) : m.rm);
				ops.push({
					k: "ext",
					d: m.reg,
					s: src,
					from,
					signed,
					w
				});
				return finish();
			}
			return fail(`0f ${op2.toString(16).padStart(2, "0")} is not in the map`);
		}
		return fail(`opcode ${op.toString(16).padStart(2, "0")} is not in the map`);
	} catch (error) {
		if (error instanceof Gapped) return fail(error.message);
		throw error;
	}
}
/**
* Lifter: walks machine code from its entry points, following every direct branch, call and
* return site, and builds the instruction map. Indirect jumps are resolved at run time: when the
* machine lands on an address it has not seen, the runner lifts from there and carries on.
*/
function newProgram(arch, text) {
	return {
		arch,
		insns: /* @__PURE__ */ new Map(),
		gaps: /* @__PURE__ */ new Map(),
		text
	};
}
function inText(program, pc) {
	return program.text.some(([lo, hi]) => pc >= lo && pc < hi);
}
function lift(program, fetch, roots, limit = 2e5) {
	const decode = program.arch === "x86_64" ? decodeX86 : decodeArm;
	const work = [...roots];
	let added = 0;
	const textFetch = (addr) => inText(program, addr) ? fetch(addr) : void 0;
	while (work.length) {
		const pc = work.pop();
		if (program.insns.has(pc) || program.gaps.has(pc)) continue;
		if (!inText(program, pc)) continue;
		if (program.arch === "aarch64" && pc % 4n !== 0n) {
			program.gaps.set(pc, {
				pc,
				bytes: "",
				reason: "misaligned arm instruction address"
			});
			continue;
		}
		if (program.insns.size >= limit) throw new Error("program is larger than the lifter limit");
		const result = decode(textFetch, pc);
		if ("gap" in result) {
			program.gaps.set(pc, result.gap);
			continue;
		}
		program.insns.set(pc, result.insn);
		added += 1;
		for (const t of result.targets) work.push(t);
		if (result.insn.fall) work.push(result.insn.next);
	}
	return { added };
}
/**
* The span of addresses that hold translated instructions. A store into it would make the
* translation stale, so both engines stop with "self-modifying code" instead.
*/
function codeExtent(program) {
	let lo = -1n;
	let hi = -1n;
	for (const insn of program.insns.values()) {
		if (lo < 0n || insn.pc < lo) lo = insn.pc;
		const end = insn.pc + BigInt(insn.len);
		if (end > hi) hi = end;
	}
	return lo < 0n ? [] : [[lo, hi]];
}
/**
* Guest machine state and the reference interpreter.
*
* State lives inside guest memory in the null page (see STATE in ir.ts), so the interpreter and the
* WebAssembly backend share one layout and the Linux shim can work with either.
*/
var GuestState = class {
	mem;
	view;
	constructor(mem) {
		this.mem = mem;
		this.view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
	}
	get size() {
		return this.mem.byteLength;
	}
	reg(i) {
		return this.view.getBigUint64(STATE.regs + i * 8, true);
	}
	setReg(i, v) {
		this.view.setBigUint64(STATE.regs + i * 8, u64(v), true);
	}
	get pc() {
		return this.view.getBigUint64(STATE.pc, true);
	}
	set pc(v) {
		this.view.setBigUint64(STATE.pc, u64(v), true);
	}
	get flags() {
		const g = (i) => this.view.getInt32(STATE.flags + i * 4, true);
		return {
			z: g(0),
			s: g(1),
			c: g(2),
			o: g(3),
			k: g(4),
			p: g(5)
		};
	}
	set flags(f) {
		[
			f.z,
			f.s,
			f.c,
			f.o,
			f.k,
			f.p ?? 0
		].forEach((v, i) => this.view.setInt32(STATE.flags + i * 4, v, true));
	}
	get fuel() {
		return this.view.getBigInt64(STATE.fuel, true);
	}
	set fuel(v) {
		this.view.setBigInt64(STATE.fuel, v, true);
	}
	get code() {
		return this.view.getInt32(STATE.code, true);
	}
	set code(v) {
		this.view.setInt32(STATE.code, v, true);
	}
	get faultAddr() {
		return this.view.getBigUint64(STATE.fault, true);
	}
	set faultAddr(v) {
		this.view.setBigUint64(STATE.fault, u64(v), true);
	}
	/** Guest memory accessors for the shim. They refuse the null page and anything out of range. */
	ok(addr, len) {
		return addr >= BigInt(4096) && addr + BigInt(len) <= BigInt(this.size);
	}
	read(addr, len) {
		if (!this.ok(addr, len)) return null;
		return this.mem.subarray(Number(addr), Number(addr) + len);
	}
	write(addr, bytes) {
		if (!this.ok(addr, bytes.length)) return false;
		this.mem.set(bytes, Number(addr));
		return true;
	}
};
/** The reference: slow, simple, BigInt everywhere. The WebAssembly backend is tested against it. */
var Interpreter = class {
	name = "interpreter";
	state;
	program;
	regs = new Array(72).fill(0n);
	code;
	constructor(program, state) {
		this.program = program;
		this.state = state;
		this.code = codeExtent(program);
	}
	val(s) {
		return "r" in s ? this.regs[s.r] : s.imm;
	}
	ea(e) {
		let a = e.disp;
		if (e.base !== null) a += this.regs[e.base];
		if (e.index !== null) a += this.regs[e.index] * BigInt(e.scale);
		if (e.a32) a &= 4294967295n;
		if (e.seg !== void 0) a += this.regs[e.seg];
		return u64(a);
	}
	inText(addr, size) {
		return this.code.some(([lo, hi]) => addr < hi && addr + BigInt(size) > lo);
	}
	run() {
		const st = this.state;
		const mem = st.mem;
		const dv = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
		for (let i = 0; i < 72; i += 1) this.regs[i] = st.reg(i);
		let flags = st.flags;
		let pc = st.pc;
		let fuel = st.fuel;
		const regs = this.regs;
		const memSize = BigInt(mem.byteLength);
		const bad = (addr, size) => addr < BigInt(4096) || addr > memSize - BigInt(size);
		let code = Stop.running;
		outer: for (;;) {
			fuel -= 1n;
			if (fuel < 0n) {
				code = Stop.fuel;
				break;
			}
			const insn = this.program.insns.get(pc);
			if (!insn) {
				code = Stop.unmapped;
				break;
			}
			let nextPc = insn.next;
			let moved = false;
			for (const op of insn.ops) {
				switch (op.k) {
					case "mov":
						regs[op.d] = writeWidth(regs[op.d], this.val(op.s), op.w);
						break;
					case "alu": {
						const a = this.val(op.a);
						const b = this.val(op.b);
						const r = aluValue(op.op, a, b, op.w, flags.c);
						flags = flagsAfter(op.op, op.f, a, b, r, op.w, flags);
						if (op.d !== null) regs[op.d] = writeWidth(regs[op.d], r, op.w);
						break;
					}
					case "ext": {
						const v = this.val(op.s) & mask(op.from);
						const e = op.signed ? u64(BigInt.asIntN(op.from, v)) : v;
						regs[op.d] = writeWidth(regs[op.d], e, op.w);
						break;
					}
					case "lea":
						regs[op.d] = writeWidth(regs[op.d], this.ea(op.ea), op.w);
						break;
					case "load": {
						const addr = this.ea(op.ea);
						if (bad(addr, op.size)) {
							st.faultAddr = addr;
							pc = insn.pc;
							code = Stop.fault;
							break outer;
						}
						const at = Number(addr);
						let v = op.size === 1 ? BigInt(dv.getUint8(at)) : op.size === 2 ? BigInt(dv.getUint16(at, true)) : op.size === 4 ? BigInt(dv.getUint32(at, true)) : dv.getBigUint64(at, true);
						if (op.signed) v = u64(BigInt.asIntN(op.size * 8, v));
						regs[op.d] = writeWidth(regs[op.d], v, op.w);
						break;
					}
					case "store": {
						const addr = this.ea(op.ea);
						if (bad(addr, op.size)) {
							st.faultAddr = addr;
							pc = insn.pc;
							code = Stop.fault;
							break outer;
						}
						if (this.inText(addr, op.size)) {
							st.faultAddr = addr;
							pc = insn.pc;
							code = Stop.smc;
							break outer;
						}
						const v = this.val(op.s);
						const at = Number(addr);
						if (op.size === 1) dv.setUint8(at, Number(v & 255n));
						else if (op.size === 2) dv.setUint16(at, Number(v & 65535n), true);
						else if (op.size === 4) dv.setUint32(at, Number(v & 4294967295n), true);
						else dv.setBigUint64(at, v & M64, true);
						break;
					}
					case "set":
						regs[op.d] = writeWidth(regs[op.d], evalCond(op.c, flags) ? 1n : 0n, op.w);
						break;
					case "csel": {
						const v = evalCond(op.c, flags) ? this.val(op.a) : this.val(op.b);
						regs[op.d] = writeWidth(regs[op.d], v & mask(op.w), op.w);
						break;
					}
					case "ccmp":
						if (evalCond(op.c, flags)) {
							const a = this.val(op.a);
							const b = this.val(op.b);
							const kind = op.neg ? "add" : "sub";
							flags = flagsAfter(kind, "arith", a, b, aluValue(kind, a, b, op.w), op.w, flags);
						} else flags = nzcvFlags(op.nzcv, flags.p);
						break;
					case "setnzcv":
						flags = nzcvFlags(op.nzcv, flags.p);
						break;
					case "br":
						if (evalCond(op.c, flags)) {
							nextPc = op.t;
							moved = true;
						}
						break;
					case "cbz":
						if ((this.val(op.s) & mask(op.w)) === 0n !== op.nz) {
							nextPc = op.t;
							moved = true;
						}
						break;
					case "tbz":
						if ((this.val(op.s) >> BigInt(op.bit) & 1n) === 1n === op.nz) {
							nextPc = op.t;
							moved = true;
						}
						break;
					case "jmp":
						nextPc = op.t;
						moved = true;
						break;
					case "jmpr":
						nextPc = this.val(op.s);
						moved = true;
						break;
					case "sys":
						pc = insn.next;
						code = Stop.syscall;
						break outer;
					case "guardz":
						if ((this.val(op.s) & mask(op.w)) === 0n) {
							pc = insn.pc;
							code = Stop.div0;
							break outer;
						}
						break;
					case "guardext": {
						const m = mask(op.w);
						const lo = regs[op.lo] & m;
						const want = op.signed && lo >> BigInt(op.w - 1) & 1n ? m : 0n;
						if ((regs[op.hi] & m) !== want) {
							pc = insn.pc;
							code = Stop.unsupported;
							break outer;
						}
						break;
					}
					case "halt":
						pc = insn.pc;
						code = Stop.halt;
						break outer;
					case "vec": {
						const pair = (x) => [regs[37 + 2 * x], regs[38 + 2 * x]];
						const [lo, hi] = vecValue(op.op, pair(op.a), pair(op.b), op.imm);
						regs[37 + 2 * op.d] = lo;
						regs[38 + 2 * op.d] = hi;
						break;
					}
					case "vmask": {
						const lo = regs[37 + 2 * op.a];
						const hi = regs[38 + 2 * op.a];
						let m = 0n;
						if (op.lanes === 16) {
							for (let i = 0; i < 8; i += 1) m |= (lo >> BigInt(8 * i + 7) & 1n) << BigInt(i);
							for (let i = 0; i < 8; i += 1) m |= (hi >> BigInt(8 * i + 7) & 1n) << BigInt(8 + i);
						} else m = lo >> 31n & 1n | (lo >> 63n & 1n) << 1n | (hi >> 31n & 1n) << 2n | (hi >> 63n & 1n) << 3n;
						regs[op.d] = m;
						break;
					}
					case "fop": {
						const lo = (x) => 37 + 2 * x;
						if (op.op === "min" || op.op === "max") {
							const read = (x) => op.size === 8 ? bitsToF64(regs[lo(x)]) : bitsToF32(regs[lo(x)]);
							const A = read(op.a);
							const B = read(op.b);
							const pickA = op.op === "min" ? A < B : A > B;
							const m = op.size === 8 ? M64 : 4294967295n;
							const bits = (pickA ? regs[lo(op.a)] : regs[lo(op.b)]) & m;
							regs[lo(op.d)] = op.size === 8 ? bits : regs[lo(op.d)] & 18446744069414584320n | bits;
							break;
						}
						if (op.size === 8) {
							const r = floatOp(op.op, bitsToF64(regs[lo(op.a)]), bitsToF64(regs[lo(op.b)]), 8);
							regs[lo(op.d)] = Number.isNaN(r) ? nanResult(regs[lo(op.a)], regs[lo(op.b)], 8, op.op) : f64ToBits(r);
						} else {
							const r = floatOp(op.op, bitsToF32(regs[lo(op.a)]), bitsToF32(regs[lo(op.b)]), 4);
							const bits = Number.isNaN(r) ? nanResult(regs[lo(op.a)], regs[lo(op.b)], 4, op.op) : f32ToBits(r);
							regs[lo(op.d)] = regs[lo(op.d)] & 18446744069414584320n | bits;
						}
						break;
					}
					case "fcvt": {
						const lo = (x) => 37 + 2 * x;
						if (op.kind === "i2f") {
							const v = this.val(op.s) & mask(op.w);
							const n = Number(BigInt.asIntN(op.w, v));
							if (op.size === 8) regs[lo(op.d)] = f64ToBits(Number(BigInt.asIntN(op.w, v)));
							else regs[lo(op.d)] = regs[lo(op.d)] & 18446744069414584320n | f32ToBits(op.w === 64 ? i64ToF32(BigInt.asIntN(64, v)) : Math.fround(n));
						} else if (op.kind === "f2i") {
							const x = op.size === 8 ? bitsToF64(regs[lo(op.a)]) : bitsToF32(regs[lo(op.a)]);
							regs[op.d] = writeWidth(regs[op.d], floatToInt(x, op.w, op.trunc), op.w);
						} else if (op.from === 8) regs[lo(op.d)] = regs[lo(op.d)] & 18446744069414584320n | f32ToBits(Math.fround(bitsToF64(regs[lo(op.a)])));
						else regs[lo(op.d)] = f64ToBits(bitsToF32(regs[lo(op.a)]));
						break;
					}
					case "fcmp": {
						const lo = (x) => 37 + 2 * x;
						const a = op.size === 8 ? bitsToF64(regs[lo(op.a)]) : bitsToF32(regs[lo(op.a)]);
						const b = op.size === 8 ? bitsToF64(regs[lo(op.b)]) : bitsToF32(regs[lo(op.b)]);
						const un = Number.isNaN(a) || Number.isNaN(b);
						flags = {
							z: un || a === b ? 1 : 0,
							p: un ? 1 : 0,
							c: un || a < b ? 1 : 0,
							s: 0,
							o: 0,
							k: 0
						};
						break;
					}
					case "div2": {
						const w = op.w;
						const m = mask(w);
						const d = this.val(op.s) & m;
						const hi = regs[2] & m;
						const lo = regs[0] & m;
						let q;
						let r;
						if (d === 0n) {
							pc = insn.pc;
							code = Stop.div0;
							break outer;
						}
						if (!op.signed) {
							const n = hi << BigInt(w) | lo;
							q = n / d;
							r = n % d;
							if (q > m) {
								pc = insn.pc;
								code = Stop.div0;
								break outer;
							}
						} else {
							const n = BigInt.asIntN(2 * w, hi << BigInt(w) | lo);
							const dd = BigInt.asIntN(w, d);
							q = n / dd;
							r = n % dd;
							const lim = 1n << BigInt(w - 1);
							if (q < -lim || q >= lim) {
								pc = insn.pc;
								code = Stop.div0;
								break outer;
							}
						}
						regs[0] = writeWidth(regs[0], q & m, w);
						regs[2] = writeWidth(regs[2], r & m, w);
						break;
					}
					case "flagsz": {
						if (op.when && (this.val(op.when.s) & BigInt(op.when.mask)) === 0n) break;
						const v = this.val(op.v) & mask(op.w);
						flags = {
							z: v === 0n ? 1 : 0,
							s: Number(v >> BigInt(op.w - 1) & 1n),
							c: 0,
							o: 0,
							k: 0,
							p: parity(v)
						};
						break;
					}
					case "setflag": {
						if (op.when) {
							const m = Number(this.val(op.when.s) & BigInt(op.when.mask));
							if (op.when.eq === void 0 ? m === 0 : m !== op.when.eq) break;
						}
						const bit = Number(this.val(op.v) >> BigInt(op.bit) & 1n);
						flags = op.flag === "c" ? {
							...flags,
							c: bit
						} : {
							...flags,
							o: bit
						};
						break;
					}
					case "cpuid": {
						const leaf = Number(regs[0] & 4294967295n);
						const row = CPUID.find(([l]) => l === leaf)?.[1] ?? [
							0,
							0,
							0,
							0
						];
						[
							0,
							3,
							1,
							2
						].forEach((r, i) => regs[r] = BigInt(row[i] >>> 0));
						break;
					}
				}
				if (moved) break;
			}
			pc = nextPc;
		}
		for (let i = 0; i < 72; i += 1) st.setReg(i, regs[i]);
		st.flags = flags;
		st.pc = pc;
		st.fuel = fuel < 0n ? 0n : fuel;
		st.code = code;
		return code;
	}
};
/**
* WebAssembly backend for the guest IR.
*
* Lowers a lifted program to one module with no imports. The module owns its memory (guest memory,
* exported as "mem") and exports `run(): i32`. State (registers, pc, flags, fuel) sits in the null
* page, so `run` loads it, executes until something needs the host (a system call, a fault, fuel
* running out, an address with no translation) and saves it back. The host handles the event and
* calls `run` again. Nothing outside the module is reachable from guest code.
*
* Layout: one dispatch loop with a br_table over every instruction address. Straight-line code
* falls from one instruction to the next without going through the table; every taken branch goes
* through it and costs one unit of fuel.
*/
var PC = 72;
var FUEL = 73;
var TA = 74;
var TB = 75;
var TR = 76;
var TEA = 77;
var FA = 78;
var I64_LOCALS = 79;
var ZF = I64_LOCALS;
var SF = ZF + 1;
var CF = ZF + 2;
var OF = ZF + 3;
var KF = ZF + 4;
var CODE = ZF + 5;
var I32_LOCALS = 8;
var PF = ZF + 7;
var I_IDX = ZF + 6;
var CHUNK_BITS = 15;
var CHUNK = 32768;
var V0 = ZF + I32_LOCALS;
var V128 = 123;
var F64 = 124;
var FA_ = V0 + 2;
var FB_ = V0 + 3;
var FR_ = V0 + 4;
function uleb(value) {
	const out = [];
	let n = value >>> 0;
	do {
		let byte = n & 127;
		n >>>= 7;
		if (n !== 0) byte |= 128;
		out.push(byte);
	} while (n !== 0);
	return out;
}
function sleb(value) {
	const out = [];
	let n = BigInt.asIntN(64, value);
	for (;;) {
		const byte = Number(n & 127n);
		n >>= 7n;
		const done = n === 0n && (byte & 64) === 0 || n === -1n && (byte & 64) !== 0;
		out.push(done ? byte : byte | 128);
		if (done) return out;
	}
}
function section(id, body) {
	return [
		id,
		...uleb(body.length),
		...body
	];
}
var I64 = 126;
var I32 = 127;
var Emitter = class {
	code = [];
	ctl = [];
	at = /* @__PURE__ */ new Map();
	emit(...bytes) {
		for (const b of bytes) this.code.push(b);
	}
	open(kind, label) {
		this.emit(kind === "block" ? 2 : kind === "loop" ? 3 : 4, 64);
		const list = this.at.get(label);
		if (list) list.push(this.ctl.length);
		else this.at.set(label, [this.ctl.length]);
		this.ctl.push(label);
	}
	end() {
		this.emit(11);
		const label = this.ctl.pop();
		const list = this.at.get(label);
		list.pop();
		if (!list.length) this.at.delete(label);
	}
	depth(label) {
		const list = this.at.get(label);
		if (!list || !list.length) throw new Error(`no label ${label}`);
		return this.ctl.length - 1 - list[list.length - 1];
	}
	br(label) {
		this.emit(12, ...uleb(this.depth(label)));
	}
	get(l) {
		this.emit(32, ...uleb(l));
	}
	set(l) {
		this.emit(33, ...uleb(l));
	}
	tee(l) {
		this.emit(34, ...uleb(l));
	}
	i64(v) {
		this.emit(66, ...sleb(v));
	}
	i32(v) {
		this.emit(65, ...sleb(BigInt(v | 0)));
	}
};
var maskOf = (w) => w >= 64 ? -1n : (1n << BigInt(w)) - 1n;
/** Address space per function. Each function holds the instructions of one aligned chunk, so no single function is huge. */
var FN_BITS = 14n;
function lowerProgram(program, memBytes) {
	if (memBytes % 65536 !== 0) throw new Error("guest memory must be a multiple of 64 KiB");
	const all = [...program.insns.values()].sort((a, b) => a.pc < b.pc ? -1 : a.pc > b.pc ? 1 : 0);
	if (!all.length) throw new Error("nothing to lower");
	const lo = all[0].pc;
	const hi = all[all.length - 1].pc + BigInt(all[all.length - 1].len);
	const arm = program.arch === "aarch64";
	const textRanges = [[lo, hi]];
	const spanBytes = hi - lo;
	const chunks = Number(spanBytes + (1n << FN_BITS) - 1n >> FN_BITS);
	if (chunks > 65536) throw new Error("program is too large for the WebAssembly backend; use the interpreter");
	const groups = /* @__PURE__ */ new Map();
	for (const insn of all) {
		const c = Number(insn.pc - lo >> FN_BITS);
		const list = groups.get(c);
		if (list) list.push(insn);
		else groups.set(c, [insn]);
	}
	const chunkIds = [...groups.keys()].sort((x, y) => x - y);
	const FIRST_CHUNK_FN = 5;
	const fnOf = new Map(chunkIds.map((c, i) => [c, FIRST_CHUNK_FN + i]));
	const t = new Emitter();
	t.emit(3, 64);
	const chunkOfPc = () => {
		t.i32(0);
		t.emit(41, 3, ...uleb(STATE.pc));
		t.i64(lo);
		t.emit(125);
		t.tee(0);
		t.i64(spanBytes);
		t.emit(90);
		t.emit(4, 64);
		t.i32(Stop.unmapped);
		t.emit(15);
		t.emit(11);
		t.get(0);
		t.i64(FN_BITS);
		t.emit(136);
		t.emit(167);
	};
	chunkOfPc();
	t.tee(1);
	t.emit(17, 0, 0);
	t.tee(2);
	t.i32(Stop.unmapped);
	t.emit(71);
	t.emit(4, 64);
	t.get(2);
	t.emit(15);
	t.emit(11);
	chunkOfPc();
	t.get(1);
	t.emit(70);
	t.emit(4, 64);
	t.i32(Stop.unmapped);
	t.emit(15);
	t.emit(11);
	t.emit(12, 0);
	t.emit(11);
	t.emit(0, 11);
	const topBody = [
		2,
		1,
		I64,
		2,
		I32,
		...t.code
	];
	const stubBody = [
		0,
		65,
		Stop.unmapped,
		11
	];
	const chunkBodies = chunkIds.map((c) => chunkBody(groups.get(c), arm, memBytes, textRanges));
	const bodies = [
		topBody,
		mulhBody(false),
		mulhBody(true),
		stubBody,
		udiv128Body(),
		...chunkBodies
	];
	const pages = memBytes / 65536;
	const name = (str) => [...uleb(str.length), ...[...str].map((ch) => ch.charCodeAt(0))];
	const elems = [];
	for (let c = 0; c < chunks; c += 1) elems.push(...uleb(fnOf.get(c) ?? 3));
	const parts = [
		[
			0,
			97,
			115,
			109,
			1,
			0,
			0,
			0
		],
		section(1, [
			3,
			96,
			0,
			1,
			I32,
			96,
			2,
			I64,
			I64,
			1,
			I64,
			96,
			3,
			I64,
			I64,
			I64,
			2,
			I64,
			I64
		]),
		section(3, [
			...uleb(bodies.length),
			0,
			1,
			1,
			0,
			2,
			...chunkIds.map(() => 0)
		]),
		section(4, [
			1,
			112,
			1,
			...uleb(chunks),
			...uleb(chunks)
		]),
		section(5, [
			1,
			1,
			...uleb(pages),
			...uleb(pages)
		]),
		section(7, [
			2,
			...name("run"),
			0,
			0,
			...name("mem"),
			2,
			0
		]),
		section(9, [
			1,
			0,
			65,
			0,
			11,
			...uleb(chunks),
			...elems
		])
	];
	const codeParts = [uleb(bodies.length)];
	for (const body of bodies) codeParts.push(uleb(body.length), body);
	const codeLen = codeParts.reduce((n, x) => n + x.length, 0);
	parts.push([10, ...uleb(codeLen)], ...codeParts);
	const total = parts.reduce((n, x) => n + x.length, 0);
	const bytes = new Uint8Array(total);
	let at = 0;
	for (const part of parts) {
		bytes.set(part, at);
		at += part.length;
	}
	return {
		bytes,
		lo,
		count: all.length
	};
}
/** One function: load CPU state, dispatch over this chunk's instructions, save state, return a stop code. */
function chunkBody(insns, arm, memBytes, textRanges) {
	const lo = insns[0].pc;
	const hi = insns[insns.length - 1].pc + BigInt(insns[insns.length - 1].len);
	const span = Number(hi - lo) >> (arm ? 2 : 0);
	const e = new Emitter();
	const N = insns.length;
	for (let r = 0; r < 72; r += 1) {
		e.i32(0);
		e.emit(41, 3, ...uleb(STATE.regs + r * 8));
		e.set(r);
	}
	e.i32(0);
	e.emit(41, 3, ...uleb(STATE.pc));
	e.set(PC);
	for (let i = 0; i < 6; i += 1) {
		e.i32(0);
		e.emit(40, 2, ...uleb(STATE.flags + i * 4));
		e.set(i === 5 ? PF : ZF + i);
	}
	e.i32(0);
	e.emit(41, 3, ...uleb(STATE.fuel));
	e.set(FUEL);
	e.open("block", "exit");
	e.open("loop", "dispatch");
	e.get(FUEL);
	e.i64(1n);
	e.emit(125);
	e.tee(FUEL);
	e.i64(0n);
	e.emit(83);
	e.open("if", "fuel");
	e.i32(Stop.fuel);
	e.set(CODE);
	e.br("exit");
	e.end();
	e.open("block", "unmapped");
	for (let i = N - 1; i >= 0; i -= 1) e.open("block", `b${i}`);
	e.get(PC);
	e.i64(lo);
	e.emit(125);
	e.tee(TA);
	e.i64(BigInt(Number(hi - lo)));
	e.emit(90);
	if (arm) {
		e.get(TA);
		e.i64(3n);
		e.emit(131);
		e.i64(0n);
		e.emit(82);
		e.emit(114);
	}
	e.emit(13, ...uleb(e.depth("unmapped")));
	e.get(TA);
	if (arm) {
		e.i64(2n);
		e.emit(136);
	}
	e.emit(167);
	{
		const table = new Array(span).fill(-1);
		insns.forEach((insn, i) => {
			table[Number(insn.pc - lo) >> (arm ? 2 : 0)] = i;
		});
		const chunks = Math.ceil(span / CHUNK);
		if (chunks <= 1) {
			const targets = table.map((i) => i < 0 ? e.depth("unmapped") : e.depth(`b${i}`));
			e.emit(14, ...uleb(targets.length));
			for (const t of targets) e.emit(...uleb(t));
			e.emit(...uleb(e.depth("unmapped")));
		} else {
			e.set(I_IDX);
			for (let c = chunks - 1; c >= 0; c -= 1) e.open("block", `c${c}`);
			e.get(I_IDX);
			e.i32(CHUNK_BITS);
			e.emit(118);
			e.emit(14, ...uleb(chunks));
			for (let c = 0; c < chunks; c += 1) e.emit(...uleb(e.depth(`c${c}`)));
			e.emit(...uleb(e.depth("unmapped")));
			for (let c = 0; c < chunks; c += 1) {
				e.end();
				const part = table.slice(c * CHUNK, (c + 1) * CHUNK);
				e.get(I_IDX);
				e.i32(32767);
				e.emit(113);
				const targets = part.map((i) => i < 0 ? e.depth("unmapped") : e.depth(`b${i}`));
				e.emit(14, ...uleb(targets.length));
				for (const t of targets) e.emit(...uleb(t));
				e.emit(...uleb(e.depth("unmapped")));
			}
		}
	}
	for (let i = 0; i < N; i += 1) {
		e.end();
		const insn = insns[i];
		lowerInsn(e, insn, memBytes, textRanges);
		if (insn.fall) {
			const following = insns[i + 1];
			if (!following || following.pc !== insn.next) {
				e.i64(insn.next);
				e.set(PC);
				e.br("dispatch");
			}
		}
	}
	e.end();
	e.i32(Stop.unmapped);
	e.set(CODE);
	e.br("exit");
	e.end();
	e.end();
	for (let r = 0; r < 72; r += 1) {
		e.i32(0);
		e.get(r);
		e.emit(55, 3, ...uleb(STATE.regs + r * 8));
	}
	e.i32(0);
	e.get(PC);
	e.emit(55, 3, ...uleb(STATE.pc));
	for (let i = 0; i < 6; i += 1) {
		e.i32(0);
		e.get(i === 5 ? PF : ZF + i);
		e.emit(54, 2, ...uleb(STATE.flags + i * 4));
	}
	e.i32(0);
	e.i64(0n);
	e.get(FUEL);
	e.get(FUEL);
	e.i64(0n);
	e.emit(83);
	e.emit(27);
	e.emit(55, 3, ...uleb(STATE.fuel));
	e.i32(0);
	e.get(FA);
	e.emit(55, 3, ...uleb(STATE.fault));
	e.i32(0);
	e.get(CODE);
	e.emit(54, 2, ...uleb(STATE.code));
	e.get(CODE);
	e.emit(11);
	return [
		...uleb(4),
		...uleb(I64_LOCALS),
		I64,
		...uleb(I32_LOCALS),
		I32,
		...uleb(2),
		V128,
		...uleb(3),
		F64,
		...e.code
	];
}
/** (hi:lo) / d for hi < d, unsigned 128-by-64 long division. Returns (quotient, remainder). Function 4. */
function udiv128Body() {
	const e = new Emitter();
	e.emit(3, 64);
	e.get(0);
	e.i64(63n);
	e.emit(136);
	e.set(5);
	e.get(0);
	e.i64(1n);
	e.emit(134);
	e.get(1);
	e.i64(63n);
	e.emit(136);
	e.emit(132);
	e.set(0);
	e.get(1);
	e.i64(1n);
	e.emit(134);
	e.set(1);
	e.get(4);
	e.i64(1n);
	e.emit(134);
	e.set(4);
	e.get(5);
	e.emit(80);
	e.emit(69);
	e.get(0);
	e.get(2);
	e.emit(90);
	e.emit(114);
	e.emit(4, 64);
	e.get(0);
	e.get(2);
	e.emit(125);
	e.set(0);
	e.get(4);
	e.i64(1n);
	e.emit(132);
	e.set(4);
	e.emit(11);
	e.get(3);
	e.i32(1);
	e.emit(106);
	e.tee(3);
	e.i32(64);
	e.emit(73);
	e.emit(13, 0);
	e.emit(11);
	e.get(4);
	e.get(0);
	e.emit(11);
	return [
		2,
		1,
		I32,
		2,
		I64,
		...e.code
	];
}
/** 64x64 -> high 64 bits, unsigned or signed. Function indexes 1 and 2. */
function mulhBody(signed) {
	const e = new Emitter();
	const M32 = 4294967295n;
	e.get(0);
	e.i64(M32);
	e.emit(131);
	e.set(2);
	e.get(0);
	e.i64(32n);
	e.emit(136);
	e.set(3);
	e.get(1);
	e.i64(M32);
	e.emit(131);
	e.set(4);
	e.get(1);
	e.i64(32n);
	e.emit(136);
	e.set(5);
	e.get(2);
	e.get(5);
	e.emit(126);
	e.set(6);
	e.get(3);
	e.get(4);
	e.emit(126);
	e.set(7);
	e.get(2);
	e.get(4);
	e.emit(126);
	e.i64(32n);
	e.emit(136);
	e.get(6);
	e.i64(M32);
	e.emit(131);
	e.emit(124);
	e.get(7);
	e.i64(M32);
	e.emit(131);
	e.emit(124);
	e.set(8);
	e.get(3);
	e.get(5);
	e.emit(126);
	e.get(6);
	e.i64(32n);
	e.emit(136);
	e.emit(124);
	e.get(7);
	e.i64(32n);
	e.emit(136);
	e.emit(124);
	e.get(8);
	e.i64(32n);
	e.emit(136);
	e.emit(124);
	if (signed) {
		e.get(1);
		e.i64(0n);
		e.get(0);
		e.i64(0n);
		e.emit(83);
		e.emit(27);
		e.emit(125);
		e.get(0);
		e.i64(0n);
		e.get(1);
		e.i64(0n);
		e.emit(83);
		e.emit(27);
		e.emit(125);
	}
	e.emit(11);
	return [
		1,
		7,
		I64,
		...e.code
	];
}
function src(e, s) {
	if ("r" in s) e.get(s.r);
	else e.i64(s.imm);
}
function maskTop(e, w) {
	if (w < 64) {
		e.i64(maskOf(w));
		e.emit(131);
	}
}
function signExtendTop(e, w) {
	if (w === 32) e.emit(196);
	else if (w === 16) e.emit(195);
	else if (w === 8) e.emit(194);
}
/** Write the value in TR (already masked to w) into register d with width semantics. */
function writeFrom(e, from, d, w) {
	if (w === 64 || w === 32) {
		e.get(from);
		if (w === 32) maskTop(e, 32);
		e.set(d);
		return;
	}
	e.get(d);
	e.i64(~maskOf(w));
	e.emit(131);
	e.get(from);
	maskTop(e, w);
	e.emit(132);
	e.set(d);
}
function exitWith(e, code, pc) {
	e.i64(pc);
	e.set(PC);
	e.i32(code);
	e.set(CODE);
	e.br("exit");
}
function cond(e, c) {
	const g = (l) => e.get(l);
	const carm = () => {
		g(CF);
		g(KF);
		e.emit(115);
	};
	const sxo = () => {
		g(SF);
		g(OF);
		e.emit(115);
	};
	const not = () => e.emit(69);
	switch (c) {
		case "eq":
			g(ZF);
			break;
		case "ne":
			g(ZF);
			not();
			break;
		case "b":
			g(CF);
			break;
		case "ae":
			g(CF);
			not();
			break;
		case "be":
			g(CF);
			g(ZF);
			e.emit(114);
			break;
		case "a":
			g(CF);
			g(ZF);
			e.emit(114);
			not();
			break;
		case "s":
			g(SF);
			break;
		case "ns":
			g(SF);
			not();
			break;
		case "o":
			g(OF);
			break;
		case "no":
			g(OF);
			not();
			break;
		case "lt":
			sxo();
			break;
		case "ge":
			sxo();
			not();
			break;
		case "le":
			g(ZF);
			sxo();
			e.emit(114);
			break;
		case "gt":
			g(ZF);
			sxo();
			e.emit(114);
			not();
			break;
		case "cs":
			carm();
			break;
		case "cc":
			carm();
			not();
			break;
		case "hi":
			carm();
			g(ZF);
			not();
			e.emit(113);
			break;
		case "ls":
			carm();
			not();
			g(ZF);
			e.emit(114);
			break;
		case "al":
			e.i32(1);
			break;
		case "p":
			g(PF);
			break;
		case "np":
			g(PF);
			not();
	}
}
function ea(e, x) {
	if (x.base !== null) e.get(x.base);
	else e.i64(0n);
	if (x.index !== null) {
		e.get(x.index);
		if (x.scale > 1) {
			e.i64(BigInt(Math.log2(x.scale)));
			e.emit(134);
		}
		e.emit(124);
	}
	if (x.disp !== 0n) {
		e.i64(x.disp);
		e.emit(124);
	}
	if (x.a32) {
		e.i64(4294967295n);
		e.emit(131);
	}
	if (x.seg !== void 0) {
		e.get(x.seg);
		e.emit(124);
	}
	e.set(TEA);
}
function checkAccess(e, size, memBytes, pc, store, text) {
	e.get(TEA);
	e.i64(BigInt(NULL_PAGE));
	e.emit(84);
	e.get(TEA);
	e.i64(BigInt(memBytes - size));
	e.emit(86);
	e.emit(114);
	e.open("if", "fault");
	e.get(TEA);
	e.set(FA);
	exitWith(e, Stop.fault, pc);
	e.end();
	if (store) for (const [lo, hi] of text) {
		e.get(TEA);
		e.i64(hi);
		e.emit(84);
		e.get(TEA);
		e.i64(BigInt(size));
		e.emit(124);
		e.i64(lo);
		e.emit(86);
		e.emit(113);
		e.open("if", "smc");
		e.get(TEA);
		e.set(FA);
		exitWith(e, Stop.smc, pc);
		e.end();
	}
}
function aluCompute(e, op, w) {
	const shiftCount = () => {
		e.get(TB);
		if (w < 64) {
			e.i64(31n);
			e.emit(131);
		}
	};
	switch (op) {
		case "add":
			e.get(TA);
			e.get(TB);
			e.emit(124);
			break;
		case "ctz":
			e.get(TA);
			e.emit(122);
			if (w < 64) {
				e.i64(BigInt(w));
				e.get(TA);
				e.i64(0n);
				e.emit(82);
				e.emit(27);
			}
			break;
		case "clz":
			e.get(TA);
			e.emit(121);
			if (w < 64) {
				e.i64(BigInt(64 - w));
				e.emit(125);
			}
			break;
		case "adc":
			e.get(TA);
			e.get(TB);
			e.emit(124);
			e.get(CF);
			e.emit(173);
			e.emit(124);
			break;
		case "sbb":
			e.get(TA);
			e.get(TB);
			e.emit(125);
			e.get(CF);
			e.emit(173);
			e.emit(125);
			break;
		case "sub":
			e.get(TA);
			e.get(TB);
			e.emit(125);
			break;
		case "and":
			e.get(TA);
			e.get(TB);
			e.emit(131);
			break;
		case "or":
			e.get(TA);
			e.get(TB);
			e.emit(132);
			break;
		case "xor":
			e.get(TA);
			e.get(TB);
			e.emit(133);
			break;
		case "mul":
			e.get(TA);
			e.get(TB);
			e.emit(126);
			break;
		case "shl":
			e.get(TA);
			shiftCount();
			e.emit(134);
			break;
		case "shr":
			e.get(TA);
			shiftCount();
			e.emit(136);
			break;
		case "sar":
			e.get(TA);
			signExtendTop(e, w);
			shiftCount();
			e.emit(135);
			break;
		case "ror":
			if (w === 64) {
				e.get(TA);
				e.get(TB);
				e.emit(138);
			} else if (w === 32) {
				e.get(TA);
				e.emit(167);
				e.get(TB);
				e.emit(167);
				e.emit(120);
				e.emit(173);
			} else throw new Error("ror below 32 bits is not lowered");
			break;
		case "umulh":
			if (w === 64) {
				e.get(TA);
				e.get(TB);
				e.emit(16, 1);
			} else {
				e.get(TA);
				e.get(TB);
				e.emit(126);
				e.i64(BigInt(w));
				e.emit(136);
			}
			break;
		case "smulh":
			if (w === 64) {
				e.get(TA);
				e.get(TB);
				e.emit(16, 2);
			} else {
				e.get(TA);
				signExtendTop(e, w);
				e.get(TB);
				signExtendTop(e, w);
				e.emit(126);
				e.i64(BigInt(w));
				e.emit(135);
			}
			break;
		case "udiv":
		case "urem": {
			const safe = () => {
				e.i64(1n);
				e.get(TB);
				e.get(TB);
				e.emit(80);
				e.emit(27);
			};
			if (op === "udiv") e.i64(0n);
			else e.get(TA);
			e.get(TA);
			safe();
			e.emit(op === "udiv" ? 128 : 130);
			e.get(TB);
			e.emit(80);
			e.emit(27);
			break;
		}
		case "sdiv":
		case "srem": {
			const A = () => {
				e.get(TA);
				signExtendTop(e, w);
			};
			const B = () => {
				e.get(TB);
				signExtendTop(e, w);
			};
			const safe = () => {
				e.i64(1n);
				B();
				B();
				e.emit(80);
				B();
				e.i64(-1n);
				e.emit(81);
				e.emit(114);
				e.emit(27);
			};
			if (op === "sdiv") e.i64(0n);
			else A();
			if (op === "sdiv") {
				e.i64(0n);
				A();
				e.emit(125);
			} else e.i64(0n);
			A();
			safe();
			e.emit(op === "sdiv" ? 127 : 129);
			B();
			e.i64(-1n);
			e.emit(81);
			e.emit(27);
			B();
			e.emit(80);
			e.emit(27);
			break;
		}
	}
	if (w < 64) maskTop(e, w);
}
function flags(e, op, mode, w) {
	if (mode === "none") return;
	const top = BigInt(w - 1);
	e.get(TR);
	e.emit(80);
	e.set(ZF);
	e.get(TR);
	e.i64(top);
	e.emit(136);
	e.i64(1n);
	e.emit(131);
	e.emit(167);
	e.set(SF);
	parityOf(e, TR);
	if (mode === "logic" || mode === "shift") {
		e.i32(0);
		e.set(CF);
		e.i32(0);
		e.set(OF);
		e.i32(0);
		e.set(KF);
		return;
	}
	const sub = op === "sub" || op === "sbb";
	if (sub) {
		e.get(TA);
		e.get(TB);
		e.emit(133);
		e.get(TA);
		e.get(TR);
		e.emit(133);
		e.emit(131);
	} else {
		e.get(TA);
		e.get(TR);
		e.emit(133);
		e.get(TB);
		e.get(TR);
		e.emit(133);
		e.emit(131);
	}
	e.i64(top);
	e.emit(136);
	e.i64(1n);
	e.emit(131);
	e.emit(167);
	e.set(OF);
	if (mode === "inc") return;
	if (op === "sbb") {
		e.get(TA);
		e.get(TB);
		e.emit(84);
		e.get(CF);
		e.get(TA);
		e.get(TB);
		e.emit(81);
		e.emit(113);
		e.emit(114);
	} else if (op === "adc") {
		if (w === 64) {
			e.get(TR);
			e.get(TA);
			e.emit(84);
			e.get(CF);
			e.get(TR);
			e.get(TA);
			e.emit(81);
			e.emit(113);
			e.emit(114);
		} else {
			e.get(TA);
			e.get(TB);
			e.emit(124);
			e.get(CF);
			e.emit(173);
			e.emit(124);
			e.i64(maskOf(w));
			e.emit(86);
		}
	} else if (sub) {
		e.get(TA);
		e.get(TB);
		e.emit(84);
	} else if (w === 64) {
		e.get(TR);
		e.get(TA);
		e.emit(84);
	} else {
		e.get(TA);
		e.get(TB);
		e.emit(124);
		e.i64(maskOf(w));
		e.emit(86);
	}
	e.set(CF);
	e.i32(sub ? 1 : 0);
	e.set(KF);
}
function lowerOp(e, op, insn, memBytes, text) {
	switch (op.k) {
		case "mov":
			src(e, op.s);
			maskTop(e, op.w);
			e.set(TR);
			writeFrom(e, TR, op.d, op.w);
			return;
		case "alu":
			src(e, op.a);
			maskTop(e, op.w);
			e.set(TA);
			src(e, op.b);
			maskTop(e, op.w);
			e.set(TB);
			aluCompute(e, op.op, op.w);
			e.set(TR);
			flags(e, op.op, op.f, op.w);
			if (op.d !== null) writeFrom(e, TR, op.d, op.w);
			return;
		case "ext":
			src(e, op.s);
			if (op.signed) signExtendTop(e, op.from);
			else maskTop(e, op.from);
			maskTop(e, op.w);
			e.set(TR);
			writeFrom(e, TR, op.d, op.w);
			return;
		case "lea":
			ea(e, op.ea);
			e.get(TEA);
			maskTop(e, op.w);
			e.set(TR);
			writeFrom(e, TR, op.d, op.w);
			return;
		case "load": {
			ea(e, op.ea);
			checkAccess(e, op.size, memBytes, insn.pc, false, text);
			e.get(TEA);
			e.emit(167);
			const opcode = {
				1: op.signed ? 48 : 49,
				2: op.signed ? 50 : 51,
				4: op.signed ? 52 : 53,
				8: 41
			}[op.size];
			e.emit(opcode, 0, 0);
			maskTop(e, op.w);
			e.set(TR);
			writeFrom(e, TR, op.d, op.w);
			return;
		}
		case "store": {
			ea(e, op.ea);
			checkAccess(e, op.size, memBytes, insn.pc, true, text);
			e.get(TEA);
			e.emit(167);
			src(e, op.s);
			const opcode = {
				1: 60,
				2: 61,
				4: 62,
				8: 55
			}[op.size];
			e.emit(opcode, 0, 0);
			return;
		}
		case "set":
			cond(e, op.c);
			e.emit(173);
			e.set(TR);
			writeFrom(e, TR, op.d, op.w);
			return;
		case "csel":
			src(e, op.a);
			src(e, op.b);
			cond(e, op.c);
			e.emit(27);
			maskTop(e, op.w);
			e.set(TR);
			writeFrom(e, TR, op.d, op.w);
			return;
		case "ccmp": {
			cond(e, op.c);
			e.open("if", "ccmp");
			const kind = op.neg ? "add" : "sub";
			src(e, op.a);
			maskTop(e, op.w);
			e.set(TA);
			src(e, op.b);
			maskTop(e, op.w);
			e.set(TB);
			aluCompute(e, kind, op.w);
			e.set(TR);
			flags(e, kind, "arith", op.w);
			e.emit(5);
			setNzcv(e, op.nzcv);
			e.end();
			return;
		}
		case "setnzcv":
			setNzcv(e, op.nzcv);
			return;
		case "br":
			cond(e, op.c);
			e.open("if", "br");
			e.i64(op.t);
			e.set(PC);
			e.br("dispatch");
			e.end();
			return;
		case "cbz":
			src(e, op.s);
			maskTop(e, op.w);
			e.emit(80);
			if (op.nz) e.emit(69);
			e.open("if", "cbz");
			e.i64(op.t);
			e.set(PC);
			e.br("dispatch");
			e.end();
			return;
		case "tbz":
			src(e, op.s);
			e.i64(BigInt(op.bit));
			e.emit(136);
			e.i64(1n);
			e.emit(131);
			e.emit(167);
			if (!op.nz) e.emit(69);
			e.open("if", "tbz");
			e.i64(op.t);
			e.set(PC);
			e.br("dispatch");
			e.end();
			return;
		case "jmp":
			e.i64(op.t);
			e.set(PC);
			e.br("dispatch");
			return;
		case "jmpr":
			src(e, op.s);
			e.set(PC);
			e.br("dispatch");
			return;
		case "sys":
			exitWith(e, Stop.syscall, insn.next);
			return;
		case "guardz":
			src(e, op.s);
			maskTop(e, op.w);
			e.emit(80);
			e.open("if", "guard");
			exitWith(e, Stop.div0, insn.pc);
			e.end();
			return;
		case "guardext":
			e.get(op.hi);
			maskTop(e, op.w);
			if (op.signed) {
				e.get(op.lo);
				signExtendTop(e, op.w);
				e.i64(63n);
				e.emit(135);
				maskTop(e, op.w);
			} else e.i64(0n);
			e.emit(82);
			e.open("if", "guard");
			exitWith(e, Stop.unsupported, insn.pc);
			e.end();
			return;
		case "halt":
			exitWith(e, Stop.halt, insn.pc);
			return;
		case "vec": {
			const lo = (x) => 37 + 2 * x;
			const pack = (x) => {
				e.i64(0n);
				simd(e, 18);
				e.get(lo(x));
				simd(e, 30);
				e.emit(0);
				e.get(lo(x) + 1);
				simd(e, 30);
				e.emit(1);
			};
			const VEC = {
				and: 78,
				or: 80,
				xor: 81,
				andn: 79,
				add8: 110,
				add16: 142,
				add32: 174,
				add64: 206,
				sub8: 113,
				sub16: 145,
				sub32: 177,
				sub64: 209,
				eq8: 35,
				eq16: 45,
				eq32: 55,
				gt8: 39,
				gt16: 49,
				gt32: 59,
				minu8: 119,
				maxu8: 121,
				mins16: 150,
				maxs16: 152,
				shl16: 139,
				shr16: 141,
				sar16: 140,
				shl32: 171,
				shr32: 173,
				sar32: 172,
				shl64: 203,
				shr64: 205
			};
			pack(op.a);
			if (/^(shl|shr|sar)/.test(op.op)) {
				e.i32(op.imm);
				simd(e, VEC[op.op]);
			} else if (op.op === "shuffle") {
				pack(op.b);
				simd(e, 13);
				e.emit(...vecShuffles[op.imm]);
			} else {
				pack(op.b);
				simd(e, VEC[op.op]);
			}
			e.tee(V0);
			simd(e, 29);
			e.emit(0);
			e.set(lo(op.d));
			e.get(V0);
			simd(e, 29);
			e.emit(1);
			e.set(lo(op.d) + 1);
			return;
		}
		case "vmask": {
			const lo = 37 + 2 * op.a;
			e.i64(0n);
			simd(e, 18);
			e.get(lo);
			simd(e, 30);
			e.emit(0);
			e.get(lo + 1);
			simd(e, 30);
			e.emit(1);
			simd(e, op.lanes === 16 ? 100 : 164);
			e.emit(173);
			e.set(op.d);
			return;
		}
		case "fop": {
			const lo = (x) => 37 + 2 * x;
			const d64 = op.size === 8;
			const load = (x, into) => {
				e.get(lo(x));
				if (d64) e.emit(191);
				else {
					e.emit(167);
					e.emit(190);
					e.emit(187);
				}
				e.set(into);
			};
			load(op.a, FA_);
			load(op.b, FB_);
			const raw = (x) => {
				e.get(lo(x));
				if (!d64) {
					e.i64(4294967295n);
					e.emit(131);
				}
			};
			if (op.op === "min" || op.op === "max") {
				raw(op.a);
				raw(op.b);
				e.get(FA_);
				e.get(FB_);
				e.emit(op.op === "min" ? 99 : 100);
				e.emit(27);
			} else {
				const F = {
					add: 160,
					sub: 161,
					mul: 162,
					div: 163
				};
				if (op.op === "sqrt") {
					e.get(FB_);
					e.emit(159);
				} else {
					e.get(FA_);
					e.get(FB_);
					e.emit(F[op.op]);
				}
				if (!d64) {
					e.emit(182);
					e.emit(187);
				}
				e.set(FR_);
				const bits = () => {
					e.get(FR_);
					if (d64) e.emit(189);
					else {
						e.emit(182);
						e.emit(188);
						e.emit(173);
					}
				};
				const quiet = BigInt(d64 ? "0x0008000000000000" : "0x00400000");
				e.get(FR_);
				e.get(FR_);
				e.emit(98);
				e.emit(4, I64);
				e.ctl.push("fnan");
				if (op.op !== "sqrt") {
					e.get(FA_);
					e.get(FA_);
					e.emit(98);
					e.emit(4, I64);
					e.ctl.push("fa");
					raw(op.a);
					e.i64(quiet);
					e.emit(132);
					e.emit(5);
				}
				e.get(FB_);
				e.get(FB_);
				e.emit(98);
				e.emit(4, I64);
				e.ctl.push("fb");
				raw(op.b);
				e.i64(quiet);
				e.emit(132);
				e.emit(5);
				e.i64(d64 ? -2251799813685248n : 4290772992n);
				e.emit(11);
				e.ctl.pop();
				if (op.op !== "sqrt") {
					e.emit(11);
					e.ctl.pop();
				}
				e.emit(5);
				bits();
				e.emit(11);
				e.ctl.pop();
			}
			if (d64) e.set(lo(op.d));
			else {
				e.set(TR);
				e.get(lo(op.d));
				e.i64(-4294967296n);
				e.emit(131);
				e.get(TR);
				e.emit(132);
				e.set(lo(op.d));
			}
			return;
		}
		case "fcvt": {
			const lo = (x) => 37 + 2 * x;
			if (op.kind === "i2f") {
				src(e, op.s);
				if (op.w === 32) {
					e.emit(167);
					e.emit(op.size === 8 ? 183 : 178);
				} else e.emit(op.size === 8 ? 185 : 180);
				if (op.size === 8) {
					e.emit(189);
					e.set(lo(op.d));
				} else {
					e.emit(188);
					e.emit(173);
					e.set(TR);
					e.get(lo(op.d));
					e.i64(-4294967296n);
					e.emit(131);
					e.get(TR);
					e.emit(132);
					e.set(lo(op.d));
				}
				return;
			}
			if (op.kind === "f2f") {
				e.get(lo(op.a));
				if (op.from === 8) {
					e.emit(191);
					e.emit(182);
					e.emit(188);
					e.emit(173);
					e.set(TR);
					e.get(lo(op.d));
					e.i64(-4294967296n);
					e.emit(131);
					e.get(TR);
					e.emit(132);
					e.set(lo(op.d));
				} else {
					e.emit(167);
					e.emit(190);
					e.emit(187);
					e.emit(189);
					e.set(lo(op.d));
				}
				return;
			}
			e.get(lo(op.a));
			if (op.size === 8) e.emit(191);
			else {
				e.emit(167);
				e.emit(190);
				e.emit(187);
			}
			if (!op.trunc) e.emit(158);
			else e.emit(157);
			e.set(FR_);
			const lim = op.w === 64 ? 0x8000000000000000 : 2147483648;
			e.get(FR_);
			e.emit(68, ...f64Bytes(-lim));
			e.emit(102);
			e.get(FR_);
			e.emit(68, ...f64Bytes(lim));
			e.emit(99);
			e.emit(113);
			e.emit(4, I64);
			e.ctl.push("cvt");
			e.get(FR_);
			e.emit(176);
			e.emit(5);
			e.i64(op.w === 64 ? -9223372036854775808n : 2147483648n);
			e.emit(11);
			e.ctl.pop();
			if (op.w === 32) {
				e.i64(4294967295n);
				e.emit(131);
			}
			e.set(TR);
			writeFrom(e, TR, op.d, op.w);
			return;
		}
		case "fcmp": {
			const lo = (x) => 37 + 2 * x;
			const load = (x, into) => {
				e.get(lo(x));
				if (op.size === 8) e.emit(191);
				else {
					e.emit(167);
					e.emit(190);
					e.emit(187);
				}
				e.set(into);
			};
			load(op.a, FA_);
			load(op.b, FB_);
			e.get(FA_);
			e.get(FA_);
			e.emit(98);
			e.get(FB_);
			e.get(FB_);
			e.emit(98);
			e.emit(114);
			e.set(PF);
			e.get(PF);
			e.get(FA_);
			e.get(FB_);
			e.emit(97);
			e.emit(114);
			e.set(ZF);
			e.get(PF);
			e.get(FA_);
			e.get(FB_);
			e.emit(99);
			e.emit(114);
			e.set(CF);
			e.i32(0);
			e.set(SF);
			e.i32(0);
			e.set(OF);
			e.i32(0);
			e.set(KF);
			return;
		}
		case "div2": {
			const w = op.w;
			const div0 = () => exitWith(e, Stop.div0, insn.pc);
			src(e, op.s);
			maskTop(e, w);
			e.set(TB);
			e.get(TB);
			e.emit(80);
			e.open("if", "dz");
			div0();
			e.end();
			if (w < 64) {
				e.get(2);
				maskTop(e, w);
				e.i64(BigInt(w));
				e.emit(134);
				e.get(0);
				maskTop(e, w);
				e.emit(132);
				if (op.signed && w === 16) e.emit(196);
				e.set(TA);
				const lim = 1n << BigInt(w - 1);
				if (!op.signed) {
					e.get(TA);
					e.get(TB);
					e.emit(128);
					e.set(TR);
					e.get(TR);
					e.i64(maskOf(w));
					e.emit(86);
					e.open("if", "ov");
					div0();
					e.end();
					e.get(TA);
					e.get(TB);
					e.emit(130);
					e.set(FA);
				} else {
					e.get(TB);
					signExtendTop(e, w);
					e.set(TB);
					e.get(TA);
					e.i64(-9223372036854775808n);
					e.emit(81);
					e.get(TB);
					e.i64(-1n);
					e.emit(81);
					e.emit(113);
					e.open("if", "ov");
					div0();
					e.end();
					e.get(TA);
					e.get(TB);
					e.emit(127);
					e.set(TR);
					e.get(TR);
					e.i64(-lim);
					e.emit(83);
					e.get(TR);
					e.i64(lim);
					e.emit(89);
					e.emit(114);
					e.open("if", "ov");
					div0();
					e.end();
					e.get(TA);
					e.get(TB);
					e.emit(129);
					e.set(FA);
				}
			} else if (!op.signed) {
				e.get(2);
				e.get(TB);
				e.emit(90);
				e.open("if", "ov");
				div0();
				e.end();
				e.get(2);
				e.get(0);
				e.get(TB);
				e.emit(16, 4);
				e.set(FA);
				e.set(TR);
			} else {
				e.get(2);
				e.i64(0n);
				e.emit(83);
				e.emit(173);
				e.set(TEA);
				e.get(TB);
				e.i64(0n);
				e.emit(83);
				e.emit(173);
				e.set(TR);
				e.get(0);
				e.set(FA);
				e.get(2);
				e.set(TA);
				e.get(TEA);
				e.i64(0n);
				e.emit(82);
				e.open("if", "nh");
				e.i64(0n);
				e.get(0);
				e.emit(125);
				e.set(FA);
				e.get(2);
				e.i64(-1n);
				e.emit(133);
				e.get(0);
				e.emit(80);
				e.emit(173);
				e.emit(124);
				e.set(TA);
				e.end();
				e.get(TR);
				e.i64(0n);
				e.emit(82);
				e.open("if", "nd");
				e.i64(0n);
				e.get(TB);
				e.emit(125);
				e.set(TB);
				e.end();
				e.get(TA);
				e.get(TB);
				e.emit(90);
				e.open("if", "ov");
				div0();
				e.end();
				e.get(TA);
				e.get(FA);
				e.get(TB);
				e.emit(16, 4);
				e.set(FA);
				e.set(TA);
				e.get(TEA);
				e.get(TR);
				e.emit(133);
				e.i64(0n);
				e.emit(82);
				e.open("if", "qn");
				e.get(TA);
				e.i64(-9223372036854775808n);
				e.emit(86);
				e.open("if", "ov");
				div0();
				e.end();
				e.i64(0n);
				e.get(TA);
				e.emit(125);
				e.set(TA);
				e.emit(5);
				e.get(TA);
				e.i64(-9223372036854775808n);
				e.emit(90);
				e.open("if", "ov");
				div0();
				e.end();
				e.end();
				e.get(TEA);
				e.i64(0n);
				e.emit(82);
				e.open("if", "rn");
				e.i64(0n);
				e.get(FA);
				e.emit(125);
				e.set(FA);
				e.end();
				e.get(TA);
				e.set(TR);
			}
			writeFrom(e, TR, 0, w);
			writeFrom(e, FA, 2, w);
			return;
		}
		case "flagsz":
			if (op.when) {
				src(e, op.when.s);
				e.i64(BigInt(op.when.mask));
				e.emit(131);
				e.i64(0n);
				e.emit(82);
				e.open("if", "flagsz");
			}
			src(e, op.v);
			maskTop(e, op.w);
			e.set(TR);
			e.get(TR);
			e.emit(80);
			e.set(ZF);
			e.get(TR);
			e.i64(BigInt(op.w - 1));
			e.emit(136);
			e.i64(1n);
			e.emit(131);
			e.emit(167);
			e.set(SF);
			parityOf(e, TR);
			e.i32(0);
			e.set(CF);
			e.i32(0);
			e.set(OF);
			e.i32(0);
			e.set(KF);
			if (op.when) e.end();
			return;
		case "setflag":
			if (op.when) {
				src(e, op.when.s);
				e.i64(BigInt(op.when.mask));
				e.emit(131);
				if (op.when.eq === void 0) {
					e.i64(0n);
					e.emit(82);
				} else {
					e.i64(BigInt(op.when.eq));
					e.emit(81);
				}
				e.open("if", "flag");
			}
			src(e, op.v);
			e.i64(BigInt(op.bit));
			e.emit(136);
			e.i64(1n);
			e.emit(131);
			e.emit(167);
			e.set(op.flag === "c" ? CF : OF);
			if (op.when) e.end();
			return;
		case "cpuid": {
			const out = [
				0,
				3,
				1,
				2
			];
			e.get(0);
			e.i64(4294967295n);
			e.emit(131);
			e.set(TA);
			for (const r of out) {
				e.i64(0n);
				e.set(r);
			}
			for (const [leaf, row] of CPUID) {
				e.get(TA);
				e.i64(BigInt(leaf));
				e.emit(81);
				e.open("if", "cpuid");
				row.forEach((v, i) => {
					e.i64(BigInt(v >>> 0));
					e.set(out[i]);
				});
				e.end();
			}
			return;
		}
	}
}
/** PF = even number of set bits in the low byte of local x. */
function parityOf(e, x) {
	e.get(x);
	e.i64(255n);
	e.emit(131);
	e.emit(123);
	e.i64(1n);
	e.emit(131);
	e.emit(80);
	e.set(PF);
}
function f64Bytes(x) {
	return Array.from(new Uint8Array(new Float64Array([x]).buffer));
}
function simd(e, sub) {
	e.emit(253, ...uleb(sub));
}
function setNzcv(e, nzcv) {
	e.i32(nzcv >> 3 & 1);
	e.set(SF);
	e.i32(nzcv >> 2 & 1);
	e.set(ZF);
	e.i32(nzcv >> 1 & 1);
	e.set(CF);
	e.i32(nzcv & 1);
	e.set(OF);
	e.i32(0);
	e.set(KF);
}
function lowerInsn(e, insn, memBytes, text) {
	for (const op of insn.ops) lowerOp(e, op, insn, memBytes, text);
}
function instantiate(build) {
	if (!WebAssembly.validate(build.bytes)) throw new Error("lowered module failed validation");
	const module = new WebAssembly.Module(build.bytes);
	if (WebAssembly.Module.imports(module).length) throw new Error("lowered module must not import anything");
	const instance = new WebAssembly.Instance(module, {});
	return {
		run: instance.exports.run,
		mem: instance.exports.mem
	};
}
/**
* Run a static Linux executable inside Forge.
*
*   ELF  ->  lift (x86-64 or AArch64 machine code -> guest IR)  ->  WebAssembly (or the interpreter)
*        ->  run until a system call  ->  the Linux shim answers it  ->  run again
*
* The shim is a capability boundary, not a kernel. It implements what ordinary command-line
* programs need to print and exit (write, writev, read from a provided stdin, brk, anonymous mmap,
* exit) and answers everything else with -ENOSYS, recorded in the report. Files, network, processes
* and signals are not reachable. Bytes the lifter does not know are reported and never executed.
*/
var ENOSYS = -38n;
var EBADF = -9n;
var EINVAL = -22n;
var ENOMEM = -12n;
var ENOTTY = -25n;
var EFAULT = -14n;
var ENOENT = -2n;
var ABI = {
	x86_64: {
		nr: 0,
		args: [
			7,
			6,
			2,
			10,
			8,
			9
		],
		ret: 0,
		sp: 4,
		names: {
			0: "read",
			1: "write",
			2: "open",
			3: "close",
			5: "fstat",
			9: "mmap",
			10: "mprotect",
			11: "munmap",
			12: "brk",
			13: "rt_sigaction",
			14: "rt_sigprocmask",
			16: "ioctl",
			20: "writev",
			21: "access",
			28: "madvise",
			39: "getpid",
			60: "exit",
			63: "uname",
			89: "readlink",
			102: "getuid",
			104: "getgid",
			107: "geteuid",
			108: "getegid",
			158: "arch_prctl",
			186: "gettid",
			201: "time",
			218: "set_tid_address",
			228: "clock_gettime",
			231: "exit_group",
			257: "openat",
			262: "newfstatat",
			267: "readlinkat",
			269: "faccessat",
			273: "set_robust_list",
			302: "prlimit64",
			318: "getrandom",
			334: "rseq"
		}
	},
	aarch64: {
		nr: 8,
		args: [
			0,
			1,
			2,
			3,
			4,
			5
		],
		ret: 0,
		sp: 31,
		names: {
			29: "ioctl",
			48: "faccessat",
			56: "openat",
			57: "close",
			63: "read",
			64: "write",
			66: "writev",
			78: "readlinkat",
			79: "newfstatat",
			80: "fstat",
			93: "exit",
			94: "exit_group",
			96: "set_tid_address",
			99: "set_robust_list",
			113: "clock_gettime",
			134: "rt_sigaction",
			135: "rt_sigprocmask",
			160: "uname",
			172: "getpid",
			174: "getuid",
			175: "geteuid",
			176: "getgid",
			177: "getegid",
			178: "gettid",
			214: "brk",
			215: "munmap",
			222: "mmap",
			226: "mprotect",
			233: "madvise",
			261: "prlimit64",
			278: "getrandom",
			293: "rseq"
		}
	}
};
var enc = new TextEncoder();
var dec = new TextDecoder();
var pageUp = (v) => v + 4095n & -4096n;
var STACK_BYTES = 524288n;
/** Load the ELF, build the stack and CPU state, and lift from the entry point. Runs nothing. */
function prepareLinux(bytes, options = {}) {
	const parsed = readElf(bytes);
	if (!parsed.ok) return {
		ok: false,
		arch: null,
		reason: parsed.reason
	};
	const elf = parsed.elf;
	const memBytes = options.memBytes ?? 16777216;
	const memory = new Uint8Array(memBytes);
	let top = 0n;
	const text = [];
	for (const seg of elf.segments) {
		const end = seg.vaddr + seg.memsz;
		if (seg.vaddr < 4096n || end > BigInt(memBytes) - 1048576n) return {
			ok: false,
			arch: elf.arch,
			reason: `segment at 0x${seg.vaddr.toString(16)} does not fit in ${memBytes >> 20} MiB of guest memory`
		};
		memory.set(bytes.subarray(seg.offset, seg.offset + Number(seg.filesz)), Number(seg.vaddr));
		if (seg.flags & 1) text.push([seg.vaddr, end]);
		if (end > top) top = end;
	}
	if (!text.length) return {
		ok: false,
		arch: elf.arch,
		reason: "no executable segment"
	};
	const abi = ABI[elf.arch];
	const stackTop = BigInt(memBytes) - 4096n;
	const state = new GuestState(memory);
	const argv = options.argv ?? ["program"];
	let sp = stackTop;
	const strings = [];
	for (const arg of argv) {
		const data = enc.encode(`${arg}\0`);
		sp -= BigInt(data.length);
		state.write(sp, data);
		strings.push(sp);
	}
	sp -= 16n;
	const random = sp;
	state.write(random, globalThis.crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(16)));
	sp &= -16n;
	const phdr = elf.phdr;
	const auxv = [
		6n,
		4096n,
		25n,
		random,
		3n,
		phdr.addr,
		4n,
		BigInt(phdr.entsize),
		5n,
		BigInt(phdr.count),
		9n,
		elf.entry,
		23n,
		0n,
		0n,
		0n
	];
	const words = [
		BigInt(argv.length),
		...strings,
		0n,
		0n,
		...auxv
	];
	sp -= BigInt(words.length * 8);
	sp &= -16n;
	const dv = new DataView(memory.buffer);
	words.forEach((w, i) => dv.setBigUint64(Number(sp) + i * 8, w, true));
	state.setReg(abi.sp, sp);
	state.pc = elf.entry;
	state.fuel = BigInt(options.fuel ?? 2e9);
	state.flags = {
		z: 0,
		s: 0,
		c: 0,
		o: 0,
		k: 0
	};
	const program = newProgram(elf.arch, text);
	const image = memory.slice();
	const fetch = (addr) => addr >= 0n && addr < BigInt(memBytes) ? image[Number(addr)] : void 0;
	lift(program, fetch, [elf.entry, ...codePointers(memory, elf.segments, text, elf.arch)]);
	if (elf.arch === "x86_64") lift(program, fetch, jumpTableTargets(program, memory, elf.segments, text));
	return {
		ok: true,
		arch: elf.arch,
		entry: elf.entry,
		memBytes,
		memory,
		program,
		fetch,
		brkBase: pageUp(top),
		mmapTop: stackTop - STACK_BYTES
	};
}
/**
* Likely code addresses stored as data (function pointer tables, init arrays, vtables): every
* aligned 64-bit value in a non-executable segment that lands inside the code. Lifting them up front
* saves re-lifting at run time; a wrong guess only decodes some bytes that never run.
*/
function codePointers(memory, segments, text, arch) {
	const out = /* @__PURE__ */ new Set();
	const dv = new DataView(memory.buffer, memory.byteOffset, memory.byteLength);
	for (const seg of segments) {
		if (seg.flags & 1) continue;
		const start = Number(seg.vaddr + 7n & -8n);
		const end = Number(seg.vaddr + seg.filesz);
		for (let at = start; at + 8 <= end; at += 8) {
			const v = dv.getBigUint64(at, true);
			if (arch === "aarch64" && v % 4n !== 0n) continue;
			if (text.some(([lo, hi]) => v >= lo && v < hi)) out.add(v);
		}
	}
	return [...out].slice(0, 2e5);
}
/**
* x86 switch tables: compilers emit `lea base, [rip + table]` then add a signed 32-bit entry from the
* table to `base` and jump. For every rip-relative address taken into read-only data, read entries
* while they land inside the code.
*/
function jumpTableTargets(program, memory, segments, text) {
	const out = /* @__PURE__ */ new Set();
	const dv = new DataView(memory.buffer, memory.byteOffset, memory.byteLength);
	const inCode = (v) => text.some(([lo, hi]) => v >= lo && v < hi);
	const data = segments.filter((seg) => !(seg.flags & 1));
	for (const insn of program.insns.values()) for (const op of insn.ops) {
		if (op.k !== "lea" || op.ea.base !== null || op.ea.index !== null) continue;
		const table = op.ea.disp;
		if (!data.some((seg) => table >= seg.vaddr && table < seg.vaddr + seg.filesz)) continue;
		for (let i = 0; i < 4096; i += 1) {
			const at = Number(table) + i * 4;
			if (at + 4 > memory.length) break;
			const target = table + BigInt(dv.getInt32(at, true));
			if (!inCode(target)) break;
			out.add(target);
		}
	}
	return [...out];
}
/** Nonzero runs of memory, for sending an initial image somewhere else without 16 MB of zeros. */
function sparseChunks(memory, gap = 64) {
	const out = [];
	let i = 0;
	const n = memory.length;
	while (i < n) {
		while (i < n && memory[i] === 0) i += 1;
		if (i >= n) break;
		const start = i;
		let zeros = 0;
		while (i < n && zeros < gap) {
			zeros = memory[i] === 0 ? zeros + 1 : 0;
			i += 1;
		}
		out.push({
			addr: start,
			bytes: memory.slice(start, i - zeros)
		});
	}
	return out;
}
var ByteSink = class {
	parts = [];
	size = 0;
	push(data) {
		if (this.size > 67108864) return;
		this.parts.push(data);
		this.size += data.length;
	}
	bytes() {
		const out = new Uint8Array(this.size);
		let at = 0;
		for (const p of this.parts) {
			out.set(p, at);
			at += p.length;
		}
		return out;
	}
};
/**
* The Linux system-call shim. The same table is implemented in Rust for the desktop host
* (src-tauri/src/guest.rs); keep the two in step.
*/
var LinuxShim = class {
	arch;
	stdout = new ByteSink();
	stderr = new ByteSink();
	counts = {};
	unsupported = /* @__PURE__ */ new Set();
	exitCode = null;
	stdin;
	stdinAt = 0;
	brkBase;
	brk;
	mmapTop;
	constructor(arch, brkBase, mmapTop, stdin) {
		this.arch = arch;
		this.brkBase = brkBase;
		this.brk = brkBase;
		this.mmapTop = mmapTop;
		this.stdin = typeof stdin === "string" ? enc.encode(stdin) : stdin ?? /* @__PURE__ */ new Uint8Array();
	}
	writeOut(fd, data) {
		if (fd === 1n) this.stdout.push(data);
		else if (fd === 2n) this.stderr.push(data);
		else return EBADF;
		return BigInt(data.length);
	}
	/** Answer the system call the guest is making. Returns "exit" when the program ends. */
	handle(state) {
		const abi = ABI[this.arch];
		const nr = Number(state.reg(abi.nr));
		const [a0, a1, a2, a3] = abi.args.map((r) => state.reg(r));
		const name = abi.names[nr] ?? `#${nr}`;
		this.counts[name] = (this.counts[name] ?? 0) + 1;
		const out = this.call(state, name, a0, a1, a2, a3);
		if (out === "exit") return "exit";
		state.setReg(abi.ret, out);
		return "continue";
	}
	call(state, name, a0, a1, a2, a3) {
		switch (name) {
			case "write": {
				const len = Number(a2 > 2147483647n ? 2147483647n : a2);
				const data = state.read(a1, len);
				return data ? this.writeOut(a0, data.slice()) : EFAULT;
			}
			case "writev": {
				let total = 0n;
				for (let i = 0; i < Number(a2 > 1024n ? 1024n : a2); i += 1) {
					const iov = state.read(a1 + BigInt(i * 16), 16);
					if (!iov) return EFAULT;
					const v = new DataView(iov.buffer, iov.byteOffset, 16);
					const data = state.read(v.getBigUint64(0, true), Number(v.getBigUint64(8, true) & 2147483647n));
					if (!data) return EFAULT;
					const n = this.writeOut(a0, data.slice());
					if (n < 0n) return n;
					total += n;
				}
				return total;
			}
			case "read": {
				if (a0 !== 0n) return EBADF;
				const n = Math.max(0, Math.min(Number(a2 > 2147483647n ? 2147483647n : a2), this.stdin.length - this.stdinAt));
				if (n > 0 && !state.write(a1, this.stdin.subarray(this.stdinAt, this.stdinAt + n))) return EFAULT;
				this.stdinAt += n;
				return BigInt(n);
			}
			case "exit":
			case "exit_group":
				this.exitCode = Number(a0 & 255n);
				return "exit";
			case "brk":
				if (a0 === 0n || a0 < this.brkBase || a0 > this.mmapTop) return this.brk;
				if (a0 > this.brk) state.mem.fill(0, Number(this.brk), Number(a0));
				this.brk = a0;
				return this.brk;
			case "mmap": {
				if ((Number(a3) & 32) === 0) return ENOSYS;
				const size = pageUp(a1);
				const next = this.mmapTop - size & -4096n;
				if (size === 0n || next < pageUp(this.brk)) return ENOMEM;
				this.mmapTop = next;
				state.mem.fill(0, Number(next), Number(next + size));
				return next;
			}
			case "arch_prctl":
				if (a0 === 4098n) {
					state.setReg(36, a1);
					return 0n;
				}
				return EINVAL;
			case "munmap":
			case "mprotect":
			case "madvise":
			case "rt_sigaction":
			case "rt_sigprocmask":
			case "close":
			case "set_robust_list": return 0n;
			case "ioctl": return ENOTTY;
			case "getpid":
			case "gettid":
			case "getuid":
			case "geteuid":
			case "getgid":
			case "getegid":
			case "set_tid_address": return 1000n;
			case "uname": {
				const buf = /* @__PURE__ */ new Uint8Array(390);
				[
					"Linux",
					"forge",
					"6.0.0-forge",
					"#1 Forge",
					this.arch,
					""
				].forEach((s, i) => buf.set(enc.encode(s), i * 65));
				return state.write(a0, buf) ? 0n : EFAULT;
			}
			case "clock_gettime": return state.write(a1, /* @__PURE__ */ new Uint8Array(16)) ? 0n : EFAULT;
			case "getrandom": {
				const n = Math.min(Number(a1 > 256n ? 256n : a1), 256);
				const buf = globalThis.crypto.getRandomValues(new Uint8Array(n));
				return state.write(a0, buf) ? BigInt(n) : EFAULT;
			}
			case "readlinkat":
			case "readlink":
			case "openat":
			case "open":
			case "access":
			case "faccessat":
			case "newfstatat":
			case "fstat": return ENOENT;
			case "prlimit64":
			case "rseq": return ENOSYS;
			default:
				this.unsupported.add(name);
				return ENOSYS;
		}
	}
};
/** The machine reached an address with no translation: lift from there, or say why it must stop. */
function relift(program, fetch, pc, attempts) {
	const gap = program.gaps.get(pc);
	if (gap) return {
		ok: false,
		stop: Stop.gap,
		detail: `stopped at 0x${pc.toString(16)}: ${gap.reason} (bytes ${gap.bytes}). Not executed.`
	};
	if (!inText(program, pc) || attempts > 256) return {
		ok: false,
		stop: Stop.unmapped,
		detail: `jumped to 0x${pc.toString(16)}, outside the program's code`
	};
	const { added } = lift(program, fetch, [pc]);
	if (!added && !program.insns.has(pc)) {
		const g = program.gaps.get(pc);
		return {
			ok: false,
			stop: Stop.gap,
			detail: g ? `stopped at 0x${pc.toString(16)}: ${g.reason} (bytes ${g.bytes}). Not executed.` : `no translation for 0x${pc.toString(16)}`
		};
	}
	return { ok: true };
}
function stopDetail(stop, pc, faultAddr) {
	if (stop === Stop.fault) return `memory fault at 0x${faultAddr.toString(16)} (pc 0x${pc.toString(16)})`;
	if (stop === Stop.smc) return `store into code at 0x${faultAddr.toString(16)}; self-modifying code is not supported`;
	return `${STOP_NAME[stop]} at pc 0x${pc.toString(16)}`;
}
function finishReport(shim, program, engine, stop, detail, instructions, relifts) {
	const finished = shim.exitCode !== null;
	const out = shim.stdout.bytes();
	return {
		ok: finished,
		arch: program.arch,
		engine,
		exitCode: shim.exitCode,
		stdout: dec.decode(out),
		stdoutBytes: out,
		stderr: dec.decode(shim.stderr.bytes()),
		stop: finished ? "exit" : STOP_NAME[stop] ?? "stopped",
		detail: finished ? `exited with code ${shim.exitCode}` : detail || "stopped: too many host round trips",
		gaps: [...program.gaps.values()],
		syscalls: shim.counts,
		unsupportedSyscalls: [...shim.unsupported],
		instructions,
		relifts
	};
}
function runLinux(bytes, options = {}) {
	const engineKind = options.engine ?? "tiered";
	const prepared = prepareLinux(bytes, options);
	if (!prepared.ok) return {
		ok: false,
		arch: prepared.arch,
		engine: engineKind,
		exitCode: null,
		stdout: "",
		stdoutBytes: /* @__PURE__ */ new Uint8Array(),
		stderr: "",
		stop: "not started",
		detail: prepared.reason,
		gaps: [],
		syscalls: {},
		unsupportedSyscalls: [],
		instructions: 0,
		relifts: 0
	};
	const { program, fetch, memBytes } = prepared;
	let memory = prepared.memory;
	let state = new GuestState(memory);
	/**
	* Tiers, like any virtual machine with a JIT: the interpreter starts at once; once a program has run
	* long enough (tierUpAfter instructions) it is lowered to WebAssembly and continues there. When
	* WebAssembly reaches code that was not lifted yet, the new code runs in the interpreter for a slice
	* and the module is rebuilt only after discovery settles, instead of once per new address.
	*/
	let tierAt = engineKind === "tiered" ? BigInt(options.tierUpAfter ?? 3e6) : 0n;
	const SLICE = 1000000n;
	let mode = engineKind === "interpreter" || tierAt > 0n ? "interp" : "wasm";
	let wasm = null;
	let interp = null;
	let interpRan = 0n;
	const buildWasm = () => {
		if (!program.insns.size) return {
			name: "wasm",
			state,
			run: () => Stop.unmapped
		};
		const { run, mem } = instantiate(lowerProgram(program, memBytes));
		const fresh = new Uint8Array(mem.buffer);
		fresh.set(memory);
		memory = fresh;
		state = new GuestState(memory);
		interp = null;
		return {
			name: "wasm",
			state,
			run: () => run()
		};
	};
	const shim = new LinuxShim(prepared.arch, prepared.brkBase, prepared.mmapTop, options.stdin);
	const maxEvents = options.maxEvents ?? 1e6;
	const startFuel = state.fuel;
	let relifts = 0;
	let stop = Stop.running;
	let detail = "";
	for (let events = 0; events < maxEvents; events += 1) {
		if (mode === "wasm") {
			wasm ??= buildWasm();
			stop = wasm.run();
		} else {
			const total = state.fuel;
			const slice = engineKind === "interpreter" || total < SLICE ? total : SLICE;
			state.fuel = slice;
			interp ??= new Interpreter(program, state);
			stop = interp.run();
			const used = slice - state.fuel;
			state.fuel = total - used;
			interpRan += used;
			if (stop === Stop.fuel && state.fuel > 0n) {
				if (engineKind !== "interpreter" && interpRan >= tierAt) mode = "wasm";
				continue;
			}
		}
		if (stop === Stop.syscall) {
			if (shim.handle(state) === "exit") break;
			continue;
		}
		if (stop === Stop.unmapped) {
			const again = relift(program, fetch, state.pc, relifts);
			relifts += 1;
			if (!again.ok) {
				stop = again.stop;
				detail = again.detail;
				break;
			}
			interp = null;
			if (engineKind !== "interpreter") {
				wasm = null;
				mode = "interp";
				interpRan = 0n;
				tierAt = tierAt > SLICE ? tierAt : SLICE;
			}
			continue;
		}
		detail = stopDetail(stop, state.pc, state.faultAddr);
		break;
	}
	return finishReport(shim, program, engineKind, stop, detail, Number(startFuel - state.fuel), relifts);
}
/**
* Page-side entry to the Linux layer. In the desktop app the program runs natively (wasmtime); in a
* browser it runs in a worker (so a long program cannot freeze the window), or inline where workers
* are unavailable.
*/
async function runLinuxProgram(bytes, options = {}, timeoutMs = 3e4) {
	if (globalThis.__TAURI_INTERNALS__) {
		const { runLinuxHosted } = await import("./native-host-DvBLXaW_.mjs");
		return runLinuxHosted(bytes, options);
	}
	if (typeof Worker === "undefined") return runLinux(bytes, options);
	let worker;
	try {
		worker = new Worker(new URL("./linux-worker.ts", import.meta.url), { type: "module" });
	} catch {
		return runLinux(bytes, options);
	}
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			worker.terminate();
			resolve({
				ok: false,
				arch: null,
				engine: options.engine ?? "wasm",
				exitCode: null,
				stdout: "",
				stdoutBytes: /* @__PURE__ */ new Uint8Array(),
				stderr: "",
				stop: "timeout",
				detail: `stopped after ${Math.round(timeoutMs / 1e3)} s`,
				gaps: [],
				syscalls: {},
				unsupportedSyscalls: [],
				instructions: 0,
				relifts: 0
			});
		}, timeoutMs);
		worker.onmessage = (event) => {
			clearTimeout(timer);
			worker.terminate();
			resolve(event.data);
		};
		worker.onerror = () => {
			clearTimeout(timer);
			worker.terminate();
			resolve(runLinux(bytes, options));
		};
		worker.postMessage({
			bytes,
			options
		});
	});
}
//#endregion
export { runLinux as a, lowerProgram as c, relift as i, Stop as l, finishReport as n, sparseChunks as o, prepareLinux as r, runLinuxProgram, stopDetail as s, LinuxShim as t };
