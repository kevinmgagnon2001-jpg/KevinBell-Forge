/**
 * Blocks, the screen (rules in src/engine/blocks.ts). No ads, no accounts, nothing sent anywhere:
 * the game and the best score are kept on the device.
 *
 * Drag a shape from the tray onto the board. While dragging, the shape floats above your finger (so
 * the finger never hides where it lands), a ghost shows where it would go, and the rows and columns it
 * would finish light up. Let go on a good spot to place it; anywhere else and it goes back.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { COLORS, fits, fitsAnywhere, newGame, place, restore, shapeOf, SIZE, wouldClear, type BlocksState, type Shape } from "@/engine/blocks";

const SAVE_KEY = "forge.blocks.v1";
const PREFS_KEY = "forge.blocks.prefs";

/** classic: white board, thin black lines, one blue (the look she knows). bright: the colourful one. */
type Look = "classic" | "bright";
type Prefs = { sound: boolean; buzz: boolean; look: Look };
/** Every block in the classic look. */
const CLASSIC_BLUE = "#1677ff";
type Drag = { slot: number; x: number; y: number; touch: boolean };
type Flash = { key: number; cells: { index: number; color: number }[] };
type Popup = { key: number; text: string; big: boolean };

function load(): BlocksState {
  const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? restore(JSON.parse(raw), seed) : newGame(seed);
  } catch {
    return newGame(seed);
  }
}

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return { sound: raw.sound !== false, buzz: raw.buzz !== false, look: raw.look === "bright" ? "bright" : "classic" };
  } catch {
    return { sound: true, buzz: true, look: "classic" };
  }
}

/** Soft little tones, made on the spot (no sound files). */
let audio: AudioContext | null = null;
function tone(notes: number[], length = 0.07, volume = 0.05) {
  try {
    audio ??= new AudioContext();
    const start = audio.currentTime;
    notes.forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const at = start + i * length * 0.8;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(volume, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
      osc.connect(gain).connect(audio!.destination);
      osc.start(at);
      osc.stop(at + length + 0.02);
    });
  } catch {
    /* no sound here */
  }
}

const buzz = (ms: number | number[]) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no vibration here */
  }
};

function ShapeCells({ shape, cell, gap, style, tint }: { shape: Shape; cell: number; gap: number; style?: CSSProperties; tint?: string }) {
  const rows = Math.max(...shape.cells.map(([r]) => r)) + 1;
  const cols = Math.max(...shape.cells.map(([, c]) => c)) + 1;
  return (
    <div className="blk-shape" style={{ width: cols * cell + (cols - 1) * gap, height: rows * cell + (rows - 1) * gap, ...style }}>
      {shape.cells.map(([r, c]) => (
        <span key={`${r}-${c}`} className="blk-cell is-full" style={{ left: c * (cell + gap), top: r * (cell + gap), width: cell, height: cell, "--blk": tint ?? COLORS[shape.color] } as CSSProperties} />
      ))}
    </div>
  );
}

export function BlocksGame({ onExit, exitLabel = "Back" }: { onExit?: () => void; exitLabel?: string }) {
  const [game, setGame] = useState<BlocksState | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({ sound: true, buzz: true, look: "classic" });
  const [confirmNew, setConfirmNew] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [menu, setMenu] = useState(false);
  const [showOver, setShowOver] = useState(false);
  const [boardPx, setBoardPx] = useState(320);
  const board = useRef<HTMLDivElement>(null);
  const counter = useRef(0);
  const startBest = useRef(0);

  // The saved game, once on the device (not on the server render).
  useEffect(() => {
    const loaded = load();
    startBest.current = loaded.best;
    setGame(loaded);
    setPrefs(loadPrefs());
  }, []);
  useEffect(() => {
    if (!game) return;
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(game));
    } catch {
      /* full or blocked: the game still plays */
    }
  }, [game]);
  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);
  useEffect(() => {
    if (!game?.over) {
      setShowOver(false);
      return;
    }
    const timer = window.setTimeout(() => setShowOver(true), 650);
    return () => window.clearTimeout(timer);
  }, [game?.over]);

  // The board's size follows the screen.
  const ready = game !== null;
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const measure = () => setBoardPx(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready]);

  const classic = prefs.look === "classic";
  // Classic: the board's black shows through 1 px gaps as the grid lines.
  const pad = classic ? 0 : 6;
  const gap = classic ? 1 : 3;
  const colorOf = (c: number) => (classic ? CLASSIC_BLUE : COLORS[c]);
  const cell = (boardPx - pad * 2 - gap * (SIZE - 1)) / SIZE;

  /** Where the dragged shape would land: its top-left cell, from where it floats on screen. */
  const target = useMemo(() => {
    if (!drag || !game || !board.current) return null;
    const shape = shapeOf(game.tray[drag.slot]);
    if (!shape) return null;
    const rect = board.current.getBoundingClientRect();
    const rows = Math.max(...shape.cells.map(([r]) => r)) + 1;
    const cols = Math.max(...shape.cells.map(([, c]) => c)) + 1;
    const w = cols * cell + (cols - 1) * gap;
    const h = rows * cell + (rows - 1) * gap;
    const lift = drag.touch ? cell * 1.6 : cell * 0.4;
    const left = drag.x - w / 2;
    const top = drag.y - lift - h;
    const col = Math.round((left - rect.left - pad) / (cell + gap));
    const row = Math.round((top - rect.top - pad) / (cell + gap));
    const ok = fits(game.board, shape, row, col);
    return { shape, left, top, row, col, ok, lines: ok ? wouldClear(game.board, shape, row, col) : { rows: [], cols: [] } };
  }, [drag, game, cell, gap, pad]);

  const effects = useCallback(
    (points: number, lines: number, combo: number, allClear: boolean) => {
      if (lines) {
        counter.current += 1;
        const words = allClear ? "Board clear!" : lines >= 3 ? "Amazing!" : lines === 2 ? "Great!" : "Nice";
        setPopup({ key: counter.current, text: `${words} +${points}${combo > 1 ? `  ·  Combo ×${combo}` : ""}`, big: lines >= 2 || allClear || combo > 1 });
        if (prefs.sound) tone(lines >= 2 || combo > 1 ? [523, 659, 784, 1047] : [523, 784], 0.09, 0.06);
        if (prefs.buzz) buzz(lines >= 2 ? [20, 40, 30] : 25);
      } else {
        if (prefs.sound) tone([330], 0.05, 0.035);
        if (prefs.buzz) buzz(8);
      }
    },
    [prefs],
  );

  const drop = useCallback(() => {
    setDrag(null);
    if (!game || !target?.ok || !drag) return;
    const result = place(game, drag.slot, target.row, target.col);
    if (!result) return;
    setGame(result.state);
    if (result.cleared.length) {
      counter.current += 1;
      setFlash({ key: counter.current, cells: result.cleared });
    }
    effects(result.points, result.lines, result.combo, result.allClear);
    if (result.state.over && prefs.sound) window.setTimeout(() => tone([392, 330, 262], 0.16, 0.05), 300);
  }, [game, target, drag, effects, prefs.sound]);

  // Follow the finger anywhere on the screen while dragging.
  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => setDrag((d) => (d ? { ...d, x: event.clientX, y: event.clientY } : d));
    const up = () => drop();
    const cancel = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [drag, drop]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 420);
    return () => window.clearTimeout(timer);
  }, [flash]);
  useEffect(() => {
    if (!popup) return;
    const timer = window.setTimeout(() => setPopup(null), 1300);
    return () => window.clearTimeout(timer);
  }, [popup]);

  const restart = () => {
    const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    startBest.current = game?.best ?? 0;
    setGame(newGame(seed, game?.best ?? 0));
    setMenu(false);
    setShowOver(false);
    setConfirmNew(false);
  };
  /** New Game asks first when there is a game going, so a stray tap never throws one away. */
  const askNew = () => {
    if (game && game.placed > 0 && !game.over) setConfirmNew(true);
    else restart();
  };

  const startDrag = (slot: number) => (event: ReactPointerEvent) => {
    if (!game || game.over || !game.tray[slot]) return;
    event.preventDefault();
    setMenu(false);
    setDrag({ slot, x: event.clientX, y: event.clientY, touch: event.pointerType !== "mouse" });
  };

  if (!game) return <div className="blk" />;

  const ghost = new Set<number>();
  const lit = new Set<number>();
  if (target?.ok) {
    for (const [r, c] of target.shape.cells) ghost.add((target.row + r) * SIZE + target.col + c);
    for (const r of target.lines.rows) for (let c = 0; c < SIZE; c += 1) lit.add(r * SIZE + c);
    for (const c of target.lines.cols) for (let r = 0; r < SIZE; r += 1) lit.add(r * SIZE + c);
  }
  const trayCell = classic ? Math.min(cell * 0.62, 30) : Math.min(cell * 0.55, 26);
  /** A tray piece's cell size: the usual one, smaller for long bars so each fits its third of the tray. */
  const fitTray = (shape: Shape) => {
    const cols = Math.max(...shape.cells.map(([, c]) => c)) + 1;
    const rows = Math.max(...shape.cells.map(([r]) => r)) + 1;
    const room = boardPx / 3 - 14;
    const g = classic ? 3 : 2;
    return Math.min(trayCell, (room - g * (cols - 1)) / cols, (room - g * (rows - 1)) / rows);
  };
  const newBest = game.best > startBest.current && game.best === game.score && game.score > 0;

  return (
    <div className={classic ? "blk is-classic" : "blk"} onContextMenu={(event) => event.preventDefault()}>
      {classic ? (
        <header className="blk-top is-classic">
          <strong className="blk-score" aria-live="polite">
            {game.score}
          </strong>
        </header>
      ) : (
      <header className="blk-top">
        {onExit ? (
          <button type="button" className="blk-icon" onClick={onExit} aria-label={exitLabel}>
            ‹
          </button>
        ) : (
          <span className="blk-icon is-blank" />
        )}
        <div className="blk-scores">
          <strong className="blk-score" aria-live="polite">
            {game.score}
          </strong>
          <span className="blk-best">👑 {game.best}</span>
        </div>
        <button type="button" className="blk-icon" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          ⋯
        </button>
      </header>
      )}
      {menu ? (
        <div className={classic ? "blk-menu is-classic" : "blk-menu"} role="menu">
          {classic ? <p className="blk-menu-best">Best score {game.best}</p> : null}
          <button type="button" role="menuitem" onClick={askNew}>
            New game
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={prefs.sound} onClick={() => setPrefs({ ...prefs, sound: !prefs.sound })}>
            Sound {prefs.sound ? "on" : "off"}
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={prefs.buzz} onClick={() => setPrefs({ ...prefs, buzz: !prefs.buzz })}>
            Vibration {prefs.buzz ? "on" : "off"}
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={!classic} onClick={() => setPrefs({ ...prefs, look: classic ? "bright" : "classic" })}>
            Colourful blocks {classic ? "off" : "on"}
          </button>
          {onExit ? (
            <button type="button" role="menuitem" onClick={onExit}>
              {exitLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="blk-stage">
        <div className="blk-board" ref={board} style={{ padding: pad, gap }}>
          {game.board.map((color, i) => {
            const isGhost = ghost.has(i);
            const isLit = lit.has(i);
            const tint = isGhost || (isLit && color === -1) ? colorOf(target!.shape.color) : color >= 0 ? colorOf(color) : undefined;
            return <span key={i} className={`blk-cell ${color >= 0 ? "is-full" : ""} ${isGhost ? "is-ghost" : ""} ${isLit ? "is-lit" : ""}`} style={tint ? ({ "--blk": tint } as CSSProperties) : undefined} />;
          })}
          {flash
            ? flash.cells.map(({ index, color }) => (
                <span
                  key={`${flash.key}-${index}`}
                  className="blk-cell is-full is-clearing"
                  style={{ position: "absolute", left: pad + (index % SIZE) * (cell + gap), top: pad + Math.floor(index / SIZE) * (cell + gap), width: cell, height: cell, "--blk": colorOf(color), animationDelay: `${((index % SIZE) + Math.floor(index / SIZE)) * 14}ms` } as CSSProperties}
                />
              ))
            : null}
          {popup ? (
            <p key={popup.key} className={`blk-popup ${popup.big ? "is-big" : ""}`}>
              {popup.text}
            </p>
          ) : null}
        </div>

        <div className="blk-tray">
          {game.tray.map((id, slot) => {
            const shape = shapeOf(id);
            const playable = shape ? !game.over && fitsAnywhere(game.board, shape) : false;
            return (
              <div key={slot} className={`blk-slot ${drag?.slot === slot ? "is-lifted" : ""} ${shape && !playable ? "is-stuck" : ""}`} onPointerDown={startDrag(slot)}>
                {shape && drag?.slot !== slot ? <ShapeCells shape={shape} cell={fitTray(shape)} gap={classic ? 3 : 2} tint={classic ? CLASSIC_BLUE : undefined} /> : null}
              </div>
            );
          })}
        </div>
      </div>

      {classic ? (
        <nav className="blk-bottom">
          <button type="button" className="blk-new" onClick={askNew}>
            <span className="blk-fab" aria-hidden="true">
              +
            </span>
            New Game
          </button>
          <button type="button" className="blk-settings" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.4 2.7a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.2 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1L11 21h4l.4-2.7c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"
                transform="translate(-1 0)"
              />
            </svg>
            Settings
          </button>
        </nav>
      ) : null}

      {confirmNew ? (
        <div className="blk-over" role="dialog" aria-label="Start a new game?">
          <p className="blk-over-title">Start a new game?</p>
          <p className="blk-over-best">This one ends at {game.score}.</p>
          <button type="button" className="blk-play" onClick={restart}>
            New game
          </button>
          <button type="button" className="blk-link" onClick={() => setConfirmNew(false)}>
            Keep playing
          </button>
        </div>
      ) : null}

      {drag && target ? <ShapeCells shape={target.shape} cell={cell} gap={gap} tint={classic ? CLASSIC_BLUE : undefined} style={{ position: "fixed", left: target.left, top: target.top, pointerEvents: "none", zIndex: 30, opacity: target.ok ? 1 : 0.8 }} /> : null}

      {showOver ? (
        <div className="blk-over" role="dialog" aria-label="Game over">
          <p className="blk-over-title">{newBest ? "New best!" : "No more room"}</p>
          <p className="blk-over-score">{game.score}</p>
          <p className="blk-over-best">Best {game.best}</p>
          <button type="button" className="blk-play" onClick={restart}>
            Play again
          </button>
          {onExit ? (
            <button type="button" className="blk-link" onClick={onExit}>
              {exitLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

