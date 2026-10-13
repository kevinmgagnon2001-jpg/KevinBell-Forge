# Fix pass

## Why movement and rendering fell apart
1. `RoomPicture` (src/components/forge/picture.tsx) painted a 2D copy of the scene over the real 3D canvas
   every frame, at CSS-pixel size (blurry on phones), and swapped in flat boxes whenever a 4-pixel
   brightness check failed. It is now off. Add `?soft=1` to the URL to bring it back for debugging.
2. Canvas was set to no antialiasing, 1.5x cap, default GPU. Settings now come from a hardware probe
   (src/engine/hardware.ts): high 2x/AA/high-performance, mid 1.5x/AA, low 1x, none -> flat stage.
3. Third person A/D turned into strafing. Restored: third person A/D turn the body, first person
   A/D strafe and drag looks. Dpad labels follow.
4. Pilot ignored turns made by forge commands ("Turn left"). The 0.35 rad resync is back.
5. A saved world without an avatar (or with a NaN position) left the pilot with nothing to follow:
   no avatar in third person, no camera in first. `ensureAvatar` now recreates/heals it on load,
   on "Find room", and in the pilot loop.

## New engine pieces
- src/engine/hardware.ts  probe + tier + quality. 
- src/engine/ingest.ts    identify any file by magic bytes and say how the engine can use it
  (wasm validates and lists imports/exports without running; gguf, glb, images, scripts, archives,
  native binaries -> emulator route). It identifies only. Nothing is executed.
- src/engine/ingest.test.ts
- src/engine/wasm-backend.ts  third backend for the compat IR (isa.ts): the same IR that lowers to x86-64 and
  AArch64 now lowers to WebAssembly, which runs on both and in the browser. Tested against the reference
  stepper on 300 random programs, 32-bit wraparound included.

## Not done
- The compat IR is still four ops (mov, add, sub, ret) on four registers. Real programs need loads/stores,
  branches, calls, flags and a syscall layer before anything ordinary runs.
- No UI hook for ingest yet (call `ingestFile(file)` from a drop target).
- No emulator layer for native (ELF/PE/Mach-O) programs.
- WebGPU is detected but the renderer is still WebGL.

## Islands, portals and the desktop host (third pass)
- src/engine/island.ts          signed island identity (Ed25519), forge:// addresses, manifest, portal handshake
- scripts/island-node.ts        a runnable self-hosted node. Stop it and the island leaves the network.
                                node --experimental-strip-types scripts/island-node.ts --name "My Island" --slug my-island --port 7420
- src/engine/portal-client.ts   visitor side; reports offline hosts
- src/engine/native-host.ts     runs translated code in the desktop host when present, in-page otherwise
- src-tauri/                    Tauri 2 shell + wasmtime sandbox (no imports, fuel limit). Written with Rust
                                tests but NOT compiled yet: crates.io was blocked in the build environment.
- Tests: node --experimental-strip-types --test src/engine/*.test.ts  (62 pass)
- Full mission, spec and handoff: Forge-Handoff.pdf

## One Forge across devices (fourth pass)
- src/engine/device-link.ts   owner identity signs device certificates (roles: host, compute, display, input),
                              six-digit pairing codes, owner-signed revocation lists, and pickHost() to move hosting
                              to the strongest online device. Transport and state streaming are not built yet.
- Tests: 66 pass.

## Multiplayer replication and huge islands (fifth pass)
- src/engine/replication.ts   host-authoritative replication: per-visitor visibility (view cone, range, near radius),
                              detail level by on-screen size and device tier, byte budget (proxies first, then sharpen
                              the most important), enter/update/leave deltas, zone split across the owner's machines,
                              and ghost copies at zone borders. Not yet wired to a transport or the renderer.
- Tests: 72 pass.

## Linux programs, skills, scripts, island content, pooled inference (sixth pass)
Everything below is tested in `npm run test:engine` (98 tests; 72 from earlier passes still pass).

- src/engine/guest/            The compat layer, rebuilt for real programs.
  - ir.ts                      64-bit guest IR: mov/alu (add sub and or xor shifts ror mul mulh div rem), extends, lea,
                               loads/stores 1-8 bytes, flags (Z S C O + K for ARM carry), set/csel/ccmp, branches,
                               cbz/tbz, direct and indirect jumps, syscall, guards. Unknown bytes stay gaps.
  - x86.ts / arm.ts            Decoders for the integer core compilers emit (-mgeneral-regs-only): x86-64 incl. ModRM/SIB,
                               RIP-relative, push/pop/call/ret, mul/div, setcc/cmov, rep movs/stos; AArch64 incl.
                               logical immediates, bitfield moves, ldp/stp, pre/post-index, literals, ccmp, tbz.
  - lift.ts                    Recursive lifting from the entry point; indirect targets are lifted lazily at run time.
  - machine.ts                 Reference interpreter (BigInt, exact).
  - wasm.ts                    Lowering to ONE import-free WebAssembly module per program: br_table dispatch, fuel,
                               bounds-checked memory, null page, refuses stores into translated code. Resumable:
                               it returns to the host on each system call, then continues.
  - elf.ts / linux.ts          Static ELF64 loader and a small Linux shim (write, writev, read, brk, anonymous mmap,
                               exit, uname, ...). Everything else answers -ENOSYS and is listed in the report.
  - linux-worker.ts / linux-client.ts  Runs programs off the main thread in the page.
- Ground truth is the real CPU:
  - fixtures/linux/            A C program built by gcc and clang for x86-64 and AArch64 at -O0..-O3 (8 binaries) plus
                               hand-written assembly. All match the x86-64 binary's output on real hardware, through both
                               the interpreter and WebAssembly. Rebuild: sh fixtures/linux/build.sh
  - fixtures/compat-corpus.json  150 random programs, each written as x86-64 AND AArch64 assembly, assembled by the real
                               toolchains; expected output from running the x86-64 build on hardware. 4 ways each must
                               agree. (A further 500 were run while building this pass; all agreed. Regenerate with
                               scripts/gen-compat-corpus.ts <count> <seed>.) The corpus caught one real bug in the
                               reference interpreter (shift counts on huge BigInts) on its first run.
  - scripts/forge-run.ts       CLI: run any static Linux program through Forge and see the report.
- src/engine/skills.ts + bounded.ts   Skill registry (work item 7). A skill = name, JSON-schema args, implementation
                               (import-free wasm, or a static Linux program for either architecture), fixtures. Installed
                               only after every fixture passes here; re-verified by hash on load; versions only move up.
                               Router: a picker (small model or the built-in lexical one) only chooses a skill and fills
                               args; args are schema-checked before anything runs. Runaway wasm is killed in a worker.
- src/engine/script-gate.ts    Safe-compile gate (work item 8), on the TypeScript compiler API: parse, optional type-check,
                               deny network/storage/compute unless granted, always deny eval/Function/globalThis/
                               prototype walking/dynamic import/Reflect, rewrite every computed key through a runtime guard,
                               transpile. Rejections carry line, column and reason.
- src/engine/island-content.ts Island content transfer and live sync (work items 5, part of 13): the signed manifest now
                               carries the world's SHA-256; visitors verify it before showing anything. /island/sync runs
                               replication.ts per visitor (view cone, budget, deltas) and shows visitors to each other as
                               host-owned presence markers. Portals are entities; `portalAt` says which one you stand in.
- src/engine/portal-tool.ts    "open a portal to forge://host:port/slug" places a portal (no model needed).
- src/engine/pooled.ts + scripts/compute-node.ts   Pooled inference (work item 16): layer split by memory and speed,
                               activations over HTTP between processes, identical output to a single machine, clean
                               failure with numbers when a device leaves, re-plan when one joins. Toy model; swap in a
                               real per-layer runtime later.
- UI (src/components/forge/Bridge.tsx): drop any file on the window to ingest it (Linux programs run, scripts are gated,
  wasm is listed); walking into a portal visits the island and places it, read-only, beside yours. Portal and visitor
  meshes added to Viewport. Pilot and camera code untouched. NOT hand-tested in a browser: this build environment could
  not install npm packages. Type-checked and bundled with esbuild against the engine.

## Still not done
- The Rust desktop host is still uncompiled (crates.io unreachable here too). It does not yet run guest programs natively;
  the page-side WebAssembly path is used everywhere.
- x86: SSE/AVX, x87, VEX (BMI), adc/sbb, rotates, 8-bit mul/div, string ops other than movs/stos, TLS (fs:). ARM: SIMD/FP,
  atomics/exclusives, system registers. glibc static binaries need TLS; musl or freestanding programs are the target today.
- Client-side prediction, adjacency (item 9), zones across machines over a real transport, local mesh, device shell levels.

## Desktop runner, glibc, isolated scripts, executables (seventh pass)
Tests: `npm run test:engine` (107 pass) and `rustc --edition 2021 --test src-tauri/src/guest.rs` (6 pass).

- N1, native runner (src-tauri/src/guest.rs, lib.rs `native_guest`): the Linux system-call shim and run loop in Rust,
  std-only and unit-tested here; wasmtime glue plus Tauri commands guest_start / guest_resume / guest_swap / guest_end.
  The page lifts and lowers; Rust runs the import-free module, answers system calls, hands out fuel in slices, and
  returns "needs-code" so the page lifts more and swaps the module (memory and CPU state kept). Page side:
  `runLinuxHosted` (native-host.ts), tested against a stand-in that follows the same protocol. The wasmtime glue was
  borrow-checked against API stubs; it is still not compiled against the real crate (no crates.io here).
- N2, glibc (x86-64): fs: thread-local storage (arch_prctl), cpuid (an honest baseline-x86-64 CPU), SSE2 integer
  and data movement (via WebAssembly SIMD), scalar SSE floating point with x86 NaN rules, parity, adc/sbb, rotates,
  shld/shrd, bt/bts/btr/btc, bsf/bsr/tzcnt/lzcnt, cmpxchg/xadd, bswap, ah/bh/ch/dh, 128-by-64 division, the
  carry/overflow flags of shifts, rotates and multiplies, rdssp/fnstcw/fldcw. Statically linked glibc programs
  (printf, malloc, qsort, strings, floating point) now print exactly what the CPU prints.
  - fixtures/x86-corpus.json: 300 random x86 programs over all of the above, the CPU as the oracle, 2 engines each.
    About 2,400 more were run while building this pass; all agree.
  - Execution is now tiered like a JIT: interpreter first, WebAssembly once a program runs long; newly found code runs
    in the interpreter until discovery settles. Code pointers and switch tables are found up front. Large programs are
    lowered as one function per 16 KiB of code (V8 and wasmtime compile them quickly).
- N3, scripts: src/engine/script-runtime.ts runs a gated script in its own worker: network, storage, workers, eval
  and the Function constructors are removed, shared prototypes frozen, and the script talks to the world only through
  `forge.*` messages the host answers. Time-limited. Dropping a .ts/.js file on the window now runs it this way.
- Executables:
  - `forge` command line: scripts/forge-cli.ts, bundled by scripts/build-cli.mjs into dist/forge.mjs (bin/forge,
    bin\forge.cmd). Commands: run, info, gate, script, island, compute, version.
  - Single-file Linux binary with Node inside, built offline: scripts/sea-inject.mjs (adds the SEA blob as an ELF
    note, no npm needed). macOS/Windows: scripts/make-sea.sh (uses npx postject).
  - Desktop app: `npm run desktop:build` (tauri build) with `vite build --mode desktop` (a static single-page build,
    copied to src-tauri/frontend by scripts/desktop-dist.mjs). App icons added. Not built here (needs crates and npm).
- scripts/offline-bundle.sh: the correct offline path (cargo vendor + npm cache), replacing the suggestion that would
  have overwritten package.json and Cargo.toml.

## Still not done
- ARM glibc (NEON, tpidr_el0, atomics); x87 arithmetic; AVX; packed float SSE; files, threads, signals in the shim.
- The desktop app and wasmtime glue have never been compiled; the desktop single-page build has never been run.

## Android from GitHub (eighth pass)
- .github/workflows/android.yml: on a `v*` tag, GitHub builds a signed 64-bit ARM APK
  (Tauri 2 Android: `tauri android init` in CI, icons, `tauri android build --apk`, zipalign +
  apksigner) and attaches `Forge-<version>-android.apk` to the Release. The app version comes from
  the tag. "Run workflow" by hand makes a test APK without a release.
- Signing comes from repository secrets (ANDROID_KEYSTORE_BASE64 / _PASSWORD / ANDROID_KEY_ALIAS) so
  releases install as updates; without them a one-off key is used and the run warns.
- Release builds may use plain http:// (islands and compute devices on the local network).
- `src-tauri/gen/` is generated and ignored; keystores are ignored.
- npm scripts android:init / android:dev / android:build for local builds.
- docs/ANDROID.md: how to get it on a phone, signing, known gaps.
- Not yet run: the Android compile itself (no SDK or crates in the build sandbox). YAML, shell steps
  and the signing round-trip were checked offline.

## Refinement pass (ninth pass)
- The 3D world was never drawn. The gaze raycaster in Viewport.tsx registered `useFrame(..., 1)`; in
  react-three-fiber any positive priority means "this hook renders the frame itself", so automatic rendering
  stopped and the canvas stayed blank on every device (the frame loop ran, `gl.render` never did). It now uses
  the default priority. Checked in a browser: about 25 draw calls a frame, the lab, exhibits and avatar on
  screen, and W+A turns the body left, W+D right.
- package-lock.json is back in sync with package.json (@tauri-apps/cli and esbuild were missing), so the
  Android workflow now installs with `npm ci`.
- The Android build has completed on GitHub (Actions run #5); docs/ANDROID.md no longer says it never ran.
  `npm run build:desktop` (the desktop and Android web build) also runs cleanly.
- Lint errors fixed (0 errors): `const` where nothing reassigns, an expression-statement push/splice in the
  x86 movss/movsd decoder replaced by the equivalent single push, unused constants and the unused
  `ManifoldShell` component removed.
- Phone layout (<= 600px): the view is taller (64dvh); the second readout line that sat on top of the HUD is
  hidden; the texture arc is scaled to 78% so it clears the view buttons and the look pad; Find room sits above
  the look pad instead of squeezing the move row; toolbar and quick-intent buttons keep their labels on one line.
- Selection and gaze outlines draw the box's 12 edges instead of a wireframe, so flat panels (the terminal
  screen) no longer show a diagonal seam. The manifold banner sits below the HUD readout instead of over it.
- Desktop: the controls hint moved to the left, above the move keys, so it no longer covers the texture arc.

## Desktop host compiled, files for guests (tenth pass)
- The desktop host (src-tauri) compiled for the first time on a desktop target: Tauri 2.12 and wasmtime
  49.0.2, no warnings. wasmtime is pinned to 49 and src-tauri/Cargo.lock is committed. Dependencies are
  optimised in dev builds (`[profile.dev.package."*"]`), since unoptimised wasmtime made `desktop:dev` crawl.
- N1 acceptance: scripts/native-guest.test.ts (`npm run test:native`) runs the page's own protocol code
  (runLinuxHosted) against the real Rust guest runner and real wasmtime, through a small stdin/stdout
  bridge (src-tauri/examples/guest_bridge.rs). hello, all 8 workload builds (gcc and clang, x86-64 and
  AArch64), the glibc fixtures and the new file fixtures print exactly what the CPU prints.
- Native compile speed. wasmtime compiles ahead of time, and Cranelift slowed sharply on the 16 KiB-per-function
  modules (a static glibc program: 34 functions up to 400 KB, about 28 s per compile, re-done on every swap).
  Now: the desktop path lowers 1 KiB of guest code per function (about 6 s for the first compile), and the
  guest engine keeps an incremental compilation cache. Chunk functions are byte-identical when their code did
  not change (chunks aligned to absolute addresses; the store-into-code range moved from constants in every
  function to the CPU-state page at codeLo/codeHi), so a swap recompiles only what changed: about 1.5 s
  instead of 6.5 s. The browser keeps 16 KiB functions (V8 compiles lazily).
- N7, files for guests: a capability-scoped, in-memory file tree per program (LinuxOptions.files; the tree as
  the program left it comes back as report.files). open/openat, close, read/write on files, lseek,
  fstat/newfstatat (both struct stat layouts), access/faccessat, unlink/unlinkat. Relative paths resolve
  against "/", ".." stops at the root, nothing outside the tree can be named. Limits: 64 MB, 4096 files,
  256 descriptors. TypeScript (src/engine/guest/files.ts) and Rust (guest.rs, mod files) implement the same
  rules; the desktop host takes the tree in guest_start and returns it when the program finishes.
  - Fixtures checked against the real CPU, files left behind included: fixtures/linux/files.c (raw system
    calls, x86-64 and AArch64) and libc-files.c (glibc stdio: fopen, fgets, fprintf, fseek, ftell, fscanf,
    remove). Rebuild with fixtures/linux/build.sh.
  - Standard streams are unchanged (fstat on 0-2 still answers ENOENT, so libc buffers as before).
  - The Rust table now knows rseq (ENOSYS, as the page does) instead of listing it as unsupported.
- The desktop window opens (x86-64 Linux, on a virtual display) and shows the world. In it, the local model
  failed at once with "No supported storage backend found": wllama keeps weights in the Origin Private File
  System, which the desktop WebView does not offer. src/engine/model-cache.ts keeps wllama's storage where it
  exists and otherwise holds the weights in memory for the session (they download again next launch).
- CI: .github/workflows/checks.yml runs lint, typecheck, engine tests and the web build, plus the desktop
  host's cargo tests and the native guest tests, on every push.
- Tests: 113 engine tests, 9 Rust tests, 4 native guest tests.

## Still not done
- The window was opened on x86-64 Linux only (not ARM, not macOS/Windows), and no installer has been built yet (work item 3).
- Model weights in the desktop app live in memory only; a Tauri-side file store would keep them across launches.
- Tauri's IPC sends modules as JSON number arrays (about 18 MB per swap for a glibc program); a binary channel
  would cut that.
- Directories cannot be listed (getdents) and files cannot be mapped (file-backed mmap); dup, pipes and
  rename are not there yet.
