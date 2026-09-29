/** Retrying a network call that can fail for reasons that are nobody's fault.
 *
 * Submitting a batch of several hundred requests is a large POST, and a large POST meets
 * gateway 502s. The attempt count is high and the backoff is linear-to-a-cap rather than
 * exponential because the goal is to sit through a few minutes of instability without
 * giving up on a job that has already cost an hour of extraction. */

export interface RetryOptions {
  attempts: number;
  maxMs: number;
  onAttempt?: (attempt: number, attempts: number, error: string, waitMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  let last: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (attempt === options.attempts) break;
      const message = err instanceof Error ? err.message : String(err);
      const waitMs = Math.min(options.maxMs, attempt * 15_000);
      options.onAttempt?.(attempt, options.attempts, message, waitMs);
      await sleep(waitMs);
    }
  }
  throw new Error(
    `${label} failed after ${options.attempts} attempts: ${last instanceof Error ? last.message : String(last)}`,
  );
}

/** A bounded worker pool. Order is preserved; one failure does not stop the others. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Splits a list into chunks: a submission larger than the gateway accepts is rejected
 *  whole, so the run is chunked before anything is sent. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
