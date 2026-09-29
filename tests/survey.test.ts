/** Counting the house style off the corpus instead of asserting it.
 *
 * The gate enforces two accepted openings. This is where those two came from: a count of
 * what the reviewers actually wrote, run before the prompt was, and re-runnable by anyone
 * who wants to check the rule still matches the corpus. */
import { describe, expect, it } from "vitest";

import { renderStyleSurvey, surveyHouseStyle } from "../src/report/house-style-survey.ts";
import { classifyCell, type WorkbookRow } from "../src/workbook/read.ts";

const row = (existing: string, approved: boolean, i: number): WorkbookRow => ({
  row: i + 2,
  caseNumber: `100000${i}-11.2099.8.26.0100`,
  existing,
  state: classifyCell(existing),
  approved,
});

const SETTLEMENT_A = "Acordo homologado entre as partes no valor de R$ 62.000,00, em 10 parcelas.";
const SETTLEMENT_B =
  "JULGADO EXTINTO o processo, com resolução do mérito, homologado o acordo de R$ 54.200,00.";
const MERITS = "JULGADO PARCIALMENTE PROCEDENTE o pedido, com retenção de 10%.";
const OFF_STYLE = "combinado com a parte, devolve 70% e encerra";

describe("the settlement wording contest", () => {
  const rows = [
    ...Array.from({ length: 5 }, (_u, i) => row(SETTLEMENT_A, true, i)),
    ...Array.from({ length: 2 }, (_u, i) => row(SETTLEMENT_B, true, i + 5)),
    row(MERITS, true, 7),
    row(OFF_STYLE, true, 8),
    // Not approved: a row nobody signed off on has no vote.
    row(SETTLEMENT_B, false, 9),
  ];
  const survey = surveyHouseStyle(rows);

  it("counts only rows a reviewer approved", () => {
    expect(survey.approvedRows).toBe(9);
    expect(survey.settlementForms.reduce((n, f) => n + f.count, 0)).toBe(7);
  });

  it("declares the form the corpus actually favours", () => {
    expect(survey.dominantSettlementForm).toBe("Acordo homologado");
    expect(survey.dominancePct).toBeCloseTo(71.4, 1);
  });

  it("keeps the losing form visible, with its count", () => {
    // A contest reported only by its winner is an assertion again.
    const loser = survey.settlementForms.find((f) => f.form !== "Acordo homologado");
    expect(loser?.count).toBe(2);
  });

  it("separates a merits opening from a settlement in merits wording", () => {
    expect(survey.meritsForms.map((f) => f.form)).toEqual(["JULGADO PARCIALMENTE PROCEDENTE"]);
  });

  it("reports approved rows matching no accepted opening as the ceiling on strictness", () => {
    // A gate stricter than the reviewers' own output would refuse work they call finished.
    expect(survey.unrecognised.count).toBe(1);
    expect(survey.unrecognised.examples[0]).toContain("combinado com a parte");
  });

  it("quotes examples of each form, so the count can be checked by eye", () => {
    const markdown = renderStyleSurvey(survey);
    expect(markdown).toContain("Acordo homologado entre as partes no valor");
    expect(markdown).toContain("JULGADO EXTINTO o processo");
    expect(markdown).toContain("71.4%");
  });
});

describe("a corpus with nothing to count", () => {
  it("says the rule is unsupported rather than picking a winner", () => {
    const survey = surveyHouseStyle([row(MERITS, true, 0)]);
    expect(survey.dominantSettlementForm).toBeNull();
    expect(survey.dominancePct).toBeNull();
    expect(renderStyleSurvey(survey)).toContain("unsupported by this corpus");
  });

  it("handles an empty workbook", () => {
    const survey = surveyHouseStyle([]);
    expect(survey.approvedRows).toBe(0);
    expect(() => renderStyleSurvey(survey)).not.toThrow();
  });

  it("ignores an approved row with no text", () => {
    expect(surveyHouseStyle([row("   ", true, 0)]).approvedRows).toBe(0);
  });
});
