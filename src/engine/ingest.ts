/**
 * Ingest. Take any file, say what it is, and say how the engine can run or use it.
 * It only identifies and validates. It never executes anything. Running a module is a
 * separate step that goes through the sandboxed VM.
 *
 * Routes
 *   wasm      runs natively in the sandbox once its imports are satisfied
 *   gguf      a local language model for the resident slot
 *   glb/gltf  a 3D asset for the scene
 *   image     a texture
 *   script    source text, checked by the safe-compile gate before it is injected
 *   archive   unpack, then ingest each member
 *   native    a compiled program for another machine (ELF, PE, Mach-O). It needs an emulator layer.
 */
import { readElf } from "./guest/elf.ts";

export type IngestKind =
  | "wasm"
  | "gguf"
  | "glb"
  | "gltf"
  | "image"
  | "script"
  | "archive"
  | "native"
  | "data"
  | "unknown";

export type IngestRoute = "sandbox-vm" | "resident-model" | "scene-asset" | "texture" | "safe-compile" | "unpack" | "emulator" | "store" | "reject";

export type IngestReport = {
  name: string;
  bytes: number;
  kind: IngestKind;
  route: IngestRoute;
  ready: boolean;
  detail: string;
  wasm?: { valid: boolean; imports: string[]; exports: string[] };
};

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...Array.from(bytes.subarray(start, start + length)));

function ext(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Identify by magic bytes first. The extension only breaks ties for plain text. */
export function sniff(bytes: Uint8Array, name: string): IngestKind {
  if (bytes.length >= 4) {
    if (bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d) return "wasm";
    const head4 = ascii(bytes, 0, 4);
    if (head4 === "GGUF") return "gguf";
    if (head4 === "glTF") return "glb";
    if (head4 === "PK\u0003\u0004") return "archive";
    if (bytes[0] === 0x7f && head4.slice(1) === "ELF") return "native";
    if (bytes[0] === 0x4d && bytes[1] === 0x5a) return "native";
    const mach = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    if ([0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcefaedfe, 0xcffaedfe].includes(mach >>> 0)) return "native";
    if (bytes[0] === 0x89 && head4.slice(1) === "PNG") return "image";
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image";
    if (head4 === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image";
    if (head4 === "GIF8") return "image";
  }
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return "archive";
  switch (ext(name)) {
    case "gltf":
      return "gltf";
    case "js":
    case "mjs":
    case "ts":
    case "tsx":
    case "jsx":
    case "html":
      return "script";
    case "json":
    case "txt":
    case "md":
    case "csv":
      return "data";
    default:
      return "unknown";
  }
}

const ROUTE: Record<IngestKind, { route: IngestRoute; ready: boolean; detail: string }> = {
  wasm: { route: "sandbox-vm", ready: true, detail: "WebAssembly module. Runs in the sandbox once imports are met." },
  gguf: { route: "resident-model", ready: true, detail: "Local model weights. Can fill the resident model slot." },
  glb: { route: "scene-asset", ready: true, detail: "Binary glTF. Can be spawned as a scene asset." },
  gltf: { route: "scene-asset", ready: true, detail: "glTF scene description. Can be spawned as a scene asset." },
  image: { route: "texture", ready: true, detail: "Image. Can be wrapped onto a solid." },
  script: { route: "safe-compile", ready: true, detail: "Source text. Goes through the safe-compile gate (script-gate.ts) before it is injected." },
  archive: { route: "unpack", ready: false, detail: "Archive. Unpack it, then ingest each member." },
  native: { route: "emulator", ready: false, detail: "Compiled for another machine. Needs an emulator layer; it cannot run directly in the browser." },
  data: { route: "store", ready: true, detail: "Plain data. Kept as a document the forge can read." },
  unknown: { route: "reject", ready: false, detail: "Unrecognized format. Nothing was run." },
};

export function ingest(bytes: Uint8Array, name: string): IngestReport {
  const kind = sniff(bytes, name);
  const base = ROUTE[kind];
  const report: IngestReport = { name, bytes: bytes.length, kind, route: base.route, ready: base.ready, detail: base.detail };
  if (kind === "native") {
    if (bytes[0] !== 0x7f) return { ...report, detail: "Windows (PE) or macOS (Mach-O) program. Forge's native layer runs static Linux programs today; this one is reported, not run." };
    const elf = readElf(bytes);
    if (!elf.ok) return { ...report, detail: `Linux program, but not one Forge can run yet: ${elf.reason}. Nothing was run.` };
    return { ...report, ready: true, detail: `Static Linux program for ${elf.elf.arch === "x86_64" ? "x86-64" : "ARM64"}. Runs in Forge's Linux layer: lifted to WebAssembly, unknown instructions reported and never executed.` };
  }
  if (kind === "wasm" && typeof WebAssembly !== "undefined") {
    // WebAssembly.validate and Module introspection do not execute the module.
    const copy = new Uint8Array(bytes);
    const valid = WebAssembly.validate(copy);
    if (!valid) {
      return { ...report, ready: false, route: "reject", detail: "Looks like WebAssembly but failed validation. Nothing was run.", wasm: { valid, imports: [], exports: [] } };
    }
    const module = new WebAssembly.Module(copy);
    const imports = WebAssembly.Module.imports(module).map((item) => `${item.module}.${item.name}`);
    const exports = WebAssembly.Module.exports(module).map((item) => item.name);
    return { ...report, wasm: { valid, imports, exports } };
  }
  return report;
}

export async function ingestFile(file: File): Promise<IngestReport> {
  return ingest(new Uint8Array(await file.arrayBuffer()), file.name);
}
