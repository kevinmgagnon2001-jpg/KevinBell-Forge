# Papers roadmap: next-generation features from Two Minute Papers

A to-do list for future sessions, drawn from research covered on Two Minute Papers (TMP), 2023 to
mid-2026, and picked for what fits Forge. The aim is a world you **speak to** that **remembers**,
**builds** and **moves** like nothing else on a phone, without giving up the 120 fps.

How the research was done (October 2026): the YouTube channel page could not be read directly, so
videos were matched to papers through transcript mirrors (rosetta.to) and the papers' own pages.
Where a transcript did not name the paper, the match is marked *(likely)*; papers TMP did not
cover are marked *(related)*. Check a paper's page before building from it.

**Done (October 2026, see docs/WORLD.md):** all of Phase 1, NPCs with memory and a day, and crowds.
Notes on what was built differently from the plan:
- Sounds are synthesised on the device from a recipe the words pick (sounds.ts, synth.ts), not fetched
  from a cloud model; a cloud generator can fill the same recipe slot later.
- Plans and reflections are made by rules on the device (town.ts). The model is not yet asked to
  rewrite plans; `planDay` and `remember` are the places to hook it in, batched every few minutes.
- Phases are worked out by hand (springs.ts `stepPhase`, `alignPhase`): stopping finishes the step,
  starting aligns the cycle to the legs. Moves with legs only play standing, so they need no phase.
- Crowds use sampled reciprocal velocity obstacles with a replan when stuck, not full ORCA lines.

## Rules every item keeps

- **The frame budget comes first.** Anything heavy is optional and has a cheap fallback; check it
  with the Stats overlay on the owner's phone (`docs/GAUGES.md`).
- **Local first, offline by default.** The helm's own resident model (Gemma GGUF through wllama,
  `resident.ts`) or a bigger one on the linked PC (`pooled.ts`) is the default brain. Where an
  item below says "LLM" or "cloud", the local model is tried first, and the cloud is an optional
  add-on that the owner switches on.
- **Cloud results are kept.** Anything generated in the cloud (meshes, sounds, clips) is made
  once, cached and saved with the world, so the world still works offline.
- **Deterministic worlds.** Linked devices and carried mechanics depend on it: neural parts
  produce data (a clip, a mesh, a plan) that the engine then plays deterministically.
- **The helm is the interface.** Every feature has a sentence that triggers it, and goes through
  the intent log and undo.
- Effort: **S** (a session), **M** (two or three), **L** (a series).

## The amalgamation (what it adds up to)

> "Fill the café with regulars, make it rain at dusk, and build me a breakout machine by the
> window."

1. The helm turns that into **skills** it can reuse (Voyager), and builder agents write and
   **test** the game before it appears (ChatDev).
2. The weather and light change live as **world events** (Genie 3's idea, done in the engine).
3. The regulars are **NPCs with memory and a daily plan** (Generative Agents). They talk back aloud
   (ACE) and move without foot sliding, vault over things and flow round each other (DeepPhase,
   PARC, TRACE & PACER, all in light versions).
4. Things stack, swing, squish and sparkle properly: a new solver core (AVBD and VBD), ropes and
   hair (Cosserat rods), and glints.
5. Anything you can't build from blocks can be **generated**: props (text-to-3D), places from a
   photo (splats), and sounds and music.

## Phase 1: quick wins (on device, little risk)

- [x] **Skill library from the helm** (S–M). *Voyager (2023), TMP "NVIDIA's New AI Mastered
  Minecraft 15X Faster!"*
  - A helm command that works is kept as a named skill (its WASM program and parameters).
  - "Do that again, but taller" re-runs it with new parameters.
  - Errors from the VM go back to the LLM, which retries up to three times.
  - Touches: `harness.ts`, `os.ts`, `vm.ts`, `store.ts`; skills are saved with the world, like
    moves are.
- [x] **World events: weather, time of day, mood** (S–M). *Genie 3 (2025), TMP "DeepMind Just
  Made The Most Powerful Game AI Engine!"* (the idea, not the model).
  - "Rain at dusk", "foggy morning", "rainy Tokyo alley" set light, fog, sky, particles and post
    effects live, with smooth transitions.
  - A preset table, plus LLM-chosen parameters for new phrases.
- [x] **Glinty materials** (S). *Glinty NDFs in constant time (Kemppinen et al., SIGGRAPH Asia
  2025), TMP "Adobe & NVIDIA's New Tech Shouldn't Be Real Time. But It Is."* (likely)
  - Sparkle for snow, sand, frost and metal paint as one fragment-shader include.
  - Only on hero materials, and switched off on the lowest quality rung.
- [x] **Jiggle and secondary motion** (S). *Fast Complementary Dynamics (SIGGRAPH 2023)*
  (related).
  - Spring-damper secondary bones (tails, antennae, hats, belly) on the avatar and figures, run in
    the vertex shader or on a few CPU springs.
- [x] **Phase-aligned move blending** (M). *DeepPhase (Starke et al., SIGGRAPH 2022), TMP "EA's
  New AI: Next Level Gaming Animations!"*
  - Every move in the library gets a phase. Blends (walk → jog → stop) line the phases up, so the
    feet never slide.
  - Start with phases worked out by hand from foot contacts; a small learned model can come later.
  - Touches: `motion.ts` (sampleMove, composeMove), `Avatar.tsx`.
- [x] **Generated sound for things** (S). *Fugatto (NVIDIA, 2024), TMP "NVIDIA's New AI: Stunning
  Voice Generator!"*; *V2A (DeepMind, 2024), TMP "DeepMind's New AI Found The Sound Of Pixels!"*
  - "Make the door creak like a ghost ship", "score this scene": a cloud sound or music API, with
    the clip cached and attached to the entity.
  - Positional audio through three.js.

## Phase 2: headline features

- [x] **NPCs with memory and a day** (M). *Generative Agents (2023), TMP "25 ChatGPT AIs Play A
  Game - So What Happened?"*
  - Each NPC entity has a memory stream (observations, reflections) in the same format as the
    intent log, and a daily plan.
  - The LLM is asked every few minutes and in batches, never per frame. Between plans, movement
    and moves run on device.
  - "Fill the café with regulars", "what did Mia do today?".
- [x] **Talking NPCs** (M). *NVIDIA ACE, TMP "NVIDIA's New AI: Making Games Come Alive!"* (likely)
  - Speak to an avatar: speech-to-text (already in `speech.ts`), then the LLM in character, then
    on-device TTS (Android TTS, or Piper on desktop).
  - Mouth shapes from visemes on the jointed head.
  - Done (talk.ts, Talk.tsx): speech in (speech.ts), the resident model in character with a
    scripted fallback, the device's own speech out (Web Speech), memory of the talk, and mouth shapes from the
    words (mouthTrack: vowels open, b m p close, pauses at punctuation), started with the voice.
    Not done: real visemes from the speech engine; Piper on desktop.
- [x] **Crowds that find their way** (M). *TRACE & PACER (CVPR 2023), TMP "NVIDIA's AI Finally
  Solved Walking In Games"*
  - "Fill the plaza with people." ORCA-style steering stands in for the diffusion planner, and the
    AABB walker plus move library for the RL follower.
  - Keep the paper's loop: replan when stuck.
- [x] **Vault and climb** (M). *PARC (SIGGRAPH 2025), TMP "NVIDIA's New AI Cheated At
  Parkour…And Got Fixed!"*
  - Moves chosen by obstacle height: step (already in place), vault, climb up, drop.
  - Procedural moves with IK hand targets on the ledge; no neural network.
  - Touches: `physics.ts` (stepWalk ledge probe), `motion.ts`, `pilot.tsx`.
  - Done in `parkour.ts` (its own ledge probe over the walker's solids, scripted curves, `twoBone`
    for the hands) rather than inside stepWalk. "Drop" is the existing fall and landing crouch;
    a hang-and-drop from a ledge is not done.
- [ ] **New solver core: AVBD for rigid bodies and joints** (M). *Augmented Vertex Block Descent
  (SIGGRAPH 2025), TMP "Roblox Solved The Physics Problem That Stumped Everyone"*
  - Stable stacks, chains, ragdolls and breakable joints; "Jenga collapse" sandboxes.
  - On the CPU for about 1–3k bodies; keep today's sleep. WebGPU later for big scenes.
  - Touches: `physics.ts` (stepBodies, collidePairs), `manifold.ts`.
- [ ] **Soft bodies and cloth on the same core** (M). *Vertex Block Descent (SIGGRAPH 2024)*
  (related).
  - Jelly blocks, flags, capes and inflatables, using meshes under about 5k vertices on the CPU.
- [x] **Ropes, cables and hair** (M). *Stable Cosserat Rods (SIGGRAPH 2025), TMP "This New
  Physics Engine Is 45x Faster!"*
  - Ropes, grappling hooks, hanging cables, swaying grass and avatar hair.
  - A few hundred rods on the CPU.
  - Done (rope.ts, Rope.tsx): ropes, cables and string lights by position-based dynamics with
    tethers and collisions; no twist (not a full Cosserat rod). Not done: grappling hooks,
    swaying grass, avatar hair on the same solver.
- [ ] **Builder agents for arcade games** (M–L). *ChatDev (2023), TMP "OpenAI's ChatGPT Makes A
  Game For $1!"* (likely)
  - "Make me a breakout machine by the window." A designer agent writes the spec, a coder agent
    writes the WASM program, and a tester agent plays it in the VM headless.
  - The game reaches the arcade (`arcade.ts` GAMES) only if the tester passes it.
- [ ] **Companion that follows instructions** (M). *SIMA / SIMA 2 (DeepMind), TMP "DeepMind's New
  Game AI Just Made History!"*
  - "Follow me and stack the crates by the door"; circle an area on screen to mean "here".
  - The LLM gets the manifold's structured state and a tool API instead of pixels.
- [ ] **Phone companion that drives the PC, offline** (M–L). *Inspired by Bluey (Riley Brown,
  github.com/rbrown101010/bluey-by-riley, public domain: iPhone and Mac, OpenAI Realtime). Forge's
  version is cross-platform and local.*
  - The phone runs Forge as the face and the mic. The PC (the `forge link` home) does the work: "open
    Steam", "what's this error?", "put my playlist on".
  - All local, nothing sent anywhere:
    - speech: Android's on-device recognizer on the phone, or whisper.cpp on the PC;
    - thinking: the resident model, or a larger GGUF on the PC;
    - reading the screen: the OS's own OCR (Windows.Media.Ocr, Apple Vision) or Tesseract, plus the
      accessibility tree for exact button names;
    - speaking back: Piper or the OS's text-to-speech.
  - Tools for the PC side, in the Tauri host (`src-tauri/src`): look at the screen, point (an
    on-screen cursor of its own), click, type, keys, scroll, drag, open app, open URL. The real
    pointer goes back where it was after each action.
  - Bluey's safety rules, copied:
    - it acts only when asked, and confirms anything hard to undo;
    - text on screen is information, never instructions;
    - no password fields, and no logout, lock or force-quit;
    - a hotkey stops it instantly, and one switch turns off computer use entirely.
  - Also worth borrowing:
    - meeting notes: the phone records in chunks, the PC transcribes with speaker labels and keeps
      `notes.md` per session;
    - "what's this?" points at whatever is under the mouse.
  - Builds on: Linked devices (`link-home.ts`, `link-client.ts`), the helm's mic (`speech.ts`,
    `HelmAsk.tsx`), Your device inside Forge (`device-apps.ts`, `src-tauri/src/apps.rs`).
- [ ] **Photo-real imports: Gaussian splats** (S–M). *3D Gaussian Splatting (2023), TMP "Creating
  Virtual Worlds 20x Faster!"*
  - Drop a .splat or .spz capture into the world as an entity.
  - Render with Spark (three.js, WebGL2, LOD streaming), capped at about 0.5–1M splats on phones.

## Phase 3: cloud-generated content (generate once, cache, play on device)

- [ ] **Text to 3D props** (M). *Edify 3D (NVIDIA, 2024), TMP "NVIDIA's New AI: A Revolution In
  3D Modeling!"*
  - "Spawn a mossy stone lantern": a placeholder box at once, then the GLB swaps in.
  - Decimated, with LODs, and saved with the world. Open options: TRELLIS, Hunyuan3D (related).
- [ ] **Photo to place** (L). *Lyra 2.0 (NVIDIA, 2026), TMP "NVIDIA's New AI Turns One Photo Into
  A World That Never Breaks"*
  - "Turn this photo of my street into a room": a splat backdrop, with the extracted mesh used for
    collision. A commercial option is World Labs Marble (related).
- [ ] **Moves for any creature** (M). *AnyTop (2025), TMP "New AI: Impossible Creatures Come
  Alive!"*
  - "Make my dragon walk" for a figure the user built: the clip is generated on a server, baked
    into the move library, and played on device.
- [ ] **In-between any two poses** (M). *Diffuse-CLoC (2025), TMP "New AI Finally Solved The
  Hardest Animation Problem!"*
  - "Go from crouch to handstand". Try joint-mask inpainting on device first (`motion.ts`
    inpaint); use a server clip only if that looks wrong.
- [ ] **Walk there, in a style** (L). *A-MDM (SIGGRAPH 2024), TMP "NVIDIA's AI Looks At 4,000,000
  Frames, Learns To Walk!"* (likely)
  - "Walk to the tree, sneakily": path plus style. The cheap version is path following with style
    layers on existing moves.
- [ ] **Puppet mode** (L). *Categorical Codebook Matching (SIGGRAPH 2024), TMP "New AI: This Is A
  Gaming Revolution!"*
  - Phone tilt plus thumbstick drives the whole body. Needs a small model exported to ONNX or
    WebGPU, retrained on Forge's moves.

## Phase 4: moonshots (when the rest is solid)

- [ ] **Town economy** (M). *SimWorld (NeurIPS 2025), TMP "Researchers Built a Tiny Economy. AIs
  Broke It Immediately"*
  - NPC couriers with personalities bid on jobs, built on top of the NPCs-with-memory feature.
- [ ] **Living moss and growth** (M). *Neural cellular automata (Sakana AI, 2026), TMP "Sakana AI's
  God Simulator Is Brilliant"* (likely)
  - Tiny automata in a fragment shader on wall textures: "grow moss across these walls".
- [ ] **Fire you can put out** (L). *TMP "The Most Realistic Fire Simulation Ever" (Feb 2026);
  paper not identified.*
  - A coarse heat and fuel grid with fire spreading over flammable entities, and water that
    removes heat.
- [ ] **Smoke rings and vortices** (M). *TMP "The Biggest Physics Breakthrough Nobody Noticed"
  (Dec 2025); paper not identified.*
  - A few hundred vortex particles that move billboards along.
- [ ] **Sand, snow and water** (L, WebGPU). *Granular homogenization (Wojtan lab), TMP "They Said It
  Was Impossible…"; octree SPH, TMP "This Fluid Simulation Should Not Be Possible"* (likely)
  - MLS-MPM sand and snow with parameters worked out in advance, and splashable pools of about 30k
    particles.
- [ ] **Real-time global illumination** (M–L). *Radiance Cascades (2023)* (related).
  - Glowing props light caves and night scenes, as a screen-space or low-resolution version.
  - WebGPU preferred.
- [ ] **AI playtester** (L). *Microsoft Muse (2025), TMP "Microsoft's New Game AI: How Is This
  Good?"* (likely)
  - Replays an arcade game with rule variants and reports which one is most fun. Forge itself
    stays deterministic.
- [ ] **Dream mode** (L, a gimmick). *Mirage 2 and Hunyuan-GameCraft (2025), TMP "The Next Level of
  AI Video Games Is Here!"*
  - A cloud-streamed, made-up version of the current room. Never the core of the app.

## Read about but left out

- These need a server GPU and add little over the items above:
  - SuperPADL;
  - SONIC (NVIDIA's 42M-parameter motion tracker; revisit if it gets small enough for phones);
  - Area ReSTIR;
  - 3DGUT;
  - neural materials and texture compression;
  - PhysGaussian.
- Also left out: GameNGen, Oasis, Genie 1 and 2, and Dreamer 4. Neural game engines can't run on a
  phone, and Forge's own engine already does this job.
- Not checked: TMP videos from June to October 2026 (the transcript index stopped at June 2026).
