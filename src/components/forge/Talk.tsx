/**
 * Talking with the townsfolk (src/engine/talk.ts). Walk up to someone and a talk bubble with their
 * name appears (E, the gamepad's X, or tap it). They stop, turn to you and say hello; type or speak
 * (the microphone bubble) and they answer in a speech bubble over their head, out loud, in a voice
 * of their own. With the resident model loaded they answer in their own words; without it, from
 * what they know. They remember the talk. Walk away or press Esc to end it.
 */
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { MessageCircle, Mic, SendHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { chatResident, residentReady } from "@/engine/resident";
import { useForge } from "@/engine/store";
import { cleanReply, heard, mouthTrack, nearestPerson, personaPrompt, scriptedReply, TALK_REACH, voiceOf } from "@/engine/talk";
import type { Group } from "three";
import { arcadeNear, arcadePlaying, mouths, talking, talkNear, townBodies, useTalking, useTalkNear } from "./body-state";
import { INTERACT_EVENT, useLook } from "./look";
import { canListen, listen } from "./speech";

const me = () => Object.values(useForge.getState().entities).find((e) => e.tags.includes("architect"));

/** Say it out loud on the device, in this person's voice, if the device can; the mouth moves with it. */
function speak(id: number, text: string) {
  const state = useForge.getState();
  const who = state.entities[id];
  if (!who || !text) return;
  const v = voiceOf(who, state.town?.minds[id]?.traits);
  const lips = () => {
    mouths[id] = { start: performance.now(), track: mouthTrack(text, v.rate) };
  };
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (!synth) {
    lips();
    return;
  }
  // Start the mouth with the voice; if no voice starts soon, move it anyway.
  let started = false;
  const fallback = window.setTimeout(() => {
    if (!started) lips();
  }, 400);
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const lang = (navigator.language || "en").slice(0, 2);
    const voices = synth.getVoices().filter((voice) => voice.lang.startsWith(lang));
    if (voices.length) u.voice = voices[v.index % voices.length];
    u.pitch = v.pitch;
    u.rate = v.rate;
    u.onstart = () => {
      started = true;
      window.clearTimeout(fallback);
      lips();
    };
    synth.speak(u);
  } catch {
    // No voice here; the bubble (and the mouth) still show it.
  }
}

/** Their answer: the resident model in character when it is loaded, else what they know. */
async function answer(id: number, said: string): Promise<string> {
  const state = useForge.getState();
  const prompt = personaPrompt(state, id, said);
  if (prompt && state.residentPower && residentReady(state.residentId)) {
    try {
      const text = await Promise.race([chatResident(prompt), new Promise<string>((resolve) => window.setTimeout(() => resolve(""), 15000))]);
      const clean = cleanReply(text);
      if (clean) return clean;
    } catch {
      // Fall through to what they know.
    }
  }
  return scriptedReply(state, id, said);
}

async function say(id: number, said: string) {
  const now = talking.get();
  if (!now || now.id !== id) return;
  talking.set({ ...now, thinking: true });
  const reply = await answer(id, said);
  const still = talking.get();
  if (!still || still.id !== id) return;
  talking.set({ ...still, reply, thinking: false });
  if (said) useForge.setState((s) => ({ town: heard(s, id, said).town }));
  speak(id, reply);
}

function begin(id: number, name: string) {
  talking.set({ id, name, reply: "", thinking: true });
  void say(id, "");
}

function end() {
  const was = talking.get();
  if (was) delete mouths[was.id];
  talking.set(null);
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // Nothing to stop.
  }
}

/** The talk prompt and the box you talk in (DOM, over the view). */
export function Talk() {
  const near = useTalkNear();
  const chat = useTalking();
  const mode = useLook().mode;
  const [text, setText] = useState("");
  const [hearing, setHearing] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Who is close enough to talk to, and walking off ends a talk.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const body = me();
      const state = useForge.getState();
      if (!body || !state.town || mode === "bench" || arcadePlaying.get()) {
        talkNear.set(null);
        if (talking.get()) end();
        return;
      }
      const p = body.transform.position;
      const now = talking.get();
      if (now) {
        const there = townBodies[now.id] ?? state.entities[now.id]?.transform.position;
        if (!there || Math.hypot(there.x - p.x, there.z - p.z) > TALK_REACH + 1.4) end();
        return;
      }
      const was = talkNear.get();
      // Someone already offered stays offered a little further out, so a passer-by is easy to catch.
      const kept = was ? nearestPerson(state, p, { [was.id]: townBodies[was.id] ?? state.entities[was.id]?.transform.position }, TALK_REACH + 0.9) : null;
      const who = kept && kept.id === was?.id ? kept : nearestPerson(state, p, townBodies);
      if ((who?.id ?? null) !== (was?.id ?? null)) talkNear.set(who ? { id: who.id, name: who.name } : null);
    }, 200);
    return () => window.clearInterval(timer);
  }, [mode]);

  // E (or the gamepad's X) talks, when nobody is talking and no game is closer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (talking.get() && event.code === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        end();
        return;
      }
      const at = talkNear.get();
      if (!at || talking.get() || arcadeNear.get() || event.code !== "KeyE" || event.repeat) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      begin(at.id, at.name);
    };
    const use = () => {
      const at = talkNear.get();
      if (at && !talking.get() && !arcadeNear.get()) begin(at.id, at.name);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener(INTERACT_EVENT, use);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener(INTERACT_EVENT, use);
    };
  }, []);

  useEffect(() => {
    if (chat) input.current?.focus({ preventScroll: true });
  }, [chat?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
      const words = text.trim();
      if (!chat || !words) return;
      setText("");
      void say(chat.id, words);
    },
    [chat, text],
  );

  const speakIn = useCallback(async () => {
    if (!chat) return;
    setHearing(true);
    const got = await listen(`Talk to ${chat.name}`);
    setHearing(false);
    if ("text" in got) void say(chat.id, got.text);
  }, [chat]);

  if (chat) {
    return (
      <form className="talk-box" onSubmit={send} aria-label={`Talking with ${chat.name}`}>
        <span className="talk-name">{chat.name}</span>
        <input
          ref={input}
          className="talk-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") end();
            e.stopPropagation();
          }}
          placeholder={`Say something to ${chat.name}`}
          aria-label={`Say something to ${chat.name}`}
          maxLength={240}
        />
        {canListen() ? (
          <button type="button" className={`visor-key bubble-icon ${hearing ? "is-on" : ""}`} aria-label="Speak" title="Speak" aria-pressed={hearing} onClick={() => void speakIn()}>
            <Mic aria-hidden />
          </button>
        ) : null}
        <button type="submit" className="visor-key bubble-icon" aria-label="Say it" title="Say it (Enter)" disabled={!text.trim()}>
          <SendHorizontal aria-hidden />
        </button>
        <button type="button" className="visor-key bubble-icon" aria-label="Stop talking" title="Stop talking (Esc)" onClick={end}>
          <X aria-hidden />
        </button>
      </form>
    );
  }
  if (near && mode !== "bench") {
    return (
      <button type="button" className="arcade-prompt talk-prompt" aria-label={`Talk to ${near.name}`} title={`Talk to ${near.name} (E)`} onClick={() => begin(near.id, near.name)}>
        <MessageCircle aria-hidden /> {near.name} <kbd>E</kbd>
      </button>
    );
  }
  return null;
}

/** Their words in a speech bubble over their head (in the scene). */
export function TalkBubble() {
  const chat = useTalking();
  const anchor = useRef<Group>(null);
  useFrame(() => {
    const g = anchor.current;
    if (!g || !chat) return;
    const body = townBodies[chat.id];
    const e = useForge.getState().entities[chat.id];
    const x = body?.x ?? e?.transform.position.x ?? 0;
    const z = body?.z ?? e?.transform.position.z ?? 0;
    const y = (e?.transform.position.y ?? 0.7) + 0.95;
    g.position.set(x, y, z);
  });
  if (!chat) return null;
  return (
    <group ref={anchor}>
      <Html center zIndexRange={[30, 0]} pointerEvents="none">
        <div className={`talk-bubble ${chat.thinking ? "is-thinking" : ""}`} aria-live="polite">
          {chat.thinking ? (
            <span className="talk-dots" aria-label={`${chat.name} is thinking`}>
              <i />
              <i />
              <i />
            </span>
          ) : (
            chat.reply
          )}
        </div>
      </Html>
    </group>
  );
}
