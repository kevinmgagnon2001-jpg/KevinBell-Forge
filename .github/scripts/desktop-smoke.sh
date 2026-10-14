#!/usr/bin/env bash
# Open the built Forge desktop app on a virtual display, take screenshots, and fail if it does
# not stay up. Linux only (the runners have no real screen).
#   .github/scripts/desktop-smoke.sh path/to/forge out-dir
set -u
BIN="$1"
OUT="$2"
mkdir -p "$OUT"
Xvfb :99 -screen 0 1280x800x24 > /dev/null 2>&1 &
XVFB=$!
sleep 2
export DISPLAY=:99
# WebKitGTK cannot use the GPU on a virtual display.
export WEBKIT_DISABLE_DMABUF_RENDERER=1
"$BIN" > "$OUT/app-output.txt" 2>&1 &
APP=$!
sleep 25
import -window root "$OUT/window-25s.png" 2>> "$OUT/app-output.txt"
sleep 20
import -window root "$OUT/window-45s.png" 2>> "$OUT/app-output.txt"
if kill -0 "$APP" 2> /dev/null; then
  echo "Forge is running (pid $APP)."
  kill "$APP"; kill "$XVFB"
  exit 0
fi
wait "$APP"; code=$?
kill "$XVFB"
echo "--- app output ---"; tail -n 60 "$OUT/app-output.txt"
echo "::error title=Desktop smoke test::the app exited (code $code) within 45 s; see app-output.txt in the artifact"
exit 1
