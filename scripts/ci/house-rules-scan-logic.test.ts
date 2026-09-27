import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { findHouseRuleViolations, findThrownPromises, parseSource } from "./house-rules-scan-logic.ts";

function ruleMatches(source: string, fileName = "x.tsx"): string[] {
  return findHouseRuleViolations(parseSource(fileName, source)).map((f) => f.rule);
}

describe("findHouseRuleViolations · temporal.getState() (spec L902 house rule 2)", () => {
  test("flags a bare temporal.getState() call anywhere", () => {
    expect(ruleMatches(`function X() { const s = temporal.getState(); return null; }`)).toEqual(["temporal-getstate"]);
  });

  test("flags store.temporal.getState(), even inside an effect: the temporal store has no render-safe read", () => {
    const src = `function X() { useEffect(() => { store.temporal.getState(); }, []); return null; }`;
    expect(ruleMatches(src)).toEqual(["temporal-getstate"]);
  });
});

describe("findHouseRuleViolations · getState() only through selector hooks (spec L902 house rule 1)", () => {
  test("flags a direct getState() call in a component's render body", () => {
    const src = `function Card() { const zoom = store.getState().zoom; return <div>{zoom}</div>; }`;
    expect(ruleMatches(src)).toEqual(["render-getstate"]);
  });

  test("allows getState() inside useEffect", () => {
    const src = `function Card() { useEffect(() => { const zoom = store.getState().zoom; }, []); return null; }`;
    expect(ruleMatches(src)).toEqual([]);
  });

  test("allows getState() inside useCallback and useMemo", () => {
    const src = `
      function Card() {
        const onClick = useCallback(() => { store.getState().zoom; }, []);
        const derived = useMemo(() => store.getState().zoom, []);
        return null;
      }`;
    expect(ruleMatches(src)).toEqual([]);
  });

  test("allows getState() inside a JSX event-handler attribute", () => {
    const src = `function Card() { return <button onClick={() => store.getState().zoom}>Go</button>; }`;
    expect(ruleMatches(src)).toEqual([]);
  });
});

describe("findThrownPromises (spec L902 house rule 3, no throw-a-promise-until-hydrated)", () => {
  function promiseMatches(source: string): string[] {
    return findThrownPromises(parseSource("x.tsx", source)).map((f) => f.rule);
  }

  test("flags throw new Promise(...)", () => {
    expect(promiseMatches(`function X() { throw new Promise((resolve) => resolve(1)); }`)).toEqual(["thrown-promise"]);
  });

  test("flags a thrown identifier named for a promise", () => {
    expect(promiseMatches(`function X() { throw pendingPromise; }`)).toEqual(["thrown-promise"]);
  });

  test("flags a thrown .then()/.catch() chain", () => {
    expect(promiseMatches(`function X() { throw load().then((v) => v); }`)).toEqual(["thrown-promise"]);
  });

  test("doesn't flag a re-thrown caught error", () => {
    expect(promiseMatches(`function X() { try { f(); } catch (error) { throw error; } }`)).toEqual([]);
  });

  test("doesn't flag throw new Error(...)", () => {
    expect(promiseMatches(`function X() { throw new Error("bad"); }`)).toEqual([]);
  });
});

// The real repository must currently pass: the audit found none of the three patterns in apps/studio/src today.
describe("the real app source", () => {
  const srcDir = join(import.meta.dir, "..", "..", "apps", "studio", "src");
  const TEST_FILE_PATTERN = /\.(test|browser\.test)\.tsx$/;

  function tsxFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name === "node_modules") return [];
      const p = join(dir, entry.name);
      if (entry.isDirectory()) return tsxFiles(p);
      return entry.name.endsWith(".tsx") && !TEST_FILE_PATTERN.test(entry.name) ? [p] : [];
    });
  }

  test("no house-rule violation in any .tsx file", () => {
    const findings: string[] = [];
    for (const file of tsxFiles(srcDir)) {
      const sourceFile = parseSource(file, readFileSync(file, "utf8"));
      for (const f of [...findHouseRuleViolations(sourceFile), ...findThrownPromises(sourceFile)]) {
        findings.push(`${file}:${f.line}: ${f.rule}`);
      }
    }
    expect(findings).toEqual([]);
  });

  test("apps/studio/src exists and has .tsx files (a sanity check the scan actually looked at something)", () => {
    expect(existsSync(srcDir)).toBe(true);
    expect(tsxFiles(srcDir).length).toBeGreaterThan(50);
  });
});
