/** Reading the text of a case file PDF, and noticing when there is none to read.
 *
 * Brazilian case files arrive two ways: exported from the court's system, where the text is
 * embedded, or scanned from paper, where the pages are images. The second kind needs a
 * vision pass; the point of this module is to tell them apart honestly rather than hand the
 * pipeline an empty string. */

/** Below this many characters per page the pages are images, not text. */
const MIN_CHARS_PER_PAGE = 60;
const MIN_TOTAL_CHARS = 200;

export interface PdfText {
  text: string;
  pageCount: number;
  /** True when there is too little text to be a text PDF: it needs OCR. */
  isScanned: boolean;
  charsPerPage: number;
}

export async function readPdf(data: Uint8Array): Promise<PdfText> {
  const { extractText } = await import("unpdf");
  const { totalPages, text } = await extractText(data, { mergePages: true });
  const merged = (text as string) ?? "";
  const pageCount = totalPages || 1;
  const charsPerPage = merged.length / Math.max(pageCount, 1);
  return {
    text: merged,
    pageCount,
    charsPerPage,
    isScanned: charsPerPage < MIN_CHARS_PER_PAGE || merged.trim().length < MIN_TOTAL_CHARS,
  };
}

/** Joins the documents of one case with a header naming each, so the model can see which
 *  filing it is reading rather than one undifferentiated wall of text. */
export function joinDocuments(parts: { kind: string; name: string; text: string }[]): string {
  return parts
    .filter((p) => p.text.trim())
    .map((p) => `===== ${p.kind.toUpperCase()}: ${p.name} =====\n${p.text}`)
    .join("\n\n");
}
