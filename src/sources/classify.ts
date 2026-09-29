/** Which filing is this, judging by its file name?
 *
 * A case folder holds a judgment, an appellate ruling, a settlement, and a dozen procedural
 * orders, certificates and writs that decide nothing. Reading all of them costs money and
 * dilutes the evidence; reading the wrong one produces a confident summary of a procedural
 * order. Names are messy but they are the only metadata there is.
 *
 * One distinction here is legal, not cosmetic: "acórdão" (an appellate ruling) and "acordo"
 * (a settlement) differ by one letter and mean entirely different outcomes. An earlier
 * version of this classifier folded them together, which is exactly the kind of bug that
 * turns into a wrong answer in a client's spreadsheet. */

export type DocumentKind =
  | "judgment"
  | "appellate_ruling"
  | "settlement"
  | "order"
  | "certificate"
  | "writ"
  | "opinion"
  | "generic"
  | "not_pdf";

/** The filings that can decide a case. Everything else is context at best. */
export const DECISIVE: DocumentKind[] = ["judgment", "appellate_ruling", "settlement"];

export function classifyDocument(name: string): DocumentKind {
  const n = name.toUpperCase();
  if (!/\.PDF$/.test(n)) return "not_pdf";
  if (/SENTEN[ÇC]A/.test(n)) return "judgment";
  if (/AC[ÓO]RD[ÃA]O/.test(n)) return "appellate_ruling";
  // Checked after acórdão on purpose: the two words differ by one letter.
  if (/ACORDO|TRANSA[ÇC]|HOMOLOGA/.test(n)) return "settlement";
  if (/DESPACHO|DECIS[ÃA]O\s+INTERLOCUT/.test(n)) return "order";
  if (/CERTID[ÃA]O|TR[ÂA]NSITO/.test(n)) return "certificate";
  if (/MANDADO/.test(n)) return "writ";
  if (/\bVOTO\b/.test(n)) return "opinion";
  return "generic";
}

export const KIND_LABEL: Record<DocumentKind, string> = {
  judgment: "sentença",
  appellate_ruling: "acórdão",
  settlement: "acordo/homologação",
  order: "despacho",
  certificate: "certidão",
  writ: "mandado",
  opinion: "voto",
  generic: "peça",
  not_pdf: "não-PDF",
};
