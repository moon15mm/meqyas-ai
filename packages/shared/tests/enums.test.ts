import { describe, expect, it } from "vitest";

import fixture from "../../../tests/fixtures/enums.json";
import * as enums from "../src/enums";

describe("enum parity with the Python source of truth", () => {
  for (const [name, values] of Object.entries(fixture)) {
    it(`${name} matches`, () => {
      expect([...(enums as unknown as Record<string, readonly string[]>)[name]!]).toEqual(values);
    });
  }

  it("every measurement type has Arabic and English labels", () => {
    for (const t of enums.MEASUREMENT_TYPES) {
      expect(enums.MEASUREMENT_TYPE_LABELS[t].ar).toBeTruthy();
      expect(enums.MEASUREMENT_TYPE_LABELS[t].en).toBeTruthy();
    }
  });
});
