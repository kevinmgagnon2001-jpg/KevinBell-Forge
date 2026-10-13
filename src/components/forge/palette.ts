/** Scene colors. UI chrome stays on CSS tokens; WebGL needs concrete values. */
export const scenePalette = {
  bg: "#09090b",
  ground: "#101114",
  grid: "#2a2c32",
  gridMajor: "#3a3d46",
  fog: "#09090b",
  steel: ["#d5d8de", "#b7bec8", "#9aa3af", "#c9c3b8", "#8e97a3", "#e4e6ea"],
  mark: "#f2f3f5",
  trim: "#9aa1ab",
  key: "#f3f4f6",
  fill: "#8b919c",
  hit: "#000000",
} as const;
