# Forge as a universal recompiler

The goal: take a program built for one machine and run it natively on another (your phone, a PC, the
browser) by replacing its machine, not imitating it. AnyPS5 does this for one console, whose CPU
already matches a PC's. Forge aims at the general case.

Every program depends on four layers. Forge replaces each one:

| Layer | What gets replaced | Forge today |
| --- | --- | --- |
| 1. CPU | Machine code, recompiled for the device's chip | x86-64 and ARM64 → one IR → WebAssembly (`src/engine/guest/`), native through wasmtime on desktop and Android. Whole programs translate ahead of time and are cached (`aot.ts`, `forge run --aot`). |
| 2. Platform | The operating system's calls and system libraries | Linux system calls for static programs (files, mmap, threads, pipes, links). |
| 3. Graphics | GPU shader code and drawing commands → Vulkan / WebGPU | Not started. |
| 4. The picture | What reaches the screen | FSR 1-style upscaling in Forge's own renderer (`Upscaler.tsx`). Applies to any program once layer 3 exists. |

Layer 4 is the advantage of owning the stack: every program's picture passes through Forge, so
upscaling, frame generation and later effects work for all of them without the program knowing.

## Plan, in order

1. **Ahead-of-time recompile with a cache. Done for the command line.** `compileAhead` lifts the
   whole program before it runs: the entry point, code pointers in data, x86 switch tables, glibc's
   IRELATIVE resolvers, and code addresses computed in code (`lea [rip+…]`, ARM `adrp`+`add`),
   repeated until nothing new turns up, then lowers it once. `forge run --aot` caches the result in
   `~/.forge/aot`, keyed by the program's SHA-256. Every test program ran with nothing lifted at run
   time; sqlite went from 14.9 s to 1.5 s, zlib from 2.7 s to 0.5 s. The runtime fallback stays for
   anything the static pass misses. Next: the same cache in the app (IndexedDB in the browser, app
   storage on Android and desktop), and handing cached modules to wasmtime in the native host.
2. **Pluggable platforms.** A platform is a loader (ELF, PE, console formats), a table of system and
   library calls, and a graphics translator. Linux becomes the first one, refactored behind that
   interface.
3. **Library calls as tested skills.** Forge's run report already lists every call a program needed
   that is not implemented. Each missing call becomes a small task; an AI session writes it, and it is
   accepted only once its fixtures pass (the same rule as `skills.ts`). The diagnostics loop
   (`docs/DIAGNOSTICS.md`) brings failures from the phone back to the build session.
4. **Graphics.** First Linux programs that draw with OpenGL ES / Vulkan, translated to WebGPU and
   three.js targets; console GPUs after that.
5. **The picture.** Temporal upscaling once Forge sees depth buffers (layer 3), then frame generation
   from finished frames, with menus and text kept out of it.
6. **More CPUs.** Each is a decoder into the same IR, tested against real hardware: MIPS (N64, PS1,
   PS2), PowerPC (GameCube, Wii, Xbox 360), 32-bit ARM / Thumb (GBA, DS, older phones), SH-4
   (Dreamcast), RISC-V, 32-bit x86.
7. **A second platform.** Start with console homebrew, which is free to use and needs no keys.

## Limits

- Code that writes code while it runs (JIT engines: browsers, Java, emulators), packed or obfuscated
  programs, anti-cheat and DRM do not recompile statically; the runtime fallback or nothing.
- A phone is not a PS5: x86 → ARM translation plus a smaller GPU and memory budget rule out big console
  games. Indie and older titles are realistic.
- Only software you own. Library replacements are written from scratch (never copied from the
  original), and Forge never ships keys, firmware or BIOS files.
