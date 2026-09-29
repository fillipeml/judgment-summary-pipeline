/** The deterministic gate.
 *
 * This is the single most consequential function in the repository: it is what decides
 * whether a generated sentence is written into a client's spreadsheet or held back for a
 * human. It is free, it runs on every row, and nothing downstream can promote what it
 * refuses. So it is tested first and hardest. */
import { describe, expect, it } from "vitest";

import { gateRow } from "../src/gate/row-status.ts";
import { UNDETERMINED_OPENING } from "../src/domain/house-style.ts";

const WRITEABLE = [
  "JULGADO PROCEDENTE o pedido para condenar a ré à restituição integral dos valores pagos.",
  "JULGADO PARCIALMENTE PROCEDENTE o pedido, com retenção de 10% e correção pelo INPC.",
  "JULGADO IMPROCEDENTE o pedido, ante o reconhecimento da prescrição trienal.",
  "JULGADO EXTINTO o processo sem resolução do mérito, por abandono da causa.",
  "Acordo homologado entre as partes, no valor de R$ 96.400,00 em 8 parcelas mensais.",
];

describe("the three rules the gate applies", () => {
  it("accepts each house-style opening", () => {
    for (const summary of WRITEABLE) {
      expect(gateRow(summary), summary.slice(0, 40)).toMatchObject({
        status: "writeable",
        reason: null,
      });
    }
  });

  it("refuses a summary that does not open in the house style", () => {
    const decision = gateRow("O processo foi julgado parcialmente procedente pelo juízo.");
    expect(decision.status).toBe("needs_review");
    expect(decision.reason).toBe("off_house_style");
    expect(decision.detail).not.toBe("");
  });

  it("refuses an approved settlement whose terms are not in the documents", () => {
    const decision = gateRow("Acordo homologado entre as partes; termos não disponíveis nas peças.");
    expect(decision.status).toBe("needs_review");
    expect(decision.reason).toBe("settlement_without_terms");
  });

  it("refuses even a settlement that names a figure, once the model flags missing terms", () => {
    // Worth stating, because it looks like an over-refusal and is one on purpose. The third
    // rule outranks the second: wherever the model says information is missing, the row goes
    // to a human, settlement or not. The price is the occasional useful summary held back;
    // the alternative is an under-specified settlement reaching a client as if it were final.
    const decision = gateRow(
      "Acordo homologado no valor de R$ 48.000,00; demais termos não disponíveis nas peças.",
    );
    expect(decision.status).toBe("needs_review");
    expect(decision.reason).toBe("self_declared_insufficiency");
  });

  it("keeps a settlement that names its terms and flags nothing as missing", () => {
    const decision = gateRow(
      "Acordo homologado no valor de R$ 96.400,00, em 8 parcelas mensais de R$ 12.050,00.",
    );
    expect(decision.status).toBe("writeable");
  });

  it("believes the model when it says it could not tell", () => {
    const decision = gateRow(`${UNDETERMINED_OPENING}, havendo apenas petição inicial e despacho.`);
    expect(decision.status).toBe("needs_review");
  });

  it("does not call a correct report of nothing a format failure", () => {
    // The row is held back either way. Which reason a reviewer reads decides whether they
    // go looking for a broken prompt or for the missing judgment.
    const decision = gateRow(`${UNDETERMINED_OPENING}, havendo apenas petição inicial.`);
    expect(decision.reason).toBe("no_final_decision");
    expect(gateRow("qualquer texto fora do padrão").reason).toBe("off_house_style");
  });

  it("refuses a self-declared insufficiency even behind a correct opening", () => {
    // The dangerous shape: it looks finished, and says in its own words that it is not.
    const decision = gateRow(
      "JULGADO PARCIALMENTE PROCEDENTE o pedido, embora não tenha sido possível identificar " +
        "o percentual de retenção a partir das peças fragmentadas.",
    );
    expect(decision.status).toBe("needs_review");
    expect(decision.reason).toBe("self_declared_insufficiency");
  });

  it.each([
    ["peças ilegíveis", "JULGADO PROCEDENTE o pedido, ainda que as peças estejam ilegíveis."],
    [
      "terms unavailable",
      "JULGADO EXTINTO o processo; os termos do ajuste não estão disponíveis nos autos.",
    ],
    [
      "outcome not determined",
      "JULGADO PROCEDENTE o pedido; o resultado do recurso não foi possível determinar.",
    ],
  ])("catches the paraphrase: %s", (_label, summary) => {
    expect(gateRow(summary).status).toBe("needs_review");
  });
});

describe("the edges that would be silent failures", () => {
  it("refuses an empty summary rather than writing a blank cell as an answer", () => {
    for (const empty of ["", "   ", "\n\n"]) {
      expect(gateRow(empty).status).toBe("needs_review");
    }
  });

  it("tolerates a null or undefined summary", () => {
    expect(gateRow(undefined as unknown as string).status).toBe("needs_review");
    expect(gateRow(null as unknown as string).status).toBe("needs_review");
  });

  it("allows leading whitespace, which PDF extraction leaves behind", () => {
    expect(gateRow("   JULGADO PROCEDENTE o pedido.").status).toBe("writeable");
  });

  it("does not accept the house-style words in the middle of a sentence", () => {
    expect(gateRow("O pedido foi JULGADO PROCEDENTE.").status).toBe("needs_review");
  });

  it("never returns a refusal without a reason a human can read", () => {
    const decision = gateRow("texto qualquer");
    expect(decision.reason).not.toBeNull();
    expect(decision.detail.length).toBeGreaterThan(20);
  });
});
