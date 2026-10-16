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
# Forge's own icon by name: the package has two launcher icons now (Forge and Blocks), and "any
# launcher activity of the package" (monkey) can pick the Blocks one, which never loads the world.
adb shell am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n "$PKG/.MainActivity" > /dev/null
sleep 20
adb exec-out screencap -p > "$OUT/screen-20s.png"
sleep 40
adb exec-out screencap -p > "$OUT/screen-60s.png"
PID="$(adb shell pidof "$PKG" | tr -d '\r')"
adb logcat -d > "$OUT/logcat.txt"
# The page's console (WebView prints it under "chromium" / "Console"), Rust's output, and crashes.
grep -E "chromium|Console|CONSOLE|RustStdoutStderr|Tauri|AndroidRuntime|FATAL|wasmtime|ForgeApps" "$OUT/logcat.txt" > "$OUT/app-log.txt" || true
# Why Android stopped Forge, if it did without a crash: "not responding", low memory, or a kill.
grep -E "ANR in|Process dev\.forge\.app .*has died|lowmemorykiller|Killing [0-9]+:dev\.forge\.app|am_kill.*dev\.forge\.app" "$OUT/logcat.txt" > "$OUT/why-stopped.txt" || true
adb shell dumpsys meminfo "$PKG" > "$OUT/meminfo.txt" 2>&1 || true
echo "--- app log (last 80 lines) ---"; tail -n 80 "$OUT/app-log.txt"
if grep -q "FATAL EXCEPTION" "$OUT/logcat.txt"; then
  echo "::error title=Android smoke test::the app crashed; see app-log.txt in the android-smoke artifact"; exit 1
fi
if [ -z "$PID" ]; then
  echo "--- why Android stopped Forge ---"; cat "$OUT/why-stopped.txt"
  grep -A 12 "ANR in dev.forge.app" "$OUT/logcat.txt" | head -n 30 || true
  echo "::error title=Android smoke test::the app is not running 60 s after launch; see why-stopped.txt and logcat.txt in the android-smoke artifact"; exit 1
fi
errors="$(grep -ciE "Uncaught|TypeError|ReferenceError|SyntaxError|Failed to load" "$OUT/app-log.txt" || true)"
if [ "${errors:-0}" -gt 0 ]; then
  echo "::warning title=Android smoke test::${errors} error line(s) in the page console; see app-log.txt"
fi
# The screen in Forge's world lists the phone's apps through MainActivity's bridge. The page asks it
# how many there are once it has started (src/engine/device-apps.ts), and the bridge logs the answer.
APPS="$(grep -oE "apps on this device: [0-9]+" "$OUT/app-log.txt" | tail -n 1 | grep -oE "[0-9]+$" || true)"
if [ -z "$APPS" ]; then
  echo "::error title=Android smoke test::the page never reported the phone's apps (window.ForgeAndroid missing?); see app-log.txt"; exit 1
fi
if [ "$APPS" -lt 1 ]; then
  echo "::error title=Android smoke test::the page sees no apps on the emulator; the <queries> entry may be missing"; exit 1
fi
echo "The page sees $APPS app(s) on the phone."

# Forge as the home screen: turn it on the way the person does, press Home, and Forge must come back
# as the same, single, running Forge. (It used to start a second copy that stayed black.)
# Android 14 does not let the plain adb shell switch another app's components on, so do the person's
# part (turning it on in Forge, choosing it in Android's setting) as root, which the emulator allows.
adb root > /dev/null 2>&1 || true
adb wait-for-device
if ! adb shell pm enable "$PKG/.HomeActivity" > "$OUT/home-setup.txt" 2>&1 \
  || ! adb shell cmd package set-home-activity "$PKG/.HomeActivity" >> "$OUT/home-setup.txt" 2>&1; then
  cat "$OUT/home-setup.txt"
  echo "::error title=Android smoke test::could not make Forge the home screen on the emulator (a test setup problem, not the app); see home-setup.txt"; exit 1
fi
# Switching a component on from the shell also stops the app (Forge's own button does not: it passes
# DONT_KILL_APP), so open Forge again and take the process to compare from here.
adb shell am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n "$PKG/.MainActivity" > /dev/null
sleep 15
PID="$(adb shell pidof "$PKG" | tr -d '\r')"
if [ -z "$PID" ]; then
  echo "::error title=Android smoke test::Forge did not start again after the home-screen setup; see logcat.txt"; exit 1
fi
adb shell input keyevent KEYCODE_HOME
sleep 3
adb shell input keyevent KEYCODE_HOME
sleep 10
adb exec-out screencap -p > "$OUT/screen-home.png"
adb shell dumpsys activity activities > "$OUT/activities.txt" 2>&1 || true
MAINS="$(grep -oE "ActivityRecord\{[0-9a-f]+ u0 $PKG/\.MainActivity" "$OUT/activities.txt" | sort -u | wc -l | tr -d ' ')"
HOME_PID="$(adb shell pidof "$PKG" | tr -d '\r')"
if [ "${MAINS:-0}" -ne 1 ]; then
  echo "::error title=Android smoke test::after pressing Home with Forge as the home screen there are ${MAINS:-0} Forge screens (want 1); see activities.txt and screen-home.png"; exit 1
fi
if ! grep -qE "ResumedActivity.*$PKG/\.MainActivity" "$OUT/activities.txt"; then
  echo "::error title=Android smoke test::pressing Home with Forge as the home screen did not bring Forge to the front; see activities.txt and screen-home.png"; exit 1
fi
if [ "$HOME_PID" != "$PID" ]; then
  echo "::error title=Android smoke test::Forge restarted when Home was pressed (pid $PID -> ${HOME_PID:-none}); see logcat.txt"; exit 1
fi
echo "Home brings back the running Forge."

# The Blocks icon (an alias of MainActivity, scripts/android-manifest.mjs) must bring back the same
# running Forge, switched to the game, not start a second copy.
adb logcat -c
adb shell am start -n "$PKG/.BlocksLauncher" > "$OUT/blocks-start.txt" 2>&1
sleep 8
adb exec-out screencap -p > "$OUT/screen-blocks.png"
adb logcat -d > "$OUT/logcat-blocks.txt"
BLOCKS_PID="$(adb shell pidof "$PKG" | tr -d '\r')"
adb shell dumpsys activity activities > "$OUT/activities-blocks.txt" 2>&1 || true
if grep -q "FATAL EXCEPTION" "$OUT/logcat-blocks.txt"; then
  echo "::error title=Android smoke test::opening the Blocks icon crashed Forge; see logcat-blocks.txt"; exit 1
fi
if [ "$BLOCKS_PID" != "$PID" ]; then
  echo "::error title=Android smoke test::the Blocks icon restarted Forge (pid $PID -> ${BLOCKS_PID:-none}); see blocks-start.txt and logcat-blocks.txt"; exit 1
fi
SCREENS="$(grep -oE "ActivityRecord\{[0-9a-f]+ u0 $PKG/\.(MainActivity|BlocksLauncher)" "$OUT/activities-blocks.txt" | sort -u | wc -l | tr -d ' ')"
if [ "${SCREENS:-0}" -ne 1 ]; then
  echo "::error title=Android smoke test::after the Blocks icon there are ${SCREENS:-0} Forge screens (want 1); see activities-blocks.txt and screen-blocks.png"; exit 1
fi
echo "The Blocks icon opens the running Forge (screen-blocks.png)."
echo "Forge is running (pid $PID)."
