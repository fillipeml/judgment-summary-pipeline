/** The pack a lawyer reads before the workbook is sent.
 *
 * The delivered spreadsheet shows what was written. It cannot show what was refused, or
 * why, and a refusal is the more useful signal: it is the list of cases that still need a
 * human. So the refused text is reproduced here in full, with the reason next to it, rather
 * than thrown away. A reviewer can usually see at a glance that a refusal was right — and
 * occasionally that it was not, which is how the gate gets corrected. */
import { formatUsage, sumUsage } from "../model/cost.ts";
import type { CaseRecord } from "../batch/state.ts";
import type { VerifyReport } from "../workbook/verify.ts";
import type { WriteReport } from "../workbook/write.ts";
import { columnLetter } from "../workbook/verify.ts";

export interface ApprovalPackInput {
  records: CaseRecord[];
  write: WriteReport;
  verify: VerifyReport;
  /** Rows a human had already approved: counted, never touched, never summarised. */
  approvedRows: number;
  model: string;
}

function group(records: CaseRecord[]): Map<string, CaseRecord[]> {
  const out = new Map<string, CaseRecord[]>();
  for (const r of records) {
    const key = r.auditReason ? "audit" : (r.gateReason ?? "unknown");
    const list = out.get(key) ?? [];
    list.push(r);
    out.set(key, list);
  }
  return out;
}

const REASON_TITLES: Record<string, string> = {
  audit: "Refused by the auditor: an assertion the source does not support",
  no_final_decision: "Held back: the documents hold no final decision, and the reading said so",
  off_house_style: "Refused: the summary does not open in the house style",
  settlement_without_terms: "Refused: a settlement whose terms are not in the documents",
  self_declared_insufficiency: "Refused: the reading itself says the documents were not enough",
  unknown: "Refused: reason not recorded",
};

export function renderApprovalPack(input: ApprovalPackInput): string {
  const written = input.records.filter((r) => r.status === "writeable");
  const refused = input.records.filter((r) => r.status !== "writeable");
  const usage = sumUsage(...input.records.map((r) => r.usage));

  const lines = [
    "# Approval pack",
    "",
    `Model: \`${input.model}\`. Summary column: ${columnLetter(input.verify.summaryColumn)}.`,
    "",
    "| | Rows |",
    "| --- | --- |",
    `| Written (blue) | ${input.write.written} |`,
    `| Flagged for review (amber) | ${input.write.flagged} |`,
    `| Already approved, untouched | ${input.approvedRows} |`,
    `| Target rows with no row in the sheet | ${input.write.missingRow} |`,
    `| Model cost (reading and structuring) | ${formatUsage(usage)} |`,
    "",
    "## Verification of the delivered file",
    "",
    input.verify.ok
      ? `Clean. ${input.verify.rowsCompared} rows compared cell by cell against the original;` +
        ` the only column that differs is ${columnLetter(input.verify.summaryColumn)},` +
        " and no approved cell changed."
      : "**FAILED.** The delivered file differs from the original outside the summary column," +
        " or an approved cell was modified. Do not send it.",
    "",
  ];

  if (!input.verify.ok) {
    if (input.verify.unexpectedColumns.length) {
      lines.push(
        `- columns changed that should not have been: ${input.verify.unexpectedColumns
          .map(columnLetter)
          .join(", ")}`,
      );
    }
    if (input.verify.approvedCellsTouched.length) {
      lines.push(`- approved rows modified: ${input.verify.approvedCellsTouched.join(", ")}`);
    }
    lines.push("");
  }

  lines.push(
    `## Refused: ${refused.length} row(s) that still need a human`,
    "",
    "The text each refused row produced is reproduced in full. Read it against the reason.",
    "",
  );

  for (const [reason, group_] of group(refused)) {
    lines.push(`### ${REASON_TITLES[reason] ?? reason} — ${group_.length} row(s)`, "");
    for (const record of group_) {
      lines.push(`**${record.caseNumber}** (row ${record.row})`);
      lines.push("");
      lines.push(`- why: ${record.auditReason ?? record.gateDetail}`);
      if (record.documentsUsed.length) {
        lines.push(`- read: ${record.documentsUsed.join(", ")} (${record.strategy})`);
      } else {
        lines.push(`- read: nothing (${record.strategy})`);
      }
      lines.push("");
      lines.push("```");
      lines.push(record.summary || "(empty)");
      lines.push("```");
      lines.push("");
    }
  }

  lines.push(`## Written: ${written.length} row(s)`, "", "| Case | Row | Outcome | Claims |", "| --- | --- | --- | --- |");
  for (const r of written) {
    lines.push(`| ${r.caseNumber} | ${r.row} | ${r.result.outcome} | ${r.result.claims.length} |`);
  }
  lines.push("");
  return lines.join("\n");
}
