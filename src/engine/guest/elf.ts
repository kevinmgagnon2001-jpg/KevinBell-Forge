/**
 * ELF64 reader for static Linux executables (x86-64 and AArch64). Reads headers and loadable
 * segments only. Dynamic linking (an interpreter segment) is reported, not attempted.
 */
import type { GuestArch } from "./ir.ts";

export type Segment = { vaddr: bigint; memsz: bigint; filesz: bigint; offset: number; flags: number };
export type ElfImage = { arch: GuestArch; entry: bigint; segments: Segment[]; type: "exec" | "dyn"; phdr: { addr: bigint; entsize: number; count: number } };
export type ElfResult = { ok: true; elf: ElfImage } | { ok: false; reason: string };

export const PF_X = 1;
export const PF_W = 2;
export const PF_R = 4;

export function readElf(bytes: Uint8Array): ElfResult {
  if (bytes.length < 64 || bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) return { ok: false, reason: "not an ELF file" };
  if (bytes[4] !== 2) return { ok: false, reason: "32-bit ELF is not supported (64-bit only)" };
  if (bytes[5] !== 1) return { ok: false, reason: "big-endian ELF is not supported" };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = dv.getUint16(16, true);
  const machine = dv.getUint16(18, true);
  const arch: GuestArch | null = machine === 62 ? "x86_64" : machine === 183 ? "aarch64" : null;
  if (!arch) return { ok: false, reason: `machine ${machine} is not x86-64 or AArch64` };
  if (type !== 2 && type !== 3) return { ok: false, reason: "not an executable" };
  const entry = dv.getBigUint64(24, true);
  const phoff = Number(dv.getBigUint64(32, true));
  const phentsize = dv.getUint16(54, true);
  const phnum = dv.getUint16(56, true);
  if (phoff + phnum * phentsize > bytes.length || phentsize < 56) return { ok: false, reason: "program headers are truncated" };
  const segments: Segment[] = [];
  for (let i = 0; i < phnum; i += 1) {
    const at = phoff + i * phentsize;
    const ptype = dv.getUint32(at, true);
    if (ptype === 3) return { ok: false, reason: "dynamically linked (needs an interpreter); build it static" };
    if (ptype !== 1) continue;
    const flags = dv.getUint32(at + 4, true);
    const offset = Number(dv.getBigUint64(at + 8, true));
    const vaddr = dv.getBigUint64(at + 16, true);
    const filesz = dv.getBigUint64(at + 32, true);
    const memsz = dv.getBigUint64(at + 40, true);
    if (offset + Number(filesz) > bytes.length) return { ok: false, reason: "segment runs past the end of the file" };
    if (filesz > memsz) return { ok: false, reason: "segment file size exceeds memory size" };
    segments.push({ vaddr, memsz, filesz, offset, flags });
  }
  if (!segments.length) return { ok: false, reason: "no loadable segments" };
  if (type === 3) return { ok: false, reason: "position-independent executable; build with -static -no-pie" };
  // Where the program headers sit in memory (libc reads them through AT_PHDR to find its TLS template).
  const holder = segments.find((s) => BigInt(phoff) >= BigInt(s.offset) && BigInt(phoff) < BigInt(s.offset) + s.filesz);
  const phdrAddr = holder ? holder.vaddr + BigInt(phoff - holder.offset) : 0n;
  return { ok: true, elf: { arch, entry, segments, type: "exec", phdr: { addr: phdrAddr, entsize: phentsize, count: phnum } } };
}
