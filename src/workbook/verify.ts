/** The third guard: proving, after the fact and independently of the pipeline, that the
 *  delivered file differs from the client's original in the summary column only and that no
 *  human-approved cell moved.
 *
 *  This exists because "we were careful" is not a claim anyone should accept about a file
 *  that overwrites a law firm's work. It re-opens both workbooks and compares every cell. */
import ExcelJS from "exceljs";

import { cellText, isApproved } from "./read.ts";

export interface VerifyReport {
  /** Differences per column index. */
  differencesByColumn: Map<number, number>;
  /** Columns other than the summary column that changed: any entry here is a failure. */
  unexpectedColumns: number[];
  /** Rows whose approved cell changed: any entry here is a failure. */
  approvedCellsTouched: number[];
  summaryColumn: number;
  rowsCompared: number;
  ok: boolean;
  samples: { row: number; before: string; after: string }[];
}

export function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export async function verifyOutput(
  originalPath: string,
  deliveredPath: string,
  summaryColumn: number,
  sampleLimit = 6,
): Promise<VerifyReport> {
  const before = new ExcelJS.Workbook();
  const after = new ExcelJS.Workbook();
  await before.xlsx.readFile(originalPath);
  await after.xlsx.readFile(deliveredPath);
  const sheetBefore = before.worksheets[0];
  const sheetAfter = after.worksheets[0];
  if (!sheetBefore || !sheetAfter) throw new Error("both workbooks must have a worksheet");

  const maxRow = Math.max(sheetBefore.rowCount, sheetAfter.rowCount);
  const maxCol = Math.max(sheetBefore.columnCount, sheetAfter.columnCount);
  const differencesByColumn = new Map<number, number>();
  const approvedCellsTouched: number[] = [];
  const samples: VerifyReport["samples"] = [];

  for (let r = 1; r <= maxRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const cellBefore = sheetBefore.getRow(r).getCell(c);
      const textBefore = cellText(cellBefore.value).trim();
      const textAfter = cellText(sheetAfter.getRow(r).getCell(c).value).trim();
      if (textBefore === textAfter) continue;

      differencesByColumn.set(c, (differencesByColumn.get(c) ?? 0) + 1);
      if (c === summaryColumn) {
        if (isApproved(cellBefore)) approvedCellsTouched.push(r);
        if (samples.length < sampleLimit) {
          samples.push({ row: r, before: textBefore.slice(0, 60), after: textAfter.slice(0, 160) });
        }
      }
    }
  }

  const unexpectedColumns = [...differencesByColumn.keys()].filter((c) => c !== summaryColumn);
  return {
    differencesByColumn,
    unexpectedColumns,
    approvedCellsTouched,
    summaryColumn,
    rowsCompared: maxRow,
    ok: unexpectedColumns.length === 0 && approvedCellsTouched.length === 0,
    samples,
  };
}
