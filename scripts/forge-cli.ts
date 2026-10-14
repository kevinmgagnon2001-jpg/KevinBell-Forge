/**
 * forge: the engine from the command line. Bundled into one file (dist/forge.mjs) by
 * scripts/build-cli.mjs, with launchers in bin/ (forge for Linux/macOS, forge.cmd for Windows).
 *
 *   forge run <program> [--interp] [--fuel N] [--show-ir]   run a static Linux x86-64 or ARM64 program
 *   forge info <file>                                       identify any file and say how Forge would use it
 *   forge gate <script.ts> [--grant fetch,storage]          check a script with the safe-compile gate
 *   forge script <script.ts>                                gate it, then run it in an isolated worker
 *   forge island --name N --slug S [--port 7420]            host an island on this machine
 *   forge compute --id ID [--port 7600] [--memory-mb 512]   offer this machine for pooled inference
 *   forge link [--name N] [--port 7430]                     be the home your devices pair and sync with
 *   forge version
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const VERSION = "0.6.0";
const [command, ...rest] = process.argv.slice(2);
const flag = (name: string, fallback = "") => {
  const at = rest.indexOf(name);
  return at >= 0 && rest[at + 1] ? rest[at + 1] : fallback;
};
const VALUE_FLAGS = new Set(["--fuel", "--grant", "--name", "--slug", "--port", "--host", "--allow", "--dir", "--world", "--tick", "--id", "--memory-mb", "--speed"]);
const positional = () => rest.find((a, i) => !a.startsWith("--") && !(i > 0 && VALUE_FLAGS.has(rest[i - 1])));

async function main(): Promise<number> {
  switch (command) {
    case "run": {
      const file = positional();
      if (!file) return usage();
      const { runLinux } = await import("../src/engine/guest/linux.ts");
      let stdin = new Uint8Array();
      if (!process.stdin.isTTY) {
        try {
          stdin = new Uint8Array(readFileSync(0));
        } catch {
          /* no stdin */
        }
      }
      if (rest.includes("--show-ir")) await showIr(file);
      const started = performance.now();
      const report = runLinux(new Uint8Array(readFileSync(file)), {
        engine: rest.includes("--interp") ? "interpreter" : "tiered",
        fuel: flag("--fuel") ? Number(flag("--fuel")) : undefined,
        stdin,
        argv: [basename(file), ...(rest.includes("--") ? rest.slice(rest.indexOf("--") + 1) : [])],
      });
      process.stdout.write(report.stdoutBytes);
      process.stderr.write(report.stderr);
      if (!rest.includes("--quiet")) {
        console.error(
          `\n[forge] ${report.arch ?? "?"} (${report.engine}): ${report.detail} in ${(performance.now() - started).toFixed(0)} ms` +
            (report.unsupportedSyscalls.length ? `; unsupported system calls: ${report.unsupportedSyscalls.join(", ")}` : ""),
        );
      }
      return report.exitCode ?? 125;
    }
    case "info": {
      const file = positional();
      if (!file) return usage();
      const { ingest } = await import("../src/engine/ingest.ts");
      const r = ingest(new Uint8Array(readFileSync(file)), basename(file));
      console.log(`${r.name}: ${r.kind}, ${r.bytes} bytes -> ${r.route}${r.ready ? "" : " (not runnable yet)"}\n${r.detail}`);
      if (r.wasm) console.log(`exports: ${r.wasm.exports.join(", ") || "none"}\nimports: ${r.wasm.imports.join(", ") || "none"}`);
      return 0;
    }
    case "gate": {
      const file = positional();
      if (!file) return usage();
      const { gateScript } = await import("../src/engine/script-gate.ts");
      const grants = flag("--grant").split(",").filter(Boolean) as never[];
      const r = gateScript(readFileSync(file, "utf8"), basename(file), { grants, typecheck: rest.includes("--typecheck") });
      if (r.ok) {
        console.log(`${file}: passed${r.uses.length ? ` (uses ${r.uses.join(", ")})` : ""}`);
        if (rest.includes("--emit")) console.log(r.js);
        return 0;
      }
      for (const i of r.issues) console.log(`${file}:${i.line}:${i.col}: ${i.message}`);
      return 1;
    }
    case "script": {
      const file = positional();
      if (!file) return usage();
      const { runGatedScript } = await import("../src/engine/script-runtime.ts");
      const run = await runGatedScript(readFileSync(file, "utf8"), basename(file), {
        log: (line: unknown) => void console.log(`[script] ${String(line)}`),
        time: () => Date.now(),
      });
      if (run.ok) {
        console.log(JSON.stringify(run.value, null, 2));
        return 0;
      }
      if (run.stage === "gate") for (const i of run.issues) console.log(`${file}:${i.line}:${i.col}: ${i.message}`);
      else console.error(`stopped: ${run.error}`);
      return 1;
    }
    case "island": {
      const { parseArgs, startIsland } = await import("./island-node.ts");
      const { address, identity } = await startIsland(parseArgs(rest));
      console.log(`island online  ${address}\nisland id      ${identity.id}\nstop this process and the island leaves the network`);
      return await new Promise<number>(() => {});
    }
    case "link": {
      const { parseLinkArgs, runLinkHome } = await import("./link-node.ts");
      await runLinkHome(parseLinkArgs(rest));
      return await new Promise<number>(() => {});
    }
    case "compute": {
      const { startComputeNode } = await import("./compute-node.ts");
      const { base } = await startComputeNode({
        id: flag("--id", "device"),
        port: Number(flag("--port", "7600")),
        memoryBytes: Number(flag("--memory-mb", "512")) * 1024 * 1024,
        speed: Number(flag("--speed", "1")),
      });
      console.log(`compute device online at ${base}`);
      return await new Promise<number>(() => {});
    }
    case "version":
    case "--version":
      console.log(`forge ${VERSION} (node ${process.versions.node}, ${process.platform}/${process.arch})`);
      return 0;
    default:
      return usage();
  }
}

async function showIr(file: string) {
  const { readElf } = await import("../src/engine/guest/elf.ts");
  const { describeOp } = await import("../src/engine/guest/ir.ts");
  const { lift, newProgram } = await import("../src/engine/guest/lift.ts");
  const bytes = new Uint8Array(readFileSync(file));
  const elf = readElf(bytes);
  if (!elf.ok) return;
  const mem = new Uint8Array(64 * 1024 * 1024);
  for (const s of elf.elf.segments) mem.set(bytes.subarray(s.offset, s.offset + Number(s.filesz)), Number(s.vaddr));
  const program = newProgram(elf.elf.arch, elf.elf.segments.filter((s) => s.flags & 1).map((s) => [s.vaddr, s.vaddr + s.memsz]));
  lift(program, (a) => mem[Number(a)], [elf.elf.entry]);
  for (const insn of [...program.insns.values()].sort((a, b) => (a.pc < b.pc ? -1 : 1)).slice(0, 80)) {
    console.error(`0x${insn.pc.toString(16)}  ${insn.text.padEnd(10)} ${insn.ops.map(describeOp).join(" ; ")}`);
  }
}

function usage(): number {
  console.error(`forge ${VERSION}
  forge run <program> [--interp] [--fuel N] [--show-ir] [-- args...]   run a static Linux x86-64 or ARM64 program
  forge info <file>                                                    identify a file and how Forge would use it
  forge gate <script.ts> [--grant fetch,storage] [--typecheck] [--emit] check a script
  forge script <script.ts>                                             gate it, then run it in an isolated worker
  forge island --name N --slug S [--port 7420] [--allow render,input]  host an island here
  forge compute --id ID [--port 7600] [--memory-mb 512] [--speed 1]    join pooled inference
  forge link [--name N] [--port 7430] [--dir .forge]                   be the home your devices pair and sync with
  forge version`);
  return 2;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
