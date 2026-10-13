import fs from "node:fs";
import path from "node:path";
import { lookup } from "node:dns/promises";
import { spawnSync } from "node:child_process";
import { isIP } from "node:net";
//#region node_modules/.nitro/vite/services/ssr/assets/loopback.server-BmPN8_rk.js
/** Strip a page down to markdown. Scripts, styles, and tags do not survive. */
var BLOCKED_HOST = /^(localhost|.*\.localhost|.*\.local)$/i;
function ipv4(host) {
	const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (!match) return null;
	const parts = match.slice(1).map((part) => Number(part));
	if (parts.some((part) => part > 255)) return null;
	return parts;
}
/** True for loopback, private, link-local, and metadata addresses. */
function isBlockedHost(host) {
	const name = host.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
	if (!name || BLOCKED_HOST.test(name) || name === "0.0.0.0" || name === "::" || name === "::1") return true;
	if (name.includes(":")) {
		if (name === "::1" || name.startsWith("fe80:") || name.startsWith("fc") || name.startsWith("fd")) return true;
		const mapped = name.match(/:(\d+\.\d+\.\d+\.\d+)$/);
		if (mapped) {
			const v4 = ipv4(mapped[1]);
			if (!v4) return true;
			const [a, b] = v4;
			if (a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31) return true;
		}
		return false;
	}
	if (/^\d+$/.test(name) || /^0x[0-9a-f]+$/i.test(name)) return true;
	const v4 = ipv4(name);
	if (!v4) return false;
	const [a, b] = v4;
	if (a === 0 || a === 10 || a === 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 192 && b === 168) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	return false;
}
/** Public http(s) URL, or null. Rejects credentials, local hosts, and non-http schemes. */
function publicUrl(raw) {
	let url;
	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}
	if (url.username || url.password) return null;
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	if (isBlockedHost(url.hostname)) return null;
	return url;
}
function decode(text) {
	return text.replace(/&nbsp;/gi, " ").replace(/&/gi, "&").replace(/</gi, "<").replace(/>/gi, ">").replace(/"/gi, "\"").replace(/&#39;|'/gi, "'").replace(/&#(\d+);/g, (_, code) => {
		const value = Number(code);
		return value > 31 && value < 127 ? String.fromCharCode(value) : " ";
	});
}
function visible(html) {
	return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
/** Headings, links, and list items kept. Everything else becomes plain text. */
function htmlToMarkdown(html) {
	let text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<svg[\s\S]*?<\/svg>/gi, " ").replace(/<iframe[\s\S]*?<\/iframe>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
	text = text.replace(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, body) => `\n${"#".repeat(Number(level))} ${visible(body)}\n`);
	text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, body) => {
		const label = visible(String(body));
		try {
			const url = new URL(String(href).slice(0, 240));
			if (url.protocol !== "http:" && url.protocol !== "https:" || isBlockedHost(url.hostname)) return label;
			return label ? `[${label}](${url.href})` : url.href;
		} catch {
			return label;
		}
	});
	text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, body) => `\n- ${visible(body)}`);
	text = text.replace(/<\/(p|div|section|article|tr|h[1-6]|blockquote)>/gi, "\n");
	text = text.replace(/<br\s*\/?>/gi, "\n");
	text = text.replace(/<[^>]+>/g, " ");
	text = decode(text).replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
	return text.slice(0, 6e3);
}
/**
* Module D loopback. A child process with a stripped environment.
* It can read and write notes under the sandbox root, or fetch one public page.
* It cannot take a shell command, and it cannot leave the root.
*/
var FS_WORKER = `
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
var WEB_WORKER = `
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
function defaultRoot() {
	return path.resolve(process.cwd(), "assets/sandbox");
}
function spawnWorker(code, payload, cwd, timeout) {
	fs.mkdirSync(cwd, { recursive: true });
	const child = spawnSync(process.execPath, [
		"--input-type=module",
		"-e",
		code,
		Buffer.from(JSON.stringify(payload)).toString("base64")
	], {
		cwd,
		env: { PATH: "/usr/bin:/bin" },
		encoding: "utf8",
		timeout,
		maxBuffer: 4e5,
		shell: false
	});
	if (child.error) return {
		ok: false,
		detail: child.error.message.slice(0, 240),
		json: null
	};
	const raw = (child.stdout || "").trim();
	const line = raw.split("\n").find((item) => item.startsWith("{")) ?? raw;
	try {
		const json = JSON.parse(line);
		return {
			ok: child.status === 0,
			detail: typeof json.detail === "string" ? json.detail : raw.slice(0, 240),
			json
		};
	} catch {
		return {
			ok: false,
			detail: (child.stderr || raw || "loopback failed").replace(/\s+/g, " ").trim().slice(0, 240),
			json: null
		};
	}
}
function sandbox(op, args, root) {
	const ran = spawnWorker(FS_WORKER, {
		op,
		path: args.path ?? ".",
		text: args.text ?? ""
	}, root, 2500);
	if (!ran.json) return {
		ok: false,
		detail: ran.detail || "sandbox loopback failed"
	};
	return {
		ok: ran.json.ok === true,
		detail: String(ran.json.detail ?? "sandbox loopback failed").slice(0, 4e3)
	};
}
async function hostIsPublic(hostname) {
	if (isBlockedHost(hostname)) return false;
	if (isIP(hostname)) return !isBlockedHost(hostname);
	try {
		const records = await lookup(hostname, {
			all: true,
			verbatim: true
		});
		return records.length > 0 && records.every((record) => !isBlockedHost(record.address));
	} catch {
		return false;
	}
}
function fetchOnce(url, root) {
	const ran = spawnWorker(WEB_WORKER, { url }, root, 8e3);
	const json = ran.json;
	if (!json || typeof json.status !== "number") return { error: ran.detail || "fetch failed" };
	return {
		status: json.status,
		location: typeof json.location === "string" ? json.location : "",
		type: typeof json.type === "string" ? json.type : "",
		body: typeof json.body === "string" ? json.body : ""
	};
}
async function fetchPublic(start, root) {
	let current = start;
	for (let hop = 0; hop < 3; hop += 1) {
		if (!await hostIsPublic(current.hostname)) return { error: "That host is not a public web address." };
		const page = fetchOnce(current.href, root);
		if ("error" in page) return page;
		if (page.status >= 300 && page.status < 400 && page.location) {
			const next = publicUrl(new URL(page.location, current).href);
			if (!next) return { error: "The page redirected to a blocked address." };
			current = next;
			continue;
		}
		if (page.status < 200 || page.status >= 300) return { error: `The page returned ${page.status}.` };
		if (page.type && !/text\/|application\/xhtml|application\/json|application\/xml/i.test(page.type)) return { error: "The page is not text, so it was not filed." };
		if (page.body.includes("\0")) return { error: "The page is not text, so it was not filed." };
		return {
			url: current,
			text: page.body
		};
	}
	return { error: "Too many redirects." };
}
async function duck(query) {
	const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`, {
		headers: {
			"user-agent": "AetherForge/0.1 (educational scene forge)",
			accept: "application/json"
		},
		signal: AbortSignal.timeout(8e3)
	});
	if (!response.ok) return {
		title: "",
		summary: "",
		source: ""
	};
	const data = await response.json();
	return {
		title: (data.Heading || "").trim(),
		summary: (data.AbstractText || "").replace(/\s+/g, " ").trim(),
		source: data.AbstractURL || ""
	};
}
function notePath(query) {
	let host = query;
	try {
		host = new URL(query).hostname.replace(/^www\./, "");
	} catch {
		host = query;
	}
	return `inbox/${host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "page"}.md`;
}
async function ingest(query, root) {
	const direct = publicUrl(query);
	let title = "";
	let source = "";
	let body = "";
	if (direct) {
		if (!await hostIsPublic(direct.hostname)) return {
			ok: false,
			detail: "That host is not a public web address."
		};
		const page = await fetchPublic(direct, root);
		if ("error" in page) return {
			ok: false,
			detail: page.error
		};
		title = direct.hostname;
		source = page.url.href;
		body = htmlToMarkdown(page.text);
	} else {
		const found = await duck(query).catch(() => ({
			title: "",
			summary: "",
			source: ""
		}));
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
	if (!body.trim()) return {
		ok: false,
		detail: "No public text came back. Nothing was written."
	};
	const pathName = notePath(source || query);
	const wrote = sandbox("write", {
		path: pathName,
		text: [
			`# ${title || "Page"}`,
			source ? `Source: ${source}` : "",
			"",
			body
		].filter((line) => line !== void 0).join("\n").slice(0, 8e3)
	}, root);
	if (!wrote.ok) return wrote;
	const preview = body.replace(/\s+/g, " ").trim().slice(0, 700);
	return {
		ok: true,
		detail: `Filed ${pathName}. Fetched in a child process and stripped to markdown. Not executed, and not Chromium.\n${source}\n${preview}`
	};
}
async function performModuleD(call, root = defaultRoot()) {
	const tool = call.tool;
	const args = call.arguments ?? {};
	if (tool === "sandbox_list") return sandbox("list", { path: args.path || "." }, root);
	if (tool === "sandbox_read") return sandbox("read", args, root);
	if (tool === "sandbox_write") return sandbox("write", args, root);
	if (tool === "search_web_clean") {
		const query = (args.query || "").trim().slice(0, 300);
		if (!query) return {
			ok: false,
			detail: "query required"
		};
		if (/^https?:/i.test(query) && !publicUrl(query)) return {
			ok: false,
			detail: "That host is not a public web address."
		};
		return ingest(query, root);
	}
	return {
		ok: false,
		detail: `tool '${tool}' is not a loopback tool`
	};
}
//#endregion
export { performModuleD };
