/** Recorded readings: what the demo runs on.
 *
 * Every response is keyed by the case number, so the whole pipeline — both calls, the
 * auditor, both judges, the cost accounting — runs offline with no API key and produces the
 * same reports every time. A case with no recording is refused rather than invented, which
 * is the same rule the pipeline itself follows. */
import { readFileSync } from "node:fs";

import { extractCaseNumber } from "../../domain/case-number.ts";
import { AuditVerdict, CaseResult, ParityVerdict } from "../schema.ts";
import { fromUsage, type Usage, type UsageRaw } from "../cost.ts";
import { ModelError } from "./claude.ts";
import type { Analyser, Auditor, MapOutput, ParityJudge, StructureOutput } from "./types.ts";

export interface Recording {
  caseNumber: string;
  /** The free-form map, ending in the FINAL SUMMARY TABLE the structuring call is anchored to. */
  map: string;
  /** The structured result exactly as the second call returned it, before any repair. */
  result: unknown;
  audit?: unknown;
  parity?: unknown;
  usage: {
    map: UsageRaw;
    structure: UsageRaw;
    audit?: UsageRaw;
    parity?: UsageRaw;
  };
}

export interface RecordingFile {
  model: string;
  recordings: Recording[];
}

export class FixtureAnalyser implements Analyser, Auditor, ParityJudge {
  readonly kind = "fixture";
  readonly model: string;
  private readonly byCase = new Map<string, Recording>();
  private readonly byMap = new Map<string, Recording>();

  constructor(source: RecordingFile | string) {
    const file: RecordingFile =
      typeof source === "string" ? JSON.parse(readFileSync(source, "utf8")) : source;
    this.model = file.model;
    for (const r of file.recordings) {
      this.byCase.set(r.caseNumber, r);
      this.byMap.set(r.map.trim(), r);
    }
  }

  private find(text: string): Recording {
    const caseNumber = extractCaseNumber(text);
    const recording = caseNumber ? this.byCase.get(caseNumber) : undefined;
    if (recording) return recording;
    throw new ModelError(
      "no recorded reading for this document: the demo answers only for the sample cases, " +
        "and never invents one. Set ANTHROPIC_API_KEY and DEMO_MODE=false to read real files.",
      "fixture",
    );
  }

  async mapCase(caseText: string): Promise<MapOutput> {
    const r = this.find(caseText);
    return { map: r.map, usage: this.usage(r.usage.map) };
  }

  async structure(map: string): Promise<StructureOutput> {
    const r = this.byMap.get(map.trim()) ?? this.find(map);
    return { result: CaseResult.parse(r.result), usage: this.usage(r.usage.structure) };
  }

  async audit(sourceText: string, _summary: string) {
    const r = this.find(sourceText);
    if (!r.audit) throw new ModelError("no recorded audit for this case", "fixture");
    return {
      verdict: AuditVerdict.parse(r.audit),
      usage: this.usage(r.usage.audit ?? { input_tokens: 0, output_tokens: 0 }),
    };
  }

  async compare(reference: string, generated: string) {
    const r = this.byMap.get(generated.trim()) ?? this.findBySummary(generated) ?? this.find(reference);
    if (!r.parity) throw new ModelError("no recorded parity verdict for this case", "fixture");
    return {
      verdict: ParityVerdict.parse(r.parity),
      usage: this.usage(r.usage.parity ?? { input_tokens: 0, output_tokens: 0 }),
    };
  }

  private findBySummary(summary: string): Recording | undefined {
    for (const r of this.byCase.values()) {
      const result = r.result as { summary?: string };
      if (result?.summary && result.summary.trim() === summary.trim()) return r;
    }
    return undefined;
  }

  private usage(raw: UsageRaw): Usage {
    return fromUsage(raw, this.model);
  }
}
