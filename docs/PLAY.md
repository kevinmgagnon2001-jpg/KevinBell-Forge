# Walking, physics and the arcade

## Your body

You walk now: gravity holds you to whatever is under you (the deck, a box you climbed, the hills
outside the lab), walls and exhibits stop you, and you slide along them. Kerbs and steps up to 40 cm
are walked straight onto; anything taller needs a jump.

| Do | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Walk / run | W A S D (Shift runs) | left stick (all the way runs) | left stick (all the way runs) |
| Jump | Space | A | Jump |
| Fly / land | F (then Space up, Shift or C down) | Y (triggers up and down) | Fly, then Up / Down / Land |
| Use, play | E | X | the prompt |
| Moves | G | | Moves |

The avatar is a jointed figure posed every frame from how you move: it breathes and looks around
standing, swings into a walk and stretches into a run, tucks on a jump, spreads its arms falling,
crouches on a hard landing and leans into flight (`src/components/forge/Avatar.tsx`).

## Talking to the helm

Over the full view the helm is two small round buttons (above Find room on a phone):

- 🎙 **Speak**: say what you want; Forge sends it to the helm and shows the words it heard. In the
  Android app this is Android's own voice input (the system's speech app listens; Forge asks for no
  microphone permission). In a browser it uses the browser's speech recognition where there is one.
- ⌨ **Type**: opens the text bar (your keyboard's dictation works in it too); it tucks away after
  you send, or with ✕ or Esc.

The "Architect intent" box under the view has the same 🎙 button.

## Moves: make your own, and the body fills in the rest

Open **Moves** (by the view buttons, or G) and tap one: wave, cheer, clap, point, salute, bow, shrug,
flex, think, stretch, dance, jumping jacks, sit, look around, facepalm. Or just type it in the helm:
"wave", "do a little dance", "stop dancing".

**Make new ones from words**, in the Moves box or the helm:

- `make a move called victory: cheer then flex twice`
- `wave with the left hand, then bow slowly`
- `keep doing jumping jacks` (loops until you say stop)
- `dance upper body` (keeps your legs free, so you can dance while you walk)

Steps are split on "then" and commas; each can say left or right, fast or slow, big or small, and how
many times. The model can also write a move as keyframes (`make_move` with `keys`), and every pose is
clamped to what a body can do. Your moves are saved with the world and go to your linked devices.

**Filling in on the fly.** A move only drives the joints it names; your walk or run fills in the rest,
so you can wave while you walk (when you move, your legs always follow the stick). Each foot reaches
the ground actually under it (a step, a kerb, the edge of a box), and your hips drop when one foot has
to reach down. When you stand still, your head turns to whatever you are looking at.

This follows two research ideas, made small enough for a phone: GENMO (NVIDIA, ICCV 2025: motion
from text, video or keyframes) for building, and MaskedMimic (NVIDIA, SIGGRAPH Asia 2024: a full
body filled in from partial constraints) for filling in. Nothing here is a trained network; the
vocabulary, the inpainting and the leg solver are plain code in `src/engine/motion.ts` (tested in
`motion.test.ts`), shaped so a small learned model could take the generator's place later.

## Things move

Loose objects (physics on, not kinematic) fall, land, bounce, slide to a stop, stack on each other,
roll if they are round, knock into each other, and get shoved when you walk into them. They do this
all the time now, not only while Run is on; a body at rest sleeps and costs nothing. Exhibits and
fixtures (kinematic) stay put and block. Set `bounce` (0..0.95) or `friction` in an entity's data to
change how lively it is. Engine: `src/engine/physics.ts`, tested in `physics.test.ts`.

## The arcade

Build a game ("build tetris", "build a marble run", or the Tetris button on the bench), walk up to
it, and press **Play** (E, the gamepad's X, or tap the prompt). The camera frames the game to fit the
screen, the sticks give way to the game's own buttons, and the game keeps its own clock.

- **Tetris:** ◀ ▶ (or A D, d-pad) move, ↑ (W, X, gamepad A) rotates, ↓ (S) drops faster, Space
  (gamepad X) drops. Hold ◀ ▶ ▼ to repeat. Pieces fall faster as you clear lines.
- **Marble run:** Space (or Release) puts the marble back on top.

Esc, the gamepad's B or Exit puts you back on your feet where you stood.

## Adding a game

One entry in `GAMES` in `src/engine/arcade.ts`: how to find it in the world, where it is, what the
camera must show, its moves (with keys and gamepad buttons), how a move changes the world, its clock,
a status line and how to restart. The prompt, the controls, the camera and the touch buttons read
that entry; `arcade.test.ts` checks the moves and the framing.
