import type { HarnessTrace } from "./vm.ts";

export function parseCritic(text: string): { pass: boolean; fix: string } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { pass: true, fix: "" };
  try {
    const parsed = JSON.parse(match[0]) as { pass?: unknown; fix?: unknown };
    const pass = parsed.pass !== false && parsed.pass !== "false";
    const fix = typeof parsed.fix === "string" ? parsed.fix.replace(/\s+/g, " ").trim().slice(0, 240) : "";
    return { pass, fix };
  } catch {
    return { pass: true, fix: "" };
  }
}

export function criticPrompt(scene: string, intent: string): string {
  return [
    "You are the second model, a critic sitting in the same scene.",
    "The actor is handling the command at the same time. Reply with one JSON object and no other text.",
    '{"pass":true} if the scene will already satisfy the command.',
    '{"pass":false,"fix":"one short command"} if the actor should do something else.',
    "The avatar is the actor's body. Edit it. Do not delete it.",
    "Scene:",
    scene || "(empty)",
    `Command: ${intent}`,
  ].join("\n");
}

/** Used while the second model is still loading, so a round of feedback still happens. */
export function localReview(trace: HarnessTrace): { pass: boolean; fix: string } {
  if (trace.ok) return { pass: true, fix: "" };
  return { pass: false, fix: "" };
}
