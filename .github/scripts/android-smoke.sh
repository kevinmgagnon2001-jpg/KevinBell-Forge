#!/usr/bin/env bash
# Install the APK on the running emulator, launch Forge, and record what happens: screenshots, the
# WebView console and any crash. Fails if the app does not start or dies.
#   .github/scripts/android-smoke.sh path/to/app.apk out-dir
set -u
APK="$1"
OUT="$2"
PKG=dev.forge.app
mkdir -p "$OUT"
adb wait-for-device
# The emulator reports "booted" before the package manager is ready; wait for it.
for _ in $(seq 1 60); do adb shell pm list packages > /dev/null 2>&1 && break; sleep 2; done
adb install -r "$APK" || { echo "::error title=Android smoke test::the APK did not install"; exit 1; }
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 > /dev/null
sleep 20
adb exec-out screencap -p > "$OUT/screen-20s.png"
sleep 40
adb exec-out screencap -p > "$OUT/screen-60s.png"
PID="$(adb shell pidof "$PKG" | tr -d '\r')"
adb logcat -d > "$OUT/logcat.txt"
# The page's console (WebView prints it under "chromium" / "Console"), Rust's output, and crashes.
grep -E "chromium|Console|CONSOLE|RustStdoutStderr|Tauri|AndroidRuntime|FATAL|wasmtime" "$OUT/logcat.txt" > "$OUT/app-log.txt" || true
adb shell dumpsys meminfo "$PKG" > "$OUT/meminfo.txt" 2>&1 || true
echo "--- app log (last 80 lines) ---"; tail -n 80 "$OUT/app-log.txt"
if grep -q "FATAL EXCEPTION" "$OUT/logcat.txt"; then
  echo "::error title=Android smoke test::the app crashed; see app-log.txt in the android-smoke artifact"; exit 1
fi
if [ -z "$PID" ]; then
  echo "::error title=Android smoke test::the app is not running 60 s after launch; see logcat.txt in the android-smoke artifact"; exit 1
fi
errors="$(grep -ciE "Uncaught|TypeError|ReferenceError|SyntaxError|Failed to load" "$OUT/app-log.txt" || true)"
if [ "${errors:-0}" -gt 0 ]; then
  echo "::warning title=Android smoke test::${errors} error line(s) in the page console; see app-log.txt"
fi
echo "Forge is running (pid $PID)."
