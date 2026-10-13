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
import ts from "typescript";
import type { Capability } from "./island.ts";

export type GateIssue = { line: number; col: number; message: string };
export type GateOptions = {
  grants?: Capability[];
  /** Module specifiers a script may import, e.g. "forge:api". Everything else is refused. */
  allowImports?: string[];
  /** Full type-check against the ES2022 library (Node only; skipped where the library files are unavailable). */
  typecheck?: boolean;
};
export type GateResult =
  | { ok: true; js: string; uses: Capability[]; typechecked: boolean }
  | { ok: false; issues: GateIssue[]; typechecked: boolean };

/** Host globals that need a capability. */
const NEEDS: Record<string, Capability> = {
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
  OffscreenCanvas: "render",
};

/** Never reachable, whatever was granted. */
const ALWAYS: Record<string, string> = {
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
  Reflect: "Reflect can read any property by name",
};

const BAD_PROPS = new Set([
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
  "callee",
]);

export const KEY_GUARD = "__forge_key";
/** Runtime half of the guard, prepended to every gated script. */
export const RUNTIME_PRELUDE = `const ${KEY_GUARD} = (k) => { const s = typeof k === "symbol" ? "" : String(k); if (${JSON.stringify([...BAD_PROPS])}.includes(s)) throw new TypeError("forge: property " + s + " is not reachable from scripts"); return k; };\n`;

function kindOf(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (fileName.endsWith(".js") || fileName.endsWith(".mjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function position(file: ts.SourceFile, at: number) {
  const { line, character } = file.getLineAndCharacterOfPosition(at);
  return { line: line + 1, col: character + 1 };
}

function isNameOnly(node: ts.Identifier): boolean {
  const p = node.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === node) return true;
  if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodSignature(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) && p.name === node) return true;
  if (ts.isQualifiedName(p) && p.right === node) return true;
  if (ts.isJsxAttribute(p) && p.name === node) return true;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return true;
  if (ts.isTypeReferenceNode(p) || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p)) return true;
  return false;
}

export function gateScript(source: string, fileName = "script.ts", options: GateOptions = {}): GateResult {
  const grants = new Set(options.grants ?? []);
  const allowImports = new Set(options.allowImports ?? []);
  const issues: GateIssue[] = [];
  const uses = new Set<Capability>();
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, kindOf(fileName));
  const add = (node: ts.Node, message: string) => issues.push({ ...position(file, node.getStart(file)), message });

  // 1. syntax
  const syntax = (file as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  for (const d of syntax) issues.push({ ...position(file, d.start ?? 0), message: `syntax: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}` });
  if (issues.length) return { ok: false, issues, typechecked: false };

  // 2. capabilities and escape hatches
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && !isNameOnly(node)) {
      const name = node.text;
      if (ALWAYS[name]) add(node, `${name} is not allowed: ${ALWAYS[name]}`);
      const cap = NEEDS[name];
      if (cap) {
        if (grants.has(cap)) uses.add(cap);
        else add(node, `${name} needs the "${cap}" capability, which this island was not granted`);
      }
    }
    if (ts.isPropertyAccessExpression(node) && BAD_PROPS.has(node.name.text)) add(node.name, `.${node.name.text} is not reachable from scripts`);
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && BAD_PROPS.has(node.argumentExpression.text)) {
      add(node.argumentExpression, `["${node.argumentExpression.text}"] is not reachable from scripts`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node, "dynamic import() is not allowed");
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (spec && ts.isStringLiteral(spec) && !allowImports.has(spec.text)) add(spec, `import from "${spec.text}" is not allowed`);
    }
    if (ts.isImportEqualsDeclaration(node)) add(node, "import = require() is not allowed");
    if (ts.isWithStatement(node)) add(node, "with statements are not allowed");
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) add(node, "import.meta is not available to scripts");
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["setTimeout", "setInterval"].includes(node.expression.text)) {
      const first = node.arguments[0];
      if (first && (ts.isStringLiteralLike(first) || ts.isTemplateExpression(first))) add(first, `${node.expression.text} with a string runs code from text`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  // 3. optional type-check
  let typechecked = false;
  const libFile = ts.sys && typeof ts.getDefaultLibFilePath === "function" ? ts.getDefaultLibFilePath({}).replace(/[^/\\]+$/, "lib.es2022.d.ts") : "";
  if (options.typecheck && libFile && ts.sys.fileExists(libFile)) {
    const libDir = ts.getDefaultLibFilePath({}).replace(/[^/\\]+$/, "");
    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: true,
      noEmit: true,
      lib: ["lib.es2022.d.ts"],
      types: [],
      jsx: ts.JsxEmit.Preserve,
      allowJs: true,
      checkJs: true,
      skipLibCheck: true,
    };
    const host = ts.createCompilerHost(compilerOptions);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (name, lang, onError) => (name === fileName ? file : original(name, lang, onError));
    host.getDefaultLibLocation = () => libDir;
    const program = ts.createProgram([fileName], compilerOptions, host);
    const diags = [...program.getSemanticDiagnostics(file), ...program.getSyntacticDiagnostics(file)];
    for (const d of diags) {
      // Unknown host globals are already reported above with a clearer reason.
      if (d.code === 2304 && issues.length) continue;
      issues.push({ ...position(file, d.start ?? 0), message: `type: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}` });
    }
    typechecked = true;
  }
  if (issues.length) return { ok: false, issues: issues.sort((a, b) => a.line - b.line || a.col - b.col), typechecked };

  // 4. transpile, guarding every computed key
  const guard: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const f = context.factory;
    const visitNode = (node: ts.Node): ts.Node => {
      if (ts.isElementAccessExpression(node) && !ts.isNumericLiteral(node.argumentExpression)) {
        return f.updateElementAccessExpression(
          node,
          ts.visitNode(node.expression, visitNode) as ts.Expression,
          f.createCallExpression(f.createIdentifier(KEY_GUARD), undefined, [ts.visitNode(node.argumentExpression, visitNode) as ts.Expression]),
        );
      }
      return ts.visitEachChild(node, visitNode, context);
    };
    return (sf) => ts.visitNode(sf, visitNode) as ts.SourceFile;
  };
  const out = ts.transpileModule(source, {
    fileName,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, alwaysStrict: true },
    transformers: { before: [guard] },
  });
  return { ok: true, js: `${RUNTIME_PRELUDE}${out.outputText}`, uses: [...uses], typechecked };
}
