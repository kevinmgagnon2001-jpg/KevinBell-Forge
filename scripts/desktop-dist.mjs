// After `vite build --mode desktop`: find the built single-page app and copy it to
// src-tauri/frontend, which tauri.conf.json serves in the native window.
import { cpSync, existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

const candidates = ["dist/client", ".output/public", "dist"];
const target = "src-tauri/frontend";
for (const dir of candidates) {
  const hasIndex = existsSync(join(dir, "index.html"));
  const hasShell = existsSync(join(dir, "_shell.html"));
  if (!hasIndex && !hasShell) continue;
  rmSync(target, { recursive: true, force: true });
  cpSync(dir, target, { recursive: true });
  if (!hasIndex && hasShell) renameSync(join(target, "_shell.html"), join(target, "index.html"));
  console.log(`desktop frontend: ${dir} -> ${target}`);
  process.exit(0);
}
console.error(`no built index.html found in ${candidates.join(", ")}. Run: npm run build:desktop`);
process.exit(1);
