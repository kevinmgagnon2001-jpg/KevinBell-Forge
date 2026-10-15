# The engine room: your device's stats as machines

The lab opens with six brass machines around the bench. Each one shows a live number from the device
running Forge:

| Machine | Shows | Where the number comes from |
| --- | --- | --- |
| Thermometer | Heat (battery °C) | Android bridge `deviceHealth` |
| Piston engine | Frame rate (top of scale = the screen's refresh, 120 Hz on a Galaxy S26 Ultra) | the 3D view |
| Boiler | Memory in use (device RAM on Android, JS heap elsewhere) | Android bridge / browser |
| Charge cell | Battery percent (bubbles speed up while charging) | Android bridge / browser battery |
| Tesla coil | Throttle (Android thermal headroom: 100 % = the phone starts slowing down) | Android bridge |
| Pressure dial | Power draw in watts (out of the battery) | Android bridge |

Readings go amber and then red as they get worse; a machine in danger pulses, its needle shakes and the
boiler's valve wheel spins. A reading the device does not give (heat in a desktop browser, for example)
shows "no reading" and the machine idles.

## Changing it: just say it

These run straight away, without waiting for the AI model, even while it is loading or turned off:

- `build the engine room` / `set up a cyberpunk room` / `steam works`
- `make the gauges neon` (brass, copper, neon, chrome, ember iron; also "steampunk", "cyber", ...)
- `switch the heat gauge to copper`
- `turn every gauge into a tesla coil`
- `add a neon thermometer for the heat`, `add a boiler for memory`

Anything else goes to the model as before, which has the same tools: `place_gauge`, `style_gauge`,
`build_gauge_rig`. Undo takes back a whole change at once.

## Adding a mesh, skin, stat or room (for whoever builds next, human or AI)

Everything is in two files, and each addition is one entry:

- `src/engine/gauges.ts`
  - `STATS`: id, label, unit, words people use, range, warn/danger points, and how to read it from the
    `LiveSample`. New device numbers go into `LiveSample` and are filled in `PerfOverlay.tsx`
    (`liveSample`).
  - `MESHES`: id, label, words. Then add the drawing to `GAUGE_PARTS` in `Gauges.tsx`.
  - `SKINS`: colours (body, trim, glass, glow, hot, needle, face) and finish. No drawing code needed.
  - `RIGS`: a named room: a list of stats (and optional meshes) and a skin.
- `src/components/forge/Gauges.tsx`: one component per mesh. It is drawn in metres, standing on
  `y = 0` and facing `+z`, and reads `reading.current` (`level` 0..1, `mood`, `known`, `t`) inside
  `useFrame`, so moving gauges never re-render React.

The tool descriptions, the model's prompt line and the instant commands all read these lists, so a new
entry is usable everywhere at once. `src/engine/gauges.test.ts` checks the lists line up.
