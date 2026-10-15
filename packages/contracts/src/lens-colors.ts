/** Shared preset palette for annotation labels and PDF underlines. */
export const LENS_COLORS = [
  { name: "Ocean", value: "#3B6CB7" },
  { name: "Teal", value: "#168575" },
  { name: "Emerald", value: "#2F855A" },
  { name: "Olive", value: "#647D2D" },
  { name: "Amber", value: "#A87816" },
  { name: "Terracotta", value: "#C4692B" },
  { name: "Coral", value: "#C65D53" },
  { name: "Rose", value: "#B94C77" },
  { name: "Violet", value: "#8056AF" },
  { name: "Indigo", value: "#5E62B5" },
  { name: "Lagoon", value: "#287F9A" },
  { name: "Slate", value: "#64748B" },
] as const;
export const DEFAULT_HUMAN_COLOR = "#40628C";
export function isAnnotationColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}
export function humanAnnotationColor(value?: string | null): string {
  return isAnnotationColor(value) ? value.toUpperCase() : DEFAULT_HUMAN_COLOR;
}
export function isLensColor(value: unknown): value is string {
  return typeof value === "string" && LENS_COLORS.some(c => c.value === value.toUpperCase());
}
/** Stable fallback for old or deleted lenses, including shared personal lenses. */
export function lensColor(id: string, configured?: string | null): string {
  if (isLensColor(configured)) return configured!.toUpperCase();
  const preset = ["preset-methodology-review", "preset-experiment-stats", "preset-reproducibility", "preset-novelty"].indexOf(id);
  if (preset >= 0) return LENS_COLORS[[0, 5, 1, 8][preset]].value;
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.codePointAt(0)!) >>> 0;
  return LENS_COLORS[hash % LENS_COLORS.length].value;
}
