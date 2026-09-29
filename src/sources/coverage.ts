/** How many of the rows we may touch actually have a document to read?
 *
 * This was measured three times, with a progressively looser join key, and each relaxation
 * recovered real documents. It is kept as three named generations rather than collapsed
 * into the last one, because the progression is the finding: the missing cases were mostly
 * a file-naming problem, not missing files.
 *
 *   1. by file name      — the obvious key, and the one that under-reports
 *   2. by full path      — picks up cases whose number is only on the parent folder
 *   3. by twenty digits  — punctuation-blind, picks up names that punctuate differently
 */
import { caseDigits, extractCaseNumber } from "../domain/case-number.ts";
import type { SourceDocument } from "./store.ts";

export type JoinKey = "filename" | "path" | "digits";

export interface CoverageReport {
  key: JoinKey;
  /** Target rows with at least one document. */
  covered: string[];
  uncovered: string[];
  coveragePct: number;
  /** Documents whose name carries no recognisable case number at all. */
  unattributable: string[];
}

function keyOf(document: SourceDocument, key: JoinKey): string | null {
  if (key === "filename") return extractCaseNumber(document.name);
  if (key === "path") return extractCaseNumber(document.path) ?? extractCaseNumber(document.name);
  return null; // digits: matched by substring, not by key equality
}

export function measureCoverage(
  targets: string[],
  documents: SourceDocument[],
  key: JoinKey,
): CoverageReport {
  const covered: string[] = [];
  const uncovered: string[] = [];

  if (key === "digits") {
    const haystacks = documents.map((d) => caseDigits(`${d.path} ${d.name}`));
    for (const caseNumber of targets) {
      const twenty = caseDigits(caseNumber);
      (haystacks.some((h) => h.includes(twenty)) ? covered : uncovered).push(caseNumber);
    }
  } else {
    const found = new Set<string>();
    for (const doc of documents) {
      const k = keyOf(doc, key);
      if (k) found.add(k);
    }
    for (const caseNumber of targets) {
      (found.has(caseNumber) ? covered : uncovered).push(caseNumber);
    }
  }

  return {
    key,
    covered,
    uncovered,
    coveragePct: targets.length ? Math.round((covered.length / targets.length) * 1000) / 10 : 0,
    // Judged by the SAME key the row is about. A file sitting in a folder named after its
    // case is unattributable to the file-name key and perfectly attributable to the path
    // key, and reporting it as orphaned under both would overstate the mess.
    unattributable: documents.filter((d) => !attributable(d, targets, key)).map((d) => d.path),
  };
}

function attributable(document: SourceDocument, targets: string[], key: JoinKey): boolean {
  if (key === "filename") return extractCaseNumber(document.name) !== null;
  if (extractCaseNumber(document.path) ?? extractCaseNumber(document.name)) return true;
  if (key !== "digits") return false;
  const haystack = caseDigits(`${document.path} ${document.name}`);
  return targets.some((t) => haystack.includes(caseDigits(t)));
}

/** All three generations, so the gain from each relaxation is visible. */
export function coverageProgression(
  targets: string[],
  documents: SourceDocument[],
): CoverageReport[] {
  return (["filename", "path", "digits"] as JoinKey[]).map((key) =>
    measureCoverage(targets, documents, key),
  );
}
