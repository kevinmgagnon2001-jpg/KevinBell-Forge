/**
 * The helm's input over the full view, kept small: two round buttons instead of a bar across the
 * screen.
 *
 *   🎙  Speak: listens (speech.ts: Android's voice input in the app, the browser's elsewhere) and
 *       sends what you said straight to the helm, showing the words for a moment.
 *   ⌨  Type: opens the text bar (the keyboard's own dictation works in it too); it tucks away again
 *       after you send, or with ✕ / Esc.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useForge } from "@/engine/store";
import { listen, useCanListen } from "./speech";

export function HelmAsk() {
  const busy = useForge((s) => s.busy);
  const [open, setOpen] = useState(false);
  const [line, setLine] = useState("");
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const speech = useCanListen();

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!heard) return;
    const timer = window.setTimeout(() => setHeard(""), 4000);
    return () => window.clearTimeout(timer);
  }, [heard]);

  const send = (text: string) => {
    const intent = text.trim();
    if (!intent) return;
    void useForge.getState().submitIntent(intent);
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(line);
    setLine("");
    setOpen(false);
  };
  const speak = async () => {
    if (listening) return;
    setListening(true);
    setHeard("");
    const result = await listen();
    setListening(false);
    if ("text" in result) {
      setHeard(`“${result.text}”`);
      send(result.text);
      return;
    }
    // Nothing said, or no voice input on this device: say so, and offer the keyboard.
    setHeard(result.error === "cancelled" || result.error === "no speech" ? "Didn't catch that" : result.error);
    if (result.error !== "cancelled" && result.error !== "no speech") setOpen(true);
  };

  if (open) {
    return (
      <form className="visor-ask" onSubmit={onSubmit}>
        <label>
          <span>Helm</span>
          <input
            ref={input}
            value={line}
            onChange={(event) => setLine(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
            placeholder="Tell the helm what to change"
            disabled={busy}
            enterKeyHint="send"
          />
          {speech ? (
            <button type="button" className="helm-mini" aria-label="Speak instead" onClick={() => void speak()} disabled={busy || listening}>
              🎙
            </button>
          ) : null}
          <button type="button" className="helm-mini" aria-label="Close" onClick={() => setOpen(false)}>
            ✕
          </button>
        </label>
      </form>
    );
  }
  return (
    <div className="helm-quick">
      {heard || listening ? <p className="helm-heard">{listening ? "Listening…" : heard}</p> : null}
      {speech ? (
        <button type="button" className={`helm-round ${listening ? "is-listening" : ""}`} aria-label="Speak to the helm" onClick={() => void speak()} disabled={busy}>
          🎙
        </button>
      ) : null}
      <button type="button" className="helm-round" aria-label="Type to the helm" onClick={() => setOpen(true)} disabled={busy}>
        ⌨
      </button>
    </div>
  );
}
