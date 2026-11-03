import { describe, expect, it } from "vitest";

import { parseLocaleNumber, toLatinDigits } from "../src/text";

describe("toLatinDigits", () => {
  it("converts Arabic-Indic and Eastern Arabic-Indic digits", () => {
    expect(toLatinDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(toLatinDigits("۱۲۳")).toBe("123");
  });

  it("maps the Arabic decimal separator and drops thousands separators", () => {
    expect(toLatinDigits("٣٫٥")).toBe("3.5");
    expect(toLatinDigits("١٬٢٠٠")).toBe("1200");
  });

  it("leaves other text untouched", () => {
    expect(toLatinDigits("الصف 10")).toBe("الصف 10");
  });
});

describe("parseLocaleNumber", () => {
  it.each([
    ["12", 12],
    ["١٢", 12],
    [" 3,5 ", 3.5],
    ["٣٫٥", 3.5],
    ["-4", -4],
  ])("parses %s", (input, expected) => {
    expect(parseLocaleNumber(input)).toBe(expected);
  });

  it.each(["", "  ", "abc", "1.2.3"])("returns null for %j", (input) => {
    expect(parseLocaleNumber(input)).toBeNull();
  });
});
