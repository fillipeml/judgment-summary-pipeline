/** The measurement harnesses.
 *
 * A harness that flatters the system is worse than none, because it produces a number people
 * quote. Three properties are tested here: an audit call that failed scores as severe, the
 * population is the DELIVERED rows rather than everything produced, and a comparison that
 * did not happen is not a tie. */
import { describe, expect, it } from "vitest";

import { emptyUsage } from "../src/model/cost.ts";
import type { AuditVerdict, ParityVerdict } from "../src/model/schema.ts";
import type { Auditor, ParityJudge } from "../src/model/analyser/types.ts";
import { deliveredCases, measureFidelity, renderFidelity } from "../src/eval/fidelity.ts";
import { measureParity, renderParity } from "../src/eval/parity.ts";
import { formatRate, rate, uniformStride } from "../src/eval/sample.ts";
import type { CaseRecord } from "../src/batch/state.ts";

const record = (over: Partial<CaseRecord>): CaseRecord =>
  ({
    caseNumber: "1000001-11.2099.8.26.0100",
    row: 2,
    previousText: "",
    strategy: "named_decisions",
    documentsUsed: ["sentenca.pdf"],
    summary: "JULGADO PROCEDENTE o pedido.",
    status: "writeable",
    gateReason: null,
    gateDetail: "",
    auditReason: null,
    auditSeverity: null,
    result: { claims: [] } as unknown as CaseRecord["result"],
    usage: emptyUsage(),
    ...over,
  }) as CaseRecord;

describe("choosing the sample", () => {
  it("spreads the picks evenly across the population", () => {
    expect(uniformStride([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toEqual([1, 3, 5, 7, 9]);
  });

  it("returns everything when the sample is as large as the population", () => {
    expect(uniformStride([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(uniformStride([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });

  it("never repeats an item", () => {
    const picked = uniformStride(Array.from({ length: 7 }, (_u, i) => i), 5);
    expect(new Set(picked).size).toBe(picked.length);
  });

  it("is reproducible: the same input gives the same sample every time", () => {
    const items = Array.from({ length: 97 }, (_u, i) => i);
    expect(uniformStride(items, 13)).toEqual(uniformStride(items, 13));
  });

  it("returns nothing for a zero or negative size", () => {
    expect(uniformStride([1, 2, 3], 0)).toEqual([]);
    expect(uniformStride([1, 2, 3], -4)).toEqual([]);
  });
});

describe("rates", () => {
  it("returns null rather than zero for an empty denominator", () => {
    // "0% of 0 rows failed" reads like a pass. It is not a measurement at all.
    expect(rate(0, 0)).toBeNull();
    expect(formatRate(null)).toBe("n/a");
  });

  it("rounds to one decimal", () => {
    expect(rate(1, 3)).toBe(33.3);
    expect(formatRate(33.3)).toBe("33.3%");
  });
});

describe("what fidelity measures", () => {
  it("counts only rows that were actually delivered", () => {
    const records = [
      record({}),
      record({ caseNumber: "1000002-22.2099.8.26.0100", status: "needs_review" }),
      record({ caseNumber: "1000003-33.2099.8.26.0100", summary: "   " }),
    ];
    // A row the gate refused was never shown to anyone: counting it would let the system
    // earn credit for work it declined to do.
    expect(deliveredCases(records).map((r) => r.caseNumber)).toEqual([
      "1000001-11.2099.8.26.0100",
    ]);
  });
});

const auditor = (answer: (c: string) => AuditVerdict | Error): Auditor => ({
  kind: "test",
  async audit(sourceText: string) {
    const result = answer(sourceText);
    if (result instanceof Error) throw result;
    return { verdict: result, usage: emptyUsage() };
  },
});

const cases = [
  { caseNumber: "a", summary: "s", sourceText: "clean" },
  { caseNumber: "b", summary: "s", sourceText: "minor" },
  { caseNumber: "c", summary: "s", sourceText: "severe" },
  { caseNumber: "d", summary: "s", sourceText: "broken" },
];

describe("the fidelity harness", () => {
  const judge = auditor((source) => {
    if (source === "broken") return new Error("529 overloaded");
    if (source === "severe") {
      return { severity: "severe", unsupported: ["retenção de 20%"], omissions: [], score: 2, note: "" };
    }
    if (source === "minor") {
      return { severity: "minor", unsupported: [], omissions: ["custas"], score: 8, note: "" };
    }
    return { severity: "ok", unsupported: [], omissions: [], score: 10, note: "" };
  });

  it("scores an audit call that failed as severe", async () => {
    // The opposite of production, on purpose: an unverifiable row must not flatter the number.
    const report = await measureFidelity(judge, cases, { size: 4 });
    expect(report.severe).toBe(2);
    expect(report.failedCalls).toBe(1);
  });

  it("separates clean from merely-not-severe", async () => {
    const report = await measureFidelity(judge, cases, { size: 4 });
    expect(report.ok).toBe(1);
    expect(report.minor).toBe(1);
    // "Clean" means no unsupported assertion, which a minor verdict can still be: a minor is
    // usually an omission, and an omission is not an invention. The severe rate is the one
    // that answers "did it make something up".
    expect(report.cleanRate).toBe(50);
    expect(report.severeRate).toBe(50);
  });

  it("reports the population it sampled from, not just the sample", async () => {
    const report = await measureFidelity(judge, cases.slice(0, 2), { size: 1, population: 400 });
    expect(report.sampled).toBe(1);
    expect(report.population).toBe(400);
  });

  it("writes out every row that was not clean, with the assertion at issue", async () => {
    const markdown = renderFidelity(await measureFidelity(judge, cases, { size: 4 }));
    expect(markdown).toContain("retenção de 20%");
    expect(markdown).toContain("529 overloaded");
    expect(markdown).toContain("custas");
  });

  it("does not crash on an empty population", async () => {
    const report = await measureFidelity(judge, [], { size: 10 });
    expect(report.sampled).toBe(0);
    expect(report.severeRate).toBeNull();
    expect(renderFidelity(report)).toContain("n/a");
  });
});

describe("the parity harness", () => {
  const verdicts: Record<string, ParityVerdict | Error> = {
    same: { sameOutcome: true, factsAgree: true, houseStyle: true, verdict: "equivalent", score: 9, note: "" },
    better: { sameOutcome: true, factsAgree: true, houseStyle: true, verdict: "ours_more_complete", score: 8, note: "" },
    worse: { sameOutcome: true, factsAgree: true, houseStyle: true, verdict: "ours_worse", score: 5, note: "perdeu os honorários" },
    clash: { sameOutcome: false, factsAgree: false, houseStyle: true, verdict: "conflict", score: 4, note: "resultados opostos" },
  };
  const judge: ParityJudge = {
    kind: "test",
    async compare(_reference: string, generated: string) {
      const v = verdicts[generated];
      if (!v) throw new Error("no verdict recorded");
      if (v instanceof Error) throw v;
      return { verdict: v, usage: emptyUsage() };
    },
  };
  const pairs = [
    { caseNumber: "a", reference: "r", generated: "same" },
    { caseNumber: "b", reference: "r", generated: "better" },
    { caseNumber: "c", reference: "r", generated: "worse" },
    { caseNumber: "d", reference: "r", generated: "clash" },
    { caseNumber: "e", reference: "r", generated: "missing" },
  ];

  it("counts each verdict separately", async () => {
    const report = await measureParity(judge, pairs, { size: 5 });
    expect(report).toMatchObject({
      equivalent: 1,
      moreComplete: 1,
      worse: 1,
      conflict: 1,
      failedCalls: 1,
    });
  });

  it("does not let a more complete summary be scored as a tie", async () => {
    const report = await measureParity(judge, pairs, { size: 5 });
    expect(report.atLeastAsGoodRate).toBe(40);
  });

  it("counts a failed comparison as a loss, not a tie", async () => {
    const report = await measureParity(judge, pairs, { size: 5 });
    const errored = report.outcomes.find((o) => o.caseNumber === "e")!;
    expect(errored.verdict).toBe("error");
    expect(errored.sameOutcome).toBe(false);
  });

  it("tracks the one thing that must never differ", async () => {
    const report = await measureParity(judge, pairs, { size: 5 });
    expect(report.sameOutcomeRate).toBe(60);
  });

  it("names every case where the pipeline lost", async () => {
    const markdown = renderParity(await measureParity(judge, pairs, { size: 5 }));
    expect(markdown).toContain("perdeu os honorários");
    expect(markdown).toContain("resultados opostos");
    expect(markdown).toContain("no verdict recorded");
  });
});
