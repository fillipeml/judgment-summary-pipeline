/** Surviving a network that is not anybody's fault.
 *
 * The sleep is injected in every test, so the suite exercises the real backoff arithmetic
 * without waiting for it. */
import { describe, expect, it, vi } from "vitest";

import { chunk, mapLimit, withRetry } from "../src/batch/retry.ts";

const noSleep = async (): Promise<void> => {};

describe("retrying", () => {
  it("returns the first success without sleeping", async () => {
    const sleep = vi.fn(noSleep);
    const result = await withRetry("t", async () => "ok", { attempts: 5, maxMs: 1000, sleep });
    expect(result).toBe("ok");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries until it succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      "t",
      async () => {
        if (++calls < 3) throw new Error("502 Bad Gateway");
        return calls;
      },
      { attempts: 5, maxMs: 60_000, sleep: noSleep },
    );
    expect(result).toBe(3);
    expect(calls).toBe(3);
  });

  it("backs off linearly and stops at the cap", async () => {
    const waits: number[] = [];
    await expect(
      withRetry("t", async () => Promise.reject(new Error("boom")), {
        attempts: 6,
        maxMs: 40_000,
        sleep: async (ms) => {
          waits.push(ms);
        },
      }),
    ).rejects.toThrow();
    // 15s, 30s, then capped at 40s. Linear, not exponential: this waits out a few minutes of
    // instability rather than giving up or sleeping for an hour.
    expect(waits).toEqual([15_000, 30_000, 40_000, 40_000, 40_000]);
  });

  it("sleeps one fewer time than it attempts", async () => {
    const sleep = vi.fn(noSleep);
    await expect(
      withRetry("t", async () => Promise.reject(new Error("boom")), {
        attempts: 3,
        maxMs: 1000,
        sleep,
      }),
    ).rejects.toThrow();
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("names the operation and the last error when it gives up", async () => {
    await expect(
      withRetry("map-submit", async () => Promise.reject(new Error("gateway timeout")), {
        attempts: 2,
        maxMs: 1,
        sleep: noSleep,
      }),
    ).rejects.toThrow(/map-submit failed after 2 attempts: gateway timeout/);
  });

  it("reports each failed attempt to the caller", async () => {
    const seen: number[] = [];
    await expect(
      withRetry("t", async () => Promise.reject(new Error("x")), {
        attempts: 3,
        maxMs: 1,
        sleep: noSleep,
        onAttempt: (attempt) => seen.push(attempt),
      }),
    ).rejects.toThrow();
    expect(seen).toEqual([1, 2]);
  });
});

describe("the bounded worker pool", () => {
  it("preserves order regardless of completion order", async () => {
    const out = await mapLimit([30, 10, 20], 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms / 10));
      return `${i}:${ms}`;
    });
    expect(out).toEqual(["0:30", "1:10", "2:20"]);
  });

  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 12 }, (_u, i) => i), 3, async (i) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return i;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles an empty list", async () => {
    expect(await mapLimit([], 4, async (x) => x)).toEqual([]);
  });
});

describe("chunking a submission", () => {
  it("splits at the size the gateway accepts", () => {
    const items = Array.from({ length: 250 }, (_u, i) => i);
    const parts = chunk(items, 100);
    expect(parts.map((p) => p.length)).toEqual([100, 100, 50]);
    expect(parts.flat()).toEqual(items);
  });

  it("returns one chunk when everything fits", () => {
    expect(chunk([1, 2, 3], 100)).toEqual([[1, 2, 3]]);
  });

  it("returns nothing for nothing", () => {
    expect(chunk([], 100)).toEqual([]);
  });
});
