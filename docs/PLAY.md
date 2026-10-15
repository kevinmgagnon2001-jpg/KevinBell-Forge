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

The avatar is a jointed figure posed every frame from how you move: it breathes and looks around
standing, swings into a walk and stretches into a run, tucks on a jump, spreads its arms falling,
crouches on a hard landing and leans into flight (`src/components/forge/Avatar.tsx`).

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
