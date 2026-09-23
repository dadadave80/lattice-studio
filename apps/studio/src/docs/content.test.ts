import { describe, expect, test } from "bun:test";
import { lintCopy, PROBLEM_CODES, renderProblem } from "@lattice-studio/core";
import { PROBLEM_DOC_CONTENT, PROBLEM_DOC_ENTRIES } from "./content/index";
import { latticeRefs, plainText } from "./markdown";
import { latticeUrl, parseLatticeRef } from "./lattice-link";

describe("problem doc content", () => {
  test("every ProblemCode has a page, once, in the checks table's order", () => {
    expect(PROBLEM_DOC_ENTRIES.map((e) => e.code)).toEqual(PROBLEM_CODES);
    expect(new Set(PROBLEM_DOC_ENTRIES.map((e) => e.code)).size).toBe(PROBLEM_CODES.length);
    for (const code of PROBLEM_CODES) expect(PROBLEM_DOC_CONTENT[code].code).toBe(code);
  });

  test("every field is non-empty and every fix reads as a sentence", () => {
    for (const entry of PROBLEM_DOC_ENTRIES) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.meaning.length).toBeGreaterThan(0);
      expect(entry.why.length).toBeGreaterThan(0);
      for (const fix of entry.fixes) expect(fix.trim().endsWith(".")).toBe(true);
    }
  });

  test("lintCopy passes on every doc's title, meaning, why, fixes and example note", () => {
    const issues: string[] = [];
    for (const entry of PROBLEM_DOC_ENTRIES) {
      const fields: [string, string][] = [
        ["title", entry.title],
        ["meaning", plainText(entry.meaning)],
        ["why", plainText(entry.why)],
        ...entry.fixes.map((f, i): [string, string] => [`fixes[${i}]`, plainText(f)]),
        ...(entry.exampleNote ? ([["exampleNote", plainText(entry.exampleNote)]] as [string, string][]) : []),
      ];
      for (const [field, text] of fields) {
        for (const issue of lintCopy(text)) issues.push(`${entry.code} ${field}: ${issue.message} ("${issue.match}")`);
      }
    }
    expect(issues).toEqual([]);
  });

  test("every example renders through renderProblem (never a copy of the message text) and passes lintCopy", () => {
    for (const entry of PROBLEM_DOC_ENTRIES) {
      const text = renderProblem(entry.code, entry.exampleParams as never);
      expect(text.length).toBeGreaterThan(0);
      expect(lintCopy(text)).toEqual([]);
    }
  });

  test("lattice: refs round-trip through parseLatticeRef and build a URL under the given commit, never a fixed one", () => {
    const commitA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const commitB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    let sawAny = false;
    for (const entry of PROBLEM_DOC_ENTRIES) {
      for (const ref of [...latticeRefs(entry.meaning), ...latticeRefs(entry.why), ...entry.fixes.flatMap(latticeRefs)]) {
        sawAny = true;
        const { path, lines } = parseLatticeRef(ref);
        expect(path.length).toBeGreaterThan(0);
        expect(path.startsWith("src/") || path.startsWith("lib/")).toBe(true);
        const urlA = latticeUrl(commitA, path, lines);
        const urlB = latticeUrl(commitB, path, lines);
        expect(urlA).toContain(commitA);
        expect(urlB).toContain(commitB);
        expect(urlA).not.toContain(commitB);
        expect(urlA.startsWith(`https://github.com/dadadave80/lattice/blob/${commitA}/${path}`)).toBe(true);
      }
    }
    expect(sawAny).toBe(true);
  });
});
