# Pick up here

State at the end of the last session (branch `ccr-0b72a8bd-nli9mn`; all work is committed and pushed).
History and details: `PATCH_NOTES.md` (the last sections). Roadmap with status per item: `docs/handoff.html`, section 3.

**Next-generation features:** `docs/PAPERS-ROADMAP.md` is a phased to-do list of research from Two Minute Papers.
Each item says what it touches.

**Done from the Papers roadmap:** all of Phase 1, NPCs with memory and a day, crowds; and this
session: vault, mantle and climb (`parkour.ts`), ropes, cables and string lights with swinging
(`rope.ts`), talking townsfolk with faces and lip sync (`talk.ts`), capes and flags (`cloth.ts`), a
companion that follows orders (`companion.ts`), fire you can put out (`fire.ts`), moss, frost, rust
and crystal (`growth.ts`). Also new: the camera pulls in when a wall is behind you
(`camera-boom.ts`), Hyper Breakout and best scores in the save (`breakout.ts`), weather on the flat
stage. Guides: `docs/WORLD.md`, `docs/PLAY.md`.

Next from the roadmap: the AVBD solver core (boxes that tumble, stacks, ragdolls; jelly and
inflatables on it), builder agents for arcade games, smoke rings, the town economy. Smaller
follow-ups:
- Feel all of the new movement on the owner's phone and PC (only checked in a software-GL browser at
  1-2 fps): vault and climb thresholds (`PARKOUR`, `PRESS_CLIMB`), rope pumping (`SWING_PUMP`), the
  camera boom's ease-out (`BOOM.outRate`), ACCEL, FLY and the camera lag in pilot.tsx.
- Hear the townsfolk talk (device speech) and try them with the resident model loaded; check the
  lip sync against the voice.
- Check the frame rate on the phone with fire, a cape, flags and 24 townsfolk (Stats overlay); fire
  and cloth have no rung of their own yet.
- Ask the resident model to rewrite a person's plan every few minutes, batched (town.ts `planDay`).
- Check rung "11" (PostFX.tsx) with the Stats overlay on the phone; it may run at 30-45 fps.
- `live-visit.test.ts` "two players beside one island" can fail under heavy load (timing); it
  passes alone.

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

- **Engine room:** the device's stats as machines in the lab (`gauges.ts`, `Gauges.tsx`, guide
  `docs/GAUGES.md`). Nine machines (gearbox, smokestack and bar meter are new) and a picker in Stats
  (`GaugePicker.tsx`) for skin and machine, all gauges or the selected one. Next: check the readings on
  the owner's phone with the Stats overlay's Copy report; brass reads dark on the low rungs (no
  environment map), so a light rig or env map for the metals would help.

- **Diagnostics:** the phone sends reports as GitHub issues labelled `diagnostics` (`docs/DIAGNOSTICS.md`).
  Start a session with `npm run forge:diagnostics` (or read the issues), fix what they show, close them.
  A daily scheduled check does the same at 5:53 AM Eastern and opens one PR.
- **Rotation:** ⟳ button (Auto / Portrait / Landscape), field of view per screen shape (`view.ts`), sideways
  fills the screen. Next: check on the phone that a turn keeps the TV player and the model loaded.

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


## Walking, physics, arcade (docs/PLAY.md)
- Done: the avatar is a jointed figure with idle, walk, run, jump, fall, landing and flight poses
  (Avatar.tsx); the body walks with gravity and collisions (physics.ts stepWalk), jumps, flies (F);
  loose objects fall, bounce, slide, stack, roll, knock and get shoved, all the time (Settle in
  Viewport.tsx); games you build are played by walking up and pressing Play (arcade.ts, Arcade.tsx).
- Moves (motion.ts, Moves.tsx, Avatar.tsx): make moves from words or keyframes (after GENMO), layer
  them over the live gait by joint mask, feet planted on the real ground by two-bone IK, head looks
  at what you look at (after MaskedMimic). Next: record a move from the phone camera (pose estimation,
  the "video" input GENMO takes); hands that reach for things (pick up, press the arcade buttons);
  carry your moves through portals like mechanics; a small learned motion model behind the same Pose
  shape, off the main thread, with the code generator as the fallback.
- Next: more games in `GAMES` (snake and pong fit the same entry as Hyper Breakout, a screen game);
  boxes that tumble (only balls turn today);
  foot placement on slopes; on islands you visit, the host's walk does not yet use
  physics (prediction.ts walks flat); check the feel on the owner's phone.

## Graphics, next steps (after the texture fix)
- Bloom on the full tier only (`@react-three/postprocessing`): the lamp posts, circuit traces, night
  stars and the TV glow would bloom. Check the cost with the Stats overlay on a phone first; the auto
  quality ladder would need a rung for it.
- Ambient occlusion (N8AO) for contact shadows under exhibits, full tier only.
- Triplanar mapping for the lab packs, so every face of a stretched solid tiles at true scale (today
  each solid repeats by its largest side and its height, so a long box's ends are approximate).
- A skinned avatar: the jointed figure (Avatar.tsx) could become a skinned low-poly mesh on the same joints.
- Water with real reflections (a planar mirror) on the full tier.
- Use the Stats overlay's Copy report from the phone to set the tier thresholds from real numbers.
