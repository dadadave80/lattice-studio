// Pure logic behind `bun scripts/ci/raw-color-scan.ts` (brief Q6 "a raw-color scan of *.module.css"): every color
// in component CSS must come from a token (`var(--lx-*)`), never a literal hex, rgb()/hsl() function or named
// color (contracts §6 "UI styling uses token variables only").

export type ColorFinding = { readonly line: number; readonly column: number; readonly match: string };

/** Chromatic CSS keyword colors worth flagging; excludes values that are legitimately literal (spec allows). */
const NAMED_COLORS = [
  "black", "white", "red", "green", "blue", "yellow", "orange", "purple", "pink", "brown", "gray", "grey",
  "cyan", "magenta", "lime", "navy", "teal", "maroon", "olive", "silver", "gold", "indigo", "violet", "crimson",
  "coral", "salmon", "khaki", "lavender", "turquoise", "beige", "tan", "azure", "chocolate", "orchid",
];
const NAMED_COLOR_PATTERN = new RegExp(`\\b(${NAMED_COLORS.join("|")})\\b`, "gi");
const HEX_PATTERN = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;
const FUNC_PATTERN = /\b(?:rgb|rgba|hsl|hsla)\s*\(/gi;

/** Strips /* ... *\/ comments, replacing non-newline characters with spaces so offsets stay stable for line/column math. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => [...m].map((c) => (c === "\n" ? "\n" : " ")).join(""));
}

/** Declaration values only: the text between `:` and the next `;` or `}`, so selectors like `.a::before` and
 * `url(...)` paths outside a color function never trip the scan, and custom-property definitions (`--x: #fff`
 * inside `:root`) are still caught — component CSS modules never define tokens, only consume them. */
function declarationValues(css: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let i = 0;
  while (i < css.length) {
    const colon = css.indexOf(":", i);
    if (colon === -1) break;
    // Skip pseudo-selectors (`::before`, `:hover`) by requiring the colon to be followed eventually by `;`/`}` before the next `{`.
    const brace = css.indexOf("{", colon);
    let end = css.indexOf(";", colon);
    const closeBrace = css.indexOf("}", colon);
    if (end === -1 || (closeBrace !== -1 && closeBrace < end)) end = closeBrace;
    if (end === -1) end = css.length;
    if (brace !== -1 && brace < end) {
      // The colon started a selector or at-rule, not a declaration; move past it without capturing.
      i = colon + 1;
      continue;
    }
    out.push({ text: css.slice(colon + 1, end), start: colon + 1 });
    i = end + 1;
  }
  return out;
}

function lineColumn(css: string, index: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < index; i++) {
    if (css[i] === "\n") {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: index - lastNewline };
}

/** Finds every raw color literal in a `.module.css` file's declaration values. */
export function scanRawColors(css: string): ColorFinding[] {
  const stripped = stripComments(css);
  const findings: ColorFinding[] = [];
  for (const { text, start } of declarationValues(stripped)) {
    for (const pattern of [HEX_PATTERN, FUNC_PATTERN, NAMED_COLOR_PATTERN]) {
      for (const m of text.matchAll(pattern)) {
        const index = start + (m.index ?? 0);
        const { line, column } = lineColumn(stripped, index);
        findings.push({ line, column, match: m[0] });
      }
    }
  }
  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  return findings;
}
