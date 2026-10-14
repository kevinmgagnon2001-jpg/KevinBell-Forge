/**
 * Work item N1's acceptance test: real Linux programs through the desktop host's native runner.
 *
 * The page's own protocol code (runLinuxHosted in src/engine/native-host.ts) drives the real Rust
 * guest runner and real wasmtime (src-tauri/src/lib.rs, native_guest), through the test bridge in
 * src-tauri/examples/guest_bridge.rs. Expected output is what the programs print on real hardware.
 *
 *   npm run test:native     (builds the bridge with cargo, then runs this file)
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import test, { after } from "node:test";
import { runLinuxHosted } from "../src/engine/native-host.ts";
import { parseRecordedTree } from "./fixture-tree.ts";

const root = new URL("../", import.meta.url);
const bridgePath = new URL("src-tauri/target/debug/examples/guest_bridge", root).pathname;
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`fixtures/linux/${name}`, root)));
const text = (name: string) => readFileSync(new URL(`fixtures/linux/${name}`, root), "utf8");

function startBridge() {
  const child = spawn(bridgePath, [], { stdio: ["pipe", "pipe", "inherit"] });
  const waiting: { resolve: (v: unknown) => void; reject: (e: Error) => void }[] = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    const next = waiting.shift();
    if (!next) return;
    const reply = JSON.parse(line) as { ok?: unknown; err?: string };
    if (reply.err !== undefined) next.reject(new Error(reply.err));
    else next.resolve(reply.ok);
  });
  child.on("exit", () => {
    for (const w of waiting.splice(0)) w.reject(new Error("guest bridge exited"));
  });
  const invoke = (cmd: string, body: Record<string, unknown> | Uint8Array = {}, options?: { headers?: Record<string, string> }) =>
    new Promise<unknown>((resolve, reject) => {
      // A raw-bytes body (as Tauri delivers guest_swap) crosses this JSON-lines bridge as hex.
      const args = body instanceof Uint8Array ? { id: Number(options?.headers?.["forge-session"]), raw: Buffer.from(body).toString("hex") } : body;
      waiting.push({ resolve, reject });
      child.stdin.write(JSON.stringify({ cmd, args }) + "\n");
    });
  return { invoke, stop: () => child.stdin.end() };
}

const ready = existsSync(bridgePath);
const bridge = ready ? startBridge() : null;
if (bridge) (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke: bridge.invoke };
after(() => bridge?.stop());

const skip = ready ? false : "guest bridge not built: run `npm run test:native`";

test("hand-written x86-64 and AArch64 programs run natively in wasmtime", { skip }, async () => {
  const expected = text("hello.expected");
  const x86 = await runLinuxHosted(fixture("hello-x86_64.elf"));
  assert.equal(x86.host, "desktop");
  assert.equal(x86.ok, true, x86.detail);
  assert.equal(x86.stdout, expected);
  const arm = await runLinuxHosted(fixture("hello-aarch64.elf"));
  assert.equal(arm.ok, true, arm.detail);
  assert.equal(arm.stdout, expected.replace("x86-64", "AArch64"));
});

test("gcc and clang builds for x86-64 and AArch64 match real hardware through wasmtime", { skip }, async () => {
  const expected = text("workload.expected");
  const code = Number(text("workload.exitcode").trim());
  const builds = ["x86_64", "x86_64-gcc-O0", "x86_64-gcc-Os", "x86_64-gcc-O3", "x86_64-clang-O1", "aarch64", "aarch64-clang-O0", "aarch64-clang-O3"];
  for (const build of builds) {
    const report = await runLinuxHosted(fixture(`workload-${build}.elf`), { stdin: "abc" });
    assert.equal(report.host, "desktop");
    assert.equal(report.ok, true, `${build}: ${report.detail}`);
    assert.equal(report.stdout, expected, build);
    assert.equal(report.exitCode, code, build);
    assert.deepEqual(report.unsupportedSyscalls, [], build);
  }
});

test("static glibc programs (printf, malloc, qsort, TLS, SSE2, floating point) match real hardware through wasmtime", { skip }, async () => {
  const demo = await runLinuxHosted(fixture("libc-demo-x86_64.elf"), { stdin: "abc" });
  assert.equal(demo.ok, true, demo.detail);
  assert.equal(demo.stdout, text("libc-demo.expected"));
  assert.equal(demo.stderr, text("libc-demo.stderr"));
  assert.equal(demo.exitCode, 0);
  const fp = await runLinuxHosted(fixture("libc-float-x86_64.elf"));
  assert.equal(fp.ok, true, fp.detail);
  assert.equal(fp.stdout, text("libc-float.expected"));
});

test("files: raw system calls on both architectures and glibc stdio, through wasmtime, files left behind included", { skip }, async () => {
  const input = fixture("files-in.txt");
  for (const build of ["files-x86_64.elf", "files-aarch64.elf"]) {
    const report = await runLinuxHosted(fixture(build), { files: { "in.txt": input } });
    assert.equal(report.ok, true, `${build}: ${report.detail}`);
    assert.equal(report.stdout, text("files.expected"), build);
    assert.equal(report.exitCode, Number(text("files.exitcode").trim()));
    assert.deepEqual(Object.keys(report.files), ["/in.txt", "/out.txt"]);
    assert.equal(new TextDecoder().decode(report.files["/out.txt"]), text("files.out.txt"));
  }
  const libc = await runLinuxHosted(fixture("libc-files-x86_64.elf"), { files: { "in.txt": input } });
  assert.equal(libc.ok, true, libc.detail);
  assert.equal(libc.stdout, text("libc-files.expected"));
  assert.deepEqual(Object.keys(libc.files), ["/in.txt", "/report.txt"]);
  assert.equal(new TextDecoder().decode(libc.files["/report.txt"]), text("libc-files.report.txt"));
});

test("directories, dup, fcntl and pipes: both architectures and glibc, through wasmtime, tree left behind included", { skip }, async () => {
  const input = fixture("files-in.txt");
  for (const [build, name] of [["dirs-x86_64.elf", "dirs"], ["dirs-aarch64.elf", "dirs"], ["libc-dirs-x86_64.elf", "libc-dirs"]]) {
    const report = await runLinuxHosted(fixture(build), { files: { "in.txt": input } });
    assert.equal(report.ok, true, `${build}: ${report.detail}`);
    assert.equal(report.stdout, text(`${name}.expected`), build);
    assert.equal(report.exitCode, Number(text(`${name}.exitcode`).trim()));
    assert.deepEqual(report.unsupportedSyscalls, [], build);
    const tree = Object.fromEntries(Object.entries(report.files).map(([k, v]) => [k, new TextDecoder().decode(v)]));
    assert.deepEqual(tree, parseRecordedTree(text(`${name}.tree`)), build);
  }
});

test("mapped files, renames, truncation, poll/select and links: both architectures and glibc, through wasmtime, tree left behind included", { skip }, async () => {
  const input = fixture("files-in.txt");
  for (const [build, name] of [["mapio-x86_64.elf", "mapio"], ["mapio-aarch64.elf", "mapio"], ["libc-mapio-x86_64.elf", "libc-mapio"], ["links-x86_64.elf", "links"], ["links-aarch64.elf", "links"], ["libc-links-x86_64.elf", "libc-links"]]) {
    const report = await runLinuxHosted(fixture(build), { files: { "in.txt": input } });
    assert.equal(report.ok, true, `${build}: ${report.detail}`);
    assert.equal(report.stdout, text(`${name}.expected`), build);
    assert.equal(report.exitCode, Number(text(`${name}.exitcode`).trim()));
    assert.deepEqual(report.unsupportedSyscalls, [], build);
    const tree = Object.fromEntries(Object.entries(report.files).map(([k, v]) => [k, new TextDecoder().decode(v)]));
    assert.deepEqual(tree, parseRecordedTree(text(`${name}.tree`)), build);
  }
});

test("SSE2 integer instructions through wasmtime", { skip }, async () => {
  const report = await runLinuxHosted(fixture("sse2-x86_64.elf"), {});
  assert.equal(report.ok, true, report.detail);
  assert.equal(report.stdout, text("sse2.expected"));
});

test("threads: glibc pthreads through wasmtime", { skip }, async () => {
  const report = await runLinuxHosted(fixture("libc-threads-x86_64.elf"), {});
  assert.equal(report.ok, true, report.detail);
  assert.equal(report.stdout, text("libc-threads.expected"));
  assert.deepEqual(report.unsupportedSyscalls, []);
  const spin = await runLinuxHosted(fixture("libc-spin-x86_64.elf"), {});
  assert.equal(spin.ok, true, spin.detail);
  assert.equal(spin.stdout, text("libc-spin.expected"));
});

test("ARM64 glibc programs and the NEON/FP corpus, through wasmtime", { skip }, async () => {
  const input = fixture("files-in.txt");
  for (const name of ["libc-demo", "libc-float", "libc-files", "libc-dirs", "libc-mapio", "libc-links", "libc-threads", "libc-spin", "neon"]) {
    const withTree = name === "libc-files" || name === "libc-dirs" || name === "libc-mapio" || name === "libc-links";
    const report = await runLinuxHosted(fixture(`${name}-aarch64.elf`), { stdin: "abc", files: withTree ? { "in.txt": input } : undefined });
    assert.equal(report.ok, true, `${name}: ${report.detail}`);
    assert.equal(report.stdout, text(`${name}.arm.expected`), name);
    if (withTree) {
      const tree = Object.fromEntries(Object.entries(report.files).map(([k, v]) => [k, new TextDecoder().decode(v)]));
      assert.deepEqual(tree, parseRecordedTree(text(`${name}.arm.tree`)), name);
    }
  }
});

