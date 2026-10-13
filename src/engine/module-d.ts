import type { ProposedAction } from "./types.ts";

const FILE = String.raw`(?:inbox\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,60}\.(?:md|txt|json)`;
const FILE_RE = new RegExp(`\\b(${FILE})\\b`, "i");

function clip(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function filePath(intent: string): string | null {
  const named = intent.match(new RegExp(`\\b(?:named|called|file)\\s+(${FILE})\\b`, "i"));
  const found = named?.[1] ?? intent.match(FILE_RE)?.[1];
  return found ? found.replace(/^inbox\//i, "inbox/") : null;
}

function noteBody(intent: string): string {
  const colon = intent.match(/:\s*([\s\S]+)$/);
  if (colon?.[1].trim()) return clip(colon[1], 4000);
  const says = intent.match(/\b(?:says|saying|reading)\s+([\s\S]+)$/i);
  return says?.[1] ? clip(says[1], 4000) : "";
}

/**
 * Module D, as a tool call. Notes and public pages only.
 * A normal forge command, including "look up", stays on the existing path.
 */
export function moduleDProposal(intent: string): ProposedAction | null {
  const lower = intent.toLowerCase();
  const sandbox = /\b(sandbox|loopback)\b/.test(lower);
  const url = intent.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.;]+$/, "") ?? "";

  if (sandbox && /\b(list|files|contents)\b/.test(lower)) {
    const folder = /\binbox\b/.test(lower) ? "inbox" : ".";
    return { kind: "tool_call", toolName: "sandbox_list", arguments: { path: folder }, message: "list sandbox notes" };
  }
  if (sandbox && /\b(read|open|show|cat)\b/.test(lower)) {
    const path = filePath(intent);
    if (!path) return { kind: "tool_call", toolName: "sandbox_list", arguments: { path: "." }, message: "list sandbox notes" };
    return { kind: "tool_call", toolName: "sandbox_read", arguments: { path }, message: "read sandbox note" };
  }
  if (sandbox && /\b(write|save|file|note|put)\b/.test(lower)) {
    return {
      kind: "tool_call",
      toolName: "sandbox_write",
      arguments: { path: filePath(intent) ?? "note.md", text: noteBody(intent) },
      message: "write sandbox note",
    };
  }
  if (url && /\b(fetch|ingest|browse|clean|file|save)\b/.test(lower)) {
    return { kind: "tool_call", toolName: "search_web_clean", arguments: { query: url }, message: "fetch a public page" };
  }
  if (/\b(file|save)\b/.test(lower) && /\b(web page|webpage|article)\b/.test(lower)) {
    const query = clip(url || intent.replace(/\b(please|file|save|the|a|an|web page|webpage|article|about|into|the|sandbox)\b/gi, " "), 300);
    if (!query) return null;
    return { kind: "tool_call", toolName: "search_web_clean", arguments: { query }, message: "file a public page" };
  }
  return null;
}
