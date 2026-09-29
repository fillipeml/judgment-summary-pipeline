/** The claim catalogue and the normalisation that snaps a model's answer onto it.
 *
 * The model is the primary chooser: it reads the case and picks the catalogue entry that
 * fits. The fuzzy matcher exists only to repair typography — an accent dropped, a word
 * inflected — because a spreadsheet column that has to group by claim type cannot tolerate
 * four spellings of the same claim. The threshold is deliberately high so that fuzzy
 * matching never makes a semantic leap the model did not make. */
import catalogueFile from "./claims.json" with { type: "json" };

import { NOT_IDENTIFIED } from "../domain/house-style.ts";

/** Sørensen–Dice over character bigrams; above this a match is a spelling repair, below it
 *  it would be a guess. */
export const MATCH_THRESHOLD = 0.82;

const CLAIMS: string[] = catalogueFile.claims;

export function catalogue(): string[] {
  return CLAIMS;
}

/** Accent-free, lower case, punctuation as spaces, single-spaced. */
export function normaliseKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const BY_KEY = new Map(CLAIMS.map((c) => [normaliseKey(c), c]));

function bigrams(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const pair = text.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/** Sørensen–Dice coefficient over character bigrams: 1 identical, 0 disjoint. */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const left = bigrams(a);
  const right = bigrams(b);
  let shared = 0;
  for (const [pair, count] of left) shared += Math.min(count, right.get(pair) ?? 0);
  const total = [...left.values()].reduce((n, c) => n + c, 0) + [...right.values()].reduce((n, c) => n + c, 0);
  return (2 * shared) / total;
}

export interface CatalogueMatch {
  canonical: string | null;
  method: "exact" | "fuzzy" | "none";
  score: number;
}

/** The catalogue entry a claim name means, or none. */
export function matchClaim(input: string, threshold = MATCH_THRESHOLD): CatalogueMatch {
  const key = normaliseKey(input ?? "");
  if (!key) return { canonical: null, method: "none", score: 0 };
  const exact = BY_KEY.get(key);
  if (exact) return { canonical: exact, method: "exact", score: 1 };

  let best: CatalogueMatch = { canonical: null, method: "none", score: 0 };
  for (const [candidateKey, canonical] of BY_KEY) {
    const score = diceCoefficient(key, candidateKey);
    if (score > best.score) best = { canonical, method: "fuzzy", score };
  }
  return best.score >= threshold ? best : { canonical: null, method: "none", score: best.score };
}

/** Re-snaps every claim of a result onto the catalogue after the model has chosen. A miss
 *  leaves whatever the model wrote, including the "not identified" sentinel. */
export function repairClaimNames<T extends { claims: { rawClaim: string; canonicalClaim: string }[] }>(
  result: T,
): T {
  for (const claim of result.claims) {
    const base =
      claim.canonicalClaim && claim.canonicalClaim !== NOT_IDENTIFIED
        ? claim.canonicalClaim
        : claim.rawClaim;
    const match = matchClaim(base);
    if (match.canonical) claim.canonicalClaim = match.canonical;
  }
  return result;
}
