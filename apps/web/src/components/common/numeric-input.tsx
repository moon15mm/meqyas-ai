"use client";

import { parseLocaleNumber } from "@meqyas/shared";
import { Input } from "@meqyas/ui";
import * as React from "react";

type Props = Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: number | null | undefined;
  /** Receives the parsed number, null when empty, or the raw text when it is not a number yet. */
  onValueChange: (value: number | null, raw: string) => void;
};

/**
 * Text-based numeric input: keeps what the user typed ("1.", "٣٫٥") while
 * reporting a parsed number, and accepts Arabic-Indic digits.
 */
export function NumericInput({ value, onValueChange, ...props }: Props) {
  const [text, setText] = React.useState(value === null || value === undefined ? "" : String(value));
  React.useEffect(() => {
    // Sync external changes without clobbering an in-progress edit of the same number.
    setText((current) =>
      parseLocaleNumber(current) === (value ?? null)
        ? current
        : value === null || value === undefined
          ? ""
          : String(value),
    );
  }, [value]);
  return (
    <Input
      {...props}
      inputMode={props.inputMode ?? "decimal"}
      dir="ltr"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onValueChange(parseLocaleNumber(e.target.value), e.target.value);
      }}
    />
  );
}
