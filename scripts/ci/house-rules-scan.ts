#!/usr/bin/env bun
// `bun scripts/ci/house-rules-scan.ts` (spec L902): the three house rules over `apps/studio/src/**/*.tsx` — read
// Zustand state only through selector hooks, never `temporal.getState()` in render, no "throw a promise until
// hydrated". Prints file:line per finding and exits 1 on any.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { findHouseRuleViolations, findThrownPromises, parseSource } from "./house-rules-scan-logic.ts";

const root = join(import.meta.dir, "..", "..");
const srcDir = join(root, "apps", "studio", "src");
const TEST_FILE_PATTERN = /\.(test|browser\.test)\.tsx$/;

const MESSAGES: Record<string, string> = {
  "temporal-getstate": "never reads temporal.getState() (spec L902)",
  "render-getstate": "reads getState() outside an effect, callback or handler; use a selector hook (spec L902)",
  "thrown-promise": "throws what looks like a promise; no \"throw a promise until hydrated\" (spec L902)",
};

function findTsxFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTsxFiles(p));
    else if (entry.name.endsWith(".tsx") && !TEST_FILE_PATTERN.test(entry.name)) out.push(p);
  }
  return out;
}

function main(): void {
  let findings = 0;
  const files = findTsxFiles(srcDir);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const sourceFile = parseSource(file, text);
    for (const f of [...findHouseRuleViolations(sourceFile), ...findThrownPromises(sourceFile)]) {
      console.log(`${relative(root, file)}:${f.line}: ${MESSAGES[f.rule]}: ${f.match}`);
      findings++;
    }
  }
  if (findings > 0) {
    console.error(`house-rules-scan · fail, ${findings} finding${findings === 1 ? "" : "s"} across ${files.length} files scanned.`);
    process.exit(1);
  }
  console.log(`house-rules-scan · pass, ${files.length} files scanned, no findings.`);
}

main();
