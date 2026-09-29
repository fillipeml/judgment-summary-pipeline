/** The structured result of one case, and the contract the second model call must satisfy.
 *
 * Almost every field has a default. That is deliberate: the schema must never force the
 * model to fill a field the documents do not support, because a schema that demands an
 * answer is how invention gets laundered into structured data. The two exceptions are the
 * ones where an empty answer would be meaningless — there has to be an outcome, and there
 * has to be at least one claim. */
import { z } from "zod";

import { NOT_IDENTIFIED } from "../domain/house-style.ts";

/** First-instance outcome. Portuguese: procedente / parcialmente procedente / improcedente
 *  / extinto (sem resolução de mérito) / não identificado. */
export const CaseOutcome = z.enum([
  "upheld",
  "partly_upheld",
  "dismissed",
  "terminated",
  "not_identified",
]);
export type CaseOutcome = z.infer<typeof CaseOutcome>;

/** Per-claim outcome: the case outcomes plus "moot" (prejudicado), which a single claim can
 *  be but a whole case cannot. */
export const ClaimOutcome = z.enum([
  "upheld",
  "partly_upheld",
  "dismissed",
  "terminated",
  "moot",
  "not_identified",
]);
export type ClaimOutcome = z.infer<typeof ClaimOutcome>;

/** Appeal outcome. An appellate court has its own vocabulary: provido / parcialmente
 *  provido / não provido (desprovido) / não conhecido. null means there was no appeal. */
export const AppealOutcome = z.enum([
  "allowed",
  "partly_allowed",
  "not_allowed",
  "not_entertained",
  "not_identified",
]);
export type AppealOutcome = z.infer<typeof AppealOutcome>;

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

export const Claim = z.object({
  rawClaim: z.string().min(1).describe("The claim as the case file words it, shortened"),
  canonicalClaim: z
    .string()
    .min(1)
    .describe(`The closest name in the official catalogue, or "${NOT_IDENTIFIED}"`),
  outcome: ClaimOutcome,
  laterDecision: z
    .string()
    .default("")
    .describe("A later decision that changed this claim's outcome, or empty"),
  notes: z.string().default(""),
  confidence: Confidence.default("medium").describe(
    "high when the claim and its outcome are explicit in the operative part; medium when inferred; low when ambiguous",
  ),
});
export type Claim = z.infer<typeof Claim>;

export const CaseResult = z.object({
  caseNumber: z.string().default(NOT_IDENTIFIED),
  outcome: CaseOutcome,
  judge: z.string().default(NOT_IDENTIFIED),
  appealOutcome: AppealOutcome.nullable().default(null),
  reportingJudge: z.string().default(NOT_IDENTIFIED),
  summary: z
    .string()
    .default("")
    .describe(
      "The consolidated house-style summary in Brazilian Portuguese: one single running paragraph",
    ),
  notes: z.string().default(""),
  claims: z.array(Claim).min(1),
});
export type CaseResult = z.infer<typeof CaseResult>;

/** What the fidelity auditor returns. Three severities with a single cut point at the top:
 *  only "severe" refuses a row. */
export const AuditSeverity = z.enum(["ok", "minor", "severe"]);
export type AuditSeverity = z.infer<typeof AuditSeverity>;

export const AuditVerdict = z.object({
  severity: AuditSeverity,
  unsupported: z
    .array(z.string())
    .describe("Each assertion of the summary the source does not support, with the figure at issue"),
  omissions: z
    .array(z.string())
    .default([])
    .describe("Central holdings of the operative part the summary leaves out"),
  score: z.number().describe("0 to 10 for fidelity to the source"),
  note: z.string().default(""),
});
export type AuditVerdict = z.infer<typeof AuditVerdict>;

/** What the parity judge returns when a generated summary is compared with a human-approved
 *  one for the same case. */
export const ParityVerdict = z.object({
  sameOutcome: z.boolean(),
  factsAgree: z.boolean(),
  houseStyle: z.boolean(),
  verdict: z.enum(["equivalent", "ours_more_complete", "ours_worse", "conflict"]),
  score: z.number(),
  note: z.string().default(""),
});
export type ParityVerdict = z.infer<typeof ParityVerdict>;
