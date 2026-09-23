#!/usr/bin/env bun
// `bun scripts/ci/copy-lint.ts`: C10's `lintCopy` (spec L667-L676) over every UI string — JSX text and the
// string props people read in apps/studio/src/** (including S12's problem pages), C10's own message and line
// templates, and toast/banner call text. Prints file:line per finding and exits 1 on any.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { lintCopy } from "@lattice-studio/core";
import { extractAppCopy, extractTemplateCopy, parseSource } from "./copy-lint-scan.ts";

const root = join(import.meta.dir, "..", "..");

const TEST_FILE_PATTERN = /\.(test|browser\.test)\.tsx?$/;

function findSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findSourceFiles(p));
    else if (/\.tsx?$/.test(entry.name) && !TEST_FILE_PATTERN.test(entry.name)) out.push(p);
  }
  return out;
}

/** files (relative to the repo root) → the extractor to run on them. */
function targets(): { file: string; extract: (sf: ReturnType<typeof parseSource>) => { line: number; text: string }[] }[] {
  const appFiles = findSourceFiles(join(root, "apps", "studio", "src"));
  const templateFiles = ["lines.ts", "narrate.ts", "problem.ts"].map((f) => join(root, "packages", "core", "src", "narrate", f));
  return [
    ...appFiles.map((file) => ({ file, extract: extractAppCopy })),
    ...templateFiles.filter(existsSync).map((file) => ({ file, extract: extractTemplateCopy })),
  ];
}

function main(): void {
  let findings = 0;
  let filesScanned = 0;
  for (const { file, extract } of targets()) {
    filesScanned++;
    const text = readFileSync(file, "utf8");
    const spans = extract(parseSource(file, text));
    for (const span of spans) {
      for (const issue of lintCopy(span.text)) {
        console.log(`${relative(root, file)}:${span.line}: ${issue.message}`);
        findings++;
      }
    }
  }
  if (findings > 0) {
    console.error(`copy-lint · fail, ${findings} finding${findings === 1 ? "" : "s"} across ${filesScanned} files scanned.`);
    process.exit(1);
  }
  console.log(`copy-lint · pass, ${filesScanned} files scanned, no findings.`);
}

main();
