/** The join key, and the proof that the fixtures are invented.
 *
 * The check-digit test is not decoration. A repository that publishes court-case fixtures
 * has to be able to show they are fictional, and "trust me" is not a demonstration. Every
 * number in this repository is dated 2099 and fails its own checksum, so it cannot be a
 * case that exists. */
import { describe, expect, it } from "vitest";

import {
  allCaseNumbers,
  caseDigits,
  expectedCheckDigits,
  extractCaseNumber,
  fromCustomId,
  hasValidCheckDigits,
  isFictional,
  toCustomId,
} from "../src/domain/case-number.ts";
import { FIXTURE_CASE_NUMBERS } from "./helpers/fixture-cases.ts";

describe("finding a case number in messy text", () => {
  it("reads one out of a file name", () => {
    expect(extractCaseNumber("1000001-11.2099.8.26.0100 - sentenca.pdf")).toBe(
      "1000001-11.2099.8.26.0100",
    );
  });

  it("reads one out of a folder path", () => {
    expect(extractCaseNumber("sources/1000002-22.2099.8.26.0100/SENTENCA (2).pdf")).toBe(
      "1000002-22.2099.8.26.0100",
    );
  });

  it("returns null rather than guessing", () => {
    expect(extractCaseNumber("acordao final.pdf")).toBeNull();
    expect(extractCaseNumber("")).toBeNull();
  });

  it("ignores a number that is merely number-shaped", () => {
    expect(extractCaseNumber("1000001-1.2099.8.26.0100")).toBeNull();
    expect(extractCaseNumber("1000001-11.2099.8.26.010")).toBeNull();
  });

  it("lists every distinct number in a document, in order, without repeats", () => {
    const text =
      "Autos 1000001-11.2099.8.26.0100 apensados aos autos 1000006-66.2099.8.26.0100, " +
      "cf. 1000001-11.2099.8.26.0100.";
    expect(allCaseNumbers(text)).toEqual([
      "1000001-11.2099.8.26.0100",
      "1000006-66.2099.8.26.0100",
    ]);
  });

  it("strips to twenty digits for punctuation-blind matching", () => {
    expect(caseDigits("1000001-11.2099.8.26.0100")).toBe("10000011120998260100");
    expect(caseDigits("1000001-11.2099.8.26.0100")).toHaveLength(20);
  });
});

describe("the Batch API custom id", () => {
  it("contains only characters the API accepts", () => {
    const id = toCustomId("1000001-11.2099.8.26.0100");
    expect(id).toBe("1000001_11_2099_8_26_0100");
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("round-trips through the known key set", () => {
    const known = FIXTURE_CASE_NUMBERS;
    for (const caseNumber of known) {
      expect(fromCustomId(toCustomId(caseNumber), known)).toBe(caseNumber);
    }
  });

  it("returns null for an id no known case produces", () => {
    expect(fromCustomId("9999999_99_2099_8_26_0100", FIXTURE_CASE_NUMBERS)).toBeNull();
  });
});

describe("check digits", () => {
  it("computes the digits the rest of the number implies", () => {
    // Changing only the check digits makes the same body valid.
    const expected = expectedCheckDigits("1000001-11.2099.8.26.0100");
    expect(expected).toBe("91");
    expect(hasValidCheckDigits(`1000001-${expected}.2099.8.26.0100`)).toBe(true);
  });

  it("returns null for anything that is not a full case number", () => {
    expect(expectedCheckDigits("not a case number")).toBeNull();
    expect(hasValidCheckDigits("not a case number")).toBe(false);
  });

  it("proves every fixture case number is impossible", () => {
    for (const caseNumber of FIXTURE_CASE_NUMBERS) {
      expect(hasValidCheckDigits(caseNumber), caseNumber).toBe(false);
      expect(isFictional(caseNumber), caseNumber).toBe(true);
    }
  });

  it("does not call a valid number fictional just because it is dated 2099", () => {
    const valid = `1000001-${expectedCheckDigits("1000001-00.2099.8.26.0100")}.2099.8.26.0100`;
    expect(isFictional(valid)).toBe(false);
  });

  it("does not call a broken number fictional if it is dated in a real year", () => {
    expect(isFictional("1000001-11.2021.8.26.0100")).toBe(false);
  });
});
