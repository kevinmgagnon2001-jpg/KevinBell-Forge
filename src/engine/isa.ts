import { makeSpawned, seatOffCenter } from "./manifold.ts";
import type { ProposedAction, World } from "./types.ts";

/**
 * A closed compatibility map. Same shape as FEX-Emu (x86 frontend, IR, ARM backend)
 * and the translator DroidDeck runs for Proton. Not their source.
 * Encodings are the single forms in Intel SDM Vol. 2 and the ARM ARM:
 * MOV r64,imm32 / MOVZ, ADD r/imm8 / ADD immediate, SUB r/imm8 / SUB immediate, RET.
 * Bytes the map does not know become an evidence gap. They are not executed.
 * A new opcode enters the local map only when the flagship row passes a sealed fixture.
 */

export type Arch = "x86_64" | "aarch64";
export type Reg = "x0" | "x1" | "x2" | "x3";
export type IrOp =
  | { op: "mov"; rd: Reg; imm: number }
  | { op: "add" | "sub"; rd: Reg; rn: Reg; imm: number }
  | { op: "ret" };

export type Gap = { offset: number; bytes: string; reason: string };
export type Evidence = { arch: Arch | "unknown"; ops: IrOp[]; gaps: Gap[] };

const REGS: Reg[] = ["x0", "x1", "x2", "x3"];
const LOCAL = new Set(["mov", "add", "ret"]);

const FIXTURE = { op: "sub" as const, rd: "x0" as Reg, rn: "x0" as Reg, imm: 4, before: 9, after: 5 };

function u32(word: number): number[] {
  return [word & 0xff, (word >> 8) & 0xff, (word >> 16) & 0xff, (word >> 24) & 0xff];
}

function wordOf(bytes: number[], offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function imm32(value: number): number[] {
  const n = value | 0;
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
}

function reg(index: number): Reg | null {
  return REGS[index] ?? null;
}

export function encode(op: IrOp, arch: Arch): number[] | null {
  if (op.op === "ret") return arch === "x86_64" ? [0xc3] : u32(0xd65f03c0);
  const rd = REGS.indexOf(op.op === "mov" ? op.rd : op.rd);
  if (rd < 0) return null;
  if (op.op === "mov") {
    if (op.imm < 0 || op.imm > 0xffff) return null;
    if (arch === "x86_64") return [0x48, 0xb8 + rd, ...imm32(op.imm)];
    return u32(0xd2800000 | ((op.imm & 0xffff) << 5) | rd);
  }
  if (op.imm < 0 || op.imm > 255) return null;
  const rn = REGS.indexOf(op.rn);
  if (arch === "x86_64") {
    if (rn !== rd) return null;
    const ext = op.op === "add" ? 0xc0 : 0xe8;
    return [0x48, 0x83, ext + rd, op.imm & 0xff];
  }
  if (rn < 0 || op.imm > 0xfff) return null;
  const base = op.op === "add" ? 0x91000000 : 0xd1000000;
  return u32(base | ((op.imm & 0xfff) << 10) | (rn << 5) | rd);
}

function decodeX86(bytes: number[], allowed: Set<string>): Evidence {
  const ops: IrOp[] = [];
  const gaps: Gap[] = [];
  let i = 0;
  while (i < bytes.length) {
    const at = i;
    if (bytes[i] === 0xc3) {
      if (!allowed.has("ret")) gaps.push({ offset: at, bytes: "c3", reason: "ret is not in the local map" });
      else ops.push({ op: "ret" });
      i += 1;
      continue;
    }
    if (bytes[i] === 0x48 && bytes[i + 1] >= 0xb8 && bytes[i + 1] <= 0xbb && i + 6 <= bytes.length) {
      const rd = reg(bytes[i + 1] - 0xb8);
      const imm = wordOf(bytes, i + 2);
      i += 6;
      if (!rd || !allowed.has("mov")) gaps.push({ offset: at, bytes: hex(bytes.slice(at, i)), reason: "mov is not in the local map" });
      else ops.push({ op: "mov", rd, imm });
      continue;
    }
    if (bytes[i] === 0x48 && bytes[i + 1] === 0x83 && i + 4 <= bytes.length) {
      const ext = bytes[i + 2] ?? 0;
      const add = ext >= 0xc0 && ext <= 0xc3;
      const sub = ext >= 0xe8 && ext <= 0xeb;
      if (add || sub) {
        const name = add ? "add" : "sub";
        const rd = reg(ext - (add ? 0xc0 : 0xe8));
        const imm = bytes[i + 3] ?? 0;
        i += 4;
        if (!rd || !allowed.has(name)) gaps.push({ offset: at, bytes: hex(bytes.slice(at, i)), reason: `${name} is not in the local map` });
        else if (rd) ops.push({ op: name, rd, rn: rd, imm });
        continue;
      }
    }
    gaps.push({ offset: at, bytes: hex([bytes[i] ?? 0]), reason: "no x86 lowering" });
    i += 1;
  }
  return { arch: "x86_64", ops, gaps };
}

function decodeArm(bytes: number[], allowed: Set<string>): Evidence {
  const ops: IrOp[] = [];
  const gaps: Gap[] = [];
  if (bytes.length % 4 !== 0) {
    return { arch: "aarch64", ops, gaps: [{ offset: 0, bytes: hex(bytes), reason: "arm instructions are 4 bytes" }] };
  }
  for (let i = 0; i < bytes.length; i += 4) {
    const word = wordOf(bytes, i);
    const raw = hex(bytes.slice(i, i + 4));
    if (word === 0xd65f03c0) {
      if (!allowed.has("ret")) gaps.push({ offset: i, bytes: raw, reason: "ret is not in the local map" });
      else ops.push({ op: "ret" });
      continue;
    }
    const rd = reg(word & 31);
    const rn = reg((word >>> 5) & 31);
    if ((word & 0xffe00000) >>> 0 === 0xd2800000) {
      const imm = (word >>> 5) & 0xffff;
      if (!rd || !allowed.has("mov")) gaps.push({ offset: i, bytes: raw, reason: "mov is not in the local map" });
      else ops.push({ op: "mov", rd, imm });
      continue;
    }
    const add = (word & 0xffc00000) >>> 0 === 0x91000000;
    const sub = (word & 0xffc00000) >>> 0 === 0xd1000000;
    if (add || sub) {
      const name = add ? "add" : "sub";
      const imm = (word >>> 10) & 0xfff;
      if (!rd || !rn || !allowed.has(name)) gaps.push({ offset: i, bytes: raw, reason: `${name} is not in the local map` });
      else ops.push({ op: name, rd, rn, imm });
      continue;
    }
    gaps.push({ offset: i, bytes: raw, reason: "no arm lowering" });
  }
  return { arch: "aarch64", ops, gaps };
}

export function hex(bytes: number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

export function parseHex(text: string): number[] | null {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{2}$/i.test(part)) return null;
    bytes.push(Number.parseInt(part, 16));
  }
  return bytes;
}

function allowed(world: World): Set<string> {
  return new Set([...LOCAL, ...(world.compat ?? [])]);
}

export function readProgram(bytes: number[], world: World, prefer?: Arch): Evidence {
  const set = allowed(world);
  if (prefer === "aarch64") return decodeArm(bytes, set);
  if (prefer === "x86_64") return decodeX86(bytes, set);
  const x86 = decodeX86(bytes, set);
  const arm = decodeArm(bytes, set);
  if (x86.gaps.length === 0) return x86;
  if (arm.gaps.length === 0) return arm;
  return x86.gaps.length <= arm.gaps.length ? x86 : arm;
}

export function step(ops: IrOp[], seed = 0): { ok: true; x0: number } | { ok: false; reason: string } {
  const regs: Record<Reg, number> = { x0: seed, x1: 0, x2: 0, x3: 0 };
  for (const op of ops) {
    if (op.op === "ret") return { ok: true, x0: regs.x0 | 0 };
    if (op.op === "mov") regs[op.rd] = op.imm | 0;
    else regs[op.rd] = (op.op === "add" ? regs[op.rn] + op.imm : regs[op.rn] - op.imm) | 0;
  }
  return { ok: true, x0: regs.x0 | 0 };
}

function same(a: IrOp, b: IrOp): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Flagship row. The local map cannot see it until the fixture passes. */
export function flagshipFixture(): { x86: number[]; arm: number[] } | null {
  const op: IrOp = { op: FIXTURE.op, rd: FIXTURE.rd, rn: FIXTURE.rn, imm: FIXTURE.imm };
  const x86 = encode(op, "x86_64");
  const arm = encode(op, "aarch64");
  if (!x86 || !arm) return null;
  return { x86, arm };
}

export function acceptLowering(world: World, proposal: { op: string; x86: number[]; arm: number[] }): { ok: boolean; world: World; detail: string } {
  if (proposal.op !== FIXTURE.op) return { ok: false, world, detail: "the flagship map has no sealed fixture for that opcode" };
  const full: World = { ...world, compat: [...LOCAL, FIXTURE.op] };
  const fromX86 = readProgram(proposal.x86, full, "x86_64");
  const fromArm = readProgram(proposal.arm, full, "aarch64");
  const expect: IrOp = { op: "sub", rd: FIXTURE.rd, rn: FIXTURE.rn, imm: FIXTURE.imm };
  if (fromX86.gaps.length || fromArm.gaps.length || !fromX86.ops[0] || !fromArm.ops[0] || !same(fromX86.ops[0], expect) || !same(fromArm.ops[0], expect)) {
    return { ok: false, world, detail: "rejected. The bytes do not lower to sub on both architectures." };
  }
  const ran = step([{ op: "mov", rd: "x0", imm: FIXTURE.before }, expect, { op: "ret" }]);
  if (!ran.ok || ran.x0 !== FIXTURE.after) return { ok: false, world, detail: "rejected. The fixture did not yield 5." };
  if ((world.compat ?? []).includes("sub")) return { ok: true, world, detail: "sub is already in the local map. The agent can lower it without the flagship." };
  return {
    ok: true,
    world: { ...world, compat: [...(world.compat ?? []), "sub"] },
    detail: "Flagship lowering for sub passed the fixture (9 - 4 = 5) on both encodings. The local map can use it next time.",
  };
}

export const SAMPLE: IrOp[] = [
  { op: "mov", rd: "x0", imm: 9 },
  { op: "add", rd: "x0", rn: "x0", imm: 2 },
  { op: "ret" },
];

function graph(evidence: Evidence): string {
  const ops = evidence.ops.map((op) => (op.op === "ret" ? "ret" : op.op === "mov" ? `mov ${op.rd}, ${op.imm}` : `${op.op} ${op.rd}, ${op.rn}, ${op.imm}`));
  const gaps = evidence.gaps.map((gap) => `@${gap.offset} ${gap.bytes} ${gap.reason}`);
  return [`arch ${evidence.arch}`, `ir ${ops.join(" | ") || "(none)"}`, `gaps ${gaps.join(" | ") || "none"}`].join("\n");
}

function seat(world: World, note: string): World {
  const existing = Object.values(world.entities).find((entity) => entity.customData.method === "compat");
  if (existing) {
    return {
      ...world,
      entities: { ...world.entities, [existing.id]: { ...existing, customData: { ...existing.customData, note: note.slice(0, 240) } } },
    };
  }
  const spawned = seatOffCenter(
    world,
    makeSpawned(world.nextId, { name: "Compat", asset: "card", x: "1.6", y: "1.05", z: "1.8", color: "indigo" }),
    { x: "1.6", y: "1.05", z: "1.8" },
  );
  spawned.customData = {
    ...spawned.customData,
    method: "compat",
    note: note.slice(0, 240),
    page: "https://github.com/FEX-Emu/FEX",
  };
  return { ...world, entities: { ...world.entities, [spawned.id]: spawned }, nextId: world.nextId + 1 };
}

export function compatProposal(intent: string): ProposedAction | null {
  const lower = intent.toLowerCase();
  const about =
    /\b(x86|aarch64|firmware|compat map|isa map|flagship map)\b/.test(lower) ||
    (/\btranslate\b/.test(lower) && /\b(arm|x86)\b/.test(lower)) ||
    (/\blearn\b/.test(lower) && /\b(opcode|opcodes|mapping|instruction|sub)\b/.test(lower));
  if (!about) return null;
  const message = "compat map";
  if (/\blearn\b/.test(lower)) return { kind: "tool_call", toolName: "compat_map", arguments: { command: "learn" }, message };
  if (/\btranslate\b/.test(lower)) {
    const hexText = lower.match(/\b(?:[0-9a-f]{2}\s+){1,24}[0-9a-f]{2}\b/)?.[0] ?? "";
    const arch = /\b(from arm|aarch64)\b/.test(lower) && !/\bx86\b/.test(lower) ? "aarch64" : "x86_64";
    return { kind: "tool_call", toolName: "compat_map", arguments: { command: "translate", hex: hexText, arch }, message };
  }
  return { kind: "tool_call", toolName: "compat_map", arguments: { command: "gaps" }, message };
}

export function compatCommand(world: World, args: Record<string, string>): { ok: boolean; detail: string; world: World } {
  const command = (args.command ?? "translate").trim().toLowerCase();
  if (command === "learn") {
    const row = flagshipFixture();
    if (!row) return { ok: false, detail: "flagship row missing", world };
    const accepted = acceptLowering(world, { op: "sub", ...row });
    const note = accepted.ok ? "sub learned" : "sub rejected";
    return { ok: accepted.ok, detail: accepted.detail, world: accepted.ok ? seat(accepted.world, note) : world };
  }
  if (command === "gaps") {
    const pending = (world.compat ?? []).includes("sub") ? "none" : "sub";
    return {
      ok: true,
      detail: `Local map: ${[...allowed(world)].join(", ")}.\nWaiting on the flagship: ${pending}.\nUnknown bytes stay a gap and are not run.`,
      world,
    };
  }
  if (command !== "translate") return { ok: false, detail: "command is translate, gaps, or learn", world };
  const prefer: Arch = args.arch === "aarch64" ? "aarch64" : "x86_64";
  const sample = SAMPLE.flatMap((op) => encode(op, prefer) ?? []);
  const parsed = args.hex ? parseHex(args.hex) : null;
  if (args.hex && !parsed) return { ok: false, detail: "hex must be byte pairs", world };
  const source = parsed ?? sample;
  const evidence = readProgram(source, world, prefer);
  const other: Arch = evidence.arch === "aarch64" ? "x86_64" : "aarch64";
  const lowered = evidence.gaps.length ? null : evidence.ops.flatMap((op) => encode(op, other) ?? []);
  const back = lowered ? readProgram(lowered, world, other) : null;
  const ran = evidence.gaps.length || !evidence.ops.length ? null : step(evidence.ops);
  const lines = [
    "FEX-style map. x86 and ARM lower to one IR. Unknown bytes are an evidence gap, not code to run.",
    graph(evidence),
    lowered ? `${other} ${hex(lowered)}` : "no lowering. The local map does not own every opcode yet.",
    back && back.gaps.length === 0 ? "round-trip held" : "round-trip blocked",
    ran?.ok ? `x0 = ${ran.x0}` : "not executed",
  ];
  const note = ran?.ok ? `x0=${ran.x0}` : "gap";
  return { ok: evidence.ops.length > 0, detail: lines.join("\n"), world: seat(world, note) };
}
