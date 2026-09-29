/** The two calls against the Claude API, and the two judges.
 *
 * Call 1 streams. A whole docket with a 32k output ceiling can outlast the ten-minute HTTP
 * timeout of a synchronous request, and streaming is the supported shape for that
 * combination. The ceiling is high so that reasoning plus the map fit and the map never
 * comes back empty.
 *
 * Call 2 does not stream, does not think, and is given a schema. It is transcription from a
 * map that already contains the answer.
 *
 * Both put the system prompt in a cached block. Both prompts are long and identical for
 * every case in a run, while the user turn changes every time, so caching turns most of the
 * input cost of a few hundred cases into cache reads. */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import {
  AUDIT_SYSTEM,
  MAPPING_SYSTEM,
  PARITY_SYSTEM,
  auditUserMessage,
  buildStructuringSystem,
  mappingUserMessage,
  parityUserMessage,
  structuringUserMessage,
} from "../prompts.ts";
import { AuditVerdict, CaseResult, ParityVerdict } from "../schema.ts";
import { fromUsage, type Usage, type UsageRaw } from "../cost.ts";
import type { Analyser, Auditor, MapOutput, ParityJudge, StructureOutput } from "./types.ts";

/** Room for reasoning plus the map: too low and large dockets spend the budget thinking and
 *  return nothing. */
const MAP_MAX_TOKENS = 32_000;
const STRUCTURE_MAX_TOKENS = 16_000;
const JUDGE_MAX_TOKENS = 2_000;
/** The source given to a judge is bounded; a whole docket would otherwise dominate the bill. */
export const JUDGE_SOURCE_LIMIT = 200_000;

export class ModelError extends Error {
  readonly stage: string;

  constructor(message: string, stage: string) {
    super(message);
    this.stage = stage;
    this.name = "ModelError";
  }
}

function cachedSystem(text: string) {
  return [{ type: "text" as const, text, cache_control: { type: "ephemeral" as const } }];
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function checkStop(stopReason: string | null, stage: string): void {
  if (stopReason === "max_tokens") {
    throw new ModelError(`the ${stage} was cut short by the output limit`, stage);
  }
  if (stopReason === "refusal") {
    throw new ModelError(`the model declined to produce the ${stage}`, stage);
  }
}

export class ClaudeAnalyser implements Analyser, Auditor, ParityJudge {
  readonly kind = "claude";
  private client: Anthropic | null = null;

  private readonly apiKey: string;
  readonly model: string;

  constructor(apiKey: string, model: string, client?: Anthropic) {
    this.apiKey = apiKey;
    this.model = model;
    this.client = client ?? null;
  }

  private api(): Anthropic {
    if (!this.client) {
      if (!this.apiKey) {
        throw new ModelError("ANTHROPIC_API_KEY is not set (or run with DEMO_MODE=true)", "config");
      }
      this.client = new Anthropic({ apiKey: this.apiKey });
    }
    return this.client;
  }

  async mapCase(caseText: string): Promise<MapOutput> {
    const response = await this.api()
      .messages.stream({
        model: this.model,
        max_tokens: MAP_MAX_TOKENS,
        thinking: { type: "adaptive" },
        system: cachedSystem(MAPPING_SYSTEM),
        messages: [{ role: "user", content: mappingUserMessage(caseText) }],
      })
      .finalMessage();
    checkStop(response.stop_reason, "map");
    const map = textOf(response.content as Anthropic.ContentBlock[]).trim();
    if (!map) throw new ModelError("the first call returned an empty map", "map");
    return { map, usage: this.usage(response.usage) };
  }

  async structure(map: string): Promise<StructureOutput> {
    const response = await this.api().messages.parse({
      model: this.model,
      max_tokens: STRUCTURE_MAX_TOKENS,
      system: cachedSystem(buildStructuringSystem()),
      messages: [{ role: "user", content: structuringUserMessage(map) }],
      output_config: { format: zodOutputFormat(CaseResult) },
    });
    checkStop(response.stop_reason, "structuring");
    if (!response.parsed_output) {
      throw new ModelError("the second call returned no structured result", "structuring");
    }
    return { result: response.parsed_output, usage: this.usage(response.usage) };
  }

  async audit(sourceText: string, summary: string) {
    const response = await this.api().messages.parse({
      model: this.model,
      max_tokens: JUDGE_MAX_TOKENS,
      system: cachedSystem(AUDIT_SYSTEM),
      messages: [
        {
          role: "user",
          content: auditUserMessage(sourceText.slice(0, JUDGE_SOURCE_LIMIT), summary),
        },
      ],
      output_config: { format: zodOutputFormat(AuditVerdict) },
    });
    checkStop(response.stop_reason, "audit");
    if (!response.parsed_output) throw new ModelError("the auditor returned no verdict", "audit");
    return { verdict: response.parsed_output, usage: this.usage(response.usage) };
  }

  async compare(reference: string, generated: string) {
    const response = await this.api().messages.parse({
      model: this.model,
      max_tokens: JUDGE_MAX_TOKENS,
      system: cachedSystem(PARITY_SYSTEM),
      messages: [{ role: "user", content: parityUserMessage(reference, generated) }],
      output_config: { format: zodOutputFormat(ParityVerdict) },
    });
    checkStop(response.stop_reason, "parity");
    if (!response.parsed_output) throw new ModelError("the judge returned no verdict", "parity");
    return { verdict: response.parsed_output, usage: this.usage(response.usage) };
  }

  private usage(raw: unknown): Usage {
    return fromUsage(raw as UsageRaw, this.model);
  }
}
