/**
 * No raw colors in the primitives (contracts §5.4): every color in `src/ui/**` is a `var(--lx-*)` token.
 * The only exceptions are `transparent`, `currentColor`, `inherit` and, inside `@media (forced-colors:
 * active)`, the CSS system colors that mode requires (spec L785). Custom properties defined here may only
 * point at `--lx-*` tokens. Scripts may not carry color literals, color-bearing JSX attributes or style
 * assignments that set a color.
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

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const FUNCTION = /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/;
const NAMED_COLOR = new RegExp(`(?<![\\w-])(?:${NAMED.join("|")})(?![\\w-])`);
const RAW = [HEX, FUNCTION, NAMED_COLOR];
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

/** Problems in one style sheet. */
export function cssProblems(css: string): string[] {
  const problems: string[] = [];
  for (const { text, forced } of declarations(css)) {
    const colon = text.indexOf(":");
    if (colon < 0 || text.startsWith("composes")) continue;
    const property = text.slice(0, colon).trim();
    const value = text.slice(colon + 1);
    if (property.startsWith("--")) {
      // A local custom property is only an alias for a token.
      if (!/^\s*var\(--lx-[\w-]+\)\s*$/.test(value)) problems.push(`${text} (custom properties alias --lx-* tokens only)`);
      continue;
    }
    if (RAW.some((re) => re.test(value))) problems.push(text);
    else if (!forced && SYSTEM_COLOR.test(value)) problems.push(`${text} (system colors belong in forced-colors)`);
  }
  return problems;
}

/** A hex color in a string, not an id selector such as `#lx-hatch` or `#add-facet`. */
const SCRIPT_HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\w-])/;
const COLOR_ATTRIBUTE = /\b(?:fill|stroke|color|stopColor|stop-color|floodColor|lightingColor|background|bgcolor)=["{]\s*["'`]?([^"'`}]*)/g;
const COLOR_STYLE_KEY = /\b(?:color|background|backgroundColor|backgroundImage|borderColor|border|outline|outlineColor|fill|stroke|boxShadow|textShadow)\s*:/;
const STYLE_ASSIGNMENT = /\.style\.(?:color|background\w*|border\w*|outline\w*|fill|stroke|boxShadow|textShadow)\s*=|\.style\.setProperty\(\s*["'](?!--lx-)[^"']*(?:color|background|border|fill|stroke)/;

/** Problems in one script: color literals, color attributes that aren't url(#…)/currentColor/tokens, colored styles. */
export function scriptProblems(source: string): string[] {
  const problems: string[] = [];
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const line of code.split("\n")) {
    const strings = line.match(/(["'`])(?:\\.|(?!\1).)*\1/g) ?? [];
    for (const s of strings) {
      if (SCRIPT_HEX.test(s) || FUNCTION.test(s)) problems.push(`color literal ${s}`);
    }
    for (const match of line.matchAll(COLOR_ATTRIBUTE)) {
      const value = (match[1] ?? "").trim();
      if (value && !/^(?:url\(#|currentColor|none|transparent|var\(--lx-|inherit|HATCH_FILL)/.test(value)) {
        problems.push(`attribute ${match[0]}`);
      }
    }
    const inline = line.match(/style=\{\{[^}]*\}\}/g) ?? [];
    for (const style of inline) if (COLOR_STYLE_KEY.test(style)) problems.push(`inline style ${style}`);
    if (STYLE_ASSIGNMENT.test(line)) problems.push(`style assignment ${line.trim()}`);
  }
  return problems;
}

describe("the scanners catch what they should", () => {
  test("css", () => {
    expect(cssProblems(".a { color: #fff; }")).toHaveLength(1);
    expect(cssProblems(".a { --x: red; }")).toHaveLength(1);
    expect(cssProblems(".a { --x: var(--lx-accent); color: var(--x); }")).toEqual([]);
    expect(cssProblems(".a { color: CanvasText; }")).toHaveLength(1);
    expect(cssProblems("@media (forced-colors: active) { .a { color: CanvasText; } }")).toEqual([]);
  });

  test("scripts", () => {
    expect(scriptProblems(`const c = "#ff5a1f";`)).toHaveLength(1);
    expect(scriptProblems(`<rect fill="red" />`)).toHaveLength(1);
    expect(scriptProblems(`<rect fill={HATCH_FILL} stroke="currentColor" />`)).toEqual([]);
    expect(scriptProblems(`<div style={{ color: "x" }} />`)).toHaveLength(1);
    expect(scriptProblems(`el.style.background = x;`)).toHaveLength(1);
    expect(scriptProblems(`el.style.top = "8px";`)).toEqual([]);
    expect(scriptProblems(`document.querySelector("#lx-hatch")`)).toEqual([]);
    expect(scriptProblems(`document.querySelector("#add-facet")`)).toEqual([]);
  });
});

describe("primitives use tokens only", () => {
  const cssFiles = files("**/*.css");

  test("there are style sheets to check", () => {
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  for (const file of cssFiles) {
    test(`${relative(root, file)} has no raw colors`, () => {
      expect(cssProblems(readFileSync(file, "utf8"))).toEqual([]);
    });
  }

  test("scripts set no colors of their own", () => {
    const problems: string[] = [];
    for (const file of files("**/*.{ts,tsx}")) {
      if (file.includes(".test.") || file.endsWith("raw-colors.test.ts")) continue;
      for (const p of scriptProblems(readFileSync(file, "utf8"))) problems.push(`${relative(root, file)}: ${p}`);
    }
    expect(problems).toEqual([]);
  });
});
