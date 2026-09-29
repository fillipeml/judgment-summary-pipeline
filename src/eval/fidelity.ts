/** Does a delivered summary say only what the source says?
 *
 * This measures the rows the pipeline DELIVERED, not the rows it produced. A row the gate
 * refused was never shown to anyone, so counting it here would let the system earn credit
 * for work it declined to do. The denominator is the delivered set, and nothing else.
 *
 * The auditor here is the same auditor the pipeline runs in production, on the same
 * segmented text, with one deliberate difference: when the audit call fails, the harness
 * scores the row as severe. In production a failure keeps the row, because an outage must
 * not turn a batch yellow. In measurement, a number that could not be verified must never
 * flatter the system. */
import { formatRate, rate, uniformStride } from "./sample.ts";
import { emptyUsage, formatUsage, sumUsage, type Usage } from "../model/cost.ts";
import type { AuditVerdict } from "../model/schema.ts";
import type { Auditor } from "../model/analyser/types.ts";
import type { CaseRecord } from "../batch/state.ts";

export interface FidelityCase {
  caseNumber: string;
  summary: string;
  sourceText: string;
}

export interface FidelityOutcome {
  caseNumber: string;
  severity: AuditVerdict["severity"];
  score: number;
  unsupported: string[];
  omissions: string[];
  /** Set when the audit call itself failed. The row still counts, as severe. */
  error: string | null;
}

export interface FidelityReport {
  sampled: number;
  population: number;
  ok: number;
  minor: number;
  severe: number;
  failedCalls: number;
  /** Share of the sample with no unsupported assertion at all. */
  cleanRate: number | null;
  /** Share of the sample carrying a severe invention. The headline number. */
  severeRate: number | null;
  meanScore: number | null;
  outcomes: FidelityOutcome[];
  usage: Usage;
}

/** Only rows that were actually written are eligible. */
export function deliveredCases(records: CaseRecord[]): CaseRecord[] {
  return records.filter((r) => r.status === "writeable" && r.summary.trim());
}

export async function measureFidelity(
  auditor: Auditor,
  cases: FidelityCase[],
  options: { size: number; concurrency?: number; population?: number },
): Promise<FidelityReport> {
  const sample = uniformStride(cases, options.size);
  const outcomes: FidelityOutcome[] = new Array(sample.length);
  const usages: Usage[] = [];
  let next = 0;

  async function worker(): Promise<void> {
    while (next < sample.length) {
      const i = next++;
      const item = sample[i]!;
      try {
        const { verdict, usage } = await auditor.audit(item.sourceText, item.summary);
        usages.push(usage);
        outcomes[i] = {
          caseNumber: item.caseNumber,
          severity: verdict.severity,
          score: verdict.score,
          unsupported: verdict.unsupported,
          omissions: verdict.omissions,
          error: null,
        };
      } catch (err) {
        usages.push(emptyUsage());
        outcomes[i] = {
          caseNumber: item.caseNumber,
          severity: "severe",
          score: 0,
          unsupported: [],
          omissions: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(options.concurrency ?? 2, sample.length) }, worker),
  );

  const severe = outcomes.filter((o) => o.severity === "severe").length;
  const minor = outcomes.filter((o) => o.severity === "minor").length;
  const ok = outcomes.filter((o) => o.severity === "ok").length;
  const clean = outcomes.filter((o) => o.unsupported.length === 0 && !o.error).length;

  return {
    sampled: sample.length,
    population: options.population ?? cases.length,
    ok,
    minor,
    severe,
    failedCalls: outcomes.filter((o) => o.error).length,
    cleanRate: rate(clean, sample.length),
    severeRate: rate(severe, sample.length),
    meanScore: sample.length
      ? Math.round((outcomes.reduce((s, o) => s + o.score, 0) / sample.length) * 10) / 10
      : null,
    outcomes,
    usage: sumUsage(...usages),
  };
}

export function renderFidelity(report: FidelityReport): string {
  const lines = [
    "# Fidelity",
    "",
    "Each delivered summary is read back against the same segmented source the generator",
    "saw, by an auditor that is asked to find assertions the source does not support.",
    "Rows the pipeline refused to write are not in the population: the measurement is of",
    "what a reader would actually have received.",
    "",
    `| Measure | Value |`,
    `| --- | --- |`,
    `| Delivered rows | ${report.population} |`,
    `| Sampled | ${report.sampled} |`,
    `| No unsupported assertion | ${formatRate(report.cleanRate)} |`,
    `| Severe (invented or contradicted) | ${formatRate(report.severeRate)} |`,
    `| Mean fidelity score (0-10) | ${report.meanScore ?? "n/a"} |`,
    `| Audit calls that failed (counted as severe) | ${report.failedCalls} |`,
    `| Cost | ${formatUsage(report.usage)} |`,
    "",
  ];
  const problems = report.outcomes.filter((o) => o.severity !== "ok");
  if (problems.length) {
    lines.push("## Every row that was not clean", "");
    for (const o of problems) {
      lines.push(`### ${o.caseNumber} — ${o.severity}`);
      if (o.error) lines.push(`- audit call failed: ${o.error}`);
      for (const u of o.unsupported) lines.push(`- unsupported: ${u}`);
      for (const m of o.omissions) lines.push(`- omitted: ${m}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}
