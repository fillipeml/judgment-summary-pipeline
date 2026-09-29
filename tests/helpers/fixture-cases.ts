/** The case numbers the fixtures use, in one place.
 *
 * Kept as a literal list rather than read back from the fixture files, so the check-digit
 * test still means something if the fixtures are ever regenerated wrongly. */
export const FIXTURE_CASE_NUMBERS = [
  "1000001-11.2099.8.26.0100",
  "1000002-22.2099.8.26.0100",
  "1000003-33.2099.8.26.0100",
  "1000004-44.2099.8.26.0100",
  "1000005-55.2099.8.26.0100",
  "1000006-66.2099.8.26.0100",
  "1000007-77.2099.8.26.0100",
  "1000008-88.2099.8.26.0100",
  "2000001-11.2099.8.26.0200",
  "2000002-22.2099.8.26.0200",
  "2000003-33.2099.8.26.0200",
  "2000004-44.2099.8.26.0200",
] as const satisfies readonly string[];

/** The cases the pipeline is allowed to write. */
export const TARGET_CASE_NUMBERS = FIXTURE_CASE_NUMBERS.filter((c) => c.startsWith("1"));

/** The cases a reviewer already approved: the parity harness's ground truth. */
export const GOLD_CASE_NUMBERS = FIXTURE_CASE_NUMBERS.filter((c) => c.startsWith("2"));
