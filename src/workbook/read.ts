/** Reading the client's workbook: which rows may be touched at all.
 *
 * Two pieces of ExcelJS lore are load-bearing here.
 *
 * A cell value is not a string. It may be a scalar, an array of rich-text runs, a hyperlink
 * object or a formula with a cached result, and reading it naively gives "[object Object]".
 *
 * And "approved" is a FONT colour, not a fill — the team coloured the text. Excel stores a
 * partially recoloured cell as an array of runs, so a cell whose first words were recoloured
 * has no cell-level font colour at all. Checking only `cell.font.color` silently misses
 * those, which would mean overwriting human work. */
import ExcelJS from "exceljs";

import { extractCaseNumber } from "../domain/case-number.ts";
import { MERITS_OPENING_RE, VALID_OPENING_RE } from "../domain/house-style.ts";
import { APPROVED_FONT } from "./colours.ts";

/** What a row's summary cell currently holds. */
export type CellState = "blank" | "house_style" | "off_style";

export interface WorkbookRow {
  row: number;
  caseNumber: string;
  /** The text already in the summary cell. */
  existing: string;
  state: CellState;
  /** True when the cell is human-reviewed: never a target, never written. */
  approved: boolean;
}

export interface LoadedWorkbook {
  workbook: ExcelJS.Workbook;
  sheet: ExcelJS.Worksheet;
  summaryColumn: number;
  rows: WorkbookRow[];
}

/** Flattens every shape an ExcelJS cell value can take. */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const o = value as {
      richText?: { text: string }[];
      text?: string;
      result?: unknown;
      hyperlink?: string;
    };
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join("");
    if (typeof o.text === "string") return o.text;
    if (o.result !== undefined) return String(o.result);
  }
  return String(value);
}

/** True when the cell carries the approved colour on the cell font or on ANY rich-text run. */
export function isApproved(cell: ExcelJS.Cell): boolean {
  if (cell.font?.color?.argb === APPROVED_FONT) return true;
  const value = cell.value as { richText?: { font?: { color?: { argb?: string } } }[] } | null;
  if (value && Array.isArray(value.richText)) {
    return value.richText.some((run) => run.font?.color?.argb === APPROVED_FONT);
  }
  return false;
}

export function classifyCell(text: string): CellState {
  if (!text.trim()) return "blank";
  return MERITS_OPENING_RE.test(text) || VALID_OPENING_RE.test(text) ? "house_style" : "off_style";
}

/** Finds the summary column by its header, falling back to an explicit index. Resolving by
 *  header means a column inserted upstream does not silently move the write target. */
export function resolveSummaryColumn(
  sheet: ExcelJS.Worksheet,
  header: string,
  fallback?: number,
): number {
  const headerRow = sheet.getRow(1);
  const wanted = header.trim().toLowerCase();
  for (let c = 1; c <= sheet.columnCount; c++) {
    if (cellText(headerRow.getCell(c).value).trim().toLowerCase() === wanted) return c;
  }
  if (fallback) return fallback;
  throw new Error(
    `no column headed "${header}" in the first row, and no fallback index was configured`,
  );
}

export async function loadWorkbook(
  path: string,
  options: { summaryHeader: string; summaryColumn?: number; caseColumn?: number },
): Promise<LoadedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error(`${path} has no worksheet`);
  const summaryColumn = resolveSummaryColumn(sheet, options.summaryHeader, options.summaryColumn);
  const caseColumn = options.caseColumn ?? 1;

  const rows: WorkbookRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const caseNumber = extractCaseNumber(cellText(sheet.getRow(r).getCell(caseColumn).value));
    if (!caseNumber) continue;
    const cell = sheet.getRow(r).getCell(summaryColumn);
    const existing = cellText(cell.value).trim();
    rows.push({
      row: r,
      caseNumber,
      existing,
      state: classifyCell(existing),
      approved: isApproved(cell) && !!existing,
    });
  }
  return { workbook, sheet, summaryColumn, rows };
}

/** The rows the pipeline is allowed to touch: not human-approved, and not already in house
 *  style. This is the first of the three places approved rows are excluded. */
export function targetRows(rows: WorkbookRow[]): WorkbookRow[] {
  return rows.filter((r) => !r.approved && r.state !== "house_style");
}

/** Rows a human already approved AND that are in house style: the gold standard the parity
 *  harness measures against. They are read here and never written. */
export function goldStandardRows(rows: WorkbookRow[]): WorkbookRow[] {
  return rows.filter((r) => r.approved && r.state === "house_style");
}

/** Approved rows that do NOT follow the house style. Auditing the gold standard itself
 *  matters: it sets the ceiling for how strictly the format rule can be applied. */
export function approvedButOffStyle(rows: WorkbookRow[]): WorkbookRow[] {
  return rows.filter((r) => r.approved && r.state === "off_style");
}
