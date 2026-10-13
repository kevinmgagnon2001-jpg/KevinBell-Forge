export const NAMED_COLORS: readonly { name: string; hex: string }[] = [
  { name: "red", hex: "#e15a4a" },
  { name: "orange", hex: "#e0863a" },
  { name: "amber", hex: "#e2b340" },
  { name: "yellow", hex: "#e6d15c" },
  { name: "green", hex: "#3cba6f" },
  { name: "teal", hex: "#2fbfc2" },
  { name: "blue", hex: "#4c8df5" },
  { name: "indigo", hex: "#6d6ef5" },
  { name: "violet", hex: "#a06bf0" },
  { name: "pink", hex: "#e36aa8" },
  { name: "white", hex: "#f2f3f5" },
  { name: "black", hex: "#2a2c31" },
  { name: "gray", hex: "#9aa3af" },
  { name: "stone", hex: "#8a8178" },
  { name: "gold", hex: "#d4a24a" },
];

const BY_NAME = new Map(NAMED_COLORS.map((color) => [color.name, color.hex]));

export function normalizeColor(value: string | undefined): string | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  if (!text) return null;
  if (text === "grey") return BY_NAME.get("gray") ?? null;
  if (text === "purple") return BY_NAME.get("violet") ?? null;
  const named = BY_NAME.get(text);
  if (named) return named;
  const hex = text.startsWith("#") ? text : "";
  if (/^#[0-9a-f]{3}$/.test(hex) || /^#[0-9a-f]{6}$/.test(hex)) return hex;
  return null;
}

export function colorName(hex: string | undefined): string {
  if (!hex) return "none";
  const found = NAMED_COLORS.find((color) => color.hex.toLowerCase() === hex.toLowerCase());
  return found?.name ?? hex;
}

function hexRgb(hex: string): [number, number, number] | null {
  let body = hex.trim().replace(/^#/, "");
  if (body.length === 3) body = body.split("").map((char) => char + char).join("");
  if (!/^[0-9a-f]{6}$/i.test(body)) return null;
  return [Number.parseInt(body.slice(0, 2), 16), Number.parseInt(body.slice(2, 4), 16), Number.parseInt(body.slice(4, 6), 16)];
}

/** Closest palette name, so a Tetris yellow that is not an exact swatch still has a name. */
export function nearestColorName(hex: string | undefined): string {
  const exact = colorName(hex);
  if (exact !== "none" && !exact.startsWith("#")) return exact;
  const rgb = hexRgb(hex ?? "");
  if (!rgb) return "none";
  let best = "none";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const color of NAMED_COLORS) {
    const other = hexRgb(color.hex);
    if (!other) continue;
    const distance = (rgb[0] - other[0]) ** 2 + (rgb[1] - other[1]) ** 2 + (rgb[2] - other[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = color.name;
    }
  }
  return best;
}

export function huesMatch(hex: string | undefined, word: string): boolean {
  const family = HUE[canonicalColor(word)] ?? [canonicalColor(word)];
  return family.includes(nearestColorName(hex));
}

const COLOR_RE = /\b(red|orange|amber|yellow|green|teal|blue|indigo|violet|purple|pink|white|black|gray|grey|gold)\b/gi;

/** Words a person treats as the same color. Tetris amber still answers to yellow or gold. */
const HUE: Record<string, readonly string[]> = {
  red: ["red"],
  orange: ["orange", "amber"],
  amber: ["amber", "gold", "yellow", "orange"],
  yellow: ["yellow", "gold", "amber"],
  gold: ["gold", "yellow", "amber"],
  green: ["green"],
  teal: ["teal"],
  blue: ["blue", "indigo"],
  indigo: ["indigo", "blue", "violet"],
  violet: ["violet", "indigo", "pink"],
  pink: ["pink", "violet", "red"],
  white: ["white"],
  black: ["black"],
  gray: ["gray", "stone"],
  stone: ["stone", "gray"],
};

function canonicalColor(word: string): string {
  const lower = word.toLowerCase();
  if (lower === "grey") return "gray";
  if (lower === "purple") return "violet";
  return lower;
}

export function colorMentions(intent: string): string[] {
  COLOR_RE.lastIndex = 0;
  return [...intent.matchAll(COLOR_RE)].map((match) => canonicalColor(match[1]));
}

export function colorWord(intent: string): string | null {
  const matches = colorMentions(intent);
  if (!matches.length) return null;
  const painting = /\b(paint|color|colour|recolor|recolour|dye|tint)\b/i.test(intent);
  return normalizeColor(painting ? matches[matches.length - 1] : matches[0]);
}

export function autoColor(id: number, asset: string): string {
  if (asset === "platform") return "#8a8178";
  const vivid = NAMED_COLORS.filter((color) => !["black", "gray", "white", "stone"].includes(color.name));
  return vivid[Math.abs(id) % vivid.length]?.hex ?? "#4c8df5";
}
