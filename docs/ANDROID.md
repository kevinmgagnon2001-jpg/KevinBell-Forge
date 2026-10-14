# Forge on Android

GitHub builds the Android app for you. Nothing needs installing on your own computer.

## Getting it on your phone

1. Push this project to a GitHub repository (with the `.github/` folder at the top level).
2. Create a tag like `v0.6.0` and push it. On GitHub you can do this from **Releases → Draft a new release → Choose a tag → type `v0.6.0` → Create new tag → Publish**.
3. Wait for the **Android APK** run under the **Actions** tab to finish (the first run takes roughly 20–40 minutes; later runs are faster because the build is cached).
4. On your phone, open the repository's **Releases** page and tap `Forge-0.6.0-android.apk`.
5. Android asks once whether your browser may install apps. Allow it, then tap **Install**.

New version: merge a pull request labelled **release** (see docs/RELEASES.md), or push a higher tag (`v0.6.1`, `v0.7.0`, …). The app tells you when a new version is out. The phone installs it over the old one, keeping your data, **as long as the signing key secrets are set** (next section).

For a test build without making a release: **Actions → Android APK → Run workflow**. The APK appears at the bottom of the run page under *Artifacts*. GitHub delivers it inside a .zip, so unzip it on the phone first.

## Updates without the browser

Forge suggests this once, in a bar at the top: **Let Forge update itself? → Allow updates**. That
opens Android's own *Install unknown apps* switch for Forge; turn it on and come back.

From then on:

1. When a new version is out, Forge downloads it by itself (a bar shows the progress).
2. Forge checks it really is Forge, newer, and signed with the same key, then hands it to Android's
   installer.
3. **The first time**, Android shows its *Do you want to update this app?* dialog: tap **Update**.
   After that, Forge is the app that installed itself, and on Android 12 and later updates install
   **without a tap**. Forge does it when you leave Forge (or straight away with **Update now**).
   Android closes Forge while it is replaced; open it again and you are where you were.

**Not now** stops the suggestion; the update bar then still offers **Download** (the old way, in the
browser) and **Allow updates**.

This needs the permanent signing key (above). With a one-off key each version is "a different app"
to Android, and Forge says so instead of installing.

### Google Play Protect

Play Protect may still scan Forge, or ask to, when it is installed or updated. That is Android's own
malware check. No app can switch it off, and Forge does not try to get around it. There are fewer
prompts when every version is signed with the same key, which the permanent key gives you.

To stop the prompts properly, Forge has to be known to Google:

- **Play Store, internal testing track:** a Play developer account ($25, once) and an `.aab` build.
  Testers you add get Forge from the Play Store, with Play's own automatic updates and no
  unknown-app or Play Protect prompts. This is the cleanest fix.
- **Android developer verification:** Google now asks developers of apps installed outside the Play
  Store to register their identity, package name and signing key. A registered Forge is treated as
  coming from a known developer. Check Google's current requirements for your country.

Neither needs any change to the app beyond the build. Ask if you want the workflow to also produce the
`.aab` for Play.

## Signing key (do this once)

Android only lets a new version replace an installed one when both were signed with the same key. Add three repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | What it is |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the keystore file, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | its password |
| `ANDROID_KEY_ALIAS` | the key's name (`forge`) |

Without them the build still works. Each APK is then signed with a one-off key, so a new version needs the old one uninstalled first, and its data goes with it.

If a secret is wrong, the build stops at "Sign the APK" and says which one. Each build prints its signing certificate's SHA-256 fingerprint on the run page and in the Release notes; it is public, and matching it against `keytool -list -v -keystore forge-release.jks` confirms your key was used.

Never commit the keystore or its password. `.gitignore` already excludes `*.jks`, `*.keystore` and `forge-android-signing*`.

To make a key yourself (any machine with Java):

```sh
keytool -genkeypair -keystore forge-release.jks -storetype PKCS12 -alias forge \
  -keyalg RSA -keysize 4096 -validity 20000 -dname "CN=Forge"
base64 -w0 forge-release.jks   # paste the output into ANDROID_KEYSTORE_BASE64
```

## What the build does

`.github/workflows/android.yml`:

1. takes the version from the tag
2. installs Node 22, Java 17, the Android SDK and NDK, and Rust with its Android targets
3. runs the engine tests
4. builds the web interface (`npm run build:desktop`)
5. generates the Android project (`tauri android init`; `src-tauri/gen/` is never committed) and its icons
6. compiles for 64-bit ARM phones (`aarch64`)
7. signs the APK
8. attaches it to the Release

To also cover old 32-bit phones, set `ANDROID_TARGETS: "aarch64 armv7"` in the workflow.

The app is allowed plain `http://` traffic so it can reach islands and compute devices on your own network.

## Building on your own machine (optional)

You need the Android SDK and NDK (`NDK_HOME` set), Java 17, Rust with `rustup target add aarch64-linux-android`, and `npm install`. Then:

```sh
npm run android:init    # once; generates src-tauri/gen/android
npm run android:dev     # live on a phone plugged in over USB (developer mode on)
npm run android:build   # release APK under src-tauri/gen/android/app/build/outputs/apk
```

## Known gaps on phones

- **Verified on GitHub, not locally.** The full pipeline (tests, web build, Android compile, signing) has completed on GitHub's runners. If a run fails, the log names the step; hand that log back.
- **wasmtime on Android.** The native runtime officially supports 64-bit ARM, but it has not been tested on a phone. If it misbehaves, the app still has the in-page WebAssembly engine.
- **Touch controls.** On-screen move keys and a drag-to-look pad are in place. They have been checked at phone size in a browser, not yet on a physical phone.
- **Taking over the phone** (default launcher, SMS passthrough, shell levels 1–2) is later work.
