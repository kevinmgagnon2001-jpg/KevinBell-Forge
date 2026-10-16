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
