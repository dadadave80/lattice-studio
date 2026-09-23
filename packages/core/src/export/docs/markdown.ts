/** A run of one line: literal newlines collapse to a space, so user text can never split a heading or cell. */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/** A Markdown table cell: `|` and `\` escaped, newlines collapsed (GFM tables can't hold either). */
export function cell(text: string): string {
  return oneLine(text).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

/** A fence at least as long as the longest run of backticks in `text`, and never under three. */
export function fenceFor(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

/** A fenced code block, its fence sized to what `body` contains so `body` can never break out. */
export function codeBlock(body: string, lang = ""): string {
  const fence = fenceFor(body);
  const trimmed = body.endsWith("\n") ? body.slice(0, -1) : body;
  return `${fence}${lang}\n${trimmed}\n${fence}`;
}

/** A GFM table from a header row and body rows, every cell already Markdown-safe. */
export function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const head = `| ${header.join(" | ")} |`;
  const rule = `| ${header.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}
