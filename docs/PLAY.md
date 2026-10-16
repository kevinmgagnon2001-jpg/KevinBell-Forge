# Walking, physics and the arcade

## Your body

You walk now: gravity holds you to whatever is under you (the deck, a box you climbed, the hills
outside the lab), walls and exhibits stop you, and you slide along them. Kerbs and steps up to 40 cm
are walked straight onto; anything taller needs a jump, or a vault or climb.

**Vault and climb** (`src/engine/parkour.ts`, after PARC): run at a low, thin wall (knee to waist
high) and you vault it, one hand on the top and legs tucked to the side, landing on the far side
still running. Walk up to a crate about chest high and push into it (or jog at it) and you mantle
onto it: hands on the edge, push up, a knee, stand. A ledge up to about 2.3 m takes a jump (Space,
A, or a moment pushing into it): you jump to a hang, pull up and knee over. A ledge probe looks
ahead along the way you are going and picks the move by height and depth; it only acts if you
face the obstacle, there is head room on top, and (for a vault) somewhere to land. The hands reach
the ledge by two-bone IK.

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

## Dominoes and Jenga

"Line up 30 dominoes" (or "in a curve"), "build a jenga tower", "knock them over", "knock over the
tower" (tools `build_dominoes`, `build_jenga`, `knock_over`). These are real rigid bodies on their
own solver (`src/engine/rigid.ts`, kept in step by `Rigid.tsx`): oriented boxes that turn, with
contacts found at each box's corners and edge middles, friction, a little bounce, and impulses
iterated with last step's as the start (warm starting) so stacks stand still; still bodies sleep
and wake when knocked. Walk into the first domino and it tips (a kick lands high on the body).

## The arcade

Build a game ("build tetris", "build a marble run", or the Tetris button on the bench), walk up to
it, and press **Play** (E, the gamepad's X, or tap the prompt). The camera frames the game to fit the
screen, the sticks give way to the game's own buttons, and the game keeps its own clock.

- **Tetris:** ◀ ▶ (or A D, d-pad) move, ↑ (W, X, gamepad A) rotates, ↓ (S) drops faster, Space
  (gamepad X) drops. Hold ◀ ▶ ▼ to repeat. Pieces fall faster as you clear lines.
- **Marble run:** Space (or Release) puts the marble back on top.

Esc, the gamepad's B or Exit puts you back on your feet where you stood.

## Hyper Breakout

"Build breakout" (or the bench's Breakout button) puts a glowing cabinet across from Blocks. Play
it and it fills the screen: neon bricks in the 4D palette (tougher ones take two or three hits and
show cracks), a ball with a light trail, sparks and a little shake when bricks break, and a glassy
bubble paddle. Drag anywhere or move the mouse to steer (or the arrow keys); tap, click or Space to
launch; P pauses; Esc walks away. Capsules drop now and then: three balls, a wide paddle, slow
time. Clear the wall for the next level (six patterns, a faster ball). Rules in
`src/engine/breakout.ts`, the screen in `BreakoutGame.tsx`.

Best scores are kept in the save, per game (`world.best`, `arcade.ts` withBest): Breakout's score
and Tetris's lines; Tetris shows its best in the bar.

## Adding a game

One entry in `GAMES` in `src/engine/arcade.ts`: how to find it in the world, where it is, what the
camera must show, its moves (with keys and gamepad buttons), how a move changes the world, its clock,
a status line and how to restart. The prompt, the controls, the camera and the touch buttons read
that entry; `arcade.test.ts` checks the moves and the framing.
