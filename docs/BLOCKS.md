# Blocks

The drag-and-place block puzzle, with no ads, no account and nothing sent anywhere. The game and the
best score stay on the phone.

## Giving it to someone

Install the Forge APK from **Releases** (see docs/ANDROID.md). It adds two icons to the phone:
**Forge** and **Blocks**. **Blocks** opens straight into the game: no 3D world, no AI model, no
controls to learn. (You can move or hide the Forge icon; Blocks works on its own.)

In a browser it is at `/blocks` (or `/?app=blocks`).

## How it looks

The classic look is the default: a white board with thin black lines, every block one blue, the
score big and blue at the top, the three pieces below, and **New Game** (asks first if a game is
going) and **Settings** along the bottom. Settings shows the best score and has New game, Sound,
Vibration, and "Colourful blocks" for the bright look. The Android icon is a blue-and-white grid.

## Playing

- Drag a shape from the bottom onto the board. It floats a little above your finger so you can see
  where it lands; a ghost shows the spot, and rows and columns it would finish light up.
- Full rows and columns clear. Several at once score more; clears close together build a combo
  (three placements without a clear end it). An empty board is a 300-point bonus.
- Place all three to get three more. When none of the shapes you hold fits, the game is over.
- **⋯** has New game, Sound and Vibration. The game picks up where you left it.

## In Forge's world

Say "build blocks" (or press Blocks on the bench) for an arcade cabinet by the bench. Walk up and
press Play; Walk away brings you back.

## For whoever works on it

- Rules: `src/engine/blocks.ts` (tested in `blocks.test.ts`): shapes and how often they are dealt,
  deals that always leave a move, scoring, saves checked on load.
- Screen: `src/components/blocks/BlocksGame.tsx`; styles under "Blocks" in `src/styles.css`.
- The second icon: an activity-alias in `scripts/android-manifest.mjs`, its icon in
  `src-tauri/android/res/drawable/blocks_icon.xml`, and `launchedAs` in `MainActivity.kt`, read by
  `src/routes/index.tsx`.
