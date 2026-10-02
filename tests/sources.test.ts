/** Finding the right documents for a case, out of a folder named by nobody in particular.
 *
 * Three separate problems, tested together because they are one pipeline: what kind of
 * filing is this, which of a case's filings should be read, and how many cases have any
 * filing at all. */
import { describe, expect, it } from "vitest";

import { classifyDocument, DECISIVE, KIND_LABEL } from "../src/sources/classify.ts";
import { coverageProgression, measureCoverage } from "../src/sources/coverage.ts";
import { indexByCase, planFor } from "../src/sources/plan.ts";
import type { SourceDocument } from "../src/sources/store.ts";

const doc = (
  name: string,
  bytes = 1000,
  path = name,
  caseNumber: string | null = null,
): SourceDocument => ({
  id: path,
  name,
  path,
  bytes,
  kind: classifyDocument(name),
  caseNumber,
});

describe("classifying a filing by its name", () => {
  it.each([
    ["1000001-11.2099.8.26.0100 - sentenca.pdf", "judgment"],
    ["SENTENÇA.PDF", "judgment"],
    ["acordao_final.pdf", "appellate_ruling"],
    ["ACÓRDÃO 8a camara.pdf", "appellate_ruling"],
    ["termo de acordo.pdf", "settlement"],
    ["homologacao de transacao.pdf", "settlement"],
    ["despacho inicial.pdf", "order"],
    ["decisao interlocutoria.pdf", "order"],
    ["certidao de transito em julgado.pdf", "certificate"],
    ["mandado de citacao.pdf", "writ"],
    ["voto do relator.pdf", "opinion"],
    ["documento (3).pdf", "generic"],
    ["planilha.xlsx", "not_pdf"],
  ])("%s is a %s", (name, kind) => {
    expect(classifyDocument(name)).toBe(kind);
  });

  it("does not confuse an appellate ruling with a settlement", () => {
    // "acórdão" and "acordo" differ by one letter and mean opposite things: one is a court
    // deciding the appeal, the other is the parties agreeing. Folding them together puts a
    // wrong outcome in a client's spreadsheet.
    expect(classifyDocument("acordao.pdf")).toBe("appellate_ruling");
    expect(classifyDocument("acordo.pdf")).toBe("settlement");
    expect(classifyDocument("ACORDAO INTEGRA.pdf")).toBe("appellate_ruling");
  });

  it("names every kind in Portuguese for the reports", () => {
    for (const kind of Object.keys(KIND_LABEL)) {
      expect(KIND_LABEL[kind as keyof typeof KIND_LABEL]).toBeTruthy();
    }
    expect(DECISIVE).toEqual(["judgment", "appellate_ruling", "settlement"]);
  });
});

describe("choosing what to read for one case", () => {
  const CASE = "1000001-11.2099.8.26.0100";

  it("prefers the named decisive filings, largest of each kind", () => {
    const plan = planFor(CASE, [
      doc("sentenca pequena.pdf", 100),
      doc("sentenca completa.pdf", 9000),
      doc("acordao.pdf", 4000),
      doc("despacho.pdf", 8000),
    ]);
    expect(plan.strategy).toBe("named_decisions");
    expect(plan.documents.map((d) => d.name)).toEqual([
      "sentenca completa.pdf",
      "sentenca pequena.pdf",
      "acordao.pdf",
    ]);
    // The despacho is larger than the acórdão and is still left out: size never beats kind.
    expect(plan.documents.map((d) => d.name)).not.toContain("despacho.pdf");
  });

  it("falls back to the largest unclassified filing", () => {
    const plan = planFor(CASE, [doc("documento (1).pdf", 500), doc("documento (2).pdf", 5000)]);
    expect(plan.strategy).toBe("generic");
    expect(plan.documents).toHaveLength(1);
    expect(plan.documents[0]!.name).toBe("documento (2).pdf");
  });

  it("falls back again to a filing that decides nothing, and says so", () => {
    const plan = planFor(CASE, [doc("mandado.pdf", 900), doc("certidao.pdf", 300)]);
    expect(plan.strategy).toBe("weak");
    expect(plan.why).toContain("non-decisive");
  });

  it("prefers a named judgment over anything else attributed to the case", () => {
    const docket = doc("autos completos.pdf", 5_000_000);
    // The docket arrives as an ordinary attributed document; a named judgment still wins,
    // because it costs less and says more.
    expect(planFor(CASE, [doc("sentenca.pdf"), docket]).strategy).toBe("named_decisions");
  });

  it("returns an empty plan rather than inventing a source", () => {
    const plan = planFor(CASE, []);
    expect(plan.strategy).toBe("none");
    expect(plan.documents).toEqual([]);
  });

  it("ignores files that are not PDFs", () => {
    expect(planFor(CASE, [doc("planilha.xlsx", 9000)]).strategy).toBe("none");
  });

  it("recovers a document whose name punctuates the case number differently", () => {
    // The coverage report showed this key recovers real files; attribution was taught it too,
    // so the report can never claim a document the run is unable to use.
    const bare = doc("10000011120998260100_sentenca.pdf");
    expect(bare.caseNumber).toBeNull();
    const index = indexByCase([bare], [CASE]);
    expect(index.get(CASE)).toHaveLength(1);
  });

  it("does not attribute a bare number to a case nobody asked about", () => {
    const index = indexByCase([doc("10000011120998260100_sentenca.pdf")]);
    expect(index.size).toBe(0);
  });

  it("groups documents by the case they were attributed to", () => {
    const index = indexByCase([
      doc("a.pdf", 1, "a.pdf", CASE),
      doc("b.pdf", 1, "b.pdf", CASE),
      doc("c.pdf", 1, "c.pdf", "1000002-22.2099.8.26.0100"),
      doc("orphan.pdf", 1, "orphan.pdf", null),
    ]);
    expect(index.get(CASE)).toHaveLength(2);
    expect(index.size).toBe(2);
  });
});

describe("how many cases have anything to read", () => {
  const targets = [
    "1000001-11.2099.8.26.0100",
    "1000002-22.2099.8.26.0100",
    "1000003-33.2099.8.26.0100",
    "1000004-44.2099.8.26.0100",
  ];
  const documents = [
    // named after the case
    doc("1000001-11.2099.8.26.0100 - sentenca.pdf"),
    // the number is only on the folder
    doc("SENTENCA (2).pdf", 1000, "sources/1000002-22.2099.8.26.0100/SENTENCA (2).pdf"),
    // punctuated differently
    doc("10000033320998260100_acordo.pdf"),
    // no case number anywhere
    doc("processo da Marina.pdf"),
  ];

  it("under-reports when the key is the file name alone", () => {
    const report = measureCoverage(targets, documents, "filename");
    expect(report.covered).toEqual(["1000001-11.2099.8.26.0100"]);
    expect(report.coveragePct).toBe(25);
  });

  it("recovers the case whose number is only on the folder", () => {
    const report = measureCoverage(targets, documents, "path");
    expect(report.covered).toContain("1000002-22.2099.8.26.0100");
  });

  it("recovers the case punctuated differently", () => {
    const report = measureCoverage(targets, documents, "digits");
    expect(report.covered).toContain("1000003-33.2099.8.26.0100");
  });

  it("never claims a case that genuinely has no document", () => {
    for (const report of coverageProgression(targets, documents)) {
      expect(report.uncovered, report.key).toContain("1000004-44.2099.8.26.0100");
    }
  });

  it("reports coverage as a progression, so each relaxation's gain is visible", () => {
    const progression = coverageProgression(targets, documents);
    expect(progression.map((r) => r.key)).toEqual(["filename", "path", "digits"]);
    const counts = progression.map((r) => r.covered.length);
    // Monotonic: a looser key never loses a case a stricter one found.
    expect(counts[1]).toBeGreaterThanOrEqual(counts[0]!);
    expect(counts[2]).toBeGreaterThanOrEqual(counts[1]!);
  });

  it("lists the documents that carry no case number at all", () => {
    const report = measureCoverage(targets, documents, "digits");
    expect(report.unattributable).toContain("processo da Marina.pdf");
  });

  it("does not divide by zero on an empty target list", () => {
    expect(measureCoverage([], documents, "filename").coveragePct).toBe(0);
  });
});
