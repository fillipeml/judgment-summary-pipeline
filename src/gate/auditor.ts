/** The second gate: a model that re-reads the source and can only refuse.
 *
 * Three properties make this defensible, and all three are deliberate:
 *
 *  - It runs ONLY on rows the deterministic gate already passed. The cheap gate rejects the
 *    largest bucket for nothing, so the audit bill is proportional to what would actually be
 *    delivered rather than to the size of the backlog.
 *
 *  - It can demote, never promote. There is no path where the second model causes something
 *    to be written that the first gate refused. A hallucinating judge can therefore only
 *    ever make the delivery more conservative.
 *
 *  - It judges against the SEGMENTED source — the same evidence the generator was given,
 *    not the raw file. Auditing against evidence the generator never saw would manufacture
 *    "omissions" and punish the model for a segmentation decision made upstream.
 *
 * And one asymmetry worth stating plainly, because it reads like a bug otherwise: here, in
 * production, an API failure KEEPS the row. An outage must not silently turn a whole batch
 * yellow. In the measurement harness (src/eval) the same failure scores as severe, because
 * a number that cannot be verified must never flatter the system. */
import type { AuditVerdict } from "../model/schema.ts";
import type { Auditor } from "../model/analyser/types.ts";
import { emptyUsage, sumUsage, type Usage } from "../model/cost.ts";

export interface AuditedRow {
  caseNumber: string;
  /** What the deterministic gate said before the auditor ran. */
  summary: string;
  /** The segmented source the generator saw, and the auditor now sees. */
  sourceText: string;
}

export interface AuditOutcome {
  caseNumber: string;
  kept: boolean;
  verdict: AuditVerdict | null;
  /** Why the row was refused, in the words a human reviewer will read. */
  reason: string | null;
  /** Set when the audit itself failed; the row is kept. */
  error: string | null;
}

export interface AuditReport {
  outcomes: AuditOutcome[];
  kept: number;
  demoted: number;
  failed: number;
  usage: Usage;
}

/** Audits one writeable summary. Only "severe" refuses; "minor" keeps the row, because a
 *  two-level gate would send most of a batch to a human for imprecision that changes
 *  nothing. */
export async function auditRow(auditor: Auditor, row: AuditedRow): Promise<AuditOutcome & { usage: Usage }> {
  try {
    const { verdict, usage } = await auditor.audit(row.sourceText, row.summary);
    if (verdict.severity === "severe") {
      return {
        caseNumber: row.caseNumber,
        kept: false,
        verdict,
        reason: `audit: ${verdict.unsupported.join(" | ") || "an assertion the source does not support"}`,
        error: null,
        usage,
      };
    }
    return { caseNumber: row.caseNumber, kept: true, verdict, reason: null, error: null, usage };
  } catch (err) {
    // Fails open on purpose: see the note at the top of this file.
    const message = err instanceof Error ? err.message : String(err);
    return {
      caseNumber: row.caseNumber,
      kept: true,
      verdict: null,
      reason: null,
      error: message,
      usage: emptyUsage(),
    };
  }
}

export async function auditRows(
  auditor: Auditor,
  rows: AuditedRow[],
  concurrency = 2,
): Promise<AuditReport> {
  const outcomes: AuditOutcome[] = new Array(rows.length);
  const usages: Usage[] = [];
  let next = 0;

  async function worker(): Promise<void> {
    while (next < rows.length) {
      const i = next++;
      const { usage, ...outcome } = await auditRow(auditor, rows[i]!);
      outcomes[i] = outcome;
      usages.push(usage);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));

  return {
    outcomes,
    kept: outcomes.filter((o) => o.kept).length,
    demoted: outcomes.filter((o) => !o.kept).length,
    failed: outcomes.filter((o) => o.error).length,
    usage: sumUsage(...usages),
  };
}
