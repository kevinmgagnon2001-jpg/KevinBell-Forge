/**
 * The ARM64 hardware oracle (work item N6), run on a real ARM64 Linux machine by
 * .github/workflows/arm-oracle.yml after fixtures/linux/build-arm.sh has built and run the programs.
 * For every program it runs Forge's Linux layer on the same binary and compares with what the CPU
 * printed: stdout, exit code, and the files left behind. Mismatches and gaps (bytes Forge does not
 * translate, never executed) are listed, so the next decoder work is driven by real programs.
 *
 *   node --experimental-strip-types scripts/arm-oracle.ts <dir> name...
 *
 * Each name needs <dir>/<name>-aarch64.elf, <name>.arm.expected and <name>.arm.exitcode, plus
 * <name>.arm.tree when the program ran in a tree holding fixtures/linux/files-in.txt as in.txt.
 * Exit code 1 when any program differs.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runLinux } from "../src/engine/guest/linux.ts";
import { parseRecordedTree } from "./fixture-tree.ts";

const [dir, ...names] = process.argv.slice(2);
if (!dir || !names.length) {
  console.error("usage: arm-oracle.ts <dir> name...");
  process.exit(2);
}
const input = readFileSync(new URL("../fixtures/linux/files-in.txt", import.meta.url));
let failed = 0;
for (const name of names) {
  const at = (suffix: string) => join(dir, `${name}${suffix}`);
  const elf = new Uint8Array(readFileSync(at("-aarch64.elf")));
  const expected = readFileSync(at(".arm.expected"), "utf8");
  const code = Number(readFileSync(at(".arm.exitcode"), "utf8").trim());
  const withTree = existsSync(at(".arm.tree"));
  const report = runLinux(elf, { stdin: "abc", files: withTree ? { "in.txt": input } : undefined });
  const problems: string[] = [];
  if (!report.ok) problems.push(`stopped: ${report.detail}`);
  if (report.stdout !== expected) {
    const a = report.stdout.split("\n");
    const b = expected.split("\n");
    const line = a.findIndex((l, i) => l !== b[i]);
    problems.push(`stdout differs at line ${line + 1}: forge ${JSON.stringify(a[line] ?? "")} cpu ${JSON.stringify(b[line] ?? "")}`);
  }
  if (report.ok && report.exitCode !== code) problems.push(`exit code: forge ${report.exitCode}, cpu ${code}`);
  if (withTree) {
    const tree = Object.fromEntries(Object.entries(report.files).map(([k, v]) => [k, new TextDecoder().decode(v)]));
    if (JSON.stringify(tree) !== JSON.stringify(parseRecordedTree(readFileSync(at(".arm.tree"), "utf8")))) problems.push("files left behind differ");
  }
  if (report.unsupportedSyscalls.length) problems.push(`unsupported system calls: ${report.unsupportedSyscalls.join(", ")}`);
  const gaps = report.gaps.slice(0, 12).map((g) => `0x${g.pc.toString(16)} ${g.bytes} ${g.reason}`);
  console.log(`${problems.length ? "DIFFERS" : "MATCHES"}  ${name} (${report.instructions} instructions, ${report.gaps.length} gaps in lifted code)`);
  for (const p of problems) console.log(`  - ${p}`);
  for (const g of gaps) console.log(`  gap ${g}`);
  if (problems.length) failed += 1;
}
console.log(`${names.length - failed} of ${names.length} match the ARM64 CPU`);
process.exit(failed ? 1 : 0);
