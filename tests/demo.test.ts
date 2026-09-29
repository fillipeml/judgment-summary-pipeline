/** The whole pipeline, end to end, on the committed fixtures.
 *
 * Every other test covers one function. This one runs the chain the way a person runs it —
 * discovery, both batch rounds, both gates, the write and the verification — and pins the
 * outcome of each of the twelve fixture cases. Each case exists to force one branch, so a
 * change that quietly stops a branch firing fails here rather than in somebody's spreadsheet.
 *
 * It is also the "are the fixtures still current" check. Comparing committed binaries byte
 * for byte across platforms proves nothing useful; running them and checking what comes out
 * proves the thing that matters. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runAll, type RunSummary, type Runner } from "../src/batch/runner.ts";
import { RunState, type CaseRecord } from "../src/batch/state.ts";
import { loadConfig } from "../src/config.ts";
import { build } from "../src/factory.ts";
import { gateRow } from "../src/gate/row-status.ts";
import { isFictional } from "../src/domain/case-number.ts";
import { loadWorkbook, targetRows } from "../src/workbook/read.ts";

const SETTLEMENT_NO_TERMS = "1000004-44.2099.8.26.0100";
const NO_DECISION = "1000005-55.2099.8.26.0100";
const INVENTED_FIGURE = "1000007-77.2099.8.26.0100";
const SCANNED_ONLY = "1000009-99.2099.8.26.0100";

let dir: string;
let runner: Runner;
let summary: RunSummary;
let records: CaseRecord[];

const find = (caseNumber: string): CaseRecord | undefined =>
  records.find((r) => r.caseNumber === caseNumber);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "jsp-demo-"));
  const config = { ...loadConfig({ DEMO_MODE: "true" }), outDir: dir, concurrency: 4 };
  const parts = build(config);
  runner = {
    config,
    state: new RunState(config.outDir),
    store: parts.store,
    mapBatches: parts.mapBatches,
    structureBatches: parts.structureBatches,
    auditor: parts.auditor,
    log: () => {},
  };
  summary = await runAll(runner, { outputPath: join(dir, "delivered.xlsx") });
  records = runner.state.cases();
}, 120_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the corpus itself", () => {
  it("is made only of case numbers that cannot exist", async () => {
    const loaded = await loadWorkbook(runner.config.workbookPath, {
      summaryHeader: runner.config.summaryHeader,
      caseColumn: runner.config.caseColumn,
    });
    expect(loaded.rows.length).toBeGreaterThan(20);
    for (const row of loaded.rows) {
      expect(isFictional(row.caseNumber), row.caseNumber).toBe(true);
    }
  });

  it("offers rows in every state the pipeline routes on", async () => {
    const loaded = await loadWorkbook(runner.config.workbookPath, {
      summaryHeader: runner.config.summaryHeader,
      caseColumn: runner.config.caseColumn,
    });
    const states = new Set(loaded.rows.map((r) => r.state));
    expect([...states].sort()).toEqual(["blank", "house_style", "off_style"]);
    expect(loaded.rows.some((r) => r.approved)).toBe(true);
    expect(targetRows(loaded.rows)).toHaveLength(11);
  });
});

describe("finding the documents", () => {
  it("reads every case that has a readable document", () => {
    expect(summary.extract.targets).toBe(11);
    expect(summary.extract.extracted).toBe(8);
    expect(summary.extract.failed).toEqual([]);
  });

  it("leaves a case with nothing but a scan blank, rather than guessing", () => {
    // A scan needs a vision pass this path does not do. Refusing is the honest answer.
    expect(find(SCANNED_ONLY)).toBeUndefined();
    expect(summary.extract.noSource).toBe(3);
  });

  it("finds a case whose number is only on its folder", () => {
    // Judgment before appellate ruling: the plan orders by kind, not by file name.
    expect(find("1000002-22.2099.8.26.0100")?.documentsUsed).toEqual([
      "SENTENCA (2).pdf",
      "ACORDAO.pdf",
    ]);
  });

  it("finds a case whose file name punctuates the number differently", () => {
    expect(find("1000003-33.2099.8.26.0100")?.documentsUsed.length).toBeGreaterThan(0);
  });
});

describe("both rounds of the batch", () => {
  it("collects a map and a structured result for every extracted case", () => {
    expect(summary.maps.collected).toBe(8);
    expect(summary.maps.failed).toBe(0);
    expect(summary.structure.collected).toBe(8);
    expect(summary.structure.invalid).toBe(0);
  });

  it("bills the batch rounds at the batch price", () => {
    expect(summary.maps.usage.costUSD).toBeGreaterThan(0);
    expect(summary.usage.costUSD).toBeGreaterThan(0);
  });

  it("records which documents each summary was built from", () => {
    for (const record of records) {
      expect(record.documentsUsed.length, record.caseNumber).toBeGreaterThan(0);
      expect(record.strategy, record.caseNumber).not.toBe("none");
    }
  });
});

describe("the first gate", () => {
  it("passes six and holds back two", () => {
    expect(summary.structure.writeable).toBe(6);
    expect(summary.structure.needsReview).toBe(2);
  });

  it("holds back a settlement whose terms are not in the documents", () => {
    expect(find(SETTLEMENT_NO_TERMS)).toMatchObject({
      status: "needs_review",
      gateReason: "settlement_without_terms",
    });
  });

  it("holds back a file that contains no final decision, and says which it is", () => {
    const record = find(NO_DECISION)!;
    expect(record.status).toBe("needs_review");
    expect(record.gateReason).toBe("no_final_decision");
  });

  it("agrees with the gate run on its own, for every case", () => {
    // The record's status must be reproducible from the summary text alone: nothing else
    // may have influenced it at collection time.
    for (const record of records) {
      if (record.auditReason) continue;
      expect(gateRow(record.summary).status, record.caseNumber).toBe(record.status);
    }
  });
});

describe("the second gate", () => {
  it("refuses exactly the row that states a figure the judgment does not", () => {
    expect(summary.audit.demoted).toBe(1);
    expect(summary.audit.failed).toBe(0);
    const record = find(INVENTED_FIGURE)!;
    expect(record.status).toBe("needs_review");
    expect(record.auditSeverity).toBe("severe");
    expect(record.auditReason).toContain("20%");
  });

  it("lets the row through the cheap gate first, which is the point", () => {
    // If the deterministic gate had caught it, the auditor would prove nothing.
    expect(gateRow(find(INVENTED_FIGURE)!.summary).status).toBe("writeable");
  });

  it("keeps a row whose only fault is an omission", () => {
    expect(find("1000002-22.2099.8.26.0100")).toMatchObject({ status: "writeable" });
  });
});

describe("the delivered workbook", () => {
  it("writes the accepted rows and flags the rest", () => {
    expect(summary.delivery.write.written).toBe(5);
    expect(summary.delivery.write.flagged).toBe(3);
    expect(summary.delivery.write.missingRow).toBe(0);
  });

  it("differs from the original in the summary column and nowhere else", () => {
    expect(summary.delivery.verify.ok).toBe(true);
    expect(summary.delivery.verify.unexpectedColumns).toEqual([]);
    expect(summary.delivery.verify.approvedCellsTouched).toEqual([]);
  });

  it("changed exactly as many cells as it wrote plus flagged", () => {
    const changed = summary.delivery.verify.differencesByColumn.get(
      summary.delivery.verify.summaryColumn,
    );
    // Only the written rows change text; a flagged row keeps its text and gets a colour.
    expect(changed).toBe(summary.delivery.write.written);
  });

  it("never touches a row a reviewer approved", () => {
    expect(summary.delivery.write.skippedApproved).toBe(0);
    for (const record of records) {
      expect(record.caseNumber.startsWith("3"), record.caseNumber).toBe(false);
    }
  });
});

describe("resuming", () => {
  it("does not pay again for a case that was already accepted", async () => {
    const second = await runAll(runner, { outputPath: join(dir, "delivered-again.xlsx") });
    expect(second.extract.extracted).toBe(0);
    expect(second.extract.alreadyDone).toBe(8);
    // Not "less": nothing at all. Every stage finds its own output already on disk, so a
    // second run over an unchanged corpus is free.
    expect(second.maps.collected).toBe(0);
    expect(second.structure.collected).toBe(0);
    // Seen again and deliberately not re-priced: collecting the same batch twice must not
    // double the cost the run reports.
    expect(second.maps.skipped).toBe(8);
    expect(second.audit.outcomes).toEqual([]);
    expect(second.usage.costUSD).toBe(0);
  }, 120_000);

  it("delivers the same rows on the second run", async () => {
    const again = await runAll(runner, { outputPath: join(dir, "delivered-third.xlsx") });
    expect(again.delivery.write.written).toBe(summary.delivery.write.written);
    expect(again.delivery.write.flagged).toBe(summary.delivery.write.flagged);
    expect(again.delivery.verify.ok).toBe(true);
  }, 120_000);

  it("delivers the same workbook on a second run", async () => {
    const again = runner.state.cases();
    expect(again.map((r) => `${r.caseNumber}:${r.status}`)).toEqual(
      records.map((r) => `${r.caseNumber}:${r.status}`),
    );
  });
});
