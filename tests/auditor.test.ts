/** The second gate, and the asymmetry at its centre.
 *
 * In production a failed audit call KEEPS the row: an outage must not turn a whole batch
 * yellow. In the measurement harness the same failure scores as severe, because a number
 * that could not be verified must never flatter the system. Both halves are tested here and
 * in eval.test.ts, because a reader meeting either one alone would call it a bug. */
import { describe, expect, it } from "vitest";

import { auditRow, auditRows } from "../src/gate/auditor.ts";
import type { AuditVerdict } from "../src/model/schema.ts";
import type { Auditor } from "../src/model/analyser/types.ts";
import { emptyUsage } from "../src/model/cost.ts";

const verdict = (over: Partial<AuditVerdict>): AuditVerdict => ({
  severity: "ok",
  unsupported: [],
  omissions: [],
  score: 10,
  note: "",
  ...over,
});

function auditor(answer: (summary: string) => AuditVerdict | Error): Auditor {
  return {
    kind: "test",
    async audit(_sourceText: string, summary: string) {
      const result = answer(summary);
      if (result instanceof Error) throw result;
      return { verdict: result, usage: emptyUsage() };
    },
  };
}

const row = (summary: string) => ({
  caseNumber: "1000001-11.2099.8.26.0100",
  summary,
  sourceText: "Ante o exposto, JULGO PARCIALMENTE PROCEDENTE o pedido, com retenção de 10%.",
});

describe("one row", () => {
  it("keeps a clean summary", async () => {
    const outcome = await auditRow(auditor(() => verdict({})), row("resumo correto"));
    expect(outcome.kept).toBe(true);
    expect(outcome.reason).toBeNull();
  });

  it("keeps a summary with a minor imprecision", async () => {
    // A two-level gate would send most of a batch to a human for imprecision that changes
    // nothing a client acts on.
    const outcome = await auditRow(
      auditor(() => verdict({ severity: "minor", omissions: ["custas rateadas"], score: 8 })),
      row("resumo quase completo"),
    );
    expect(outcome.kept).toBe(true);
  });

  it("refuses a summary that asserts what the source does not say", async () => {
    const outcome = await auditRow(
      auditor(() =>
        verdict({
          severity: "severe",
          unsupported: ["a retenção de 20% não consta da sentença, que fixa 10%"],
          score: 3,
        }),
      ),
      row("JULGADO PARCIALMENTE PROCEDENTE ... com retenção de 20%"),
    );
    expect(outcome.kept).toBe(false);
    expect(outcome.reason).toContain("retenção de 20%");
  });

  it("gives a reason even when the auditor names nothing specific", async () => {
    const outcome = await auditRow(
      auditor(() => verdict({ severity: "severe", unsupported: [], score: 2 })),
      row("resumo"),
    );
    expect(outcome.kept).toBe(false);
    expect(outcome.reason).toBeTruthy();
  });

  it("keeps the row when the audit call itself fails", async () => {
    const outcome = await auditRow(
      auditor(() => new Error("529 overloaded")),
      row("resumo correto"),
    );
    expect(outcome.kept).toBe(true);
    expect(outcome.error).toContain("529");
    expect(outcome.verdict).toBeNull();
  });
});

describe("a batch of rows", () => {
  const rows = [
    row("bom"),
    { ...row("inventado"), caseNumber: "1000002-22.2099.8.26.0100" },
    { ...row("indisponível"), caseNumber: "1000003-33.2099.8.26.0100" },
  ];
  const mixed = auditor((summary) => {
    if (summary === "inventado") return verdict({ severity: "severe", unsupported: ["x"], score: 1 });
    if (summary === "indisponível") return new Error("timeout");
    return verdict({});
  });

  it("counts what it kept, what it demoted and what it could not judge", async () => {
    const report = await auditRows(mixed, rows, 2);
    expect(report.kept).toBe(2);
    expect(report.demoted).toBe(1);
    expect(report.failed).toBe(1);
  });

  it("returns an outcome per row, in order", async () => {
    const report = await auditRows(mixed, rows, 1);
    expect(report.outcomes.map((o) => o.caseNumber)).toEqual(rows.map((r) => r.caseNumber));
  });

  it("can only refuse, never promote", async () => {
    // Nothing the auditor returns adds a row: it is given what the first gate passed.
    const report = await auditRows(mixed, rows, 2);
    expect(report.outcomes).toHaveLength(rows.length);
  });

  it("handles an empty batch", async () => {
    const report = await auditRows(mixed, [], 2);
    expect(report).toMatchObject({ kept: 0, demoted: 0, failed: 0 });
  });
});
