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

## Asking without a model

The resident model is **off until you turn it on** (the power switch by its name). Forge answers on
its own: `src/engine/planner.ts` reads plain requests and `src/engine/route.ts` hands each system's
words to it (moves, fire, weather, townsfolk, ropes, gauges, the arcade, ...). It reads:

- **Making:** "a row of five red cubes", "stack 4 crates on the bench", "a circle of 8 rainbow
  pillars around me", "a pyramid of 10 gold cubes", "scatter 20 small balls", "a huge gold sphere
  in the middle", "three big red cubes and two tiny gold balls", "a gem named Spark at 2, 0, 3".
- **Changing:** "paint it blue", "paint the red cube teal", "make the sphere twice as big", "make
  the column taller", "turn it into a ring", "give the clay a marble texture", "rename it Bob",
  "paint them rainbow".
- **Moving:** "move it up 2", "move the cube left 3", "put the gold on the bench", "bring the ball
  here", "set it on the ground".
- **Physics:** "throw the ball", "throw it up", "kick the cubes", "drop the gold".
- **Copies and clean-up:** "copy it 3 times", "delete the spheres", "clear everything I made",
  "undo", "undo 3 times".
- **Questions:** "how many cubes?", "where is the gold?", "what's here?", "what is that?", "help".
- **You:** "walk forward 3", "turn around", "turn left 45 degrees", "jump".
- **Several at once:** join steps with "then", "and" before a verb, or full stops: "make a red cube,
  then throw it". "It" is the selection (what you just made), "them" the last group.

Names forgive a typo ("the colum"). When it does not understand, it says the closest things it
knows. With a model on, anything the planner reads surely still runs at once; the rest goes to it.

**Your own phrases:** "when I say party, light a campfire then make it rain at dusk then fill the
plaza with people" — then just say "party". "my phrases" lists them, "forget party" drops one.
They are kept in the world, so linked devices know them too.

**As you type** the box offers your phrases, past lines, catalog entries and examples that start
with your words (tap to send, Tab to fill in); Up and Down walk through what you sent.

## The catalog

The book bubble by the view buttons (or **B**) opens the catalog: games, toys, shapes, colours and
textures, people, effects, weather, gauges, moves, your phrases, and **In this world** (everything
here now, by kind, with Find). Tap an entry and it runs as the request it shows. Entries and
things that are new since you last looked are marked **new**. Add an entry in
`src/engine/catalog.ts`; bump `CATALOG_VERSION` and mark it `added` so it shows as new
(`catalog.test.ts` checks every entry is understood without a model).

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
