import { lookup } from "node:dns/promises";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import { htmlToMarkdown, isBlockedHost, publicUrl } from "./web-clean.ts";

/**
 * Module D loopback. A child process with a stripped environment.
 * It can read and write notes under the sandbox root, or fetch one public page.
 * It cannot take a shell command, and it cannot leave the root.
 */

const FS_WORKER = `
import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const cmd = JSON.parse(Buffer.from(process.argv[1], "base64").toString("utf8"));
const allowed = new Set([".md", ".txt", ".json"]);
const fail = (detail) => {
  process.stdout.write(JSON.stringify({ ok: false, detail }));
};
const safeFile = (rel) => {
  if (typeof rel !== "string") return null;
  const parts = rel.split("/").filter(Boolean);
  if (!parts.length || parts.length > 2) return null;
  if (parts.some((part) => part === "." || part === ".." || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,64}$/.test(part))) return null;
  if (parts.length === 2 && parts[0] !== "inbox") return null;
  if (!allowed.has(path.extname(parts[parts.length - 1]).toLowerCase())) return null;
  const abs = path.resolve(root, ...parts);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(prefix)) return null;
  return abs;
};
const contained = (abs) => {
  const parent = path.dirname(abs);
  fs.mkdirSync(parent, { recursive: true });
  const realRoot = fs.realpathSync(root);
  const realParent = fs.realpathSync(parent);
  const prefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (realParent !== realRoot && !realParent.startsWith(prefix)) return false;
  if (fs.existsSync(abs) && fs.lstatSync(abs).isSymbolicLink()) return false;
  return true;
};
try {
  if (cmd.op === "list") {
    const dir = !cmd.path || cmd.path === "." ? root : cmd.path === "inbox" ? path.join(root, "inbox") : null;
    if (!dir) fail("path stays inside the sandbox");
    else {
      fs.mkdirSync(dir, { recursive: true });
      const names = fs.readdirSync(dir).filter((name) => allowed.has(path.extname(name).toLowerCase())).slice(0, 40);
      const prefix = dir === root ? "" : "inbox/";
      process.stdout.write(JSON.stringify({ ok: true, detail: names.length ? names.map((name) => prefix + name).join("\\n") : "(empty)" }));
    }
  } else if (cmd.op === "read") {
    const abs = safeFile(cmd.path);
    if (!abs || !contained(abs) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) fail("note not found");
    else process.stdout.write(JSON.stringify({ ok: true, detail: fs.readFileSync(abs, "utf8").slice(0, 8000) }));
  } else if (cmd.op === "write") {
    const abs = safeFile(cmd.path);
    const text = typeof cmd.text === "string" ? cmd.text.slice(0, 8000) : "";
    if (!abs || !text.trim()) fail("name a .md, .txt, or .json note and include the text");
    else if (!contained(abs)) fail("path stays inside the sandbox");
    else {
      fs.writeFileSync(abs, text, { encoding: "utf8", flag: "w" });
      process.stdout.write(JSON.stringify({ ok: true, detail: "Wrote " + cmd.path + ". The note is not executed." }));
    }
  } else fail("unknown sandbox op");
} catch (error) {
  fail(error instanceof Error ? error.message : "sandbox failed");
}
`;

const WEB_WORKER = `
const cmd = JSON.parse(Buffer.from(process.argv[1], "base64").toString("utf8"));
const url = new URL(cmd.url);
const response = await fetch(url, {
  redirect: "manual",
  signal: AbortSignal.timeout(7000),
  headers: { "user-agent": "AetherForge/0.1 (educational scene forge)", accept: "text/html, text/plain;q=0.9, */*;q=0.1" },
});
const location = response.headers.get("location") || "";
const type = response.headers.get("content-type") || "";
const buf = await response.arrayBuffer();
const body = new TextDecoder().decode(buf.slice(0, 160000));
process.stdout.write(JSON.stringify({ status: response.status, location, type, body }));
`;

export type ModuleCall = { tool: string; arguments: Record<string, string> };
export type ModuleResult = { ok: boolean; detail: string };

function defaultRoot(): string {
  return path.resolve(process.cwd(), "assets/sandbox");
}

function spawnWorker(code: string, payload: unknown, cwd: string, timeout: number): { ok: boolean; detail: string; json: Record<string, unknown> | null } {
  fs.mkdirSync(cwd, { recursive: true });
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, Buffer.from(JSON.stringify(payload)).toString("base64")], {
    cwd,
    env: { PATH: "/usr/bin:/bin" },
    encoding: "utf8",
    timeout,
    maxBuffer: 400_000,
    shell: false,
  });
  if (child.error) return { ok: false, detail: child.error.message.slice(0, 240), json: null };
  const raw = (child.stdout || "").trim();
  const line = raw.split("\n").find((item) => item.startsWith("{")) ?? raw;
  try {
    const json = JSON.parse(line) as Record<string, unknown>;
    return { ok: child.status === 0, detail: typeof json.detail === "string" ? json.detail : raw.slice(0, 240), json };
  } catch {
    const err = (child.stderr || raw || "loopback failed").replace(/\s+/g, " ").trim().slice(0, 240);
    return { ok: false, detail: err, json: null };
  }
}

function sandbox(op: "list" | "read" | "write", args: Record<string, string>, root: string): ModuleResult {
  const ran = spawnWorker(FS_WORKER, { op, path: args.path ?? ".", text: args.text ?? "" }, root, 2500);
  if (!ran.json) return { ok: false, detail: ran.detail || "sandbox loopback failed" };
  return { ok: ran.json.ok === true, detail: String(ran.json.detail ?? "sandbox loopback failed").slice(0, 4000) };
}

async function hostIsPublic(hostname: string): Promise<boolean> {
  if (isBlockedHost(hostname)) return false;
  if (isIP(hostname)) return !isBlockedHost(hostname);
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.length > 0 && records.every((record) => !isBlockedHost(record.address));
  } catch {
    return false;
  }
}

type Fetched = { status: number; location: string; type: string; body: string };

function fetchOnce(url: string, root: string): Fetched | { error: string } {
  const ran = spawnWorker(WEB_WORKER, { url }, root, 8000);
  const json = ran.json;
  if (!json || typeof json.status !== "number") return { error: ran.detail || "fetch failed" };
  return {
    status: json.status,
    location: typeof json.location === "string" ? json.location : "",
    type: typeof json.type === "string" ? json.type : "",
    body: typeof json.body === "string" ? json.body : "",
  };
}

async function fetchPublic(start: URL, root: string): Promise<{ url: URL; text: string } | { error: string }> {
  let current = start;
  for (let hop = 0; hop < 3; hop += 1) {
    if (!(await hostIsPublic(current.hostname))) return { error: "That host is not a public web address." };
    const page = fetchOnce(current.href, root);
    if ("error" in page) return page;
    if (page.status >= 300 && page.status < 400 && page.location) {
      const next = publicUrl(new URL(page.location, current).href);
      if (!next) return { error: "The page redirected to a blocked address." };
      current = next;
      continue;
    }
    if (page.status < 200 || page.status >= 300) return { error: `The page returned ${page.status}.` };
    if (page.type && !/text\/|application\/xhtml|application\/json|application\/xml/i.test(page.type)) {
      return { error: "The page is not text, so it was not filed." };
    }
    if (page.body.includes("\u0000")) return { error: "The page is not text, so it was not filed." };
    return { url: current, text: page.body };
  }
  return { error: "Too many redirects." };
}

async function duck(query: string): Promise<{ title: string; summary: string; source: string }> {
  const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`, {
    headers: { "user-agent": "AetherForge/0.1 (educational scene forge)", accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return { title: "", summary: "", source: "" };
  const data = (await response.json()) as { AbstractText?: string; Heading?: string; AbstractURL?: string };
  return {
    title: (data.Heading || "").trim(),
    summary: (data.AbstractText || "").replace(/\s+/g, " ").trim(),
    source: data.AbstractURL || "",
  };
}

function notePath(query: string): string {
  let host = query;
  try {
    host = new URL(query).hostname.replace(/^www\./, "");
  } catch {
    host = query;
  }
  const slug = host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "page";
  return `inbox/${slug}.md`;
}

async function ingest(query: string, root: string): Promise<ModuleResult> {
  const direct = publicUrl(query);
  let title = "";
  let source = "";
  let body = "";
  if (direct) {
    if (!(await hostIsPublic(direct.hostname))) return { ok: false, detail: "That host is not a public web address." };
    const page = await fetchPublic(direct, root);
    if ("error" in page) return { ok: false, detail: page.error };
    title = direct.hostname;
    source = page.url.href;
    body = htmlToMarkdown(page.text);
  } else {
    const found = await duck(query).catch(() => ({ title: "", summary: "", source: "" }));
    title = found.title || query;
    source = publicUrl(found.source)?.href ?? "";
    body = found.summary;
    if (source) {
      const page = await fetchPublic(new URL(source), root);
      if (!("error" in page)) {
        const cleaned = htmlToMarkdown(page.text);
        if (cleaned) body = cleaned;
        source = page.url.href;
      }
    }
  }
  if (!body.trim()) return { ok: false, detail: "No public text came back. Nothing was written." };
  const pathName = notePath(source || query);
  const filed = [`# ${title || "Page"}`, source ? `Source: ${source}` : "", "", body].filter((line) => line !== undefined).join("\n");
  const wrote = sandbox("write", { path: pathName, text: filed.slice(0, 8000) }, root);
  if (!wrote.ok) return wrote;
  const preview = body.replace(/\s+/g, " ").trim().slice(0, 700);
  return {
    ok: true,
    detail: `Filed ${pathName}. Fetched in a child process and stripped to markdown. Not executed, and not Chromium.\n${source}\n${preview}`,
  };
}

export async function performModuleD(call: ModuleCall, root = defaultRoot()): Promise<ModuleResult> {
  const tool = call.tool;
  const args = call.arguments ?? {};
  if (tool === "sandbox_list") return sandbox("list", { path: args.path || "." }, root);
  if (tool === "sandbox_read") return sandbox("read", args, root);
  if (tool === "sandbox_write") return sandbox("write", args, root);
  if (tool === "search_web_clean") {
    const query = (args.query || "").trim().slice(0, 300);
    if (!query) return { ok: false, detail: "query required" };
    if (/^https?:/i.test(query) && !publicUrl(query)) return { ok: false, detail: "That host is not a public web address." };
    return ingest(query, root);
  }
  return { ok: false, detail: `tool '${tool}' is not a loopback tool` };
}
