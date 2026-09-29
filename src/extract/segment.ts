/** Cutting a case file down to what actually decides it.
 *
 * A Brazilian judgment has three parts: the header, the report of the case (relatório) and
 * the operative part (dispositivo), which is the binding one — where the reasoning and the
 * operative part conflict, the operative part prevails. So the header, the report and the
 * operative part carry almost all the signal, and everything between them can go. That
 * typically removes half to four fifths of the input.
 *
 * Two modes. A single decision is cut to its three parts. A whole docket — hundreds of
 * pages of filings with decisions scattered through it — is instead reduced to windows
 * around every operative-part marker, keeping the LAST windows when the budget runs out,
 * because the operative decisions sit at the end of a case file.
 *
 * One fail-safe governs both: if the cut is not worth making, the original text is returned
 * unchanged. Segmentation may never be worse than not segmenting. */

/** Below this there is nothing to cut. */
const MIN_LENGTH = 1500;
/** Above this the text is treated as a whole docket rather than one decision (~15k tokens). */
export const FULL_DOCKET_THRESHOLD = 60_000;
/** Window around each operative-part marker, and the total window budget (~22k tokens). */
const BEFORE = 3_000;
const AFTER = 6_000;
const BUDGET = 90_000;
const HEADER_CAP = 2_000;
const REPORT_CAP = 4_000;
/** A cut that removes less than this is not worth the risk of having cut the wrong thing. */
const MIN_REDUCTION = 0.1;

/** The phrases that open the operative part of a Brazilian decision. */
export const OPERATIVE_MARKERS: RegExp[] = [
  /\bante\s+o\s+exposto\b/i,
  /\bpelo\s+exposto\b/i,
  /\bdiante\s+do\s+exposto\b/i,
  /\bem\s+face\s+do\s+exposto\b/i,
  /\bpor\s+todo\s+o\s+exposto\b/i,
  /\bpor\s+(todas\s+)?essas\s+raz[õo]es\b/i,
  /\b(à|a)\s+vista\s+do\s+exposto\b/i,
  /\b(à|a)\s+luz\s+do\s+exposto\b/i,
  /\bposto\s+isso\b/i,
  /\bisso\s+posto\b/i,
  /\bisto\s+posto\b/i,
  /^\s*dispositivo\s*$/im,
  /\bjulg(o|amos)\s+(parcialmente\s+)?(procedente|improcedente|extinto)/i,
  /\bjulg(o|amos)\s+extint[oa]/i,
  /\bacordam\s+(os|as)\s+(desembargadores|membros|integrantes|ju[íi]zes)/i,
];

/** The phrases that open the report section. */
export const REPORT_MARKERS: RegExp[] = [
  /^\s*relat[óo]rio\s*$/im,
  /\btrata[- ]se\s+de\b/i,
  /\bcuida[- ]se\s+de\b/i,
  /^\s*vistos,?\s*(etc\.?)?\s*$/im,
];

/** Diagnostic only: whether a signature block was found, which tells a reader whether the
 *  document ends where it should. */
export const SIGNATURE_HINTS: RegExp[] = [
  /\bju(iz|íza)\s+(de\s+direito|federal|do\s+trabalho|substitut[oa])/i,
  /\bdesembargador(a)?\b/i,
  /\brelator(a)?\b/i,
  /\bassinad[oa]\s+(eletronicamente|digitalmente)/i,
];

export type SegmentationMode = "none" | "decision" | "full-docket";

export interface Segmentation {
  /** What the model is given. */
  segmented: string;
  mode: SegmentationMode;
  originalLength: number;
  segmentedLength: number;
  /** Whole percent of the input removed. */
  reductionPct: number;
  found: { operative: boolean; report: boolean; signature: boolean; windows: number };
}

function firstMatch(text: string, markers: RegExp[]): number | null {
  let best: number | null = null;
  for (const re of markers) {
    const m = text.match(re);
    if (m?.index !== undefined && (best === null || m.index < best)) best = m.index;
  }
  return best;
}

function allMatches(text: string, markers: RegExp[]): number[] {
  const found: number[] = [];
  for (const re of markers) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of text.matchAll(global)) if (m.index !== undefined) found.push(m.index);
  }
  return [...new Set(found)].sort((a, b) => a - b);
}

function result(
  text: string,
  segmented: string,
  mode: SegmentationMode,
  found: Segmentation["found"],
): Segmentation {
  return {
    segmented,
    mode,
    originalLength: text.length,
    segmentedLength: segmented.length,
    reductionPct: text.length
      ? Math.round(((text.length - segmented.length) / text.length) * 100)
      : 0,
    found,
  };
}

function unsegmented(text: string, found: Segmentation["found"]): Segmentation {
  return result(text, text, "none", found);
}

/** Windows around every operative-part marker, merged where they overlap, trimmed to the
 *  budget by dropping the EARLIEST windows first. */
function docketWindows(text: string, positions: number[]): { text: string; windows: number } {
  let ranges = positions
    .map((p) => [Math.max(0, p - BEFORE), Math.min(text.length, p + AFTER)] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  ranges = merged;

  const size = () => ranges.reduce((n, [a, b]) => n + (b - a), 0);
  while (ranges.length > 1 && size() > BUDGET) ranges.shift();

  return { text: ranges.map(([a, b]) => text.slice(a, b)).join("\n\n[...]\n\n"), windows: ranges.length };
}

/** Reduces a case file to the part that decides it. */
export function segmentDecision(text: string): Segmentation {
  const empty = { operative: false, report: false, signature: false, windows: 0 };
  if (!text || text.length < MIN_LENGTH) return unsegmented(text ?? "", empty);

  const operativePositions = allMatches(text, OPERATIVE_MARKERS);
  const found = {
    operative: operativePositions.length > 0,
    report: firstMatch(text, REPORT_MARKERS) !== null,
    signature: firstMatch(text, SIGNATURE_HINTS) !== null,
    windows: 0,
  };

  if (!found.operative) return unsegmented(text, found);

  let segmented: string;
  let mode: SegmentationMode;

  if (text.length > FULL_DOCKET_THRESHOLD) {
    const { text: windows, windows: count } = docketWindows(text, operativePositions);
    found.windows = count;
    segmented =
      `[CABEÇALHO]\n${text.slice(0, HEADER_CAP)}\n\n` +
      `[DECISÕES (sentença/acórdão) — trechos relevantes dos autos]\n${windows}`;
    mode = "full-docket";
  } else {
    const operativeAt = operativePositions[0]!;
    const header = text.slice(0, Math.min(HEADER_CAP, operativeAt));
    const reportAt = firstMatch(text, REPORT_MARKERS);
    let report = "";
    if (reportAt !== null && reportAt < operativeAt) {
      report = text.slice(reportAt, operativeAt);
      if (report.length > REPORT_CAP) report = `${report.slice(0, REPORT_CAP)}\n[...]`;
    }
    segmented =
      `[CABEÇALHO]\n${header}\n\n` +
      (report ? `[RELATÓRIO / PEDIDOS]\n${report}\n\n` : "") +
      `[DISPOSITIVO E ASSINATURA]\n${text.slice(operativeAt)}`;
    mode = "decision";
    found.windows = 1;
  }

  const reduction = (text.length - segmented.length) / text.length;
  if (reduction < MIN_REDUCTION) return unsegmented(text, found);
  return result(text, segmented, mode, found);
}
