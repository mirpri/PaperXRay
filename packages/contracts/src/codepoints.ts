/**
 * `charRange` throughout this project counts Unicode code points, not UTF-16
 * code units (see docs/02-decisions.md #12). Direct `str[i]` / `str.length`
 * indexing is banned anywhere a charRange is produced or consumed, because it
 * silently miscounts surrogate pairs (astral math symbols, some CJK
 * extension characters). Always go through these helpers instead.
 */

/** Split a string into an array of code points (one entry per character). */
export function toCodePoints(str: string): string[] {
  return Array.from(str);
}

/** Number of Unicode code points in `str` (NOT `str.length`). */
export function codePointLength(str: string): number {
  return toCodePoints(str).length;
}

/** Slice by code-point offsets, mirroring `String.prototype.slice` semantics. */
export function sliceByCodePoints(str: string, start: number, end: number): string {
  return toCodePoints(str).slice(start, end).join("");
}
