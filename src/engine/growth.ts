/**
 * Living growth over things (Papers roadmap: living moss, after neural cellular automata, in a
 * classic form: Gray-Scott reaction-diffusion, a continuous automaton whose two chemicals feed and
 * kill each other into spots, worms and labyrinths, like moss, frost, rust and crystal). The pattern
 * is grown once into a small tiling texture; Growth.tsx wraps it over a thing and lets it creep out
 * from a seed point over time.
 *
 *   grayScott   the automaton: size², steps, feed and kill rates.
 *   GROWTHS     the kinds: their feed and kill (which pattern), colours and how fast they spread.
 *   grow        the tool: start a growth on a thing (or take it off).
 */
import type { World } from "./types.ts";

export type GrowthKind = "moss" | "frost" | "rust" | "crystal";

export const GROWTHS: Record<GrowthKind, { feed: number; kill: number; color: [string, string]; speed: number; shine: number; glow: number }> = {
  // Coral-like spots and branches.
  moss: { feed: 0.0545, kill: 0.062, color: ["#2f5a1c", "#8fbf4a"], speed: 0.12, shine: 0.1, glow: 0 },
  // Fine worms, like frost ferns.
  frost: { feed: 0.029, kill: 0.057, color: ["#bcd8ff", "#ffffff"], speed: 0.3, shine: 0.9, glow: 0.25 },
  // Round blotches.
  rust: { feed: 0.03, kill: 0.062, color: ["#5a2a12", "#c4642a"], speed: 0.08, shine: 0.15, glow: 0 },
  // A labyrinth that glows.
  crystal: { feed: 0.039, kill: 0.058, color: ["#3b8fd9", "#b6f7ff"], speed: 0.2, shine: 1, glow: 1.2 },
};
export const GROWTH_KINDS = Object.keys(GROWTHS) as GrowthKind[];

/**
 * Gray-Scott reaction-diffusion on a size × size torus (so the texture tiles). Returns the second
 * chemical, 0..1 (where the pattern is). Seeded, so the same call gives the same pattern.
 */
export function grayScott(size: number, steps: number, feed: number, kill: number, seed = 1): Float32Array {
  const n = size * size;
  let a = new Float32Array(n).fill(1);
  let b = new Float32Array(n);
  let na = new Float32Array(n);
  let nb = new Float32Array(n);
  let s = seed >>> 0 || 1;
  const rand = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  // Scattered seeds of the second chemical.
  for (let k = 0; k < Math.max(6, Math.floor(n / 220)); k += 1) {
    const cx = Math.floor(rand() * size);
    const cy = Math.floor(rand() * size);
    for (let dy = -2; dy <= 2; dy += 1)
      for (let dx = -2; dx <= 2; dx += 1) {
        const i = ((cy + dy + size) % size) * size + ((cx + dx + size) % size);
        b[i] = 1;
        a[i] = 0.5;
      }
  }
  const da = 1;
  const db = 0.5;
  for (let step = 0; step < steps; step += 1) {
    for (let y = 0; y < size; y += 1) {
      const up = ((y - 1 + size) % size) * size;
      const row = y * size;
      const down = ((y + 1) % size) * size;
      for (let x = 0; x < size; x += 1) {
        const l = (x - 1 + size) % size;
        const r = (x + 1) % size;
        const i = row + x;
        const lapA = 0.2 * (a[row + l] + a[row + r] + a[up + x] + a[down + x]) + 0.05 * (a[up + l] + a[up + r] + a[down + l] + a[down + r]) - a[i];
        const lapB = 0.2 * (b[row + l] + b[row + r] + b[up + x] + b[down + x]) + 0.05 * (b[up + l] + b[up + r] + b[down + l] + b[down + r]) - b[i];
        const abb = a[i] * b[i] * b[i];
        na[i] = Math.min(1, Math.max(0, a[i] + da * lapA - abb + feed * (1 - a[i])));
        nb[i] = Math.min(1, Math.max(0, b[i] + db * lapB + abb - (kill + feed) * b[i]));
      }
    }
    [a, na] = [na, a];
    [b, nb] = [nb, b];
  }
  return b;
}

/** grow: moss, frost, rust or crystal on a thing (kind none takes it off). */
export function grow(world: World, args: Record<string, string>): { ok: boolean; detail: string; world: World } {
  const q = (args.thing ?? "").trim().toLowerCase().replace(/^(the|a|an|my)\s+/, "");
  const all = Object.values(world.entities).filter((e) => !e.tags.includes("helm") && !e.tags.includes("architect"));
  const target = q ? (all.find((e) => e.name.toLowerCase() === q) ?? all.find((e) => q.length > 2 && e.name.toLowerCase().includes(q))) : world.entities[(world as World & { selectedId?: number }).selectedId ?? -1];
  if (!target) return { ok: false, detail: q ? `nothing called ${q}` : "say what it should grow on", world };
  const kind = (args.kind ?? "").trim().toLowerCase();
  if (/^(none|off|clean|nothing)$/.test(kind)) {
    const { growth: _g, growthSeq: _s, ...rest } = target.customData;
    return { ok: true, detail: `${target.name} is clean again.`, world: { ...world, entities: { ...world.entities, [target.id]: { ...target, customData: rest } } } };
  }
  const k = (GROWTH_KINDS as string[]).includes(kind) ? (kind as GrowthKind) : "moss";
  const seq = String((Number(target.customData.growthSeq) || 0) + 1);
  const words: Record<GrowthKind, string> = {
    moss: "Moss starts to creep over",
    frost: "Frost ferns spread across",
    rust: "Rust blooms over",
    crystal: "Glowing crystal grows across",
  };
  return {
    ok: true,
    detail: `${words[k]} ${target.name}.`,
    world: { ...world, entities: { ...world.entities, [target.id]: { ...target, customData: { ...target.customData, growth: k, growthSeq: seq } } } },
  };
}

/** Plain requests: "grow moss on the column", "frost the bench", "let the steel rust", "clean the column". */
export function growthIntent(intent: string): { tool: "grow"; arguments: Record<string, string> } | null {
  const t = intent.trim().toLowerCase().replace(/[.!?]+$/, "");
  if (t.split(/\s+/).length > 10) return null;
  let m = t.match(/^(?:grow|spread|put|cover)\s+(moss|frost|rust|crystals?|ice)\s+(?:on|over|across|onto)\s+(.+)$/);
  if (m) return { tool: "grow", arguments: { kind: kindOf(m[1]), thing: m[2] } };
  m = t.match(/^(?:let\s+)?(?:the\s+)?(.+?)\s+(rust|frost over|freeze|grow moss|crystalli[sz]e)$/);
  if (m) return { tool: "grow", arguments: { kind: kindOf(m[2]), thing: m[1] } };
  m = t.match(/^(frost|rust|freeze|crystalli[sz]e|moss)\s+(?:over\s+)?(.+)$/);
  if (m) return { tool: "grow", arguments: { kind: kindOf(m[1]), thing: m[2] } };
  m = t.match(/^(?:clean|scrub|wipe)\s+(.+)$/);
  if (m) return { tool: "grow", arguments: { kind: "none", thing: m[1] } };
  return null;
}

function kindOf(word: string): GrowthKind {
  if (/frost|freeze|ice/.test(word)) return "frost";
  if (/rust/.test(word)) return "rust";
  if (/crystal/.test(word)) return "crystal";
  return "moss";
}
