# KevinBell-Forge

Forge is a 3D engine you host yourself. It runs worlds in the browser, as a desktop app or as an Android app, and links them together through portals. It also runs ordinary Linux programs built for x86-64 or ARM64 by translating them to WebAssembly, so the same program runs on any chip.

## Get it on Android

Open **[Releases](../../releases)** on your phone and tap the newest `Forge-…-android.apk`. Android asks once whether your browser may install apps; allow it. See [docs/ANDROID.md](docs/ANDROID.md).

## Run it from source

```sh
npm install
npm run dev              # the web app at http://localhost:8080
npm run test:engine      # engine tests (hardware-checked x86 and ARM translation, sandbox, islands)
npm run lint && npm run typecheck
npm run cli:build        # the `forge` command-line tool -> bin/forge
```

| Command | What it does |
| --- | --- |
| `forge run <program>` | run a static Linux x86-64 or ARM64 program |
| `forge info <file>` | identify a file and say how Forge would use it |
| `forge gate <script.ts>` / `forge script <script.ts>` | check or run a script in the sandbox |
| `forge island` | host an island on this machine |
| `forge compute` | offer this machine for pooled AI inference |

## Where things are

- `src/engine/guest/`: the x86-64 and AArch64 translators, the WebAssembly back end and the Linux system-call layer
- `src/engine/`: the skill registry, script sandbox, islands and portals, pooled inference and file intake
- `src-tauri/`: the native desktop and Android host (Rust, wasmtime)
- `.github/workflows/android.yml`: builds and publishes the Android APK
- `PATCH_NOTES.md` and `Forge-Handoff.pdf`: history and the roadmap
