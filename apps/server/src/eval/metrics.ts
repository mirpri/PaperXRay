/**
 * Evaluation metrics for the golden-set harness (docs/02-decisions.md #10,
 * W4: "证据校验 + golden set + 评测 harness"). Pure functions only; the
 * CLI in ./run-eval.ts feeds them.
 */
import type { CharMap, CharRange } from "@paper-xray/contracts";
import { codePointLength, sliceByCodePoints, toCodePoints } from "@paper-xray/contracts";

/**
 * Whitespace-insensitive search: pdf.js and the reassembly layer disagree
 * with a human transcriber mostly about spaces and line breaks, which
 * aren't what these metrics measure. Returns the code-point offset of the
 * match in `text`, or -1.
 */
export function findCollapsed(text: string, needle: string, from = 0): number {
  const cps = toCodePoints(text);
  let collapsed = "";
  const offsets: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < cps.length; i++) {
    if (/\s/.test(cps[i])) {
      if (prevSpace) continue;
      collapsed += " ";
      prevSpace = true;
    } else {
      collapsed += cps[i];
      prevSpace = false;
    }
    offsets.push(i);
  }
  const target = needle.trim().replace(/\s+/g, " ");
  if (target.length === 0) return -1;
  // Map `from` (an offset into text) to an offset into `collapsed`.
  let startCollapsed = offsets.findIndex((o) => o >= from);
  if (startCollapsed === -1) return -1;
  const collapsedCps = toCodePoints(collapsed);
  const collapsedStr = collapsedCps.join("");
  const utf16From = collapsedCps.slice(0, startCollapsed).join("").length;
  const utf16Hit = collapsedStr.indexOf(target, utf16From);
  if (utf16Hit === -1) return -1;
  startCollapsed = codePointLength(collapsedStr.slice(0, utf16Hit));
  return offsets[startCollapsed];
}

export interface ReadingOrderResult {
  total: number;
  found: number;
  /** Size of the longest run of found snippets whose positions increase — i.e. how many are in the right relative order. */
  inOrder: number;
  missing: string[];
  /** Found snippets that break the order (not part of the longest increasing run). */
  outOfOrder: string[];
}

/** Checks that human-transcribed snippets, listed in true reading order, appear in normalizedText in that order. */
export function readingOrderScore(normalizedText: string, snippets: string[]): ReadingOrderResult {
  const positions = snippets.map((s) => findCollapsed(normalizedText, s));
  const missing = snippets.filter((_, i) => positions[i] === -1);
  const foundIdx = positions.map((p, i) => [p, i] as const).filter(([p]) => p !== -1);

  // Longest increasing subsequence over positions (n is small; O(n²) is fine).
  const n = foundIdx.length;
  const len = new Array<number>(n).fill(1);
  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (foundIdx[j][0] < foundIdx[i][0] && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
    }
  }
  let best = -1;
  for (let i = 0; i < n; i++) if (best === -1 || len[i] > len[best]) best = i;
  const inLis = new Set<number>();
  for (let i = best; i !== -1; i = prev[i]) inLis.add(i);

  return {
    total: snippets.length,
    found: n,
    inOrder: inLis.size,
    missing,
    outOfOrder: foundIdx.filter((_, k) => !inLis.has(k)).map(([, i]) => snippets[i]),
  };
}

/** Share of non-whitespace code points in normalizedText that the CharMap maps back to a PDF text item. Anything unmapped can't be highlighted. */
export function charMapCoverage(normalizedText: string, charMap: CharMap): { mapped: number; total: number } {
  const cps = toCodePoints(normalizedText);
  const covered = new Uint8Array(cps.length);
  for (const run of charMap) {
    for (let i = Math.max(0, run.charStart); i < Math.min(cps.length, run.charEnd); i++) covered[i] = 1;
  }
  let mapped = 0;
  let total = 0;
  for (let i = 0; i < cps.length; i++) {
    if (/\s/.test(cps[i])) continue;
    total++;
    mapped += covered[i];
  }
  return { mapped, total };
}

export interface AnchorSnapshot {
  charRange: CharRange;
  text: string;
  contextPrefix: string;
  contextSuffix: string;
}

export type AnchorStatus = "stable" | "relocated" | "lost";

/**
 * The regression required by docs/02-decisions.md #2: after a parser
 * change, previously stored charRanges must still point at the same text.
 * `stable` = same range, same text. `relocated` = the text (with its
 * context) still exists elsewhere, so a migration could re-anchor it, but
 * stored annotations would currently point at the wrong place. `lost` = gone.
 */
export function checkAnchor(normalizedText: string, snap: AnchorSnapshot): AnchorStatus {
  if (sliceByCodePoints(normalizedText, snap.charRange.start, snap.charRange.end) === snap.text) return "stable";
  const withContext = snap.contextPrefix + snap.text + snap.contextSuffix;
  return findCollapsed(normalizedText, withContext) !== -1 || findCollapsed(normalizedText, snap.text) !== -1
    ? "relocated"
    : "lost";
}

/** Picks `count` evenly spaced anchors across the document, each `length` code points, snapped to start after whitespace. */
export function sampleAnchors(normalizedText: string, count: number, length = 40, contextLength = 16): AnchorSnapshot[] {
  const cps = toCodePoints(normalizedText);
  const out: AnchorSnapshot[] = [];
  if (cps.length < length) return out;
  for (let k = 0; k < count; k++) {
    let start = Math.floor(((k + 0.5) * (cps.length - length)) / count);
    while (start < cps.length - length && start > 0 && !/\s/.test(cps[start - 1])) start++;
    const end = start + length;
    out.push({
      charRange: { start, end },
      text: cps.slice(start, end).join(""),
      contextPrefix: cps.slice(Math.max(0, start - contextLength), start).join(""),
      contextSuffix: cps.slice(end, end + contextLength).join(""),
    });
  }
  return out;
}

export interface SpanMatchResult {
  predicted: number;
  gold: number;
  truePositives: number;
  precision: number;
  recall: number;
  f1: number;
}

function overlapRatio(a: CharRange, b: CharRange): number {
  const inter = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  return shorter <= 0 ? 0 : inter / shorter;
}

/**
 * Lens precision/recall against human-labelled evidence spans. A
 * prediction matches a gold span when they overlap by at least
 * `minOverlap` of the shorter span (a lens quoting a sentence where the
 * labeller marked a clause of it still counts). One-to-one greedy matching,
 * best overlaps first.
 */
export function matchSpans(predicted: CharRange[], gold: CharRange[], minOverlap = 0.5): SpanMatchResult {
  const pairs: Array<[number, number, number]> = [];
  predicted.forEach((p, i) =>
    gold.forEach((g, j) => {
      const r = overlapRatio(p, g);
      if (r >= minOverlap) pairs.push([r, i, j]);
    }),
  );
  pairs.sort((x, y) => y[0] - x[0]);
  const usedP = new Set<number>();
  const usedG = new Set<number>();
  for (const [, i, j] of pairs) {
    if (usedP.has(i) || usedG.has(j)) continue;
    usedP.add(i);
    usedG.add(j);
  }
  const tp = usedP.size;
  const precision = predicted.length === 0 ? 0 : tp / predicted.length;
  const recall = gold.length === 0 ? 0 : tp / gold.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { predicted: predicted.length, gold: gold.length, truePositives: tp, precision, recall, f1 };
}
