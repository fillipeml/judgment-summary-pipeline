/** Choosing which documents of a case to read.
 *
 * The rule that survived contact with a real archive: take every decisive filing, up to two
 * of each kind, largest first — a judgment plus the appellate ruling that reformed it plus
 * the settlement that ended it, read together, give the model the whole story. Fall back to
 * the largest generic filing, then to anything at all, and last to the whole docket, which
 * segmentation can cope with.
 *
 * Largest-first replaced smallest-first after the first pilot: the small file is usually an
 * extract or a cover page, and the big one is the decision. */
import type { SourceDocument } from "./store.ts";
import { DECISIVE, type DocumentKind } from "./classify.ts";
import { caseDigits } from "../domain/case-number.ts";

export type PlanStrategy = "named_decisions" | "generic" | "weak" | "none";

export interface SourcePlan {
  caseNumber: string;
  strategy: PlanStrategy;
  documents: SourceDocument[];
  /** Why this plan and not another, for the audit trail of a bad summary. */
  why: string;
}

const PER_KIND = 2;

function largestOfKind(documents: SourceDocument[], kind: DocumentKind): SourceDocument[] {
  return documents
    .filter((d) => d.kind === kind)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, PER_KIND);
}

/** Builds the reading plan for one case from the documents attributed to it. */
export function planFor(
  caseNumber: string,
  documents: SourceDocument[],
): SourcePlan {
  const usable = documents.filter((d) => d.kind !== "not_pdf");

  const decisions = DECISIVE.flatMap((kind) => largestOfKind(usable, kind));
  if (decisions.length) {
    return {
      caseNumber,
      strategy: "named_decisions",
      documents: decisions,
      why: `named decisive filings: ${decisions.map((d) => d.kind).join(", ")}`,
    };
  }

  const generic = largestOfKind(usable, "generic");
  if (generic.length) {
    return {
      caseNumber,
      strategy: "generic",
      documents: generic.slice(0, 1),
      why: "no named decision: the largest unclassified filing",
    };
  }

  const anything = [...usable].sort((a, b) => b.bytes - a.bytes);
  if (anything.length) {
    return {
      caseNumber,
      strategy: "weak",
      documents: anything.slice(0, 1),
      why: `only non-decisive filings: the largest is a ${anything[0]!.kind}`,
    };
  }

  return { caseNumber, strategy: "none", documents: [], why: "no source document found" };
}

/** Attributes documents to cases by the case number in the path or the name.
 *
 *  `knownCases` turns on the third join key. The coverage report measures three keys and
 *  shows that matching on the twenty bare digits recovers documents whose names punctuate
 *  the number differently — so attribution was taught the same key, rather than leaving the
 *  report able to see files the run could not use. It needs the case list because a bare
 *  twenty-digit string is only recognisable as a case number once you know which cases
 *  exist. */
export function indexByCase(
  documents: SourceDocument[],
  knownCases: Iterable<string> = [],
): Map<string, SourceDocument[]> {
  const byDigits = new Map<string, string>();
  for (const caseNumber of knownCases) byDigits.set(caseDigits(caseNumber), caseNumber);

  const byCase = new Map<string, SourceDocument[]>();
  for (const doc of documents) {
    let caseNumber = doc.caseNumber;
    if (!caseNumber && byDigits.size) {
      const haystack = caseDigits(`${doc.path} ${doc.name}`);
      for (const [digits, known] of byDigits) {
        if (haystack.includes(digits)) {
          caseNumber = known;
          break;
        }
      }
    }
    if (!caseNumber) continue;
    const list = byCase.get(caseNumber) ?? [];
    list.push(doc);
    byCase.set(caseNumber, list);
  }
  return byCase;
}
