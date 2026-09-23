import { describe, expect, test } from "bun:test";
import { lintCopy } from "@lattice-studio/core";
import { extractAppCopy, parseSource } from "./copy-lint-scan.ts";

/** A fixture the way copy-lint.ts's own scan would see it: extract, then run C10's lintCopy over every span. */
function findings(source: string, fileName = "fixture.tsx"): string[] {
  const spans = extractAppCopy(parseSource(fileName, source));
  return spans.flatMap((span) => lintCopy(span.text).map((issue) => issue.message));
}

describe("copy-lint end to end (fixtures, as the CLI would scan them)", () => {
  test("flags a planted 'Please click OK!' in JSX text", () => {
    const source = `const X = () => <button>Please click OK!</button>;`;
    const messages = findings(source);
    expect(messages.some((m) => m.includes('"please"'))).toBe(true);
    expect(messages.some((m) => m.includes("exclamation"))).toBe(true);
  });

  test("flags the same planted copy in an aria-label", () => {
    const source = `const X = () => <button aria-label="Please click OK!" />;`;
    expect(findings(source).length).toBeGreaterThan(0);
  });

  test("passes on ordinary sentence-case UI copy", () => {
    const source = `const X = () => <button aria-label="Deploy to a testnet">Deploy now</button>;`;
    expect(findings(source)).toEqual([]);
  });
});
