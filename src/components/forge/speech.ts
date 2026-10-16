/**
 * Speak to the helm. One call, whatever the device:
 *
 *   Android app   ForgeAndroid.listen (MainActivity.kt) opens Android's own voice input; the words
 *                 come back through window.__forgeSpeech. Forge itself never touches the microphone.
 *   browsers      the Web Speech API (Chrome, Edge, Safari), where it exists.
 *
 * `canListen()` says whether either is there; without one, the helm opens its text box instead, and
 * the phone keyboard's own dictation works in it as usual.
 */
import { useEffect, useState } from "react";

type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};

type SpeechWindow = {
  ForgeAndroid?: { listen?: (prompt: string) => boolean };
  __forgeSpeech?: (result: { text?: string; error?: string }) => void;
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

const w = globalThis as SpeechWindow;

export function canListen(): boolean {
  return typeof w.ForgeAndroid?.listen === "function" || !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

/** canListen() for components: false on the server and the first render, so the page hydrates cleanly. */
export function useCanListen(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => setCan(canListen()), []);
  return can;
}

/** Listen once. Resolves with the words, or an error ("no speech", "cancelled", ...). */
export function listen(prompt = "Tell the helm what to change"): Promise<{ text: string } | { error: string }> {
  return new Promise((resolve) => {
    if (typeof w.ForgeAndroid?.listen === "function") {
      w.__forgeSpeech = (result) => {
        w.__forgeSpeech = undefined;
        const text = result?.text?.trim();
        resolve(text ? { text } : { error: result?.error || "no speech" });
      };
      if (!w.ForgeAndroid.listen(prompt)) {
        w.__forgeSpeech = undefined;
        resolve({ error: "This phone has no voice input app" });
      }
      return;
    }
    const Engine = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Engine) {
      resolve({ error: "Speech is not available here" });
      return;
    }
    const rec = new Engine();
    rec.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let done = false;
    const finish = (value: { text: string } | { error: string }) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    rec.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim() ?? "";
      finish(text ? { text } : { error: "no speech" });
    };
    rec.onerror = (event) => finish({ error: event.error === "not-allowed" ? "Microphone not allowed" : event.error || "no speech" });
    rec.onend = () => finish({ error: "no speech" });
    try {
      rec.start();
    } catch {
      finish({ error: "Could not start listening" });
    }
  });
}
