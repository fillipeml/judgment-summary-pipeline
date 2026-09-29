/** Turning one case's reading plan into one string of text.
 *
 * Shared deliberately. The pipeline reads a case this way, and so does the parity harness,
 * which has to generate its own summaries for cases the pipeline is forbidden to touch. If
 * the two read differently, the harness would be measuring a system nobody runs. */
import { joinDocuments, readPdf } from "./pdf.ts";
import type { SourcePlan } from "../sources/plan.ts";
import type { SourceStore } from "../sources/store.ts";

export interface CaseText {
  text: string;
  /** The documents that actually contributed text, not the ones the plan hoped for. */
  used: string[];
  /** Files skipped for size, and files with no text layer: both need saying out loud. */
  skipped: { name: string; why: "too_large" | "scanned" }[];
}

export interface ReadOptions {
  maxDocumentMB: number;
  onSkip?: (name: string, why: "too_large" | "scanned") => void;
}

export async function readCaseText(
  store: SourceStore,
  plan: SourcePlan,
  options: ReadOptions,
): Promise<CaseText> {
  const parts: { kind: string; name: string; text: string }[] = [];
  const used: string[] = [];
  const skipped: CaseText["skipped"] = [];

  for (const doc of plan.documents) {
    if (doc.bytes > options.maxDocumentMB * 1024 * 1024) {
      skipped.push({ name: doc.name, why: "too_large" });
      options.onSkip?.(doc.name, "too_large");
      continue;
    }
    const pdf = await readPdf(await store.read(doc));
    if (pdf.isScanned) {
      // A scanned file needs a vision pass, which this path does not do inline. Left out
      // rather than passed on as an empty string pretending to be a reading.
      skipped.push({ name: doc.name, why: "scanned" });
      options.onSkip?.(doc.name, "scanned");
      continue;
    }
    parts.push({ kind: doc.kind, name: doc.name, text: pdf.text });
    used.push(doc.name);
  }

  return { text: joinDocuments(parts), used, skipped };
}
