/**
 * The arcade on screen (src/engine/arcade.ts has the games). Walk up to a game and a "Play" prompt
 * appears; E, the gamepad's X or a tap starts it. While playing, the game owns the controls:
 *
 *   keyboard  the game's keys (Tetris: ◀ ▶ or A D move, ↑ W X rotate, ↓ S faster, Space drops)
 *   gamepad   the d-pad and face buttons (A rotates, X drops), B leaves
 *   touch     big buttons in place of the sticks; hold ◀ ▶ ▼ to repeat
 *
 * The game keeps its own clock (the piece falls even with the world paused), the camera frames the
 * board (pilot.tsx), and Esc, B or Exit puts you back on your feet where you stood.
 */
import { RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { bestOf, EXIT_KEYS, EXIT_PAD, gameById, moveForKey, moveForPad, nearestGame, withBest, type GameMove, type GameSpec } from "@/engine/arcade";
import { useForge } from "@/engine/store";
import { BlocksGame } from "@/components/blocks/BlocksGame";
import { BreakoutGame } from "./BreakoutGame";
import { INTERACT_EVENT, pilotKeys, pilotStick, useLook } from "./look";
import { arcadeNear, arcadePlaying, screenKeys, useArcadeNear, useArcadePlaying } from "./body-state";

/** Apply one move to the live world, without an undo step or a log line per keypress. */
function applyMove(game: GameSpec, move: string) {
  useForge.setState((state) => {
    const next = game.play(state, move);
    return next === state ? state : { entities: next.entities, nextId: next.nextId };
  });
}

function restart(game: GameSpec) {
  useForge.setState((state) => {
    const next = game.restart(state);
    return { entities: next.entities, nextId: next.nextId };
  });
}

function start(game: string, label: string) {
  pilotKeys.clear();
  pilotStick.x = 0;
  pilotStick.y = 0;
  arcadePlaying.set({ game, label });
}

function leave() {
  pilotKeys.clear();
  arcadePlaying.set(null);
}

/** Held keys and buttons repeat after a short wait, like a real keyboard. */
const REPEAT_WAIT = 0.17;
const REPEAT_EVERY = 0.055;

/** A big on-screen button for one move; holding a repeating move repeats it. */
function MoveButton({ game, move }: { game: GameSpec; move: GameMove }) {
  const timer = useRef<number | null>(null);
  const stop = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const press = () => {
    applyMove(game, move.id);
    if (!move.repeat) return;
    const again = (wait: number) => {
      timer.current = window.setTimeout(() => {
        applyMove(game, move.id);
        again(REPEAT_EVERY * 1000);
      }, wait);
    };
    again(REPEAT_WAIT * 1000);
  };
  return (
    <button
      type="button"
      className={`arcade-key is-${move.id}`}
      aria-label={move.id}
      onPointerDown={(event) => {
        event.preventDefault();
        stop();
        press();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(event) => event.preventDefault()}
    >
      {move.label}
    </button>
  );
}

export function Arcade() {
  const { mode } = useLook();
  const near = useArcadeNear();
  const playing = useArcadePlaying();
  const game = playing ? gameById(playing.game) : undefined;
  const status = useForge((s) => {
    if (!game) return "";
    const board = game.find(s);
    return board ? game.status(s, board) : "";
  });
  const over = useForge((s) => {
    if (!game) return false;
    const board = game.find(s);
    return board ? game.over(s, board) : false;
  });
  const [padName, setPadName] = useState("");

  // Which game you are standing at, a few times a second.
  useEffect(() => {
    const look = () => {
      if (mode === "bench" || arcadePlaying.get()) {
        arcadeNear.set(null);
        return;
      }
      const state = useForge.getState();
      const you = Object.values(state.entities).find((e) => e.tags.includes("architect"));
      const found = you ? nearestGame(state, you.transform.position) : null;
      const current = arcadeNear.get();
      if (!found) arcadeNear.set(null);
      else if (current?.game !== found.game.id) arcadeNear.set({ game: found.game.id, label: found.game.label });
    };
    look();
    const timer = window.setInterval(look, 200);
    return () => window.clearInterval(timer);
  }, [mode]);

  // Leave if the game goes away (deleted, undone) or the view goes to the bench.
  useEffect(() => {
    if (!playing) return;
    if (mode === "bench") leave();
    return useForge.subscribe((state) => {
      const g = gameById(playing.game);
      if (!g?.find(state)) leave();
    });
  }, [playing, mode]);

  // Keys: E plays the game you are at; while playing, the game's keys, and Esc leaves. Capture first,
  // so walking, the phone and the bench's own Tetris keys do not also act on them.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const now = arcadePlaying.get();
      if (!now) {
        const at = arcadeNear.get();
        if (at && event.code === "KeyE" && !event.repeat) {
          event.preventDefault();
          event.stopImmediatePropagation();
          start(at.game, at.label);
        }
        return;
      }
      const g = gameById(now.game);
      if (!g) return;
      if (EXIT_KEYS.includes(event.key) || EXIT_KEYS.includes(event.code)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        // After this key has been seen by everyone else, so Esc does not also leave the full view.
        window.setTimeout(leave, 0);
        return;
      }
      event.stopImmediatePropagation();
      if (g.screen) {
        screenKeys.down?.(event);
        return;
      }
      const move = moveForKey(g, event.code);
      if (!move) return;
      event.preventDefault();
      if (event.repeat && !move.repeat) return;
      applyMove(g, move.id);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  // The gamepad's X (or the "use" button anywhere) plays the game you are at.
  useEffect(() => {
    const use = () => {
      const at = arcadeNear.get();
      if (at && !arcadePlaying.get()) start(at.game, at.label);
    };
    window.addEventListener(INTERACT_EVENT, use);
    return () => window.removeEventListener(INTERACT_EVENT, use);
  }, []);

  // While playing: the game's clock, and the gamepad.
  useEffect(() => {
    if (!game) return;
    let frame = 0;
    let last = performance.now();
    let tick = 0;
    const held = new Map<number, number>();
    // Buttons already down as the game starts (the X that started it) wait to be let go.
    const firstPad = (navigator.getGamepads ? Array.from(navigator.getGamepads() ?? []) : []).find((p) => p && p.connected);
    firstPad?.buttons.forEach((button, index) => {
      if (button.pressed) held.set(index, Number.NEGATIVE_INFINITY);
    });
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const state = useForge.getState();
      const board = game.find(state);
      if (board && game.clock && !game.over(state, board)) {
        const clock = game.clock(state, board);
        tick += dt;
        if (tick >= clock.every) {
          tick = 0;
          applyMove(game, clock.move);
        }
      }
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads() ?? []) : [];
      const pad = pads.find((p) => p && p.connected);
      if (pad) {
        setPadName((name) => (name ? name : pad.id));
        pad.buttons.forEach((button, index) => {
          if (!button.pressed) {
            held.delete(index);
            return;
          }
          const since = held.get(index);
          if (since === Number.NEGATIVE_INFINITY) return;
          if (since === undefined) {
            held.set(index, 0);
            if (EXIT_PAD.includes(index)) {
              leave();
              return;
            }
            const move = moveForPad(game, index);
            if (move) applyMove(game, move.id);
            return;
          }
          const move = moveForPad(game, index);
          if (!move?.repeat) return;
          const next = since + dt;
          held.set(index, next);
          if (next >= REPEAT_WAIT) {
            held.set(index, REPEAT_WAIT - REPEAT_EVERY);
            applyMove(game, move.id);
          }
        });
      }
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, [game]);

  const begin = useCallback(() => {
    const at = arcadeNear.get();
    if (at) start(at.game, at.label);
  }, []);

  if (game?.screen && playing) {
    // A game with a screen of its own (Blocks): full screen over everything, until you walk away.
    return (
      <div className="arcade-screen" role="dialog" aria-label={playing.label}>
        {game.id === "breakout" ? (
          <BreakoutGame best={bestOf(useForge.getState(), "breakout")} onBest={(score) => useForge.setState((state) => withBest(state, "breakout", score))} onExit={leave} />
        ) : (
          <BlocksGame onExit={leave} exitLabel="Walk away" />
        )}
      </div>
    );
  }
  if (game && playing) {
    const keyHelp = game.id === "tetris" ? "◀ ▶ move · ↑ rotate · ↓ faster · Space drops · Esc leaves" : "Space releases the marble · Esc leaves";
    return (
      <div className="arcade" role="region" aria-label={`Playing ${playing.label}`}>
        <div className="arcade-bar">
          <strong>{playing.label}</strong>
          <span className="arcade-status">{status}</span>
          <button type="button" className="arcade-exit visor-key bubble-icon" aria-label="Exit" title="Exit (Esc)" onClick={leave}>
            <X aria-hidden />
          </button>
        </div>
        {over ? (
          <div className="arcade-over">
            <p>{status}</p>
            <div className="arcade-over-actions">
              <button type="button" className="visor-key bubble-icon" aria-label="Play again" title="Play again" onClick={() => restart(game)}>
                <RotateCcw aria-hidden />
              </button>
              <button type="button" className="visor-key bubble-icon" aria-label="Walk away" title="Walk away" onClick={leave}>
                <X aria-hidden />
              </button>
            </div>
          </div>
        ) : null}
        <p className="arcade-help">{padName ? "Controller: d-pad moves · A rotates · X drops · B leaves" : keyHelp}</p>
        <div className={`arcade-pad is-${game.id}`}>
          {game.moves.map((move) => (
            <MoveButton key={move.id} game={game} move={move} />
          ))}
        </div>
      </div>
    );
  }
  if (near && mode !== "bench") {
    return (
      <button type="button" className="arcade-prompt" onClick={begin}>
        Play {near.label} <kbd>E</kbd>
      </button>
    );
  }
  return null;
}
