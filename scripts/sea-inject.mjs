// Builds a single-file `forge` executable for Linux without any npm package: copies the node binary,
// adds the Single Executable Application blob as an ELF note (what postject does), and flips the SEA fuse.
//
//   node scripts/build-cli.mjs
//   node scripts/sea-inject.mjs            -> dist/forge-linux-<arch> (runs without Node installed)
//
// macOS and Windows binaries: use scripts/make-sea.sh on those systems (it uses npx postject).
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const out = `dist/forge-linux-${process.arch}`;
writeFileSync("dist/sea-config.json", JSON.stringify({ main: "dist/forge.cjs", output: "dist/sea-prep.blob", disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ["--experimental-sea-config", "dist/sea-config.json"], { stdio: "inherit" });
const blob = readFileSync("dist/sea-prep.blob");
// Start from a stripped copy of this node (debug symbols are not needed to run).
copyFileSync(process.execPath, "dist/node-base");
try {
  execFileSync("strip", ["dist/node-base"]);
} catch {
  console.log("strip is not available; using the node binary as is");
}
const bin = readFileSync("dist/node-base");
rmSync("dist/node-base");

if (bin.readUInt32BE(0) !== 0x7f454c46 || bin[4] !== 2 || bin[5] !== 1) throw new Error("expected a 64-bit little-endian ELF node binary");
const phoff = Number(bin.readBigUInt64LE(32));
const phentsize = bin.readUInt16LE(54);
const phnum = bin.readUInt16LE(56);
const PT_LOAD = 1, PT_NOTE = 4, PT_PHDR = 6;
const phdrs = [];
for (let i = 0; i < phnum; i += 1) phdrs.push(Buffer.from(bin.subarray(phoff + i * phentsize, phoff + (i + 1) * phentsize)));
const type = (p) => p.readUInt32LE(0);
const up = (v, a) => (v + a - 1n) / a * a;
let maxEnd = 0n;
for (const p of phdrs) if (type(p) === PT_LOAD) {
  const end = p.readBigUInt64LE(16) + p.readBigUInt64LE(40);
  if (end > maxEnd) maxEnd = end;
}

// new region at the end of the file: [program headers][note: NODE_SEA_BLOB]
const count = phnum + 2;
const tableSize = count * phentsize;
const fileOff = up(BigInt(bin.length), 0x1000n);
const vaddr = up(maxEnd, 0x1000n) + 0x1000n;
const noteOff = up(BigInt(tableSize), 8n);
const name = Buffer.alloc(16); // "NODE_SEA_BLOB" padded to 16: the same offset whether a reader rounds the name size or not
name.write("NODE_SEA_BLOB");
const descPad = (4 - (blob.length % 4)) % 4;
const nhdr = Buffer.alloc(12);
nhdr.writeUInt32LE(16, 0);
nhdr.writeUInt32LE(blob.length, 4);
nhdr.writeUInt32LE(0, 8);
const note = Buffer.concat([nhdr, name, blob, Buffer.alloc(descPad)]);
const regionSize = noteOff + BigInt(note.length);

const ph = (t, flags, off, va, size, align) => {
  const b = Buffer.alloc(phentsize);
  b.writeUInt32LE(t, 0); b.writeUInt32LE(flags, 4);
  b.writeBigUInt64LE(off, 8); b.writeBigUInt64LE(va, 16); b.writeBigUInt64LE(va, 24);
  b.writeBigUInt64LE(size, 32); b.writeBigUInt64LE(size, 40); b.writeBigUInt64LE(align, 48);
  return b;
};
const table = [];
const lastLoad = phdrs.map(type).lastIndexOf(PT_LOAD);
phdrs.forEach((p, i) => {
  if (type(p) === PT_PHDR) table.push(ph(PT_PHDR, 4, fileOff, vaddr, BigInt(tableSize), 8n));
  else table.push(p);
  if (i === lastLoad) table.push(ph(PT_LOAD, 4, fileOff, vaddr, regionSize, 0x1000n)); // loads stay in address order
});
table.push(ph(PT_NOTE, 4, fileOff + noteOff, vaddr + noteOff, BigInt(note.length), 4n));

const head = Buffer.from(bin);
head.writeBigUInt64LE(fileOff, 32); // e_phoff
head.writeUInt16LE(count, 56); // e_phnum
const fuseAt = head.indexOf(`${FUSE}:0`);
if (fuseAt < 0) throw new Error("this node binary has no SEA fuse");
head.write(`${FUSE}:1`, fuseAt);
const region = Buffer.concat([Buffer.concat(table), Buffer.alloc(Number(noteOff) - tableSize), note]);
writeFileSync(out, Buffer.concat([head, Buffer.alloc(Number(fileOff) - head.length), region]));
chmodSync(out, 0o755);
rmSync("dist/sea-prep.blob");
rmSync("dist/sea-config.json");
console.log(`built ${out} (${(Number(fileOff + regionSize) / 1e6).toFixed(1)} MB)`);
