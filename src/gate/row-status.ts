/** The first gate: free, deterministic, and the only one that can let a row through.
 *
 * It asks four questions of the generated summary, none of which needs a model or a
 * network call:
 *   0. did the model report, in the exact sentence it was given, that the file holds no
 *      final decision? That row is held back, but it is not a failure: separating it from
 *      the format failures below is the difference between "the model did as it was told"
 *      and "the model produced something unusable", and a reviewer needs to know which.
 *   1. does it open in the firm's house style?
 *   2. is it a settlement with no terms, which is worthless to the client?
 *   3. did the model itself say, in prose, that it could not tell?
 *
 * The last is the interesting one. The prompt forbids invention and tells the model to say
 * so when the documents do not support an outcome, so when it says so the gate believes it
 * — even when the sentence otherwise starts correctly. The regexes are in house-style.ts. */
import {
  AMOUNT_RE,
  SELF_DECLARED_INSUFFICIENCY_RE,
  SETTLEMENT_OPENING_RE,
  TERMS_UNAVAILABLE_RE,
  UNDETERMINED_OPENING,
  VALID_OPENING_RE,
} from "../domain/house-style.ts";

export type RowStatus = "writeable" | "needs_review";

export type RefusalReason =
  | "no_final_decision"
  | "off_house_style"
  | "settlement_without_terms"
  | "self_declared_insufficiency";

export interface GateDecision {
  status: RowStatus;
  reason: RefusalReason | null;
  detail: string;
}

const DETAIL: Record<RefusalReason, string> = {
  no_final_decision:
    "the documents hold no final decision, and the reading said so in the exact terms it was asked to use: there is nothing to write",
  off_house_style:
    "the summary does not open with a merits outcome or an approved settlement, which usually means the source was insufficient",
  settlement_without_terms:
    "an approved settlement whose terms are not in the documents: no amount, and the text says the terms are unavailable",
  self_declared_insufficiency:
    "the model stated that the documents did not let it determine the outcome",
};

/** Decides whether a generated summary may be written into the client's spreadsheet. */
export function gateRow(summary: string): GateDecision {
  const text = (summary ?? "").trim();

  if (text.startsWith(UNDETERMINED_OPENING)) return refuse("no_final_decision");

  if (!VALID_OPENING_RE.test(text)) return refuse("off_house_style");

  if (
    SETTLEMENT_OPENING_RE.test(text) &&
    !AMOUNT_RE.test(text) &&
    TERMS_UNAVAILABLE_RE.test(text)
  ) {
    return refuse("settlement_without_terms");
  }

  if (SELF_DECLARED_INSUFFICIENCY_RE.test(text)) return refuse("self_declared_insufficiency");

  return { status: "writeable", reason: null, detail: "" };
}

function refuse(reason: RefusalReason): GateDecision {
  return { status: "needs_review", reason, detail: DETAIL[reason] };
}
