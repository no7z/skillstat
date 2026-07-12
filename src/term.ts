const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

function wrap(code: string, s: string): string {
  return useColor ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export const c = {
  bold: (s: string) => wrap("1", s),
  dim: (s: string) => wrap("2", s),
  red: (s: string) => wrap("31", s),
  green: (s: string) => wrap("32", s),
  yellow: (s: string) => wrap("33", s),
  cyan: (s: string) => wrap("36", s),
  gray: (s: string) => wrap("90", s),
};

/** Visible width, ignoring ANSI escapes. */
function visLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export function pad(s: string, width: number, align: "left" | "right" = "left"): string {
  const len = visLen(s);
  if (len >= width) return s;
  const fill = " ".repeat(width - len);
  return align === "right" ? fill + s : s + fill;
}

export interface Col {
  header: string;
  align?: "left" | "right";
}

export function table(cols: Col[], rows: string[][]): string {
  const widths = cols.map((col, i) =>
    Math.max(visLen(col.header), ...rows.map((r) => visLen(r[i] ?? ""))),
  );
  const line = (cells: string[]) =>
    cells.map((cell, i) => pad(cell ?? "", widths[i], cols[i].align)).join("  ");
  const out: string[] = [];
  out.push(c.bold(line(cols.map((col) => col.header))));
  for (const r of rows) out.push(line(r));
  return out.join("\n");
}

export function relTime(days: number | null): string {
  if (days === null) return c.red("never");
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}
