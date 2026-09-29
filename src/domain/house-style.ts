/** The firm's house style for a decision summary, and the phrases that mean "I could not
 *  tell". These regexes are the cheap gate: they decide, without a model and without a
 *  network call, whether a generated summary may be written into the client's spreadsheet.
 *
 *  They are written against Portuguese because the summaries are Portuguese: the documents
 *  are Brazilian court judgments and the cell is read by Brazilian lawyers. Every spelling
 *  is matched with and without diacritics, because PDF extraction and OCR lose them. */

/** A merits outcome, in capitals, as the first words of the paragraph. */
export const MERITS_OPENING_RE =
  /^\s*JULGADO\s+(PROCEDENTE|PARCIALMENTE PROCEDENTE|IMPROCEDENTE|EXTINTO)/i;

/** A court-approved settlement, the other accepted opening. */
export const SETTLEMENT_OPENING_RE = /^\s*acordo\s+homologado/i;

/** The full set of openings a writeable summary may have. */
export const VALID_OPENING_RE =
  /^\s*(JULGADO\s+(PROCEDENTE|PARCIALMENTE PROCEDENTE|IMPROCEDENTE|EXTINTO)|Acordo homologado)/i;

/** A monetary amount, used to tell a settlement with terms from one without. */
export const AMOUNT_RE = /R\$/;

/** A settlement that states its terms are unavailable. */
export const TERMS_UNAVAILABLE_RE = /(n[ãa]o)\s+(dispon|const|identific|inform)/i;

/** The model saying, in prose, that the documents did not let it decide. The prompt asks for
 *  the first of these verbatim; the others catch the paraphrases observed in review. */
export const SELF_DECLARED_INSUFFICIENCY_RE =
  /n[ãa]o foi poss[íi]vel (identificar|determinar)|pe[çc]as?[^.]{0,30}(fragmentad|insuficient)|ileg[íi]ve(l|is)|termos?[^.]{0,20}n[ãa]o[^.]{0,10}dispon|resultado[^.]{0,25}n[ãa]o[^.]{0,12}(identific|determin)/i;

/** The exact opening the prompt demands when the file holds no final decision. Its only job
 *  is to be machine-detectable: the gate below keys on it. */
export const UNDETERMINED_OPENING =
  "Não foi possível determinar o resultado final do processo a partir das peças disponíveis";

/** The value every text field takes when the documents do not support one. */
export const NOT_IDENTIFIED = "Não identificado";

/** The accepted first-instance outcomes, as they are written in a summary. */
export const MERITS_WORDS = [
  "PROCEDENTE",
  "PARCIALMENTE PROCEDENTE",
  "IMPROCEDENTE",
  "EXTINTO",
] as const;
