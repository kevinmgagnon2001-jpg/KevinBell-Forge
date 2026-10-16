/**
 * Blocks: the drag-and-place block puzzle, without the ads. Pure rules, no drawing (the screen is
 * src/components/blocks/BlocksGame.tsx), so it is tested here and the same everywhere.
 *
 *   The board is 8 x 8. You are dealt three shapes; drag each onto the board anywhere it fits.
 *   A full row or column clears (several at once score more). Clearing on placements close together
 *   builds a combo; three placements without a clear end it. Emptying the board is a bonus.
 *   When all three are placed you get three more. When none of the shapes you hold fits, the game
 *   is over.
 *
 * Deals are seeded (the same seed deals the same game) and kind: a fresh deal always has at least
 * one shape that fits, so a game never ends on a deal that was hopeless from the start.
 */

export const SIZE = 8;

/** A shape: its cells as [row, col] from its top-left, and its colour (index into COLORS). */
export type Shape = { id: string; cells: [number, number][]; color: number };

export const COLORS = ["#ff5b5b", "#ff9f43", "#ffd23f", "#3ddc84", "#3ec9ff", "#4d7cff", "#a66cff", "#ff6fb5"] as const;

const line = (n: number, vertical: boolean): [number, number][] => Array.from({ length: n }, (_, i) => (vertical ? [i, 0] : [0, i]));
const rect = (rows: number, cols: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) out.push([r, c]);
  return out;
};
/** All four quarter turns of a shape, without repeats. */
function turns(cells: [number, number][]): [number, number][][] {
  const out: [number, number][][] = [];
  let cur = cells;
  for (let i = 0; i < 4; i += 1) {
    const norm = normalize(cur);
    const key = JSON.stringify(norm);
    if (!out.some((s) => JSON.stringify(s) === key)) out.push(norm);
    cur = cur.map(([r, c]) => [c, -r] as [number, number]);
  }
  return out;
}
function normalize(cells: [number, number][]): [number, number][] {
  const minR = Math.min(...cells.map(([r]) => r));
  const minC = Math.min(...cells.map(([, c]) => c));
  return cells.map(([r, c]) => [r - minR, c - minC] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Every shape in the game, with how often it is dealt (weight). */
export const SHAPES: (Shape & { weight: number })[] = (() => {
  const list: (Shape & { weight: number })[] = [];
  const add = (id: string, cells: [number, number][], color: number, weight: number) => list.push({ id, cells: normalize(cells), color, weight });
  add("dot", [[0, 0]], 2, 3);
  for (const n of [2, 3, 4, 5]) {
    add(`line${n}h`, line(n, false), n === 5 ? 0 : 4, n === 5 ? 3 : 4);
    add(`line${n}v`, line(n, true), n === 5 ? 0 : 4, n === 5 ? 3 : 4);
  }
  add("square2", rect(2, 2), 2, 5);
  add("square3", rect(3, 3), 6, 2);
  add("rect2x3", rect(2, 3), 3, 2);
  add("rect3x2", rect(3, 2), 3, 2);
  turns([[0, 0], [1, 0], [1, 1]]).forEach((s, i) => add(`corner${i}`, s, 7, 3));
  turns([[0, 0], [1, 0], [2, 0], [2, 1]]).forEach((s, i) => add(`l${i}`, s, 1, 2));
  turns([[0, 1], [1, 1], [2, 1], [2, 0]]).forEach((s, i) => add(`j${i}`, s, 5, 2));
  turns([[0, 0], [0, 1], [0, 2], [1, 1]]).forEach((s, i) => add(`t${i}`, s, 6, 2));
  turns([[0, 1], [0, 2], [1, 0], [1, 1]]).forEach((s, i) => add(`s${i}`, s, 3, 2));
  turns([[0, 0], [0, 1], [1, 1], [1, 2]]).forEach((s, i) => add(`z${i}`, s, 0, 2));
  turns([[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]).forEach((s, i) => add(`big${i}`, s, 5, 2));
  return list;
})();

export const shapeById = (id: string) => SHAPES.find((s) => s.id === id);

/** A piece in the tray: a shape id, with the colour it was dealt in after "@" ("square2@5"). */
export function shapeOf(entry: string | null | undefined): Shape | undefined {
  if (!entry) return undefined;
  const [id, tint] = entry.split("@");
  const shape = shapeById(id);
  if (!shape) return undefined;
  const color = Number(tint);
  return Number.isInteger(color) && color >= 0 && color < COLORS.length ? { ...shape, color } : shape;
}

/** The board: SIZE * SIZE cells, row by row; -1 is empty, otherwise a colour index. */
export type Board = number[];

export type BlocksState = {
  board: Board;
  /** The three pieces in hand (shapeOf), null once placed. */
  tray: (string | null)[];
  score: number;
  best: number;
  /** Clearing placements in a row (0 = none going). */
  combo: number;
  /** Placements since the last clear (three end a combo). */
  sinceClear: number;
  seed: number;
  over: boolean;
  /** Shapes placed this game. */
  placed: number;
};

export const emptyBoard = (): Board => Array.from({ length: SIZE * SIZE }, () => -1);

function rng(seed: number): { next: () => number; seed: () => number } {
  let a = seed >>> 0 || 1;
  return {
    next: () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    seed: () => a,
  };
}

export function fits(board: Board, shape: Shape, row: number, col: number): boolean {
  for (const [r, c] of shape.cells) {
    const rr = row + r;
    const cc = col + c;
    if (rr < 0 || cc < 0 || rr >= SIZE || cc >= SIZE) return false;
    if (board[rr * SIZE + cc] !== -1) return false;
  }
  return true;
}

/** Anywhere on the board this shape fits. */
export function fitsAnywhere(board: Board, shape: Shape): boolean {
  for (let r = 0; r < SIZE; r += 1) for (let c = 0; c < SIZE; c += 1) if (fits(board, shape, r, c)) return true;
  return false;
}

/** Three shapes for this board, at least one of which fits (unless nothing at all could). */
export function deal(board: Board, seed: number): { tray: string[]; seed: number } {
  const random = rng(seed);
  const total = SHAPES.reduce((sum, s) => sum + s.weight, 0);
  const pick = () => {
    let roll = random.next() * total;
    for (const s of SHAPES) {
      roll -= s.weight;
      if (roll <= 0) return s;
    }
    return SHAPES[0];
  };
  let tray: string[] = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    // Each piece in a colour of its own, so a hand is never three of the same.
    const colors = [0, 1, 2, 3, 4, 5, 6, 7].sort(() => random.next() - 0.5);
    tray = [pick(), pick(), pick()].map((s, i) => `${s.id}@${colors[i]}`);
    if (tray.some((entry) => fitsAnywhere(board, shapeOf(entry)!))) break;
  }
  return { tray, seed: random.seed() };
}

export function newGame(seed: number, best = 0): BlocksState {
  const board = emptyBoard();
  const dealt = deal(board, seed);
  return { board, tray: dealt.tray, score: 0, best, combo: 0, sinceClear: 0, seed: dealt.seed, over: false, placed: 0 };
}

/** Rows and columns that are full on this board. */
export function fullLines(board: Board): { rows: number[]; cols: number[] } {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let i = 0; i < SIZE; i += 1) {
    let row = true;
    let col = true;
    for (let j = 0; j < SIZE; j += 1) {
      if (board[i * SIZE + j] === -1) row = false;
      if (board[j * SIZE + i] === -1) col = false;
    }
    if (row) rows.push(i);
    if (col) cols.push(i);
  }
  return { rows, cols };
}

/** What placing a shape there would clear, for the preview while dragging. */
export function wouldClear(board: Board, shape: Shape, row: number, col: number): { rows: number[]; cols: number[] } {
  if (!fits(board, shape, row, col)) return { rows: [], cols: [] };
  const next = [...board];
  for (const [r, c] of shape.cells) next[(row + r) * SIZE + col + c] = shape.color;
  return fullLines(next);
}

export type PlaceResult = {
  state: BlocksState;
  /** Cells that were cleared (index into the board), with the colour they had, for the animation. */
  cleared: { index: number; color: number }[];
  lines: number;
  points: number;
  combo: number;
  allClear: boolean;
};

/** Points for clearing `lines` lines at once on a combo of `combo`. */
export const linePoints = (lines: number, combo: number) => (lines ? 10 * lines * lines * (1 + combo) : 0);
export const ALL_CLEAR_BONUS = 300;

/** Place the shape in tray slot `slot` with its top-left at (row, col). null if it does not fit. */
export function place(state: BlocksState, slot: number, row: number, col: number): PlaceResult | null {
  if (state.over) return null;
  const shape = shapeOf(state.tray[slot]);
  if (!shape || !fits(state.board, shape, row, col)) return null;
  const board = [...state.board];
  for (const [r, c] of shape.cells) board[(row + r) * SIZE + col + c] = shape.color;
  const { rows, cols } = fullLines(board);
  const lines = rows.length + cols.length;
  const cleared: { index: number; color: number }[] = [];
  const gone = new Set<number>();
  for (const r of rows) for (let c = 0; c < SIZE; c += 1) gone.add(r * SIZE + c);
  for (const c of cols) for (let r = 0; r < SIZE; r += 1) gone.add(r * SIZE + c);
  for (const index of gone) {
    cleared.push({ index, color: board[index] });
    board[index] = -1;
  }
  // A clear carries on a combo that is going (it ends after three placements without one).
  const sinceClear = lines ? 0 : state.sinceClear + 1;
  const comboNow = lines ? state.combo + 1 : sinceClear >= 3 ? 0 : state.combo;
  const allClear = lines > 0 && board.every((cell) => cell === -1);
  const points = shape.cells.length + linePoints(lines, Math.max(0, comboNow - 1)) + (allClear ? ALL_CLEAR_BONUS : 0);
  let tray = state.tray.map((t, i) => (i === slot ? null : t));
  let seed = state.seed;
  if (tray.every((t) => t === null)) {
    const dealt = deal(board, seed);
    tray = dealt.tray;
    seed = dealt.seed;
  }
  const score = state.score + points;
  const over = !tray.some((t) => t !== null && fitsAnywhere(board, shapeOf(t)!));
  return {
    state: { board, tray, score, best: Math.max(state.best, score), combo: comboNow, sinceClear, seed, over, placed: state.placed + 1 },
    cleared,
    lines,
    points,
    combo: comboNow,
    allClear,
  };
}

/** A saved game, checked: anything malformed starts a new game instead. */
export function restore(value: unknown, seed: number): BlocksState {
  const s = value as Partial<BlocksState> | null;
  const best = Math.max(0, Math.floor(Number(s?.best) || 0));
  if (!s || !Array.isArray(s.board) || s.board.length !== SIZE * SIZE || !Array.isArray(s.tray) || s.tray.length !== 3) return newGame(seed, best);
  const board = s.board.map((v) => (Number.isInteger(v) && v >= 0 && v < COLORS.length ? v : -1));
  const tray = s.tray.map((t) => (typeof t === "string" && shapeOf(t) ? t : null));
  if (tray.every((t) => t === null)) return newGame(seed, best);
  const score = Math.max(0, Math.floor(Number(s.score) || 0));
  return {
    board,
    tray,
    score,
    best: Math.max(best, score),
    combo: Math.max(0, Math.floor(Number(s.combo) || 0)),
    sinceClear: Math.max(0, Math.floor(Number(s.sinceClear) || 0)),
    seed: Math.floor(Number(s.seed) || seed),
    over: !tray.some((t) => t !== null && fitsAnywhere(board, shapeOf(t)!)),
    placed: Math.max(0, Math.floor(Number(s.placed) || 0)),
  };
}
