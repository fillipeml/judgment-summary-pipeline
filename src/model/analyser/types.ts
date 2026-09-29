import type { AuditVerdict, CaseResult, ParityVerdict } from "../schema.ts";
import type { Usage } from "../cost.ts";

export interface MapOutput {
  /** The free-form map of the case, ending in the FINAL SUMMARY TABLE. */
  map: string;
  usage: Usage;
}

export interface StructureOutput {
  result: CaseResult;
  usage: Usage;
}

/** The two calls. Splitting them is the design: the second receives only the map, never the
 *  case file, so it cannot introduce a fact the map does not carry. */
export interface Analyser {
  readonly kind: string;
  mapCase(caseText: string): Promise<MapOutput>;
  structure(map: string): Promise<StructureOutput>;
}

/** The fidelity auditor: the second gate, and the judge of the fidelity harness. */
export interface Auditor {
  readonly kind: string;
  audit(sourceText: string, summary: string): Promise<{ verdict: AuditVerdict; usage: Usage }>;
}

/** The judge of the parity harness: generated against human-approved, for the same case. */
export interface ParityJudge {
  readonly kind: string;
  compare(
    reference: string,
    generated: string,
  ): Promise<{ verdict: ParityVerdict; usage: Usage }>;
}
