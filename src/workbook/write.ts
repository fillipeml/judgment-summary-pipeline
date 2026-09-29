/** Writing the result back — into a copy, never over human work.
 *
 * A passed row gets its text replaced and is marked written. A refused row keeps whatever
 * text was already there and is only tinted: the column held partner-written notes in many
 * rows, and overwriting one with a refused summary, or blanking it, would destroy work a
 * colour can flag instead.
 *
 * The approved-row guard here is the SECOND of three. The first is target selection; the
 * third is verify.ts, which re-opens both files afterwards and proves cell by cell that no
 * approved cell moved. The redundancy is the point: this is the one mistake the engagement
 * could not survive. */
import ExcelJS from "exceljs";

import { isApproved } from "./read.ts";
import { REVIEW_FILL, WRITTEN_FILL, WRITTEN_FONT } from "./colours.ts";

export interface SummaryToWrite {
  caseNumber: string;
  row: number;
  status: "writeable" | "needs_review";
  summary: string;
  reason?: string | null;
}

export interface WriteReport {
  written: number;
  flagged: number;
  skippedApproved: number;
  missingRow: number;
  outputPath: string;
}

/** ExcelJS shares one style object between every cell that looks alike, so assigning
 *  `cell.fill` repaints unrelated cells. Cloning first and assigning a fresh object keeps
 *  the marker on the one cell it belongs to. */
export function applyStyle(cell: ExcelJS.Cell, fillArgb: string, fontArgb?: string): void {
  const style = structuredClone(cell.style ?? {}) as ExcelJS.Style;
  style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
  if (fontArgb) style.font = { ...(style.font ?? {}), color: { argb: fontArgb } };
  cell.style = style;
}

export async function writeSummaries(
  sourcePath: string,
  outputPath: string,
  summaries: SummaryToWrite[],
  options: { summaryColumn: number },
): Promise<WriteReport> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourcePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error(`${sourcePath} has no worksheet`);

  const report: WriteReport = {
    written: 0,
    flagged: 0,
    skippedApproved: 0,
    missingRow: 0,
    outputPath,
  };

  for (const item of summaries) {
    if (item.row < 2 || item.row > sheet.rowCount) {
      report.missingRow++;
      continue;
    }
    const cell = sheet.getRow(item.row).getCell(options.summaryColumn);

    // Runtime guard: never touch a cell a human approved, whatever the plan said.
    if (isApproved(cell)) {
      report.skippedApproved++;
      continue;
    }

    if (item.status === "writeable" && item.summary.trim()) {
      cell.value = item.summary.trim();
      applyStyle(cell, WRITTEN_FILL, WRITTEN_FONT);
      report.written++;
    } else {
      // Refused: the text stays exactly as it was; only the background changes.
      applyStyle(cell, REVIEW_FILL);
      report.flagged++;
    }
  }

  await workbook.xlsx.writeFile(outputPath);
  return report;
}
