/** Money.
 *
 * Two of these tests exist because the code they cover was written wrong the first time, in
 * the project this one is rebuilt from: the batch discount was applied at one call site so
 * every other caller over-reported by a factor of two, and an unknown model id silently fell
 * back to a default model's prices. Both are the kind of defect nobody notices, because a
 * wrong number looks exactly like a right one. */
import { describe, expect, it } from "vitest";

import {
  BATCH_DISCOUNT,
  emptyUsage,
  formatUSD,
  formatUsage,
  fromUsage,
  priceOf,
  pricedModels,
  sumUsage,
  unpricedWarning,
} from "../src/model/cost.ts";

const RAW = {
  input_tokens: 1_000_000,
  output_tokens: 100_000,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

describe("pricing one call", () => {
  it("prices input and output from the table", () => {
    // claude-opus-5: $5 in, $25 out per MTok -> 5 + 2.5
    const usage = fromUsage(RAW, "claude-opus-5");
    expect(usage.costUSD).toBeCloseTo(7.5, 6);
    expect(usage.pricedWith).toBe("claude-opus-5");
  });

  it("halves the bill for a batch-billed request", () => {
    const sync = fromUsage(RAW, "claude-opus-5");
    const batch = fromUsage(RAW, "claude-opus-5", BATCH_DISCOUNT);
    expect(batch.costUSD).toBeCloseTo(sync.costUSD! / 2, 6);
  });

  it("applies the standard cache multipliers when the model does not override them", () => {
    const usage = fromUsage(
      { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 },
      "claude-opus-5",
    );
    // 1.25x input for a write, 0.10x input for a read: 6.25 + 0.5
    expect(usage.costUSD).toBeCloseTo(6.75, 6);
  });

  it("uses the model's own cache read price where it has one", () => {
    const usage = fromUsage(
      { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 },
      "claude-opus-5-5",
    );
    expect(usage.costUSD).toBeCloseTo(0.2, 6);
  });

  it("treats missing cache fields as zero, not as undefined", () => {
    const usage = fromUsage({ input_tokens: 10, output_tokens: 10 }, "claude-opus-5");
    expect(usage.cacheWriteTokens).toBe(0);
    expect(usage.cacheReadTokens).toBe(0);
    expect(usage.costUSD).not.toBeNull();
  });
});

describe("a model with no price", () => {
  it("reports the cost as unknown rather than guessing", () => {
    const usage = fromUsage(RAW, "some-model-that-does-not-exist");
    expect(usage.costUSD).toBeNull();
    expect(usage.pricedWith).toBeNull();
    // The tokens are still counted: only the money is unknown.
    expect(usage.inputTokens).toBe(1_000_000);
  });

  it("says so in words", () => {
    expect(formatUSD(null)).toBe("unpriced");
    expect(unpricedWarning("some-model-that-does-not-exist")).toContain("no entry");
    expect(unpricedWarning("claude-opus-5")).toBeNull();
  });

  it("names every model it can price, so the warning is actionable", () => {
    const warning = unpricedWarning("nope")!;
    for (const model of pricedModels()) expect(warning).toContain(model);
  });

  it("has a price for the default model", () => {
    expect(priceOf("claude-opus-5")).not.toBeNull();
  });

  it("carries every entry's source, because a price with no provenance is a guess", () => {
    for (const model of pricedModels()) {
      expect(priceOf(model)!.source.length, model).toBeGreaterThan(20);
    }
  });
});

describe("totalling a run", () => {
  it("adds tokens and money", () => {
    const total = sumUsage(fromUsage(RAW, "claude-opus-5"), fromUsage(RAW, "claude-opus-5"));
    expect(total.inputTokens).toBe(2_000_000);
    expect(total.costUSD).toBeCloseTo(15, 6);
  });

  it("makes the whole total unpriced when any part is", () => {
    // A total that silently omits one call reads as a complete figure. It must not.
    const total = sumUsage(fromUsage(RAW, "claude-opus-5"), fromUsage(RAW, "unknown-model"));
    expect(total.costUSD).toBeNull();
    expect(total.inputTokens).toBe(2_000_000);
  });

  it("sums nothing to zero", () => {
    expect(sumUsage().costUSD).toBe(0);
    expect(emptyUsage().costUSD).toBe(0);
  });
});

describe("how a cost is printed", () => {
  it("shows the cache hit only when there was one", () => {
    expect(formatUsage(fromUsage(RAW, "claude-opus-5"))).not.toContain("cache hit");
    expect(
      formatUsage(
        fromUsage({ input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 900 }, "claude-opus-5"),
      ),
    ).toContain("cache hit 900");
  });

  it("prints an unpriced usage without pretending it is free", () => {
    expect(formatUsage(fromUsage(RAW, "unknown"))).toContain("unpriced");
    expect(formatUsage(fromUsage(RAW, "unknown"))).not.toContain("0.0000");
  });
});
