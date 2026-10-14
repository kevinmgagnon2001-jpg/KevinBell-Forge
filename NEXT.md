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
- **Desktop:** `.github/workflows/desktop.yml` builds installers for Linux x86-64/ARM64 (opened on a virtual display,
  screenshots kept), Windows and macOS (not opened). Not code-signed. Guide: `docs/DESKTOP.md`.
- **Linux programs:** static x86-64 and ARM64 programs, glibc included, match real hardware on every engine.
  `.github/workflows/arm-oracle.yml` is the ARM64 hardware oracle (builds `fixtures/linux/*.c` natively, records output,
  compares Forge). Guest files (N7): files, directories, dup/fcntl, pipes, file-backed mmap (shared mappings kept
  coherent with read/write at every system call), msync, ftruncate/truncate, pread/pwrite, rename/renameat2,
  poll/select, symbolic and hard links, threads (clone, futex; one at a time, switched at system calls). Fixtures: `mapio.c`, `links.c` (raw system calls, both architectures),
  `libc-mapio.c`, `libc-links.c` (glibc).

## Next, most important first

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
