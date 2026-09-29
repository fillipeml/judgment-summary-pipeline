/** How many of the rows we are allowed to touch have a document to read?
 *
 * Reported as the progression of three join keys rather than one number, because the gain
 * from each relaxation is the finding: most of the "missing" documents were never missing,
 * they were named in a way the first key could not see. */
import type { CoverageReport } from "../sources/coverage.ts";
import type { SourcePlan } from "../sources/plan.ts";

const KEY_TITLES: Record<string, string> = {
  filename: "by file name",
  path: "by full path (the case number may be on the folder)",
  digits: "by the twenty digits alone (punctuation-blind)",
};

export function renderCoverage(
  progression: CoverageReport[],
  plans: Map<string, SourcePlan>,
): string {
  const lines = [
    "# Source coverage",
    "",
    "| Join key | Covered | Coverage |",
    "| --- | --- | --- |",
  ];
  for (const report of progression) {
    lines.push(
      `| ${KEY_TITLES[report.key] ?? report.key} | ${report.covered.length} / ${
        report.covered.length + report.uncovered.length
      } | ${report.coveragePct}% |`,
    );
  }
  lines.push("");

  const first = progression[0];
  const last = progression[progression.length - 1];
  if (first && last && last !== first) {
    const gained = last.covered.length - first.covered.length;
    lines.push(
      `Relaxing the join key recovered **${gained}** case(s) that the file-name key could not` +
        " see. None of those documents were missing; they were named differently.",
      "",
    );
  }

  const byStrategy = new Map<string, number>();
  for (const plan of plans.values()) {
    byStrategy.set(plan.strategy, (byStrategy.get(plan.strategy) ?? 0) + 1);
  }
  if (byStrategy.size) {
    lines.push("## What was selected to read", "", "| Strategy | Cases |", "| --- | --- |");
    for (const [strategy, count] of [...byStrategy].sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${strategy} | ${count} |`);
    }
    lines.push("");
  }

  if (last?.uncovered.length) {
    lines.push(
      `## ${last.uncovered.length} case(s) with no recoverable document`,
      "",
      "These rows are left blank. A blank cell is a correct answer when there is nothing to read.",
      "",
    );
    for (const c of last.uncovered.slice(0, 40)) lines.push(`- ${c}`);
    if (last.uncovered.length > 40) lines.push(`- ... and ${last.uncovered.length - 40} more`);
    lines.push("");
  }

  if (last?.unattributable.length) {
    lines.push(
      `## ${last.unattributable.length} document(s) carrying no case number`,
      "",
      "Named after a party, a date or nothing at all. They belong to some case; which one is",
      "a question for a human.",
      "",
    );
    for (const p of last.unattributable.slice(0, 20)) lines.push(`- ${p}`);
    lines.push("");
  }

  return lines.join("\n");
}
