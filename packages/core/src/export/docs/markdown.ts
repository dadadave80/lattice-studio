/** A run of one line: literal newlines collapse to a space, so user text can never split a heading or cell. */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/**
 * Escapes the three characters a Markdown renderer reads as HTML (spec L21, L857: every generated string is
 * escaped, so a name like `<img onerror>` can't render as a tag). `&` first, so the entities this introduces
 * are never themselves re-escaped.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The ASCII punctuation that opens an inline Markdown construct (FX8, spec L857: names are rendered as text):
 * `\` escapes, `` ` `` code spans, `*` `_` emphasis, `~` GFM strikethrough, `[` `]` `(` `)` `!` links and
 * images, `|` GFM table cells. `<` and `>` (autolinks, raw HTML) and `&` (entities) are `escapeHtml`'s.
 */
const MARKDOWN_PUNCTUATION = /[\\`*_~[\]()!|]/g;

/**
 * Backslash-escapes `MARKDOWN_PUNCTUATION`, and a `#` that starts the text (an ATX heading, were it to start
 * a line). CommonMark renders a backslash-escaped ASCII punctuation character as the character itself, so
 * ordinary names read the same while `[x](javascript:alert(1))`, `![i](x)` and `*b*` stay literal text.
 * Run it after `escapeHtml`: escaping `<` first would turn `\<` into `\&lt;`, which renders as "&lt;".
 */
export function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_PUNCTUATION, "\\$&").replace(/^#/, "\\#");
}

/**
 * One line of prose, safe outside a code fence or inline code: newlines collapsed, HTML-escaped, then every
 * character that could open a link, image, emphasis, code span or table cell backslash-escaped.
 */
export function escapedLine(text: string): string {
  return escapeMarkdown(escapeHtml(oneLine(text)));
}

/** A Markdown table cell: `escapedLine`, which already escapes `|` and `\` (GFM tables can't hold either raw). */
export function cell(text: string): string {
  return escapedLine(text);
}

/** A piece of text: a code span (backticks included) or the text between spans. */
type Piece = { code: boolean; text: string };

/**
 * `text` split into code spans and the text between, as CommonMark §6.1 finds them: a backtick run opens a
 * span only when a later run of exactly the same length closes it; a run with no closer is literal text, and
 * the search goes on from the next run.
 */
export function codeSpans(text: string): Piece[] {
  const runs = Array.from(text.matchAll(/`+/g), (match) => ({ at: match.index, length: match[0].length }));
  const pieces: Piece[] = [];
  let from = 0;
  for (let i = 0; i < runs.length; i++) {
    const open = runs[i];
    if (open === undefined) break;
    const closeAt = runs.findIndex((run, j) => j > i && run.length === open.length);
    const close = runs[closeAt];
    if (close === undefined) continue;
    if (open.at > from) pieces.push({ code: false, text: text.slice(from, open.at) });
    from = close.at + close.length;
    pieces.push({ code: true, text: text.slice(open.at, from) });
    i = closeAt;
  }
  if (from < text.length) pieces.push({ code: false, text: text.slice(from) });
  return pieces;
}

/**
 * Copy that means some of its backticks, one line: another WP's rendered text (a problem message, a formatted
 * selector) that marks code with spans and may quote user text. Its code spans are kept, since nothing inside
 * one renders as a link, emphasis or HTML; everything between them is escaped as `escapedLine` escapes user
 * text. `table` also escapes `|` inside spans, because GFM splits a row on every unescaped pipe first.
 */
export function formattedLine(text: string, table = false): string {
  const pieces = codeSpans(escapeHtml(oneLine(text)));
  const out = pieces.map((piece) => {
    if (!piece.code) return piece.text.replace(MARKDOWN_PUNCTUATION, "\\$&");
    return table ? piece.text.replace(/\|/g, "\\|") : piece.text;
  });
  return out.join("").replace(/^#/, "\\#");
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
