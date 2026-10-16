/**
 * The arcade: games built in the world (Tetris, the marble run) that you walk up to and play.
 *
 * Near one, a "Play" prompt appears (E, the gamepad's X, or tap it). Playing hands the controls to
 * the game: the camera frames the board, the sticks give way to the game's own buttons, keys and
 * gamepad buttons map to its moves, and the game keeps its own clock. Leave with Esc, B or Exit and
 * you are back on your feet where you stood.
 *
 * Each game is one GAMES entry: how to find its board in the world, where the camera goes, its
 * moves (with keys and pad buttons), how a move changes the world, and its clock. Plain data plus
 * pure functions, so it is tested here and drawn by Arcade.tsx.
 */
import { buildBreakout, buildMarble, buildTetris, CELL, COLS, playTetris } from "./manifold.ts";
import type { Entity, Vec3, World } from "./types.ts";

export type GameMove = {
  id: string;
  label: string;
  /** KeyboardEvent.code values. */
  keys: string[];
  /** Standard gamepad button indices. */
  pad: number[];
  /** Held down, it repeats (moving a piece across). */
  repeat?: boolean;
};

/** What the camera must show: the middle of the game, the way it faces, and how big it is. */
export type Framing = { at: Vec3; toward: Vec3; width: number; height: number };

export type GameSpec = {
  id: string;
  label: string;
  /** The entity that stands for the game (its board, its first ramp). */
  find: (world: World) => Entity | undefined;
  /** Where it is, for "am I close enough to play". */
  spot: (world: World, board: Entity) => Vec3;
  /** Where the camera goes while playing. */
  framing: (world: World, board: Entity) => Framing;
  moves: GameMove[];
  play: (world: World, move: string) => World;
  /** Seconds between the game's own steps, and the move it makes (the piece falling). */
  clock?: (world: World, board: Entity) => { every: number; move: string };
  /** One line for the HUD. */
  status: (world: World, board: Entity) => string;
  over: (world: World, board: Entity) => boolean;
  restart: (world: World) => World;
  /** Played on a screen of its own instead of in the world (Blocks): Arcade.tsx opens it full screen. */
  screen?: boolean;
};

const tetrisBoard = (world: World) => Object.values(world.entities).find((e) => e.customData.play === "tetris");
const tetrisCenter = (board: Entity): Vec3 => {
  const originX = Number(board.customData.originX) || 5.55;
  const originZ = Number(board.customData.originZ) || 1.35;
  return { x: originX + ((COLS - 1) * CELL) / 2, y: 2.55, z: originZ };
};
const linesOf = (board: Entity) => Number(board.customData.lines) || 0;

const marbleStart = (world: World) => Object.values(world.entities).find((e) => e.tags.includes("marble") && e.name === "StartRamp");
const marbleBall = (world: World) => Object.values(world.entities).find((e) => e.tags.includes("marble") && e.name === "Marble");

/** Put the marble back at the top of the run, at rest. */
function releaseMarble(world: World): World {
  const ball = marbleBall(world);
  if (!ball) return buildMarble(world);
  return {
    ...world,
    entities: {
      ...world.entities,
      [ball.id]: {
        ...ball,
        transform: { ...ball.transform, position: { x: -5.6, y: 2.62, z: 3.5 } },
        physics: ball.physics ? { ...ball.physics, velocity: { x: 0, y: 0, z: 0 } } : ball.physics,
      },
    },
  };
}

export const GAMES: GameSpec[] = [
  {
    id: "tetris",
    label: "Tetris",
    find: tetrisBoard,
    spot: (_, board) => tetrisCenter(board),
    // Straight on from the open side (+z): the whole well, from its floor to where pieces come in.
    framing: (_, board) => {
      const c = tetrisCenter(board);
      return { at: { x: c.x, y: 2.75, z: c.z }, toward: { x: 0, y: 0.08, z: 1 }, width: COLS * CELL + 0.5, height: 5.4 };
    },
    moves: [
      { id: "left", label: "◀", keys: ["ArrowLeft", "KeyA"], pad: [14], repeat: true },
      { id: "right", label: "▶", keys: ["ArrowRight", "KeyD"], pad: [15], repeat: true },
      { id: "rotate", label: "⟳", keys: ["ArrowUp", "KeyW", "KeyX"], pad: [12, 0] },
      { id: "down", label: "▼", keys: ["ArrowDown", "KeyS"], pad: [13], repeat: true },
      { id: "drop", label: "⤓", keys: ["Space"], pad: [2] },
    ],
    // A finished game's lines are its score; the best is kept in the save.
    play: (world, move) => {
      const next = playTetris(world, move);
      const board = tetrisBoard(next);
      return board && board.customData.over === "1" ? withBest(next, "tetris", linesOf(board)) : next;
    },
    // Faster as you clear lines.
    clock: (_, board) => ({ every: Math.max(0.12, 0.65 - linesOf(board) * 0.025), move: "down" }),
    status: (world, board) => {
      const best = bestOf(world, "tetris");
      const tail = best ? ` · best ${best}` : "";
      return board.customData.over === "1" ? `Game over · ${linesOf(board)} lines${tail}` : `${linesOf(board)} lines${tail}`;
    },
    over: (_, board) => board.customData.over === "1",
    restart: buildTetris,
  },
  {
    id: "marble",
    label: "Marble run",
    find: marbleStart,
    spot: () => ({ x: -4.4, y: 1, z: 0.6 }),
    framing: () => ({ at: { x: -4.1, y: 1.2, z: 0.6 }, toward: { x: 0.75, y: 0.5, z: 0.45 }, width: 5, height: 3.4 }),
    moves: [{ id: "release", label: "⤓", keys: ["Space", "Enter"], pad: [0, 2] }],
    play: (world, move) => (move === "release" ? releaseMarble(world) : world),
    status: (world) => {
      const ball = marbleBall(world);
      if (!ball) return "No marble";
      const p = ball.transform.position;
      return p.x > -3.2 && p.z < -0.5 && p.y < 0.8 ? "In the catch" : "Rolling";
    },
    over: () => false,
    restart: buildMarble,
  },
];

/**
 * Where the camera stands to show a framing whole on this screen: far enough back for its width and
 * its height at this field of view (vertical, degrees) and shape, with room at the bottom for the
 * touch buttons (`bottom`, a share of the screen's height).
 */
export function frameCamera(f: Framing, fovDeg: number, aspect: number, bottom = 0.14): { eye: Vec3; at: Vec3 } {
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const usable = 1 - bottom - 0.08;
  const distance = Math.max(f.height / 2 / (tanV * usable), f.width / 2 / (tanV * Math.max(0.2, aspect) * 0.9)) + 0.3;
  const n = Math.hypot(f.toward.x, f.toward.y, f.toward.z) || 1;
  // Look a little below the middle, so the game sits above the buttons.
  const drop = tanV * distance * (bottom - 0.04);
  const at = { x: f.at.x, y: f.at.y - drop, z: f.at.z };
  return { at, eye: { x: f.at.x + (f.toward.x / n) * distance, y: f.at.y + (f.toward.y / n) * distance - drop, z: f.at.z + (f.toward.z / n) * distance } };
}

export const BLOCKS_GAME: GameSpec = {
  id: "blocks",
  label: "Blocks",
  find: (world) => Object.values(world.entities).find((e) => e.customData.play === "blocks"),
  spot: (_, board) => board.transform.position,
  framing: (_, board) => ({ at: { ...board.transform.position, y: 1.2 }, toward: { x: 0, y: 0.2, z: 1 }, width: 1.4, height: 1.8 }),
  moves: [],
  play: (world) => world,
  status: () => "",
  over: () => false,
  restart: (world) => world,
  screen: true,
};
GAMES.push(BLOCKS_GAME);

export const BREAKOUT_GAME: GameSpec = {
  ...BLOCKS_GAME,
  id: "breakout",
  label: "Hyper Breakout",
  find: (world) => Object.values(world.entities).find((e) => e.customData.play === "breakout"),
  restart: buildBreakout,
};
GAMES.push(BREAKOUT_GAME);

// ---------- best scores, kept in the save ----------

export const bestOf = (world: Pick<World, "best">, game: string): number => world.best?.[game] ?? 0;

/** The world with `score` as this game's best, if it beats it (the same world otherwise). */
export function withBest<W extends Pick<World, "best">>(world: W, game: string, score: number): W {
  if (!Number.isFinite(score) || score <= bestOf(world, game)) return world;
  return { ...world, best: { ...world.best, [game]: Math.floor(score) } };
}

/** Best scores from a save: known-looking ids and whole, non-negative numbers only. */
export function cleanBest(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [id, score] of Object.entries(value as Record<string, unknown>).slice(0, 32)) {
    if (/^[a-z0-9-]{1,24}$/.test(id) && typeof score === "number" && Number.isFinite(score) && score >= 0) out[id] = Math.floor(Math.min(score, 1e9));
  }
  return Object.keys(out).length ? out : undefined;
}

export const gameById = (id: string | undefined) => GAMES.find((g) => g.id === id);

/** How close counts as "at the machine", metres across the floor. */
export const PLAY_REACH = 2.2;

/** The closest game within reach of `at`, or null. */
export function nearestGame(world: World, at: Vec3, reach = PLAY_REACH): { game: GameSpec; board: Entity; distance: number } | null {
  let best: { game: GameSpec; board: Entity; distance: number } | null = null;
  for (const game of GAMES) {
    const board = game.find(world);
    if (!board) continue;
    const spot = game.spot(world, board);
    const distance = Math.hypot(spot.x - at.x, spot.z - at.z);
    if (distance <= reach && (!best || distance < best.distance)) best = { game, board, distance };
  }
  return best;
}

/** The move a key or pad button means in this game, if any. */
export function moveForKey(game: GameSpec, code: string): GameMove | undefined {
  return game.moves.find((m) => m.keys.includes(code));
}

export function moveForPad(game: GameSpec, button: number): GameMove | undefined {
  return game.moves.find((m) => m.pad.includes(button));
}

/** Keys that leave the game; the gamepad's B (1) and Back (8) do too. */
export const EXIT_KEYS = ["Escape", "Backspace"];
export const EXIT_PAD = [1, 8];
