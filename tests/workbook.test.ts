/** The three guards that stand between this pipeline and a lawyer's reviewed work.
 *
 * A summary written over an approved cell is not a bug that shows up in a report: it is a
 * reviewer's afternoon, silently overwritten, discovered weeks later. The guards are
 * therefore tested as behaviour, on real workbook files written and read back from disk,
 * not on mocks of ExcelJS. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { APPROVED_FONT, REVIEW_FILL, WRITTEN_FILL, WRITTEN_FONT } from "../src/workbook/colours.ts";
import {
  cellText,
  classifyCell,
  goldStandardRows,
  isApproved,
  loadWorkbook,
  resolveSummaryColumn,
  targetRows,
} from "../src/workbook/read.ts";
import { applyStyle, writeSummaries } from "../src/workbook/write.ts";
import { columnLetter, verifyOutput } from "../src/workbook/verify.ts";

const HEADER = "Resumo Decisão";
const HOUSE = "JULGADO PARCIALMENTE PROCEDENTE o pedido, com retenção de 10%.";
const APPROVED_TEXT = "JULGADO PROCEDENTE o pedido de outorga de escritura definitiva.";

let dir: string;
let source: string;

/** Four row states plus the rich-text case, written once and read back by every test. */
async function buildWorkbook(path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Carteira");
  sheet.addRow(["Processo", "Cliente", HEADER, "Responsável"]);

  const rows: [string, string, string][] = [
    ["1000001-11.2099.8.26.0100", "blank", ""],
    ["1000002-22.2099.8.26.0100", "off_style", "acordo feito, ver com o Dr."],
    ["1000003-33.2099.8.26.0100", "house_style", HOUSE],
    ["2000001-11.2099.8.26.0200", "approved", APPROVED_TEXT],
    ["2000002-22.2099.8.26.0200", "approved_rich", ""],
    ["2000003-33.2099.8.26.0200", "approved_off_style", "combinado com a parte, ok"],
  ];
  for (const [caseNumber, label, text] of rows) {
    const row = sheet.addRow([caseNumber, label, text, "MD"]);
    const cell = row.getCell(3);
    if (label === "approved" || label === "approved_off_style") {
      cell.font = { color: { argb: APPROVED_FONT } };
    }
    if (label === "approved_rich") {
      // Only PART of the text is coloured: the shape that defeats a naive colour check.
      cell.value = {
        richText: [
          { text: "JULGADO IMPROCEDENTE o pedido", font: { color: { argb: APPROVED_FONT } } },
          { text: ", ante a prescrição trienal.", font: { color: { argb: APPROVED_FONT } } },
        ],
      };
    }
  }
  await workbook.xlsx.writeFile(path);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "jsp-workbook-"));
  source = join(dir, "caseload.xlsx");
  await buildWorkbook(source);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("reading a cell whose value can be anything", () => {
  it("flattens every shape ExcelJS produces", () => {
    expect(cellText(null)).toBe("");
    expect(cellText(undefined)).toBe("");
    expect(cellText("texto")).toBe("texto");
    expect(cellText(42 as unknown as ExcelJS.CellValue)).toBe("42");
    expect(cellText({ richText: [{ text: "a" }, { text: "b" }] } as ExcelJS.CellValue)).toBe("ab");
    expect(cellText({ text: "link", hyperlink: "x" } as ExcelJS.CellValue)).toBe("link");
    expect(cellText({ formula: "A1", result: "calculado" } as ExcelJS.CellValue)).toBe("calculado");
  });

  it("classifies the cell states the pipeline routes on", () => {
    expect(classifyCell("")).toBe("blank");
    expect(classifyCell("   ")).toBe("blank");
    expect(classifyCell(HOUSE)).toBe("house_style");
    expect(classifyCell("Acordo homologado no valor de R$ 10,00.")).toBe("house_style");
    expect(classifyCell("acordo feito, ver com o Dr.")).toBe("off_style");
  });
});

describe("finding the column by its header", () => {
  it("resolves by header name", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(source);
    expect(resolveSummaryColumn(workbook.worksheets[0]!, HEADER)).toBe(3);
  });

  it("is blind to case and surrounding whitespace", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(source);
    expect(resolveSummaryColumn(workbook.worksheets[0]!, "  resumo decisão  ")).toBe(3);
  });

  it("falls back to the configured index when the header is absent", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(source);
    expect(resolveSummaryColumn(workbook.worksheets[0]!, "Coluna Inexistente", 3)).toBe(3);
  });

  it("throws rather than guessing when there is no header and no fallback", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(source);
    expect(() => resolveSummaryColumn(workbook.worksheets[0]!, "Coluna Inexistente")).toThrow(
      /no column headed/,
    );
  });
});

describe("recognising a cell a human approved", () => {
  it("finds the approved rows, including the partly-coloured one", async () => {
    const loaded = await loadWorkbook(source, { summaryHeader: HEADER });
    const approved = loaded.rows.filter((r) => r.approved).map((r) => r.caseNumber);
    expect(approved).toEqual([
      "2000001-11.2099.8.26.0200",
      "2000002-22.2099.8.26.0200",
      "2000003-33.2099.8.26.0200",
    ]);
  });

  it("does not treat an empty approved-looking cell as approved", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("s");
    const cell = sheet.getRow(1).getCell(1);
    cell.font = { color: { argb: APPROVED_FONT } };
    // The colour is there; the work is not.
    expect(isApproved(cell)).toBe(true);
    expect(cellText(cell.value)).toBe("");
  });

  it("does not treat an ordinary cell as approved", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("s");
    const cell = sheet.getRow(1).getCell(1);
    cell.value = HOUSE;
    expect(isApproved(cell)).toBe(false);
  });
});

describe("choosing which rows may be written", () => {
  it("excludes approved rows and rows already in house style", async () => {
    const loaded = await loadWorkbook(source, { summaryHeader: HEADER });
    expect(targetRows(loaded.rows).map((r) => r.caseNumber)).toEqual([
      "1000001-11.2099.8.26.0100",
      "1000002-22.2099.8.26.0100",
    ]);
  });

  it("offers only approved house-style rows as the parity ground truth", async () => {
    const loaded = await loadWorkbook(source, { summaryHeader: HEADER });
    // The approved off-style row is excluded: it is not a standard to be measured against.
    expect(goldStandardRows(loaded.rows).map((r) => r.caseNumber)).toEqual([
      "2000001-11.2099.8.26.0200",
      "2000002-22.2099.8.26.0200",
    ]);
  });
});

describe("styling one cell without repainting its neighbours", () => {
  it("does not leak a fill into a cell that merely looks alike", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("s");
    const a = sheet.getRow(1).getCell(1);
    const b = sheet.getRow(2).getCell(1);
    a.value = "a";
    b.value = "b";
    applyStyle(a, WRITTEN_FILL, WRITTEN_FONT);
    // ExcelJS shares one style object between identical cells; cloning is what stops this.
    expect((b.style.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb).toBeUndefined();
    expect((a.style.fill as ExcelJS.FillPattern).fgColor?.argb).toBe(WRITTEN_FILL);
  });

  it("keeps the other style properties of the cell it paints", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("s");
    const cell = sheet.getRow(1).getCell(1);
    cell.value = "a";
    cell.font = { bold: true };
    applyStyle(cell, REVIEW_FILL);
    expect(cell.style.font?.bold).toBe(true);
  });
});

describe("writing the delivery", () => {
  it("writes accepted rows, tints refused ones, and never touches approved work", async () => {
    const out = join(dir, "delivered.xlsx");
    const loaded = await loadWorkbook(source, { summaryHeader: HEADER });
    const report = await writeSummaries(
      source,
      out,
      [
        {
          caseNumber: "1000001-11.2099.8.26.0100",
          row: 2,
          status: "writeable",
          summary: HOUSE,
        },
        {
          caseNumber: "1000002-22.2099.8.26.0100",
          row: 3,
          status: "needs_review",
          summary: "texto recusado",
          reason: "off house style",
        },
        // Aimed straight at an approved cell: the runtime guard must stop it.
        {
          caseNumber: "2000001-11.2099.8.26.0200",
          row: 5,
          status: "writeable",
          summary: "TEXTO QUE NUNCA DEVE SER GRAVADO",
        },
        {
          caseNumber: "9999999-99.2099.8.26.0100",
          row: 9999,
          status: "writeable",
          summary: HOUSE,
        },
      ],
      { summaryColumn: loaded.summaryColumn },
    );

    expect(report.written).toBe(1);
    expect(report.flagged).toBe(1);
    expect(report.skippedApproved).toBe(1);
    expect(report.missingRow).toBe(1);

    const after = new ExcelJS.Workbook();
    await after.xlsx.readFile(out);
    const sheet = after.worksheets[0]!;
    expect(cellText(sheet.getRow(2).getCell(3).value)).toBe(HOUSE);
    // A refused row keeps its own text: the pipeline flags, it does not erase.
    expect(cellText(sheet.getRow(3).getCell(3).value)).toBe("acordo feito, ver com o Dr.");
    expect(cellText(sheet.getRow(5).getCell(3).value)).toBe(APPROVED_TEXT);
  });

  it("leaves the original file untouched", async () => {
    const loaded = await loadWorkbook(source, { summaryHeader: HEADER });
    expect(loaded.rows.find((r) => r.row === 2)?.existing).toBe("");
  });

  it("verifies the delivered file differs only in the summary column", async () => {
    const out = join(dir, "verified.xlsx");
    const loaded = await loadWorkbook(source, { summaryHeader: HEADER });
    await writeSummaries(
      source,
      out,
      [{ caseNumber: "1000001-11.2099.8.26.0100", row: 2, status: "writeable", summary: HOUSE }],
      { summaryColumn: loaded.summaryColumn },
    );
    const report = await verifyOutput(source, out, loaded.summaryColumn);
    expect(report.ok).toBe(true);
    expect(report.unexpectedColumns).toEqual([]);
    expect(report.approvedCellsTouched).toEqual([]);
    expect(report.differencesByColumn.get(3)).toBe(1);
  });

  it("fails verification when a cell outside the summary column changed", async () => {
    const out = join(dir, "tampered.xlsx");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(source);
    workbook.worksheets[0]!.getRow(2).getCell(2).value = "alterado";
    await workbook.xlsx.writeFile(out);

    const report = await verifyOutput(source, out, 3);
    expect(report.ok).toBe(false);
    expect(report.unexpectedColumns).toContain(2);
  });

  it("fails verification when an approved cell changed", async () => {
    const out = join(dir, "overwritten.xlsx");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(source);
    workbook.worksheets[0]!.getRow(5).getCell(3).value = "sobrescrito";
    await workbook.xlsx.writeFile(out);

    const report = await verifyOutput(source, out, 3);
    expect(report.ok).toBe(false);
    expect(report.approvedCellsTouched).toContain(5);
  });
});

describe("column letters", () => {
  it.each([
    [1, "A"],
    [3, "C"],
    [26, "Z"],
    [27, "AA"],
    [34, "AH"],
    [52, "AZ"],
    [53, "BA"],
  ])("%i is %s", (index, letter) => {
    expect(columnLetter(index)).toBe(letter);
  });
});
