/** Measuring what a run actually cost, from the usage the API reports rather than from an
 *  estimate. With a few hundred cases and a heavily cached system prompt, an estimate is
 *  meaningless: the cache-read share dominates.
 *
 *  Two deliberate differences from the original this is rebuilt from. The original fell back
 *  to a default model's prices when it met an unknown model id, which silently produced a
 *  wrong number; here an unpriced model yields `costUSD: null` and the reports say so. And
 *  the original applied the Batch API's 50% discount at one call site, so every other caller
 *  over-reported batch cost by a factor of two; here the discount is part of the type. */
import pricing from "./pricing.json" with { type: "json" };

export const STANDARD_CACHE_WRITE_MULTIPLIER = 1.25;
export const STANDARD_CACHE_READ_MULTIPLIER = 0.1;

/** The Message Batches API bills at half the synchronous price. */
export const BATCH_DISCOUNT = 0.5;

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok?: number;
  cacheReadPerMTok?: number;
  source: string;
}

export interface UsageRaw {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  /** null when the model has no entry in pricing.json: unknown, not free. */
  costUSD: number | null;
  /** The model id the cost was priced with, or null when unpriced. */
  pricedWith: string | null;
}

const PRICES = pricing.models as Record<string, ModelPrice>;

export const DEFAULT_MODEL: string = pricing.default;

export function priceOf(model: string): ModelPrice | null {
  return PRICES[model] ?? null;
}

export function pricedModels(): string[] {
  return Object.keys(PRICES).sort();
}

export function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    costUSD: 0,
    pricedWith: null,
  };
}

/** Turns one API usage object into tokens plus money. `discount` is BATCH_DISCOUNT for a
 *  request that went through the Message Batches API. */
export function fromUsage(raw: UsageRaw, model: string, discount = 1): Usage {
  const cacheWriteTokens = raw.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = raw.cache_read_input_tokens ?? 0;
  const price = priceOf(model);
  const tokens = {
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    cacheWriteTokens,
    cacheReadTokens,
  };
  if (!price) return { ...tokens, costUSD: null, pricedWith: null };

  const cacheWritePerMTok =
    price.cacheWritePerMTok ?? price.inputPerMTok * STANDARD_CACHE_WRITE_MULTIPLIER;
  const cacheReadPerMTok =
    price.cacheReadPerMTok ?? price.inputPerMTok * STANDARD_CACHE_READ_MULTIPLIER;
  const costUSD =
    ((raw.input_tokens / 1_000_000) * price.inputPerMTok +
      (raw.output_tokens / 1_000_000) * price.outputPerMTok +
      (cacheWriteTokens / 1_000_000) * cacheWritePerMTok +
      (cacheReadTokens / 1_000_000) * cacheReadPerMTok) *
    discount;
  return { ...tokens, costUSD, pricedWith: model };
}

/** Sums usages. An unpriced part makes the total unpriced: a partial total would read as a
 *  complete one. */
export function sumUsage(...parts: Usage[]): Usage {
  const total = emptyUsage();
  let unpriced = false;
  for (const p of parts) {
    total.inputTokens += p.inputTokens;
    total.outputTokens += p.outputTokens;
    total.cacheWriteTokens += p.cacheWriteTokens;
    total.cacheReadTokens += p.cacheReadTokens;
    if (p.costUSD === null) unpriced = true;
    else if (total.costUSD !== null) total.costUSD += p.costUSD;
    if (p.pricedWith) total.pricedWith = p.pricedWith;
  }
  if (unpriced) total.costUSD = null;
  return total;
}

export function formatUSD(costUSD: number | null): string {
  return costUSD === null ? "unpriced" : `US$ ${costUSD.toFixed(4)}`;
}

export function formatUsage(u: Usage): string {
  const cached = u.cacheReadTokens > 0 ? ` (cache hit ${u.cacheReadTokens})` : "";
  return `${formatUSD(u.costUSD)} · in ${u.inputTokens} / out ${u.outputTokens}${cached}`;
}

/** The one-line warning the CLI prints when the configured model has no price. */
export function unpricedWarning(model: string): string | null {
  return priceOf(model)
    ? null
    : `cost reporting is off: ${model} has no entry in src/model/pricing.json (priced models: ${pricedModels().join(", ")})`;
}
