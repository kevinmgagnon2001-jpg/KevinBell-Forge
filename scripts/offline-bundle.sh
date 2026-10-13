#!/usr/bin/env bash
# Build Forge on a machine with no internet, the correct way.
#
# Step 1, on ANY machine WITH internet (same OS and CPU family as the target, because some npm
# packages ship native binaries):
#     scripts/offline-bundle.sh fetch
# This fills ./offline/ with every Rust crate (cargo vendor) and every npm package (an npm cache),
# and writes src-tauri/.cargo/config.toml so Cargo reads crates from src-tauri/vendor.
#
# Step 2, copy the whole project folder (including offline/ and src-tauri/vendor/) to the offline
# machine and run:
#     scripts/offline-bundle.sh install
# Nothing in step 2 touches the network: npm installs from the cache, Cargo builds from vendor/.
#
# Needs: Node 22+, npm, Rust (cargo), and for the desktop app the Tauri system libraries
# (Linux: webkit2gtk-4.1, libsoup-3; Windows: WebView2; macOS: nothing extra).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
OFFLINE="$ROOT/offline"

fetch() {
  mkdir -p "$OFFLINE/npm-cache"
  echo "== npm: filling the package cache"
  npm install --cache "$OFFLINE/npm-cache" --prefer-online --no-audit --no-fund
  echo "== cargo: locking and vendoring every crate"
  (cd src-tauri && cargo generate-lockfile && mkdir -p .cargo && cargo vendor --locked vendor > .cargo/config.toml)
  # cargo vendor prints the exact source replacement; record which versions were vendored.
  (cd src-tauri && cargo tree --offline --depth 1 > "$OFFLINE/cargo-tree.txt" || true)
  echo "== done. Copy this folder (with offline/ and src-tauri/vendor/) to the offline machine."
  du -sh "$OFFLINE" src-tauri/vendor 2>/dev/null || true
}

install() {
  [ -d "$OFFLINE/npm-cache" ] || { echo "offline/npm-cache is missing: run 'fetch' on a machine with internet first"; exit 1; }
  [ -d src-tauri/vendor ] || { echo "src-tauri/vendor is missing: run 'fetch' on a machine with internet first"; exit 1; }
  echo "== npm: installing from the local cache only"
  npm ci --offline --cache "$OFFLINE/npm-cache" --no-audit --no-fund
  echo "== engine tests"
  npm run test:engine
  echo "== cargo: building and testing the desktop host from vendor/ only"
  (cd src-tauri && cargo test --offline --locked)
  echo "== command-line program"
  npm run cli:build
  echo "== ready. Next: bin/forge run <program>, npm run desktop:dev (window) or npm run desktop:build (installer)."
}

case "${1:-}" in
  fetch) fetch ;;
  install) install ;;
  *) echo "usage: $0 fetch   (with internet)  |  $0 install   (offline)"; exit 2 ;;
esac
