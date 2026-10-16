/**
 * The Moves panel (motion.ts): tap a move to do it, Stop, and make a new one from words
 * ("wave with the left hand then cheer twice", "keep doing jumping jacks"). G opens it too.
 * Everything goes through the make_move and do_move tools, so the log shows it and the model can do
 * the same.
 */
import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { movesOf } from "@/engine/motion";
import { useForge } from "@/engine/store";

let open = false;
const listeners = new Set<() => void>();
const setOpen = (on: boolean) => {
  open = on;
  listeners.forEach((notify) => notify());
};
const useOpen = () =>
  useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => open,
    () => false,
  );

/** The Moves button, by the view buttons (it opens the panel, like Stats). */
export function MovesButton() {
  const on = useOpen();
  return (
    <button type="button" className={`bubble-icon ${on ? "is-on" : ""}`} aria-expanded={on} aria-label="Moves" title="Moves (G)" onClick={() => setOpen(!on)}>
      <Sparkles aria-hidden="true" />
    </button>
  );
}

/** The panel itself, over the view; G opens and closes it. */
export function MovesOverlay() {
  const on = useOpen();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || event.repeat) return;
      if (event.code === "KeyG") setOpen(!open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return on ? <MovesPanel onClose={() => setOpen(false)} /> : null;
}

function MovesPanel({ onClose }: { onClose: () => void }) {
  const stored = useForge((s) => s.moves);
  const doing = useForge((s) => Object.values(s.entities).find((e) => e.tags.includes("architect"))?.customData.move ?? "");
  const all = useMemo(() => movesOf({ moves: stored }), [stored]);
  const [words, setWords] = useState("");
  const [note, setNote] = useState("");
  const run = (tool: string, args: Record<string, string>) => {
    const before = useForge.getState().history.length;
    useForge.getState().dispatchManual(tool, args);
    const result = useForge.getState().history.slice(before).at(-1);
    return result?.title === "Result" ? "" : (result?.body ?? "");
  };
  const make = (event: FormEvent) => {
    event.preventDefault();
    const text = words.trim();
    if (!text) return;
    // Build it from the words and do it straight away; it is kept under its name.
    const problem = run("do_move", { move: text });
    setNote(problem || "Made it. It is in the list now.");
    if (!problem) setWords("");
  };
  const own = all.filter((m) => m.from !== "built in");
  const builtIn = all.filter((m) => m.from === "built in");
  return (
    <section className="moves" aria-label="Moves">
      <div className="moves-head">
        <strong>Moves</strong>
        <button type="button" className="moves-chip" onClick={() => run("do_move", { move: "stop" })} disabled={!doing}>
          Stop
        </button>
        <button type="button" className="moves-chip" onClick={onClose} aria-label="Close moves">
          ✕
        </button>
      </div>
      {own.length ? (
        <div className="moves-row" aria-label="Your moves">
          {own.map((m) => (
            <button key={m.id} type="button" className={`moves-chip is-own ${doing === m.id ? "is-on" : ""}`} onClick={() => run("do_move", { move: m.id })} title={m.from}>
              {m.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="moves-row" aria-label="Built-in moves">
        {builtIn.map((m) => (
          <button key={m.id} type="button" className={`moves-chip ${doing === m.id ? "is-on" : ""}`} onClick={() => run("do_move", { move: m.id })}>
            {m.name}
          </button>
        ))}
      </div>
      <form className="moves-make" onSubmit={make}>
        <input value={words} onChange={(e) => setWords(e.target.value)} placeholder="Make one: wave left then cheer twice" aria-label="Describe a new move" maxLength={200} />
        <button type="submit" className="moves-chip">
          Make
        </button>
      </form>
      {note ? <p className="moves-note">{note}</p> : null}
    </section>
  );
}
