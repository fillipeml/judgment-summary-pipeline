/** Cutting a case file down to the part that decides it.
 *
 * The cost of cutting badly is that the model reads a superseded decision and reports it as
 * the result, which is the worst failure this pipeline has. So the property that matters is
 * not the size of the reduction: it is that the LAST operative part always survives. */
import { describe, expect, it } from "vitest";

import { FULL_DOCKET_THRESHOLD, segmentDecision } from "../src/extract/segment.ts";

const filler = (n: number, word = "manifestação processual sem conteúdo decisório. "): string =>
  word.repeat(Math.ceil(n / word.length)).slice(0, n);

const HEADER = "PODER JUDICIÁRIO — 2ª Vara Cível da Comarca de Porto das Águas\n";
const OPERATIVE =
  "Ante o exposto, JULGO PARCIALMENTE PROCEDENTE o pedido para condenar a ré à restituição " +
  "dos valores pagos, com retenção de 10%.\n";
const SIGNATURE = "Documento assinado eletronicamente por Dr. Henrique Salles Pinto, Juiz de Direito.";

describe("when there is nothing worth cutting", () => {
  it("returns a short decision unchanged", () => {
    const text = `${HEADER}${OPERATIVE}${SIGNATURE}`;
    const out = segmentDecision(text);
    expect(out.mode).toBe("none");
    expect(out.segmented).toBe(text);
    expect(out.reductionPct).toBe(0);
  });

  it("returns empty input unchanged rather than throwing", () => {
    expect(segmentDecision("").segmented).toBe("");
    expect(segmentDecision(undefined as unknown as string).segmented).toBe("");
  });

  it("returns a long document with no operative marker unchanged", () => {
    // Better to send everything than to guess which paragraph decided the case.
    const text = HEADER + filler(20_000);
    const out = segmentDecision(text);
    expect(out.mode).toBe("none");
    expect(out.found.operative).toBe(false);
    expect(out.segmented).toBe(text);
  });

  it("returns the original when the cut would remove less than a tenth", () => {
    // The operative part is almost the whole document: cutting buys nothing and risks much.
    const text = `${HEADER}${filler(1_600)}\n${OPERATIVE}${filler(200)}`;
    const out = segmentDecision(text);
    expect(out.mode).toBe("none");
    // The marker was still found and reported, even though nothing was cut.
    expect(out.found.operative).toBe(true);
  });
});

describe("one decision", () => {
  const text =
    HEADER +
    "RELATÓRIO\n" +
    "Trata-se de ação de rescisão contratual ajuizada por Marina Duarte Bastos.\n" +
    filler(30_000) +
    "FUNDAMENTAÇÃO\n" +
    filler(20_000) +
    OPERATIVE +
    SIGNATURE;

  it("keeps the header, the report and everything from the operative part on", () => {
    const out = segmentDecision(text);
    expect(out.mode).toBe("decision");
    expect(out.segmented).toContain("[CABEÇALHO]");
    expect(out.segmented).toContain("[RELATÓRIO / PEDIDOS]");
    expect(out.segmented).toContain("[DISPOSITIVO E ASSINATURA]");
    expect(out.segmented).toContain("JULGO PARCIALMENTE PROCEDENTE");
    expect(out.segmented).toContain(SIGNATURE);
  });

  it("removes most of the reasoning", () => {
    const out = segmentDecision(text);
    expect(out.reductionPct).toBeGreaterThan(50);
    expect(out.segmentedLength).toBeLessThan(out.originalLength);
  });

  it("reports what it found", () => {
    const out = segmentDecision(text);
    expect(out.found).toMatchObject({ operative: true, report: true, signature: true, windows: 1 });
  });
});

describe("a whole docket", () => {
  const superseded =
    "Ante o exposto, JULGO IMPROCEDENTE o pedido, PRIMEIRA-DECISAO-SUPERADA.\n";
  const governing =
    "ACORDAM os Desembargadores da 8ª Câmara de Direito Privado em dar provimento ao " +
    "recurso, ULTIMA-DECISAO-VALIDA.\n";
  const text =
    HEADER +
    filler(30_000) +
    superseded +
    filler(120_000) +
    governing +
    "Documento assinado eletronicamente por Des. Rafael Quintanilha Serra, Relator.";

  it("switches to window mode past the threshold", () => {
    const out = segmentDecision(text);
    expect(out.originalLength).toBeGreaterThan(FULL_DOCKET_THRESHOLD);
    expect(out.mode).toBe("full-docket");
    expect(out.found.windows).toBeGreaterThanOrEqual(1);
  });

  it("always keeps the last operative part", () => {
    // The whole point. A docket trimmed from the wrong end reports a reversed judgment.
    const out = segmentDecision(text);
    expect(out.segmented).toContain("ULTIMA-DECISAO-VALIDA");
  });

  it("keeps the header so the model can see whose case it is", () => {
    expect(segmentDecision(text).segmented).toContain("Porto das Águas");
  });

  it("drops the earliest windows first when the budget is exceeded", () => {
    const many =
      HEADER +
      Array.from(
        { length: 20 },
        (_unused, i) =>
          `${filler(20_000)}\nAnte o exposto, JULGO PROCEDENTE o pedido, MARCADOR-${i}.\n`,
      ).join("");
    const out = segmentDecision(many);
    expect(out.segmented).toContain("MARCADOR-19");
    expect(out.segmented).not.toContain("MARCADOR-0,");
    expect(out.segmentedLength).toBeLessThan(out.originalLength);
  });

  it("marks where text was removed, so nobody reads it as continuous", () => {
    const out = segmentDecision(text);
    expect(out.segmented).toContain("[...]");
  });
});
