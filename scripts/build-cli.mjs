// Bundles the forge command-line program.
//   node scripts/build-cli.mjs
// dist/forge.mjs  one file, run with Node 22+ (bin/forge, bin\forge.cmd)
// dist/forge.cjs  the same as CommonJS, the input for a single-file executable (scripts/make-sea.sh)
import { build } from "esbuild";

const common = {
  entryPoints: ["scripts/forge-cli.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  legalComments: "none",
  logLevel: "warning",
};
await build({
  ...common,
  outfile: "dist/forge.mjs",
  format: "esm",
  banner: {
    js: 'import { createRequire as __cr } from "node:module"; import { fileURLToPath as __fu } from "node:url"; import { dirname as __dn } from "node:path"; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);',
  },
});
await build({ ...common, outfile: "dist/forge.cjs", format: "cjs", define: { "import.meta.url": "__forge_meta_url" }, banner: { js: 'const __forge_meta_url = require("node:url").pathToFileURL(__filename).href;' } });
console.log("built dist/forge.mjs and dist/forge.cjs");
