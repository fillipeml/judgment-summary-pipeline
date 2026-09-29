/** Snapping a claim name onto the closed list a spreadsheet column can be grouped by.
 *
 * The catalogue is given to the model as prompt text rather than as a schema enum, so the
 * model's answer is a suggestion and this module is the arbiter. The threshold matters in
 * both directions: too low and "Danos morais" becomes "Danos materiais", which is a
 * different claim; too high and every accent lost in PDF extraction becomes a miss. */
import { describe, expect, it } from "vitest";

import {
  catalogue,
  diceCoefficient,
  matchClaim,
  MATCH_THRESHOLD,
  normaliseKey,
  repairClaimNames,
} from "../src/extract/catalogue.ts";
import { NOT_IDENTIFIED } from "../src/domain/house-style.ts";

describe("the catalogue itself", () => {
  it("is a non-trivial closed list with no duplicates", () => {
    const claims = catalogue();
    expect(claims.length).toBeGreaterThan(30);
    expect(new Set(claims).size).toBe(claims.length);
  });

  it("includes the sentinel, so a non-match is a value the column can hold", () => {
    expect(catalogue()).toContain(NOT_IDENTIFIED);
  });

  it("has no two entries that normalise to the same key", () => {
    const keys = catalogue().map(normaliseKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("normalising a claim name", () => {
  it("strips accents, case and punctuation", () => {
    expect(normaliseKey("Rescisão Contratual")).toBe("rescisao contratual");
    expect(normaliseKey("  DANOS   MORAIS!  ")).toBe("danos morais");
    expect(normaliseKey("Honorários advocatícios")).toBe("honorarios advocaticios");
  });

  it("returns an empty key for nothing", () => {
    expect(normaliseKey("")).toBe("");
    expect(normaliseKey("---")).toBe("");
  });
});

describe("the similarity measure", () => {
  it("is 1 for identical strings and 0 for disjoint ones", () => {
    expect(diceCoefficient("danos morais", "danos morais")).toBe(1);
    expect(diceCoefficient("xyz", "abc")).toBe(0);
  });

  it("is 0 for a string too short to have a bigram", () => {
    expect(diceCoefficient("a", "abc")).toBe(0);
  });

  it("is symmetric", () => {
    const a = diceCoefficient("rescisao contratual", "resolucao contratual");
    const b = diceCoefficient("resolucao contratual", "rescisao contratual");
    expect(a).toBeCloseTo(b, 10);
  });
});

describe("matching a claim the model wrote", () => {
  it("matches exactly, accents and all", () => {
    const match = matchClaim("Rescisão contratual");
    expect(match).toMatchObject({ canonical: "Rescisão contratual", method: "exact", score: 1 });
  });

  it("matches an entry whose accents PDF extraction lost", () => {
    expect(matchClaim("Rescisao contratual").canonical).toBe("Rescisão contratual");
    expect(matchClaim("HONORARIOS ADVOCATICIOS").canonical).toBe("Honorários advocatícios");
  });

  it("tolerates a near miss in spelling", () => {
    expect(matchClaim("Restituição integral dos valores pago").canonical).toBe(
      "Restituição integral dos valores pagos",
    );
  });

  it("refuses to guess when nothing is close", () => {
    const match = matchClaim("pedido completamente fora do catálogo de imóveis e contratos");
    expect(match.canonical).toBeNull();
    expect(match.method).toBe("none");
  });

  it("does not turn one claim into a different one", () => {
    // These two are one letter apart in Portuguese and are different heads of claim.
    expect(matchClaim("Danos morais").canonical).toBe("Danos morais");
    expect(matchClaim("Danos materiais").canonical).toBe("Danos materiais");
  });

  it("returns no match for an empty name", () => {
    expect(matchClaim("").canonical).toBeNull();
    expect(matchClaim(undefined as unknown as string).canonical).toBeNull();
  });

  it("reports the score it rejected on, so the threshold can be tuned from data", () => {
    const match = matchClaim("rescisao", 0.99);
    expect(match.canonical).toBeNull();
    expect(match.score).toBeGreaterThan(0);
    expect(match.score).toBeLessThan(0.99);
  });

  it("uses a threshold high enough to be a spelling repair, not a classifier", () => {
    expect(MATCH_THRESHOLD).toBeGreaterThan(0.75);
  });
});

describe("repairing a whole result", () => {
  it("snaps every claim onto the catalogue", () => {
    const result = repairClaimNames({
      claims: [
        { rawClaim: "rescisão do contrato", canonicalClaim: "Rescisao contratual" },
        { rawClaim: "devolução das parcelas", canonicalClaim: "Devolucao de valores pagos" },
      ],
    });
    expect(result.claims.map((c) => c.canonicalClaim)).toEqual([
      "Rescisão contratual",
      "Devolução de valores pagos",
    ]);
  });

  it("falls back to the raw claim when the model's canonical name is the sentinel", () => {
    const result = repairClaimNames({
      claims: [{ rawClaim: "danos morais", canonicalClaim: NOT_IDENTIFIED }],
    });
    expect(result.claims[0]!.canonicalClaim).toBe("Danos morais");
  });

  it("leaves the sentinel alone when the raw claim matches nothing either", () => {
    const result = repairClaimNames({
      claims: [{ rawClaim: "algo totalmente distinto e sem paralelo", canonicalClaim: NOT_IDENTIFIED }],
    });
    expect(result.claims[0]!.canonicalClaim).toBe(NOT_IDENTIFIED);
  });

  it("handles a result with no claims without throwing", () => {
    expect(repairClaimNames({ claims: [] }).claims).toEqual([]);
  });
});
