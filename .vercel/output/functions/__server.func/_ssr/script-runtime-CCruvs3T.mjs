import { i as __toESM } from "../_runtime.mjs";
import { t as require_typescript } from "../_libs/typescript.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/script-runtime-CCruvs3T.js
var import_typescript = /* @__PURE__ */ __toESM(require_typescript());
/**
* Safe-compile gate for scripts (JS, TS, JSX, TSX) before they are injected into a world.
*
*   parse -> (optional) type-check -> deny what the island was not granted -> transpile
*
* Network, storage and compute are capabilities (see island.ts). A script that touches one it was
* not granted is rejected with the line and the reason. Escape hatches that would let a script reach
* the host's globals indirectly (eval, the Function constructor, globalThis, prototype walking,
* dynamic import, Reflect) are always refused. Computed property keys are wrapped in a runtime guard
* so a key built from strings still cannot reach `constructor` or `__proto__`.
*
* This is the static layer. Run the result in a separate realm (a worker without network access)
* as the second layer: static checks of JavaScript can be argued with; a missing socket cannot.
*/
/** Host globals that need a capability. */
var NEEDS = {
	fetch: "fetch",
	XMLHttpRequest: "fetch",
	WebSocket: "fetch",
	EventSource: "fetch",
	WebTransport: "fetch",
	RTCPeerConnection: "fetch",
	navigator: "fetch",
	localStorage: "storage",
	sessionStorage: "storage",
	indexedDB: "storage",
	caches: "storage",
	WebAssembly: "compute",
	AudioContext: "audio",
	OffscreenCanvas: "render"
};
/** Never reachable, whatever was granted. */
var ALWAYS = {
	eval: "eval runs arbitrary code",
	Function: "the Function constructor runs arbitrary code",
	globalThis: "the global object reaches everything",
	window: "the global object reaches everything",
	self: "the global object reaches everything",
	top: "the global object reaches everything",
	parent: "the global object reaches everything",
	frames: "the global object reaches everything",
	document: "the page document belongs to the host",
	require: "module loading is not available to scripts",
	process: "the host process is not available to scripts",
	Deno: "the host runtime is not available to scripts",
	Bun: "the host runtime is not available to scripts",
	importScripts: "loading remote code is not allowed",
	Worker: "spawning workers is not allowed",
	SharedWorker: "spawning workers is not allowed",
	Reflect: "Reflect can read any property by name"
};
var BAD_PROPS = /* @__PURE__ */ new Set([
	"constructor",
	"__proto__",
	"getPrototypeOf",
	"setPrototypeOf",
	"getOwnPropertyDescriptor",
	"getOwnPropertyDescriptors",
	"defineProperty",
	"defineProperties",
	"__defineGetter__",
	"__defineSetter__",
	"__lookupGetter__",
	"__lookupSetter__",
	"caller",
	"callee"
]);
var KEY_GUARD = "__forge_key";
/** Runtime half of the guard, prepended to every gated script. */
var RUNTIME_PRELUDE = `const ${KEY_GUARD} = (k) => { const s = typeof k === "symbol" ? "" : String(k); if (${JSON.stringify([...BAD_PROPS])}.includes(s)) throw new TypeError("forge: property " + s + " is not reachable from scripts"); return k; };\n`;
function kindOf(fileName) {
	if (fileName.endsWith(".tsx")) return import_typescript.default.ScriptKind.TSX;
	if (fileName.endsWith(".jsx")) return import_typescript.default.ScriptKind.JSX;
	if (fileName.endsWith(".js") || fileName.endsWith(".mjs")) return import_typescript.default.ScriptKind.JS;
	return import_typescript.default.ScriptKind.TS;
}
function position(file, at) {
	const { line, character } = file.getLineAndCharacterOfPosition(at);
	return {
		line: line + 1,
		col: character + 1
	};
}
function isNameOnly(node) {
	const p = node.parent;
	if (!p) return false;
	if (import_typescript.default.isPropertyAccessExpression(p) && p.name === node) return true;
	if ((import_typescript.default.isPropertyAssignment(p) || import_typescript.default.isPropertyDeclaration(p) || import_typescript.default.isMethodDeclaration(p) || import_typescript.default.isPropertySignature(p) || import_typescript.default.isMethodSignature(p) || import_typescript.default.isGetAccessor(p) || import_typescript.default.isSetAccessor(p)) && p.name === node) return true;
	if (import_typescript.default.isQualifiedName(p) && p.right === node) return true;
	if (import_typescript.default.isJsxAttribute(p) && p.name === node) return true;
	if (import_typescript.default.isLabeledStatement(p) || import_typescript.default.isBreakOrContinueStatement(p)) return true;
	if (import_typescript.default.isTypeReferenceNode(p) || import_typescript.default.isTypeAliasDeclaration(p) || import_typescript.default.isInterfaceDeclaration(p)) return true;
	return false;
}
function gateScript(source, fileName = "script.ts", options = {}) {
	const grants = new Set(options.grants ?? []);
	const allowImports = new Set(options.allowImports ?? []);
	const issues = [];
	const uses = /* @__PURE__ */ new Set();
	const file = import_typescript.default.createSourceFile(fileName, source, import_typescript.default.ScriptTarget.ES2022, true, kindOf(fileName));
	const add = (node, message) => issues.push({
		...position(file, node.getStart(file)),
		message
	});
	const syntax = file.parseDiagnostics ?? [];
	for (const d of syntax) issues.push({
		...position(file, d.start ?? 0),
		message: `syntax: ${import_typescript.default.flattenDiagnosticMessageText(d.messageText, " ")}`
	});
	if (issues.length) return {
		ok: false,
		issues,
		typechecked: false
	};
	const visit = (node) => {
		if (import_typescript.default.isIdentifier(node) && !isNameOnly(node)) {
			const name = node.text;
			if (ALWAYS[name]) add(node, `${name} is not allowed: ${ALWAYS[name]}`);
			const cap = NEEDS[name];
			if (cap) {
				if (grants.has(cap)) uses.add(cap);
				else add(node, `${name} needs the "${cap}" capability, which this island was not granted`);
			}
		}
		if (import_typescript.default.isPropertyAccessExpression(node) && BAD_PROPS.has(node.name.text)) add(node.name, `.${node.name.text} is not reachable from scripts`);
		if (import_typescript.default.isElementAccessExpression(node) && import_typescript.default.isStringLiteralLike(node.argumentExpression) && BAD_PROPS.has(node.argumentExpression.text)) add(node.argumentExpression, `["${node.argumentExpression.text}"] is not reachable from scripts`);
		if (import_typescript.default.isCallExpression(node) && node.expression.kind === import_typescript.default.SyntaxKind.ImportKeyword) add(node, "dynamic import() is not allowed");
		if (import_typescript.default.isImportDeclaration(node) || import_typescript.default.isExportDeclaration(node)) {
			const spec = node.moduleSpecifier;
			if (spec && import_typescript.default.isStringLiteral(spec) && !allowImports.has(spec.text)) add(spec, `import from "${spec.text}" is not allowed`);
		}
		if (import_typescript.default.isImportEqualsDeclaration(node)) add(node, "import = require() is not allowed");
		if (import_typescript.default.isWithStatement(node)) add(node, "with statements are not allowed");
		if (import_typescript.default.isMetaProperty(node) && node.keywordToken === import_typescript.default.SyntaxKind.ImportKeyword) add(node, "import.meta is not available to scripts");
		if (import_typescript.default.isCallExpression(node) && import_typescript.default.isIdentifier(node.expression) && ["setTimeout", "setInterval"].includes(node.expression.text)) {
			const first = node.arguments[0];
			if (first && (import_typescript.default.isStringLiteralLike(first) || import_typescript.default.isTemplateExpression(first))) add(first, `${node.expression.text} with a string runs code from text`);
		}
		import_typescript.default.forEachChild(node, visit);
	};
	visit(file);
	let typechecked = false;
	const libFile = import_typescript.default.sys && typeof import_typescript.default.getDefaultLibFilePath === "function" ? import_typescript.default.getDefaultLibFilePath({}).replace(/[^/\\]+$/, "lib.es2022.d.ts") : "";
	if (options.typecheck && libFile && import_typescript.default.sys.fileExists(libFile)) {
		const libDir = import_typescript.default.getDefaultLibFilePath({}).replace(/[^/\\]+$/, "");
		const compilerOptions = {
			target: import_typescript.default.ScriptTarget.ES2022,
			module: import_typescript.default.ModuleKind.ESNext,
			strict: true,
			noEmit: true,
			lib: ["lib.es2022.d.ts"],
			types: [],
			jsx: import_typescript.default.JsxEmit.Preserve,
			allowJs: true,
			checkJs: true,
			skipLibCheck: true
		};
		const host = import_typescript.default.createCompilerHost(compilerOptions);
		const original = host.getSourceFile.bind(host);
		host.getSourceFile = (name, lang, onError) => name === fileName ? file : original(name, lang, onError);
		host.getDefaultLibLocation = () => libDir;
		const program = import_typescript.default.createProgram([fileName], compilerOptions, host);
		const diags = [...program.getSemanticDiagnostics(file), ...program.getSyntacticDiagnostics(file)];
		for (const d of diags) {
			if (d.code === 2304 && issues.length) continue;
			issues.push({
				...position(file, d.start ?? 0),
				message: `type: ${import_typescript.default.flattenDiagnosticMessageText(d.messageText, " ")}`
			});
		}
		typechecked = true;
	}
	if (issues.length) return {
		ok: false,
		issues: issues.sort((a, b) => a.line - b.line || a.col - b.col),
		typechecked
	};
	const guard = (context) => {
		const f = context.factory;
		const visitNode = (node) => {
			if (import_typescript.default.isElementAccessExpression(node) && !import_typescript.default.isNumericLiteral(node.argumentExpression)) return f.updateElementAccessExpression(node, import_typescript.default.visitNode(node.expression, visitNode), f.createCallExpression(f.createIdentifier(KEY_GUARD), void 0, [import_typescript.default.visitNode(node.argumentExpression, visitNode)]));
			return import_typescript.default.visitEachChild(node, visitNode, context);
		};
		return (sf) => import_typescript.default.visitNode(sf, visitNode);
	};
	return {
		ok: true,
		js: `${RUNTIME_PRELUDE}${import_typescript.default.transpileModule(source, {
			fileName,
			compilerOptions: {
				target: import_typescript.default.ScriptTarget.ES2022,
				module: import_typescript.default.ModuleKind.ESNext,
				jsx: import_typescript.default.JsxEmit.React,
				alwaysStrict: true
			},
			transformers: { before: [guard] }
		}).outputText}`,
		uses: [...uses],
		typechecked
	};
}
/**
* Second layer for scripts (work item N3): a gated script runs in its own worker with a
* message-only API.
*
*   gateScript (static checks, script-gate.ts)
*     -> a fresh worker: network, storage, workers, eval and the Function constructors are removed
*        before the script loads; the shared prototypes are frozen
*     -> the script's default export is called with `forge`, an object whose methods only send
*        messages; the host answers each one (and only for what the island was granted)
*     -> the worker is terminated when the script returns, throws, or runs out of time
*
* A script never touches the world directly. It asks; the host decides, the same rule as portals.
*
* Script shape:
*   export default async function (forge) {
*     const n = await forge.query("lab");
*     await forge.log(`there are ${n.length} lab things`);
*     return n.length;
*   }
*/
/** Globals removed inside the worker, whatever the static gate said. */
var REMOVED = [
	"fetch",
	"XMLHttpRequest",
	"WebSocket",
	"EventSource",
	"WebTransport",
	"RTCPeerConnection",
	"navigator",
	"localStorage",
	"sessionStorage",
	"indexedDB",
	"caches",
	"importScripts",
	"Worker",
	"SharedWorker",
	"eval",
	"Function",
	"require",
	"process",
	"Deno",
	"Bun",
	"BroadcastChannel",
	"MessageChannel",
	"postMessage",
	"close",
	"onmessage"
];
/** Also removed in browser workers. (Node uses WebAssembly internally to load modules, so there the static gate alone keeps it from scripts.) */
var BROWSER_ONLY = ["WebAssembly"];
var lockdown = (names) => `
const __deny = (name) => function () { throw new Error("forge: " + name + " is not available to scripts"); };
const __send = __forgeSend;
for (const name of ${JSON.stringify(names)}) {
  try { Object.defineProperty(globalThis, name, { value: __deny(name), writable: false, configurable: false, enumerable: false }); } catch {}
}
for (const f of [function () {}, async function () {}, function* () {}, async function* () {}]) {
  try { Object.defineProperty(Object.getPrototypeOf(f), "constructor", { value: __deny("the Function constructor"), writable: false, configurable: false }); } catch {}
}
for (const p of [Object.prototype, Array.prototype, Function.prototype, String.prototype, Number.prototype, Boolean.prototype, Promise.prototype, Map.prototype, Set.prototype, RegExp.prototype, Error.prototype, Symbol.prototype]) Object.freeze(p);
let __next = 1;
const __pending = new Map();
const forge = new Proxy(Object.freeze({}), {
  get(_t, name) {
    if (typeof name !== "string" || name === "then") return undefined;
    return (...args) => new Promise((resolve, reject) => {
      const id = __next++;
      __pending.set(id, { resolve, reject });
      __send({ type: "call", id, name, args: JSON.parse(JSON.stringify(args ?? [])) });
    });
  },
});
globalThis.__forgeReply = (m) => {
  const p = __pending.get(m.id);
  if (!p) return;
  __pending.delete(m.id);
  if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error));
};
globalThis.__forgeRun = async (url) => {
  try {
    const mod = await import(url);
    if (typeof mod.default !== "function") throw new Error("the script must export a default function");
    const value = await mod.default(forge);
    __send({ type: "done", value: value === undefined ? null : JSON.parse(JSON.stringify(value)) });
  } catch (error) {
    __send({ type: "error", error: String(error && error.message ? error.message : error) });
  }
};
`;
/** Gate, then run in an isolated worker. `api` holds the host functions the script may call. */
async function runGatedScript(source, fileName, api, options = {}) {
	const gated = gateScript(source, fileName, {
		...options,
		allowImports: []
	});
	if (!gated.ok) return {
		ok: false,
		stage: "gate",
		issues: gated.issues
	};
	return runInWorker(gated.js, api, options.timeoutMs ?? 2e3, options.maxCalls ?? 1e3);
}
/** The runtime layer on its own (already-checked JavaScript). Exported for tests of the second layer. */
async function runInWorker(js, api, timeoutMs = 2e3, maxCalls = 1e3) {
	const started = Date.now();
	let calls = 0;
	const isNode = typeof process !== "undefined" && !!process.versions?.node;
	const moduleUrl = isNode ? `data:text/javascript;base64,${btoaUtf8(js)}` : URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
	let port;
	return new Promise((resolve) => {
		const finish = (r) => {
			clearTimeout(timer);
			port?.kill();
			if (!isNode) URL.revokeObjectURL(moduleUrl);
			resolve(r);
		};
		const timer = setTimeout(() => finish({
			ok: false,
			stage: "run",
			error: `stopped after ${timeoutMs} ms`,
			calls,
			ms: Date.now() - started
		}), timeoutMs);
		const onMessage = async (m) => {
			if (m.type === "done") return finish({
				ok: true,
				value: m.value,
				calls,
				ms: Date.now() - started
			});
			if (m.type === "error") return finish({
				ok: false,
				stage: "run",
				error: m.error,
				calls,
				ms: Date.now() - started
			});
			if (m.type !== "call") return;
			calls += 1;
			if (calls > maxCalls) return finish({
				ok: false,
				stage: "run",
				error: `more than ${maxCalls} host calls`,
				calls,
				ms: Date.now() - started
			});
			const fn = Object.prototype.hasOwnProperty.call(api, m.name) ? api[m.name] : null;
			if (!fn) return port.post({
				type: "reply",
				id: m.id,
				ok: false,
				error: `forge.${m.name} is not offered to this script`
			});
			try {
				const value = await fn(...Array.isArray(m.args) ? m.args : []);
				port.post({
					type: "reply",
					id: m.id,
					ok: true,
					value: value === void 0 ? null : JSON.parse(JSON.stringify(value))
				});
			} catch (error) {
				port.post({
					type: "reply",
					id: m.id,
					ok: false,
					error: String(error instanceof Error ? error.message : error)
				});
			}
		};
		(async () => {
			if (isNode) {
				const { Worker } = await import("node:worker_threads");
				const worker = new Worker(`
          const { parentPort } = require("node:worker_threads");
          globalThis.__forgeSend = (m) => parentPort.postMessage(m);
          ${lockdown(REMOVED)}
          parentPort.on("message", (m) => { if (m.type === "reply") globalThis.__forgeReply(m); });
          globalThis.__forgeRun(${JSON.stringify(moduleUrl)});
        `, {
					eval: true,
					resourceLimits: {
						maxOldGenerationSizeMb: 64,
						maxYoungGenerationSizeMb: 16
					}
				});
				port = {
					post: (m) => worker.postMessage(m),
					kill: () => void worker.terminate()
				};
				worker.on("message", (m) => void onMessage(m));
				worker.on("error", (e) => finish({
					ok: false,
					stage: "run",
					error: String(e),
					calls,
					ms: Date.now() - started
				}));
			} else {
				const boot = `
          const __post = self.postMessage.bind(self);
          globalThis.__forgeSend = (m) => __post(m);
          self.addEventListener("message", (e) => { if (e.data && e.data.type === "reply") globalThis.__forgeReply(e.data); });
          ${lockdown([...REMOVED, ...BROWSER_ONLY])}
          globalThis.__forgeRun(${JSON.stringify(moduleUrl)});
        `;
				const url = URL.createObjectURL(new Blob([boot], { type: "text/javascript" }));
				const worker = new Worker(url, { type: "module" });
				port = {
					post: (m) => worker.postMessage(m),
					kill: () => {
						worker.terminate();
						URL.revokeObjectURL(url);
					}
				};
				worker.onmessage = (e) => void onMessage(e.data);
				worker.onerror = (e) => finish({
					ok: false,
					stage: "run",
					error: String(e.message),
					calls,
					ms: Date.now() - started
				});
			}
		})();
	});
}
function btoaUtf8(text) {
	const bytes = new TextEncoder().encode(text);
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}
//#endregion
export { runGatedScript };
