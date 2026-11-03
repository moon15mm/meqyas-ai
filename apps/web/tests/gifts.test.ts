import { describe, expect, it } from "vitest";

import { whatsappNumber } from "@/components/gifts/gift-dialogs";

describe("whatsappNumber", () => {
  it("turns the ways people type a mobile number into wa.me digits", () => {
    expect(whatsappNumber("0551234567")).toBe("966551234567"); // Saudi local format
    expect(whatsappNumber("+966 55 123 4567")).toBe("966551234567");
    expect(whatsappNumber("٠٥٥١٢٣٤٥٦٧")).toBe("966551234567"); // Arabic-Indic digits
    expect(whatsappNumber("00971501234567")).toBe("971501234567");
  });

  it("gives up on anything too short to be a number", () => {
    expect(whatsappNumber("")).toBeNull();
    expect(whatsappNumber("123")).toBeNull();
  });
});
