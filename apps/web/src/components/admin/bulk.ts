/** Rows pasted from Excel / Google Sheets (tab-separated) or a CSV file: one person per line.
 * The e-mail is found wherever it is; the first other cell is the name, the next one the
 * workspace (optional). A header line (no e-mail in it) is skipped. */

export interface PersonRow {
  name: string;
  email: string;
  organization_name: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function splitLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  // CSV: commas (or Arabic commas / semicolons) outside double quotes.
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (ch === "," || ch === "،" || ch === ";")) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

export function parsePeople(text: string): { rows: PersonRow[]; skipped: number } {
  const rows: PersonRow[] = [];
  let skipped = 0;
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  lines.forEach((line, index) => {
    const cells = splitLine(line).filter((c) => c !== "");
    const emailAt = cells.findIndex((c) => EMAIL.test(c));
    if (emailAt < 0) {
      if (index > 0) skipped += 1; // the first line without an e-mail is a header
      return;
    }
    const others = cells.filter((_, i) => i !== emailAt);
    rows.push({
      email: cells[emailAt]!.toLowerCase(),
      name: others[0] ?? "",
      organization_name: others[1] ?? "",
    });
  });
  return { rows, skipped };
}

/** CSV for the administrator (Excel opens UTF-8 with the BOM): who got what, and their links. */
export function resultsCsv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const escape = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    // A cell starting with = + - @ would run as a formula in Excel (CSV injection).
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "\uFEFF" + [header, ...rows].map((r) => r.map(escape).join(",")).join("\n") + "\n";
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
