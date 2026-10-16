# A world that remembers, builds and moves

Everything here is said to the helm (typed or spoken) and runs at once, with no model needed. Each
goes through the log and undo like any change, is saved with the world and shared with your linked
devices. Nothing is downloaded or sent anywhere.

## Weather, time of day, mood

"Make it rain at dusk", "foggy morning", "snow at midnight", "storm", "clear skies", "set the time to
7pm", "rainy tokyo alley", "eerie fog", "stop the rain", "back to normal weather", "speed up time".

- The sky, sun, moon and stars, fog, lights, clouds, rain, snow and lightning all follow, easing from
  one sky to the next. Rain wets the plaza; snow sparkles on it; the lamps come on at night.
- A whole scene ("foggy morning") starts fresh; a part ("add some fog", "at 7pm") changes only that.
- Moods: neon, eerie, cozy, dreamy, cold, apocalyptic.
- A model can set the numbers itself for phrases the table does not know: `set_weather` takes hour,
  cloud, rain, snow, fog, wind, storm, mood and flow.
- Code: `src/engine/weather.ts`, `src/components/forge/Scenery.tsx`.

## Skills

- Every change that works is remembered. "Do that again, but taller", "another one, red, to the
  left", "again 3 times" re-runs it with tweaks (taller, shorter, bigger, smaller, wider, thinner, a
  colour, a side, higher, a count). Copies go to the next free spot, not on top of each other.
- "Remember that as lamp", "save the last 3 things as campfire" keeps them as a skill. "Campfire",
  "build a campfire to the left, but bigger" builds it in front of you. "What skills do you know?"
- A model can call a skill by name like a tool. When a model's call fails, it gets the error back and
  tries again, three tries in all.
- Code: `src/engine/skillbook.ts`.

## Sounds and sparkle

- "Make Clay creak like a ghost ship", "give the orb a deep hum", "make the lamp chime", "silence
  Clay". 19 kinds of sound, shaped by words (ghostly, deep, high, loud, quiet, slow, fast, keep
  looping). Loops play while you are near; one-shots when you walk up or tap the thing. Sound is 3D.
- "Score this scene", "play some sad music", "stop the music": a looping score made from the words.
- Rain, wind and thunder (after each flash) follow the weather.
- Audio starts after your first tap or key (browsers require it).
- "Make Clay sparkle", "stop the sparkle on Clay": a glinting finish (snow, glitter, metal flake).
  Off on the lowest quality rung.
- Code: `src/engine/sounds.ts`, `src/engine/synth.ts`, `src/components/forge/SoundStage.tsx`,
  `src/components/forge/glint.ts`.

## Townsfolk

- "Fill the plaza with people", "add 5 people", "fill the bench with regulars".
- Each person has habits (early bird, chatty, shy...), a plan for the day, and a memory: where they
  went, what they noticed (a new tower is news), who they talked to and about what, and now and then
  a reflection that sums up older memories. They shelter when it rains.
- They walk round each other, you and the exhibits, and replan when stuck.
- "What did Mia do today?", "where is Leo?", "who is here?", "send Leo to the bench", "everyone go
  home", "clear the crowd".
- The town clock runs one town minute per real second.
- Code: `src/engine/town.ts`, `src/components/forge/Town.tsx`.
- **Talk to them.** Walk up to someone and a talk bubble with their name appears (E, the gamepad's
  X, or tap it). They stop, turn to you and say hello. Type, or tap the microphone and speak; they
  answer in a speech bubble over their head and out loud in a voice of their own (the device's
  speech). With the resident model loaded they answer in their own words, in character (their
  traits, what they are doing, their day, whether they know you); without it, from the same facts.
  They remember the talk ("talked with you about ..."), and next time they say so. Townsfolk have
  faces now: they blink, and their mouths move with the words. Walk away or Esc
  to end it. Code: `src/engine/talk.ts`, `src/components/forge/Talk.tsx`.

## The body

- An antenna on the pack and a ponytail swing on springs: they lag when you speed up, overshoot when
  you stop, and settle.
- Stopping finishes the step you are in, so both feet land; starting to walk begins the cycle in step
  with your legs.
- Code: `src/engine/springs.ts`, `src/components/forge/Avatar.tsx`.

## Moving and flying

- Third person: drag (or the right stick) turns the camera. The left stick puts a point on the ground
  around you, in the direction you push and further the harder you push, and the body chases it:
  a light push walks, further jogs, all the way runs, smoothly in between. Push sideways and you turn
  and step that way; push back and you pivot round first. WASD jogs, Shift runs, Space jumps, Q and E
  dash aside.
- F flies: look where you want to go. Look up to climb, down to dive; W boosts (with Shift, more),
  S brakes to a hover, A and D drift. F again lands.
- Prompts (Play, the phone, the TV) and "looking at" only appear up close.

## The 4D bubble

- "Make a 4D bubble", "put a tesseract here", "a 600-cell", "a 120-cell": a regular polytope turning
  through the fourth dimension inside an iridescent bubble with a haze. Its edges glow red, violet
  and green by how deep in w they are; on the higher quality rungs they bloom into light. A plain
  "4D bubble" is the 120-cell (600 corners, 1200 edges).
- "Give me the 4D sword", "put the sword away": the hyper sword in your right hand. Its blade is a
  hypercube turning through w, with ghost cubes glitching off it.
- In the dark theme the whole app sits on a 120-cell turning slowly behind the panels, and a small
  tesseract turns by the name.
- Code: `src/engine/polytope.ts` (the shapes, checked), `src/engine/hyper.ts`,
  `src/components/forge/Hyper.tsx`, `src/components/forge/HyperBackdrop.tsx`.

## Ropes, cables and string lights

Say "hang a rope", "string lights between the column and the terminal" or "run a cable from the
bench to the pillar" (tool `hang_rope`, `src/engine/rope.ts`, drawn by `Rope.tsx`). A rope hangs
from a ring in front of you, or from a thing you name, and swings when you or the townsfolk walk
into it. Cables and string lights are slung between two things (or "here") with a little sag and
follow those things when they move. They drape over exhibits and lie on the ground instead of
passing through, and the weather's wind sways them. String lights carry warm bulbs that glow (and
bloom on the rungs with bloom).

The simulation is a chain of particles solved by position-based dynamics: links held at length,
skip-one links for bending, long-range tethers so a long chain never stretches, collisions with
the world's boxes, the land and people. It is a light stand-in for Stable Cosserat Rods (no twist).

**Swing on a rope.** Jump at a hanging rope and you catch it: hands round it, one over the other.
Push the stick the way you are swinging to pump it higher (it adds most when it goes with the
swing), and jump to let go with the swing's speed. Your weight is a heavy particle in the rope's
own simulation, so the rope bends and sways with you.

## Capes and flags

"Give me a cape" (violet, night, crimson, teal, gold, white, or "a red cape"), "take the cape off",
"raise a flag" (4D, rainbow, pirate or white). Tools `wear_cape` and `raise_flag`
(`src/engine/cloth.ts`, drawn by `Cloth.tsx`). Both are real cloth: a grid of particles with links
across, down and on the diagonals (soft, so it drapes and folds), skip-one links against folding,
and tethers so it never stretches. The cape is pinned across your shoulders and pushed out of your
body (capsules for the torso, legs and head), so it swings as you walk and streams when you run or
fly. Wind pushes each little triangle by how squarely it meets it, drags the cloth downwind and
sheds waves along a flag to its free edge. Fabric uses a sheen material so the folds catch the
light.

## Your companion

"Summon a companion" (or just give an order) and Pip appears beside you and follows. Orders:
"follow me", "wait here", "come here", "go to the bench", "bring me the gold", "put the clay on the
bench", "stack the cubes here"; join several with "then" or "and". Pip walks with the same physics
as you, picks things up and carries them over its head, sets them down on whatever is already
there (so "stack" makes a real stack), says what it is doing in a bubble, and comes back to your
side when it is done. Words it does not know, addressed to it by name ("Pip, tidy up the cubes"),
go to the resident model when one is loaded, which answers in Pip's little language
(`companionPrompt`). Code: `src/engine/companion.ts`, `src/components/forge/Companion.tsx`.

## Fire

"Set the bench on fire", "light a campfire", "burn the crates", "put out the fire" (tools
`set_fire`, `make_campfire`, `put_out_fire`; `src/engine/fire.ts`, drawn by `Fire.tsx`). A coarse
grid of heat, fuel and wetness lies over the world; flammable things (wood, crates, hay, paper,
the bench, anything marked flammable) put fuel under themselves. Fire creeps along them, jumps
small gaps downwind, eats the fuel and leaves what burned charred black. Rain wets everything and
slowly puts it out; hold H (or the water bubble that appears near a fire) to spray water from
your hands where you look, with steam where it hits. Flames are camera-facing sheets with a noise
shader, glowing past white so the bloom takes them; smoke drifts with the wind, embers swirl up,
and a flickering warm light plays on everything near.

## Moss, frost, rust and crystal

"Grow moss on the column", "frost the bench", "let the steel rust", "crystallize the gold", "clean
the column" (tool `grow`; `src/engine/growth.ts`, drawn by `Growth.tsx`). Each kind is a Gray-Scott
reaction-diffusion pattern (a continuous cellular automaton: coral for moss, fine worms for frost,
blotches for rust, a glowing labyrinth for crystal), grown once into a tiling texture and wrapped
over the thing on every side at two scales. It creeps out from a spot near the base with a ragged
living edge until it covers the thing; frost and crystal glow.

## Smoke rings

"Blow a smoke ring", "blow two smoke rings" (`src/engine/vortex.ts`, drawn by `SmokeRings.tsx`).
Each ring is a loop of vortex filament that moves with the velocity all the filaments induce
(Biot–Savart with a smoothed core, stepped with the midpoint rule), so it glides forward on its own;
a second, smaller ring behind catches up, shrinks and slips through the first, which widens: they
leapfrog. The smoke is tracer particles carried by that same field.

