/**
 * The ahead-of-time cache on disk (src/engine/guest/aot.ts): one file per program in ~/.forge/aot
 * (or FORGE_AOT_DIR), named by the program's SHA-256, its memory size and the build format version.
 * The first run of a program builds it; later runs load it and start translated.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { aheadKey, compileAhead, decodeAhead, encodeAhead, type AheadBuild } from "../src/engine/guest/aot.ts";

export function aotDir(): string {
  return process.env.FORGE_AOT_DIR || join(homedir(), ".forge", "aot");
}

export async function loadOrBuildAhead(bytes: Uint8Array, memBytes?: number): Promise<{ build: AheadBuild; hit: boolean; ms: number; path: string }> {
  const started = performance.now();
  const dir = aotDir();
  const path = join(dir, `${await aheadKey(bytes, memBytes)}.faot`);
  if (existsSync(path)) {
    const build = decodeAhead(new Uint8Array(readFileSync(path)));
    if (build) return { build, hit: true, ms: performance.now() - started, path };
  }
  const build = compileAhead(bytes, memBytes ? { memBytes } : {});
  mkdirSync(dir, { recursive: true });
  // Write then rename, so a crash never leaves half a file under the real name.
  writeFileSync(`${path}.tmp`, encodeAhead(build));
  renameSync(`${path}.tmp`, path);
  return { build, hit: false, ms: performance.now() - started, path };
}
