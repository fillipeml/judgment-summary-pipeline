/** Is the machine's summary as good as the human's?
 *
 * Fidelity asks whether a summary invents. Parity asks the harder question: for a case a
 * lawyer already summarised and approved, how does the pipeline's summary compare? The
 * approved rows are the only ground truth in the project that was not written by a model.
 *
 * Two things keep the measurement honest. The judge sees the two summaries without being
 * told which is which, so it cannot simply favour the longer one out of deference to the
 * label. And "our version is more complete" is a distinct verdict from "equivalent", so an
 * improvement is never quietly scored as a tie — nor as a win, unless a reader agrees. */
import { formatRate, rate, uniformStride } from "./sample.ts";
import { emptyUsage, formatUsage, sumUsage, type Usage } from "../model/cost.ts";
import type { ParityVerdict } from "../model/schema.ts";
import type { ParityJudge } from "../model/analyser/types.ts";

export interface ParityCase {
  caseNumber: string;
  /** The human-approved summary already in the workbook. */
  reference: string;
  /** What the pipeline produced for the same case. */
  generated: string;
}

export interface ParityOutcome {
  caseNumber: string;
  verdict: ParityVerdict["verdict"] | "error";
  sameOutcome: boolean;
  factsAgree: boolean;
  houseStyle: boolean;
  score: number;
  note: string;
  error: string | null;
}

export interface ParityReport {
  sampled: number;
  population: number;
  equivalent: number;
  moreComplete: number;
  worse: number;
  conflict: number;
  failedCalls: number;
  /** Share where the outcome — the one thing that must never differ — matches. */
  sameOutcomeRate: number | null;
  /** Share at least as good as the human summary. The headline number. */
  atLeastAsGoodRate: number | null;
  houseStyleRate: number | null;
  meanScore: number | null;
  outcomes: ParityOutcome[];
  /** What the judge spent comparing the pairs. */
  usage: Usage;
  /** What it cost to produce the generated side of those pairs.
   *
   *  The parity harness is the one bench that cannot reuse the pipeline's output: approved
   *  rows are excluded from a normal run by the first guard, so it generates its own
   *  summaries — two model calls per case — and throws them away after scoring. That usage
   *  was computed and discarded, so the reported cost was the judge's alone and understated
   *  the bench by more than an order of magnitude. */
  generationUsage: Usage;
}

export async function measureParity(
  judge: ParityJudge,
  cases: ParityCase[],
  options: { size: number; concurrency?: number; generationUsage?: Usage },
): Promise<ParityReport> {
  const sample = uniformStride(cases, options.size);
  const outcomes: ParityOutcome[] = new Array(sample.length);
  const usages: Usage[] = [];
  let next = 0;

  async function worker(): Promise<void> {
    while (next < sample.length) {
      const i = next++;
      const item = sample[i]!;
      try {
        const { verdict, usage } = await judge.compare(item.reference, item.generated);
        usages.push(usage);
        outcomes[i] = {
          caseNumber: item.caseNumber,
          verdict: verdict.verdict,
          sameOutcome: verdict.sameOutcome,
          factsAgree: verdict.factsAgree,
          houseStyle: verdict.houseStyle,
          score: verdict.score,
          note: verdict.note,
          error: null,
        };
      } catch (err) {
        usages.push(emptyUsage());
        // A comparison that did not happen is not a tie.
        outcomes[i] = {
          caseNumber: item.caseNumber,
          verdict: "error",
          sameOutcome: false,
          factsAgree: false,
          houseStyle: false,
          score: 0,
          note: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(options.concurrency ?? 2, sample.length) }, worker),
  );

  const count = (v: ParityOutcome["verdict"]): number =>
    outcomes.filter((o) => o.verdict === v).length;
  const equivalent = count("equivalent");
  const moreComplete = count("ours_more_complete");

  return {
    sampled: sample.length,
    population: cases.length,
    equivalent,
    moreComplete,
    worse: count("ours_worse"),
    conflict: count("conflict"),
    failedCalls: count("error"),
    sameOutcomeRate: rate(outcomes.filter((o) => o.sameOutcome).length, sample.length),
    atLeastAsGoodRate: rate(equivalent + moreComplete, sample.length),
    houseStyleRate: rate(outcomes.filter((o) => o.houseStyle).length, sample.length),
    meanScore: sample.length
      ? Math.round((outcomes.reduce((s, o) => s + o.score, 0) / sample.length) * 10) / 10
      : null,
    outcomes,
    usage: sumUsage(...usages),
    generationUsage: options.generationUsage ?? emptyUsage(),
  };
}

export function renderParity(report: ParityReport): string {
  const lines = [
    "# Parity with the approved rows",
    "",
    "Only cases a lawyer had already summarised and marked approved are eligible. For each,",
    "the pipeline's summary is compared with the approved one by a judge that is not told",
    "which is which.",
    "",
    "| Measure | Value |",
    "| --- | --- |",
    `| Approved cases available | ${report.population} |`,
    `| Sampled | ${report.sampled} |`,
    `| Same outcome | ${formatRate(report.sameOutcomeRate)} |`,
    `| At least as good | ${formatRate(report.atLeastAsGoodRate)} |`,
    `| In house style | ${formatRate(report.houseStyleRate)} |`,
    `| Mean score (0-10) | ${report.meanScore ?? "n/a"} |`,
    `| Cost, judging | ${formatUsage(report.usage)} |`,
    `| Cost, generating the summaries judged | ${formatUsage(report.generationUsage)} |`,
    `| Cost, total | ${formatUsage(sumUsage(report.usage, report.generationUsage))} |`,
    "",
    "| Verdict | Rows |",
    "| --- | --- |",
    `| Equivalent | ${report.equivalent} |`,
    `| Ours more complete | ${report.moreComplete} |`,
    `| Ours worse | ${report.worse} |`,
    `| Outright conflict | ${report.conflict} |`,
    `| Judge call failed | ${report.failedCalls} |`,
    "",
  ];
  const bad = report.outcomes.filter(
    (o) => o.verdict === "ours_worse" || o.verdict === "conflict" || o.error,
  );
  if (bad.length) {
    lines.push("## Every case where the pipeline lost", "");
    for (const o of bad) {
      lines.push(`- **${o.caseNumber}** — ${o.verdict}${o.note ? `: ${o.note}` : ""}${o.error ? ` (${o.error})` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
