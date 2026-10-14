# Pick up here

State at the end of the last session (branch `ccr-35d6a362-2y91j1`; all work is committed and pushed, CI green).
History and details: `PATCH_NOTES.md` (last three sections). Roadmap with status per item: `docs/handoff.html`, section 3.

## Where things stand

- **Android:** `.github/workflows/android.yml` builds an arm64 APK (for phones) and an x86_64 APK, launches the
  x86_64 one on an emulator (`.github/scripts/android-smoke.sh`), and only then may publish a Release (on a `v*` tag).
  No signing secrets are set, so each build uses a one-off key. The owner accepts this for now.
- **Release v0.6.0 is not published.** Pushing the tag from a session was blocked as a production deploy. Either the
  owner creates the release on GitHub (tag `v0.6.0`, target this branch) or allows the push.
- **Desktop:** `.github/workflows/desktop.yml` builds installers for Linux x86-64/ARM64 (opened on a virtual display,
  screenshots kept), Windows and macOS (not opened). Not code-signed. Guide: `docs/DESKTOP.md`.
- **Linux programs:** static x86-64 and ARM64 programs, glibc included, match real hardware on every engine.
  `.github/workflows/arm-oracle.yml` is the ARM64 hardware oracle (builds `fixtures/linux/*.c` natively, records output,
  compares Forge). Guest files (N7): files, directories, dup/fcntl, pipes.

## Next, most important first

1. Code-sign the installers (needs the owner's certificates as secrets), and open the Windows/macOS builds in CI if possible.
2. Rest of N7: file-backed `mmap`, `rename`/`renameat2`, then poll/select. Hardware-check each with a fixture.
3. Adjacency (work item 9) and replication over a real transport with client-side prediction (13).
4. Portal test between two real machines (item 4): needs the owner's devices on one network.
5. N8 (packed SSE float, AVX) and ARM ld2/ld3/ld4 when a real program needs them.

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
