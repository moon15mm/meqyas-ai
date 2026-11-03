/** Convert Arabic-Indic / Eastern Arabic-Indic digits and separators to ASCII so numbers parse reliably. */
export function toLatinDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) out += String(code - 0x0660);
    else if (code >= 0x06f0 && code <= 0x06f9) out += String(code - 0x06f0);
    else if (code === 0x066b)
      out += "."; // Arabic decimal separator
    else if (code === 0x066c)
      continue; // Arabic thousands separator
    else out += ch;
  }
  return out;
}

/** Parse a user-typed number in either digit system; returns null when empty or invalid. */
export function parseLocaleNumber(input: string): number | null {
  const raw = toLatinDigits(input).replace(/\s+/g, "").replace(",", ".");
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
