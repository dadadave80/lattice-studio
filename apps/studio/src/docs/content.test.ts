import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { CREATEX_CODEHASH, lintCopy, PROBLEM_CODES, renderProblem, type ProblemParams } from "@lattice-studio/core";
import { PROBLEM_DOC_CONTENT, PROBLEM_DOC_ENTRIES } from "./content/index";
import { latticeRefs, plainText } from "./markdown";
import { latticeUrl, parseLatticeRef } from "./lattice-link";

/** This file's path is `apps/studio/src/docs/content.test.ts`; four levels up is the repo root, whatever the cwd is. */
const REPO_ROOT = join(import.meta.dir, "../../../..");

/**
 * Every `lattice:` ref content uses, flattened once for the two tests below.
 */
function allLatticeRefs(): string[] {
  return PROBLEM_DOC_ENTRIES.flatMap((e) => [...latticeRefs(e.meaning), ...latticeRefs(e.why), ...e.fixes.flatMap(latticeRefs)]);
}

/**
 * `.env.local`'s `LATTICE_DIR` (claim.ts writes it; bun skips `.env.local` under `NODE_ENV=test`, so it's
 * read directly here), then `process.env.LATTICE_DIR` (set outside `bun test`), then `<repo>/lattice`
 * (a WP that owns a checkout). Null when none of them holds a real Lattice checkout.
 */
function resolveLatticeDir(): string | null {
  const fromEnvLocal = (() => {
    try {
      const text = readFileSync(join(REPO_ROOT, ".env.local"), "utf8");
      return text.match(/^LATTICE_DIR=(.*)$/m)?.[1]?.trim();
    } catch {
      return undefined;
    }
  })();
  for (const candidate of [fromEnvLocal, process.env.LATTICE_DIR, join(REPO_ROOT, "lattice")]) {
    if (candidate && existsSync(join(candidate, "src", "Lattice.sol"))) return candidate;
  }
  return null;
}

const LATTICE_DIR = resolveLatticeDir();

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
    const refs = allLatticeRefs();
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
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
  });

  // `LATTICE_DIR` (from `.env.local`, the environment, or `<repo>/lattice`); skips cleanly when none exists,
  // so this only runs where a real Lattice checkout is available to check every path and line range against.
  test.skipIf(!LATTICE_DIR)("every lattice: path and line range exists in the pinned Lattice checkout", () => {
    const dir = LATTICE_DIR;
    if (!dir) return;
    const refs = new Set(allLatticeRefs());
    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) {
      const { path, lines } = parseLatticeRef(ref);
      const filePath = join(dir, path);
      expect(existsSync(filePath), `${ref}: ${filePath} doesn't exist in the checkout`).toBe(true);
      if (!lines) continue;
      const [startStr, endStr] = lines.split("-");
      const start = Number(startStr);
      const end = endStr ? Number(endStr) : start;
      expect(Number.isInteger(start) && start >= 1, `${ref}: "${lines}" isn't a valid line or range`).toBe(true);
      expect(Number.isInteger(end) && end >= start, `${ref}: "${lines}" has an end before its start`).toBe(true);
      const lineCount = readFileSync(filePath, "utf8").split("\n").length;
      expect(end, `${ref}: line ${end} is past ${path}'s ${lineCount} lines`).toBeLessThanOrEqual(lineCount);
    }
  });

  test("NET-01's example codehash is core's own CREATEX_CODEHASH, not a fabricated value", () => {
    const net01 = PROBLEM_DOC_CONTENT["NET-01"].exampleParams as ProblemParams["NET-01"];
    expect(net01.case === "codehash" ? net01.expected : null).toBe(CREATEX_CODEHASH);
  });
});
