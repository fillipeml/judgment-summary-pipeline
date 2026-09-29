/** Generating a summary for a case the pipeline is not allowed to touch.
 *
 * This exists because of a gap that is easy to miss. The parity harness measures the
 * pipeline against the rows a lawyer wrote and approved — but an approved row is excluded
 * from the target set by the first of the three guards, so the pipeline never produces a
 * summary for it. Comparing against nothing is not a measurement.
 *
 * So the harness generates its own, through the same two calls, from the same documents,
 * segmented the same way. Nothing it produces is ever written anywhere near the workbook:
 * these summaries exist to be scored and then discarded. */
import { readCaseText } from "../extract/case-text.ts";
import { repairClaimNames } from "../extract/catalogue.ts";
import { segmentDecision } from "../extract/segment.ts";
import { emptyUsage, sumUsage, type Usage } from "../model/cost.ts";
import type { Analyser } from "../model/analyser/types.ts";
import { planFor } from "../sources/plan.ts";
import type { SourceDocument, SourceStore } from "../sources/store.ts";

export interface GeneratedSummary {
  caseNumber: string;
  summary: string;
  sourceText: string;
  documentsUsed: string[];
  usage: Usage;
  error: string | null;
}

export interface GenerateOptions {
  maxDocumentMB: number;
  concurrency?: number;
}

async function generateOne(
  analyser: Analyser,
  store: SourceStore,
  caseNumber: string,
  documents: SourceDocument[],
  options: GenerateOptions,
): Promise<GeneratedSummary> {
  const blank: GeneratedSummary = {
    caseNumber,
    summary: "",
    sourceText: "",
    documentsUsed: [],
    usage: emptyUsage(),
    error: null,
  };
  try {
    const plan = planFor(caseNumber, documents);
    if (!plan.documents.length) return { ...blank, error: "no document for this case" };

    const { text, used } = await readCaseText(store, plan, {
      maxDocumentMB: options.maxDocumentMB,
    });
    if (!text.trim()) return { ...blank, error: "no readable text" };

    const segmented = segmentDecision(text).segmented;
    const mapped = await analyser.mapCase(segmented);
    const structured = await analyser.structure(mapped.map);
    const result = repairClaimNames(structured.result);
    return {
      caseNumber,
      summary: result.summary.trim(),
      sourceText: segmented,
      documentsUsed: used,
      usage: sumUsage(mapped.usage, structured.usage),
      error: null,
    };
  } catch (err) {
    return { ...blank, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function generateForCases(
  analyser: Analyser,
  store: SourceStore,
  cases: { caseNumber: string; documents: SourceDocument[] }[],
  options: GenerateOptions,
): Promise<GeneratedSummary[]> {
  const out: GeneratedSummary[] = new Array(cases.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < cases.length) {
      const i = next++;
      const item = cases[i]!;
      out[i] = await generateOne(analyser, store, item.caseNumber, item.documents, options);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(options.concurrency ?? 2, cases.length) }, worker),
  );
  return out;
}
