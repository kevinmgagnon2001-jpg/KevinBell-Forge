#!/bin/sh
# Single-file `forge` executable on macOS or Windows (Git Bash), where scripts/sea-inject.mjs (Linux only)
# does not apply. Needs network access once for `npx postject`.
#   sh scripts/make-sea.sh
set -e
cd "$(dirname "$0")/.."
node scripts/build-cli.mjs
printf '{ "main": "dist/forge.cjs", "output": "dist/sea-prep.blob", "disableExperimentalSEAWarning": true }' > dist/sea-config.json
node --experimental-sea-config dist/sea-config.json
FUSE=NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
case "$(uname -s)" in
  Darwin)
    cp "$(command -v node)" dist/forge-macos
    codesign --remove-signature dist/forge-macos || true
    npx --yes postject dist/forge-macos NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse $FUSE --macho-segment-name NODE_SEA
    codesign --sign - dist/forge-macos
    echo "built dist/forge-macos" ;;
  MINGW*|MSYS*|CYGWIN*)
    cp "$(command -v node)" dist/forge.exe
    npx --yes postject dist/forge.exe NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse $FUSE
    echo "built dist/forge.exe (unsigned; Windows may warn on first run)" ;;
  *)
    node scripts/sea-inject.mjs ;;
esac
