/**
 * Your own words: "when I say party, light a campfire then make it rain then fill the plaza".
 * Saying "party" afterwards runs the rest, step by step, with no model. Kept in the world (saved,
 * shared with linked devices). "forget party" drops one; "my phrases" lists them.
 */
import type { Phrase } from "./types.ts";

export const MAX_PHRASES = 32;

const key = (text: string) =>
  text
    .toLowerCase()
    .replace(/[“”"'’.!?]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export type PhraseCall =
  | { kind: "teach"; say: string; does: string }
  | { kind: "forget"; say: string }
  | { kind: "list" };

/** A request about phrases themselves, or null. */
export function readPhraseRequest(intent: string): PhraseCall | null {
  const text = intent.trim();
  const lead = String.raw`^(?:when(?:ever)?|if)\s+i\s+say\s+`;
  const glue = String.raw`(?:then\s+|do\s+|it\s+means\s+|that\s+means\s+|means\s+|you\s+)?`;
  const teach =
    text.match(new RegExp(String.raw`${lead}["“'](.+?)["”']\s*,?\s*${glue}(.+)$`, "i")) ??
    text.match(new RegExp(String.raw`${lead}([^,"“]+?)\s*,\s*${glue}(.+)$`, "i")) ??
    text.match(new RegExp(String.raw`${lead}(.+?)\s+(?:do|means|it means|that means|then)\s+(.+)$`, "i"));
  if (teach) {
    const say = key(teach[1]);
    const does = teach[2].trim();
    if (say && does && say.length <= 40) return { kind: "teach", say, does };
  }
  const named = text.match(/^(?:teach|learn)\s+["“']?(.+?)["”']?\s+(?:as|means|=)\s+(.+)$/i);
  if (named) return { kind: "teach", say: key(named[1]), does: named[2].trim() };
  const forget = text.match(/^(?:forget|unlearn|delete the phrase|remove the phrase)\s+["“']?(.+?)["”']?$/i);
  if (forget) return { kind: "forget", say: key(forget[1]) };
  if (/^(?:my phrases|list (?:my )?phrases|what phrases do you know|what have i taught you|show (?:my )?phrases)\??$/i.test(text)) return { kind: "list" };
  return null;
}

/** What a phrase does, when the words are exactly one you taught. */
export function phraseFor(phrases: Phrase[] | undefined, intent: string): string | null {
  const said = key(intent);
  return phrases?.find((p) => p.say === said)?.does ?? null;
}

export function teach(phrases: Phrase[] | undefined, say: string, does: string): Phrase[] {
  return [...(phrases ?? []).filter((p) => p.say !== say), { say, does: does.slice(0, 400) }].slice(-MAX_PHRASES);
}

export function forget(phrases: Phrase[] | undefined, say: string): Phrase[] {
  return (phrases ?? []).filter((p) => p.say !== say);
}

/** From a save: well-formed phrases only. */
export function cleanPhrases(value: unknown): Phrase[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((p): p is Phrase => !!p && typeof p === "object" && typeof (p as Phrase).say === "string" && typeof (p as Phrase).does === "string")
    .map((p) => ({ say: key(p.say).slice(0, 40), does: p.does.slice(0, 400) }))
    .filter((p) => p.say && p.does)
    .slice(-MAX_PHRASES);
  return out.length ? out : undefined;
}
