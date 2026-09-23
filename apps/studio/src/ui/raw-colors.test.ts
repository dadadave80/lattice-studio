/**
 * No raw colors in the primitives (contracts §5.4): every color in `src/ui/**` CSS is a `var(--lx-*)` token.
 * The only exceptions are `transparent`, `currentColor`, `inherit` and, inside `@media (forced-colors:
 * active)`, the CSS system colors that mode requires (spec L785). TSX files must not set colors inline.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = import.meta.dir;

function files(pattern: string): string[] {
  return [...new Bun.Glob(pattern).scanSync({ cwd: root })].map((f) => join(root, f));
}

const NAMED = [
  "white", "black", "red", "green", "blue", "yellow", "orange", "purple", "gray", "grey", "silver", "navy",
  "teal", "maroon", "olive", "lime", "aqua", "fuchsia", "pink", "brown", "gold", "cyan", "magenta",
];
const SYSTEM = [
  "Canvas", "CanvasText", "LinkText", "VisitedText", "ActiveText", "ButtonFace", "ButtonText", "ButtonBorder",
  "Field", "FieldText", "Highlight", "HighlightText", "SelectedItem", "SelectedItemText", "Mark", "MarkText",
  "GrayText", "AccentColor", "AccentColorText",
];

const RAW = [
  /#[0-9a-fA-F]{3,8}\b/,
  /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/,
  new RegExp(`(?<![\\w-])(?:${NAMED.join("|")})(?![\\w-])`),
];
const SYSTEM_COLOR = new RegExp(`(?<![\\w-])(?:${SYSTEM.join("|")})(?![\\w-])`);

/** Strips comments and returns each declaration with whether it sits inside a forced-colors block. */
function declarations(css: string): { text: string; forced: boolean }[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { text: string; forced: boolean }[] = [];
  const stack: boolean[] = [];
  let buffer = "";
  for (const ch of clean) {
    if (ch === "{") {
      stack.push(/@media[^{]*forced-colors/.test(buffer) || (stack.at(-1) ?? false));
      buffer = "";
    } else if (ch === "}") {
      if (buffer.trim()) out.push({ text: buffer.trim(), forced: stack.at(-1) ?? false });
      stack.pop();
      buffer = "";
    } else if (ch === ";") {
      out.push({ text: buffer.trim(), forced: stack.at(-1) ?? false });
      buffer = "";
    } else {
      buffer += ch;
    }
  }
  return out;
}

describe("primitives use tokens only", () => {
  const cssFiles = files("**/*.css");

  test("there are style sheets to check", () => {
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  for (const file of cssFiles) {
    test(`${relative(root, file)} has no raw colors`, () => {
      const problems: string[] = [];
      for (const { text, forced } of declarations(readFileSync(file, "utf8"))) {
        const colon = text.indexOf(":");
        if (colon < 0 || text.startsWith("composes")) continue;
        const property = text.slice(0, colon).trim();
        if (property.startsWith("--")) continue;
        const value = text.slice(colon + 1);
        if (RAW.some((re) => re.test(value))) problems.push(text);
        else if (!forced && SYSTEM_COLOR.test(value)) problems.push(`${text} (system colors belong in forced-colors)`);
      }
      expect(problems).toEqual([]);
    });
  }

  test("components set no inline colors", () => {
    const problems: string[] = [];
    for (const file of files("**/*.tsx")) {
      if (file.includes(".test.")) continue;
      const source = readFileSync(file, "utf8");
      const inline = source.match(/style=\{\{[^}]*\}\}/g) ?? [];
      for (const style of inline) if (/color|background|fill|stroke|border/i.test(style)) problems.push(`${relative(root, file)}: ${style}`);
    }
    expect(problems).toEqual([]);
  });
});
