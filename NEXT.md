# Pick up here

State at the end of the last session (branch `ccr-cb829fc1-9iqt9m`; all work is committed and pushed).
History and details: `PATCH_NOTES.md` (last three sections). Roadmap with status per item: `docs/handoff.html`, section 3.

## Where things stand

- **Android:** `.github/workflows/android.yml` builds an arm64 APK (for phones) and an x86_64 APK, launches the
  x86_64 one on an emulator (`.github/scripts/android-smoke.sh`), and only then may publish a Release (on a `v*` tag).
  Signed with the owner's permanent key (secrets ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS).
- **Release v0.6.0 is published** (tag `v0.6.0` on main): the Android APK, signed with the owner's permanent key
  (repository secrets), and the desktop installers. Android builds print the signing fingerprint from the next tag on.
- **Linked devices (first part):** `forge link` runs a home on a PC; devices pair in the app's Devices panel (matching
  six-digit codes) and share one save (world, log, clock). The device in use leads; the others follow. Engine:
  `link-home.ts`, `link-client.ts`; app: `link-browser.ts`, `Devices.tsx`. Guide: `docs/LINKING.md`.
- **Carried mechanics:** movement mechanics (Walk, Car, Plane, or recipes people write) are checked, signed
  WebAssembly that visitors carry through portals ("carry" grant). The host runs the visitor's mechanic under its
  own rules, and the visitor predicts with the same one, so there are zero corrections. Others can keep a mechanic
  with its author credited, and islands can adopt one (`--mechanic`). Engine: `mechanic.ts`; app:
  `Mechanics.tsx`, `carry-browser.ts`, `movers.ts`. Guide: `docs/MECHANICS.md`.
- **Your device inside Forge:** a screen in the lab opens your real apps (Android: launcher apps with icons, optional
  "Forge as home screen"; desktop: installed applications). Forge steps aside and keeps its state. Engine:
  `device-apps.ts`; app: `DeviceScreen.tsx`; native: `src-tauri/src/apps.rs`, `src-tauri/android/MainActivity.kt`
  (ForgeApps), `scripts/android-manifest.mjs`. Guide: `docs/YOUR-DEVICE.md`.
- **Releases:** merge a PR labelled `release` (or `[release]` in the title) and `release.yml` tags the next version
  and builds everything; the apps show "Forge X is ready" with the right download. See `docs/RELEASES.md`.
- **Desktop:** `.github/workflows/desktop.yml` builds installers for Linux x86-64/ARM64 (opened on a virtual display,
  screenshots kept), Windows and macOS (not opened). Not code-signed. Guide: `docs/DESKTOP.md`.
- **Linux programs:** static x86-64 and ARM64 programs, glibc included, match real hardware on every engine.
  `.github/workflows/arm-oracle.yml` is the ARM64 hardware oracle (builds `fixtures/linux/*.c` natively, records output,
  compares Forge). Guest files (N7): files, directories, dup/fcntl, pipes, file-backed mmap (shared mappings kept
  coherent with read/write at every system call), msync, ftruncate/truncate, pread/pwrite, rename/renameat2,
  poll/select, symbolic and hard links, threads (clone, futex; one at a time, switched at system calls). Fixtures: `mapio.c`, `links.c` (raw system calls, both architectures),
  `libc-mapio.c`, `libc-links.c` (glibc).

## Next, most important first

1. Desktop self-update (Tauri updater): needs the owner's update-signing key as a secret; then sign the installers'
   update artifacts in desktop.yml and publish latest.json with each Release.
1. Your device inside Forge, next: a live picture of the real screen on the in-world screen (desktop capture
   with permission; Android MediaProjection), then input passed through on desktop.
1. Carried mechanics, next: mechanics that act on an island's world (doors, tools), with per-island
   permissions; custom models that travel with a mechanic; try carrying between two physical machines.
1. Linked devices, next: try it between the owner's phone and PC; run the home inside the desktop and Android apps
   (link-home.ts is transport-free; the app needs a small local HTTP listener in Rust that hands requests to it);
   pairing by QR code; encrypt traffic; live control from one device while another renders; move the simulation
   with `pickHost`.
1. Code-sign the installers (needs the owner's certificates as secrets), and open the Windows/macOS builds in CI if possible.
2. N7 leftovers: processes (fork/vfork, exec, wait4), signals (tgkill). Threads (with preemption at fuel-slice
   ends) and links are done.
   A private mapping does not yet see later writes to pages it has not touched (Linux shares them until the first store).
3. Work items 9 and 13 run on one machine (live-visit.ts, prediction.ts, pilot.tsx). Next: try them across two
   machines with real latency (item 4).
4. Portal test between two real machines (item 4): needs the owner's devices on one network.
5. N8: speed for big programs. Last commit (unverified by the full suite; run `npm run test:engine` and
   `npm run test:native` first): lowered chunks are cached per program, the in-page engine reuses one imported
   memory across rebuilds, 100k interpreted instructions after a relift instead of 1M, no double validation.
   OpenSSL 55 s -> 32 s, sqlite 29 -> 17 s, zlib 8.5 -> 3 s. Profile now: lowerProgram 12 s inclusive (it re-sorts
   all instructions per rebuild; group incrementally), V8 compile 5 s, interpreter 5 s, 365 rebuilds for OpenSSL.
   Then packed SSE float,
   x87 transcendentals. SSE2 integer and x87 arithmetic are done (zlib, OpenSSL, sqlite run). ARM ld2/ld3/ld4
   when a real program needs them.

## Directions the owner wants (not started)

- **Nearby mesh (classrooms, groups in one room).** Phones find each other over Bluetooth LE and carry data over
  Wi-Fi Direct / Wi-Fi Aware or one shared hotspot: Android's Nearby Connections does exactly this (P2P_CLUSTER for
  many-to-many). Build it once as a transport, then use it twice:
  1. join an island hosted on a phone nearby, offline (shared worlds for a class, everyone's mechanics carried in);
  2. run `pooled.ts` across the room's phones.
  Local hops are a few milliseconds, so pipelined inference over 20–30 phones is usable where the internet version
  is not. Limits: iPhones need a shared hotspot (Apple's nearby system does not talk to Android's); battery and heat
  limit sessions; every device opts in visibly.
- **A shared AI computer, with permission.** Grow pooled inference in steps:
  1. one real small open model across your own linked devices;
  2. friends and trusted groups;
  3. an opt-in public pool for background work only (writing and improving skills and mechanics), since its output
     is checked by fixtures before anything runs.
  Only open-weight models can be pooled. Personal requests stay on your own devices.

  Sizing, for planning (flagship phones, top memory tier):
  - Phones share one memory between processor and graphics (no separate VRAM). Of 16–24 GB, a model can count on
    about 12–16 GB per phone; Android keeps the rest and kills apps that take too much.
  - Ten such phones: about 240 GB on paper, 120–160 GB usable. That holds a 70B model at 4-bit (~40 GB) with room to
    spare, or a ~200B-class model at 4-bit. The largest open frontier models (600B+, ~350–400 GB at 4-bit) need about
    25–30 phones, which is a classroom.
  - Prefer mixture-of-experts models. A dense model makes every phone read its whole slice for every token, one phone
    after another: ten phones is roughly 2 s per token. A mixture-of-experts model reads only its active experts, so
    the same room gets a few tokens per second.
  - Plan for heat (throttling after minutes at full load), power (plugged in), and dropouts (keep spare phones holding
    a copy of each slice so the chain does not stall when one leaves).

## How to work here

- Checks before every push: `npm run lint`, `npm run typecheck`, `npm run test:engine`.
- Rust guest shim and model store without GTK: `rustc --edition 2021 --test src-tauri/src/guest.rs` (and `model_store.rs`).
  The full `cargo test` and `npm run test:native` need the Tauri system libraries; CI (`checks.yml`) runs both.
  Without them, build `examples/guest_bridge.rs` in a scratch crate that has only wasmtime, serde and serde_json, holding
  `lib.rs` up to the first `#[tauri::command]`, then symlink it to `src-tauri/target/debug/examples/guest_bridge`.
- New instructions go in only with a test whose expected answer came from real hardware (x86-64: the build machine;
  ARM64: the arm-oracle workflow). Download its `arm-oracle` artifact into `fixtures/linux/` to record new expectations.
- In the "wasm" and "tiered" engines, newly found code first runs in the interpreter for a slice. A program-level test
  can therefore pass while the WebAssembly lowering is wrong. Test lowering directly, as `src/engine/guest/arm-fp.test.ts` does.
- WebAssembly `select` is `cond ? first : second`.
- Workflows can be started by hand (`gh workflow run`) only if they exist on `main`. `desktop.yml` and `arm-oracle.yml`
  also run on branch pushes that touch their paths.


## Graphics, next steps (after the texture fix)
- Bloom on the full tier only (`@react-three/postprocessing`): the lamp posts, circuit traces, night
  stars and the TV glow would bloom. Check the cost with the Stats overlay on a phone first; the auto
  quality ladder would need a rung for it.
- Ambient occlusion (N8AO) for contact shadows under exhibits, full tier only.
- Triplanar mapping for the lab packs, so every face of a stretched solid tiles at true scale (today
  each solid repeats by its largest side and its height, so a long box's ends are approximate).
- A proper avatar: the body is a few primitives; a rigged low-poly figure with walk and idle cycles.
- Water with real reflections (a planar mirror) on the full tier.
- Use the Stats overlay's Copy report from the phone to set the tier thresholds from real numbers.
