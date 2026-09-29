/** The Brazilian national case number (CNJ), the key everything in this pipeline joins on.
 *
 * Format NNNNNNN-DD.YYYY.J.TR.OOOO: a seven-digit sequential number, two check digits, the
 * year, one digit for the branch of justice, two for the court, four for the originating
 * unit. The check digits are computed over the rest, which is what lets this repository
 * prove its fixtures are fictional rather than merely assert it. */

export const CASE_NUMBER_RE = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;
const STRICT_RE = /^(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})$/;

/** The first case number in a string (a file name, a path, a spreadsheet cell), or null. */
export function extractCaseNumber(text: string): string | null {
  return text.match(CASE_NUMBER_RE)?.[0] ?? null;
}

/** Every distinct case number in a string, in order of appearance. */
export function allCaseNumbers(text: string): string[] {
  return [...new Set(text.match(new RegExp(CASE_NUMBER_RE, "g")) ?? [])];
}

/** The twenty bare digits, for punctuation-blind matching against messy file names. */
export function caseDigits(caseNumber: string): string {
  return caseNumber.replace(/\D/g, "");
}

/** The Batch API accepts only [a-zA-Z0-9_-] in a custom_id; a case number has dots and a dash. */
export function toCustomId(caseNumber: string): string {
  return caseNumber.replace(/[^a-zA-Z0-9]/g, "_");
}

/** The reverse of toCustomId is lossy, so it is resolved against the known key set. */
export function fromCustomId(customId: string, known: Iterable<string>): string | null {
  for (const caseNumber of known) if (toCustomId(caseNumber) === customId) return caseNumber;
  return null;
}

/** The two check digits the rest of the number implies (CNJ Resolution 65/2008: modulo 97
 *  base 10, ISO 7064). */
export function expectedCheckDigits(caseNumber: string): string | null {
  const m = caseNumber.match(STRICT_RE);
  if (!m) return null;
  const [, sequential, , year, branch, court, unit] = m;
  const body = `${sequential}${year}${branch}${court}${unit}00`;
  const remainder = Number(BigInt(body) % 97n);
  return String(98 - remainder).padStart(2, "0");
}

/** True when the number's check digits match the rest of it: a real case number does, and
 *  every fixture in this repository deliberately does not. */
export function hasValidCheckDigits(caseNumber: string): boolean {
  const m = caseNumber.match(STRICT_RE);
  if (!m) return false;
  return expectedCheckDigits(caseNumber) === m[2];
}

/** A case number that is well-formed but cannot exist: dated 2099 with broken check digits. */
export function isFictional(caseNumber: string): boolean {
  const m = caseNumber.match(STRICT_RE);
  if (!m) return false;
  return m[3] === "2099" && !hasValidCheckDigits(caseNumber);
}
