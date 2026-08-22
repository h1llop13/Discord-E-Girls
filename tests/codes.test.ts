import { describe, expect, it } from "vitest";
import { codesToCsv } from "../src/codes/csv.js";
import { CODE_PATTERN, generateCode, generateUniqueCodes, normalizeCode } from "../src/codes/generator.js";

describe("purchase codes", () => {
  it("uses the XXXX-XXXX format", () => {
    expect(generateCode(() => 0)).toBe("2222-2222");
    expect(generateCode()).toMatch(CODE_PATTERN);
  });

  it("generates the requested number of unique values", () => {
    const codes = generateUniqueCodes(100);
    expect(codes).toHaveLength(100);
    expect(new Set(codes).size).toBe(100);
    expect(codes.every((code) => CODE_PATTERN.test(code))).toBe(true);
  });

  it("normalizes user input", () => {
    expect(normalizeCode("  abcd-2345 ")).toBe("ABCD-2345");
  });

  it("exports only a header and the supplied codes", () => {
    expect(codesToCsv(["AAAA-BBBB", "CCCC-DDDD"])).toBe("code\nAAAA-BBBB\nCCCC-DDDD\n");
  });

  it("rejects unsafe batch sizes", () => {
    expect(() => generateUniqueCodes(0)).toThrow(RangeError);
    expect(() => generateUniqueCodes(10_001)).toThrow(RangeError);
  });
});
