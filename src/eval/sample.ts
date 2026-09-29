/** Choosing which rows to measure.
 *
 * A sample drawn at random is not reproducible, and a sample taken from the top measures
 * whatever the workbook happens to be sorted by. A uniform stride over the sorted list is
 * both: reproducible without a seed, and spread across the whole population. */

/** Takes `size` items spread evenly across `items`, in order, without repeats. */
export function uniformStride<T>(items: T[], size: number): T[] {
  if (size >= items.length) return [...items];
  if (size <= 0) return [];
  const stride = items.length / size;
  const picked: T[] = [];
  for (let i = 0; i < size; i++) {
    const index = Math.min(items.length - 1, Math.floor(i * stride));
    const item = items[index];
    if (item !== undefined) picked.push(item);
  }
  return picked;
}

/** A percentage rounded to one decimal, or null when the denominator is zero.
 *
 *  Returning null rather than 0 matters: "0% of 0 rows failed" reads like a pass. */
export function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10;
}

export function formatRate(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(1)}%`;
}
