import { describe, expect, test } from "bun:test";
import { scanRawColors } from "./raw-color-scan-logic.ts";

describe("scanRawColors", () => {
  test("token-only CSS has no findings", () => {
    const css = `.app { background: var(--lx-ground); color: var(--lx-text); border: var(--lx-stroke-hair) solid var(--lx-border-subtle); }`;
    expect(scanRawColors(css)).toEqual([]);
  });

  test("flags a hex color", () => {
    const css = `.card { color: #FF5A1F; }`;
    const findings = scanRawColors(css);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.match).toBe("#FF5A1F");
  });

  test("flags a short and an alpha hex color", () => {
    const css = `.a { color: #fff; } .b { color: #1f4fe0cc; }`;
    const matches = scanRawColors(css).map((f) => f.match);
    expect(matches).toEqual(["#fff", "#1f4fe0cc"]);
  });

  test("flags rgb() and hsl() functions", () => {
    const css = `.a { color: rgb(255, 0, 0); } .b { background: hsla(10, 50%, 50%, 0.5); }`;
    const matches = scanRawColors(css).map((f) => f.match.toLowerCase());
    expect(matches).toEqual(["rgb(", "hsla("]);
  });

  test("flags a chromatic named color but not transparent, inherit or currentColor", () => {
    const css = `.a { color: red; background: transparent; border-color: currentColor; outline: inherit; }`;
    const matches = scanRawColors(css).map((f) => f.match);
    expect(matches).toEqual(["red"]);
  });

  test("ignores colors written inside a comment", () => {
    const css = `.a { /* color: #fff; was here */ color: var(--lx-text); }`;
    expect(scanRawColors(css)).toEqual([]);
  });

  test("ignores a pseudo-selector colon and scans the declaration after it", () => {
    const css = `.tab:hover { color: #123456; }`;
    const findings = scanRawColors(css);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.match).toBe("#123456");
  });

  test("ignores a double-colon pseudo-element", () => {
    const css = `.tab::before { content: ""; color: var(--lx-text); }`;
    expect(scanRawColors(css)).toEqual([]);
  });

  test("scans inside a media query", () => {
    const css = `@media (min-width: 600px) { .a { color: #ABCDEF; } }`;
    const findings = scanRawColors(css);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.match).toBe("#ABCDEF");
  });

  test("reports 1-based line and column", () => {
    const css = `.a {\n  color: #ffffff;\n}`;
    const findings = scanRawColors(css);
    expect(findings).toEqual([{ line: 2, column: 10, match: "#ffffff" }]);
  });
});
