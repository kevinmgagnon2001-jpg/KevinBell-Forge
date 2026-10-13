import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { performModuleD } from "./loopback.server.ts";
import { bootWorld } from "./manifold.ts";
import { moduleDProposal } from "./module-d.ts";
import { settleIntent } from "./turn.ts";
import type { BondedModel } from "./types.ts";
import { alignToJob, jobOf, verifyJob } from "./vm.ts";
import { htmlToMarkdown, publicUrl } from "./web-clean.ts";

const model: BondedModel = { name: "demo-bonded", path: "models/test.gguf", loaded: true, validated: false };

test("page text drops scripts and keeps the heading", () => {
  const markdown = htmlToMarkdown(
    "<html><script>alert(1)</script><style>body{}</style><h1>Nanite</h1><p>Clusters. <a href=\"http://127.0.0.1/secret\">local</a> <a href=\"https://example.com/doc\">doc</a></p></html>",
  );
  assert.equal(markdown.includes("alert"), false);
  assert.equal(markdown.includes("body{}"), false);
  assert.match(markdown, /# Nanite/);
  assert.match(markdown, /Clusters/);
  assert.equal(markdown.includes("127.0.0.1"), false);
  assert.match(markdown, /https:\/\/example.com\/doc/);
});

test("local and credentialed urls are not public", () => {
  for (const raw of [
    "http://127.0.0.1/latest",
    "http://localhost/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://10.1.1.1/",
    "http://192.168.0.5/",
    "http://[::1]/",
    "http://user:pass@example.com/",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ]) {
    assert.equal(publicUrl(raw), null, raw);
  }
  assert.equal(publicUrl("https://example.com/nanite")?.hostname, "example.com");
});

test("sandbox words become loopback tools and a lookup stays a lookup", () => {
  const listed = moduleDProposal("list the sandbox");
  assert.equal(listed?.toolName, "sandbox_list");
  const wrote = moduleDProposal("save a sandbox note named lod.md: coarse at a distance");
  assert.equal(wrote?.toolName, "sandbox_write");
  assert.equal(wrote?.arguments.path, "lod.md");
  assert.match(wrote?.arguments.text ?? "", /coarse at a distance/);
  const read = moduleDProposal("read sandbox inbox/lod.md");
  assert.equal(read?.toolName, "sandbox_read");
  assert.equal(read?.arguments.path, "inbox/lod.md");
  const page = moduleDProposal("fetch https://example.com/nanite");
  assert.equal(page?.toolName, "search_web_clean");
  assert.equal(page?.arguments.query, "https://example.com/nanite");
  assert.equal(moduleDProposal("look up a marble texture"), null);
  assert.equal(moduleDProposal("show nanite"), null);
  const world = bootWorld();
  assert.equal(jobOf("list the sandbox", world), "field");
  assert.equal(alignToJob(world, "save a sandbox note: hello", { kind: "message", arguments: {}, message: "no" }).toolName, "sandbox_write");
  assert.equal(verifyJob("field", world, world, "save a sandbox note: hello", "sandbox_write").ok, true);
});

test("a sandbox note is filed by the child process and does not spawn or escape", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aether-sandbox-"));
  const outside = path.join(path.dirname(root), "aether-escape-test.txt");
  const world = bootWorld();
  const before = Object.keys(world.entities).length;
  let askedModel = false;
  const settled = await settleIntent({
    world,
    intent: "save a sandbox note: the gem coarsens when you step back",
    label: "Gemma",
    model,
    scene: "1 ArchitectAvatar you",
    proposeTurn: async () => {
      askedModel = true;
      return { text: "spawn", toolCalls: [] };
    },
    critiqueTurn: null,
    research: async () => {
      throw new Error("should not research");
    },
    moduleD: (call) => performModuleD(call, root),
  });
  assert.equal(askedModel, false);
  assert.equal(settled.trace.ok, true, settled.trace.result);
  assert.equal(Object.keys(settled.trace.world.entities).length, before);
  assert.match(fs.readFileSync(path.join(root, "note.md"), "utf8"), /gem coarsens/);
  const escaped = await performModuleD(
    { tool: "sandbox_write", arguments: { path: "../aether-escape-test.txt", text: "nope" } },
    root,
  );
  assert.equal(escaped.ok, false);
  assert.equal(fs.existsSync(outside), false);
  const script = await performModuleD({ tool: "sandbox_write", arguments: { path: "note.ts", text: "console.log(1)" } }, root);
  assert.equal(script.ok, false);
  assert.equal(fs.existsSync(path.join(root, "note.ts")), false);
  const read = await performModuleD({ tool: "sandbox_read", arguments: { path: "note.md" } }, root);
  assert.equal(read.ok, true);
  assert.match(read.detail, /gem coarsens/);
  const list = await performModuleD({ tool: "sandbox_list", arguments: { path: "." } }, root);
  assert.match(list.detail, /note\.md/);
  const local = await performModuleD({ tool: "search_web_clean", arguments: { query: "http://127.0.0.1/" } }, root);
  assert.equal(local.ok, false);
  assert.match(local.detail, /not a public/);
  fs.rmSync(root, { recursive: true, force: true });
});
