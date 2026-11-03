import type { IndicatorType } from "@meqyas/shared";

import type { StatFormat } from "@/components/analytics/format";

/** An indicator value in its own unit: % for percentages, a sign for changes, d for effect sizes. */
export function indicatorText(
  kind: IndicatorType,
  unit: string,
  value: number | null,
  fmt: StatFormat,
): string {
  if (value === null || value === undefined) return "—";
  const withUnit = (v: string) => (unit && unit !== "%" ? `${v} ${unit}` : v);
  switch (kind) {
    case "PERCENTAGE":
      return fmt.pct(value, 1);
    case "CHANGE":
    case "DIFFERENCE":
      return withUnit(fmt.signed(value));
    case "EFFECT_SIZE":
      return `d = ${fmt.num(value)}`;
    case "COUNT":
      return fmt.int(value);
    default:
      return withUnit(fmt.num(value));
  }
}
