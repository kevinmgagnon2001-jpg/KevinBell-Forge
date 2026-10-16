import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_CLEAR_BONUS, deal, emptyBoard, fits, fitsAnywhere, fullLines, linePoints, newGame, place, restore, SHAPES, shapeById, shapeOf, SIZE, wouldClear, type BlocksState } from "./blocks.ts";

const withTray = (state: BlocksState, tray: (string | null)[]) => ({ ...state, tray });
/** A board with row r full except the listed columns. */
function nearlyFullRow(r: number, gaps: number[]) {
  const board = emptyBoard();
  for (let c = 0; c < SIZE; c += 1) if (!gaps.includes(c)) board[r * SIZE + c] = 1;
  return board;
}

test("shapes: unique ids, normalised to their top-left, sensible sizes", () => {
  assert.equal(new Set(SHAPES.map((s) => s.id)).size, SHAPES.length);
  for (const s of SHAPES) {
    assert.equal(Math.min(...s.cells.map(([r]) => r)), 0, s.id);
    assert.equal(Math.min(...s.cells.map(([, c]) => c)), 0, s.id);
    assert.ok(s.cells.length >= 1 && s.cells.length <= 9, s.id);
  }
  assert.equal(shapeById("square3")!.cells.length, 9);
  assert.equal(SHAPES.filter((s) => s.id.startsWith("corner")).length, 4);
});

test("placing: fits, edges, overlap", () => {
  const board = emptyBoard();
  const square = shapeById("square2")!;
  assert.ok(fits(board, square, 0, 0));
  assert.ok(fits(board, square, 6, 6));
  assert.ok(!fits(board, square, 7, 0), "off the bottom");
  board[0] = 3;
  assert.ok(!fits(board, square, 0, 0), "on top of a block");
});

test("a full row and a full column clear together and score more than one line", () => {
  let state = newGame(7);
  const board = nearlyFullRow(0, [0]);
  for (let r = 1; r < SIZE; r += 1) board[r * SIZE] = 2; // column 0 full except row 0
  state = withTray({ ...state, board }, ["dot", "line2h", "line3h"]);
  assert.deepEqual(wouldClear(state.board, shapeById("dot")!, 0, 0), { rows: [0], cols: [0] });
  const done = place(state, 0, 0, 0)!;
  assert.equal(done.lines, 2);
  assert.equal(done.cleared.length, 15);
  assert.ok(done.state.board.every((c) => c === -1));
  assert.ok(done.allClear);
  assert.equal(done.points, 1 + linePoints(2, 0) + ALL_CLEAR_BONUS);
  assert.equal(done.state.tray[0], null);
  assert.ok(linePoints(2, 0) > 2 * linePoints(1, 0), "two at once beat two apart");
});

test("combos build on close clears and end after three placements without one", () => {
  let state = newGame(3);
  // A block left elsewhere, so these are not all-clears.
  const clearRow = (s: BlocksState, r: number) => {
    const board = nearlyFullRow(r, [0]);
    board[7 * SIZE + 7] = 4;
    return place(withTray({ ...s, board }, ["dot", "dot", "dot"]), 0, r, 0)!;
  };
  const first = clearRow(state, 0);
  assert.equal(first.combo, 1);
  const second = clearRow(first.state, 1);
  assert.equal(second.combo, 2);
  assert.equal(second.points, 1 + linePoints(1, 1));
  state = second.state;
  for (let i = 0; i < 3; i += 1) state = place(withTray({ ...state, board: emptyBoard() }, ["dot", "dot", "dot"]), 0, 4, i)!.state;
  assert.equal(state.combo, 0);
});

test("deals: three shapes, one always fits; all placed deals three more; nothing fits ends it", () => {
  const dealt = deal(emptyBoard(), 42);
  assert.equal(dealt.tray.length, 3);
  assert.deepEqual(deal(emptyBoard(), 42).tray, dealt.tray, "same seed, same deal");
  assert.equal(new Set(dealt.tray.map((e) => shapeOf(e)!.color)).size, 3, "three colours");
  assert.equal(shapeOf("square2@9"), shapeById("square2") ? shapeOf("square2") : undefined, "a bad colour falls back to the shape's own");
  // A board with one hole: the deal still includes something that fits (a dot).
  const holey = Array.from({ length: SIZE * SIZE }, (_, i) => (i === 27 ? -1 : 1));
  assert.ok(deal(holey, 9).tray.some((entry) => fitsAnywhere(holey, shapeOf(entry)!)));
  let state = withTray(newGame(1), [null, null, "dot"]);
  state = place(state, 2, 0, 0)!.state;
  assert.ok(state.tray.every((t) => t !== null), "a new hand");
  // Holes on a checkerboard, so only single blocks fit: with a 3x3 left, it is over.
  const tight = Array.from({ length: SIZE * SIZE }, (_, i) => ((Math.floor(i / SIZE) + (i % SIZE)) % 2 === 0 ? -1 : 1));
  const stuck = place(withTray({ ...newGame(1), board: tight }, ["dot", null, "square3"]), 0, 0, 0)!;
  assert.ok(stuck.state.over);
  assert.equal(place(stuck.state, 2, 1, 1), null, "no moves after the end");
});

test("best score keeps; saves are checked", () => {
  const state = place(withTray({ ...newGame(5, 100), score: 99 }, ["square2", "dot", "dot"]), 0, 0, 0)!.state;
  assert.equal(state.best, 103);
  const back = restore(JSON.parse(JSON.stringify(state)), 1);
  assert.deepEqual(back.board, state.board);
  assert.equal(back.score, state.score);
  const junk = restore({ board: [1, 2], tray: "x", best: 50 }, 1);
  assert.equal(junk.best, 50);
  assert.equal(junk.score, 0);
  assert.equal(fullLines(junk.board).rows.length, 0);
  assert.equal(restore({ ...state, board: state.board.map(() => 99) }, 1).board[0], -1, "bad colours are emptied");
});

test("a long random game stays legal", () => {
  let state = newGame(2024);
  let random = 12345;
  const next = () => (random = (random * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let move = 0; move < 400 && !state.over; move += 1) {
    const options: [number, number, number][] = [];
    state.tray.forEach((id, slot) => {
      if (!id) return;
      for (let r = 0; r < SIZE; r += 1) for (let c = 0; c < SIZE; c += 1) if (fits(state.board, shapeOf(id)!, r, c)) options.push([slot, r, c]);
    });
    assert.ok(options.length > 0, "not over means something fits");
    const [slot, r, c] = options[Math.floor(next() * options.length)];
    const before = state.score;
    state = place(state, slot, r, c)!.state;
    assert.ok(state.score > before);
    assert.equal(fullLines(state.board).rows.length + fullLines(state.board).cols.length, 0, "no full line is left standing");
  }
  // Random spots fill the board fast; it still plays several hands before it ends.
  assert.ok(state.placed >= 3);
});
