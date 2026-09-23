#!/usr/bin/env bun
// `bun scripts/ci/raw-color-scan.ts`: every color in `*.module.css` must come from a token (contracts §6 "UI
// styling uses token variables only"). Flags literal hex colors, rgb()/rgba()/hsl()/hsla() and chromatic named
// colors in declaration values. Prints file:line:column per finding and exits 1 on any.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { scanRawColors } from "./raw-color-scan-logic.ts";

const root = join(import.meta.dir, "..", "..");
const srcDir = join(root, "apps", "studio", "src");

function findModuleCssFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...findModuleCssFiles(p));
    else if (entry.endsWith(".module.css")) out.push(p);
  }
  return out;
}

function main(): void {
  const files = findModuleCssFiles(srcDir);
  let total = 0;
  for (const file of files) {
    const findings = scanRawColors(readFileSync(file, "utf8"));
    for (const finding of findings) {
      console.log(`${relative(root, file)}:${finding.line}:${finding.column}: raw color "${finding.match}"; use a var(--lx-*) token instead.`);
      total++;
    }
  }
  if (total > 0) {
    console.error(`raw-color-scan · fail, ${total} raw color${total === 1 ? "" : "s"} in ${files.length} file${files.length === 1 ? "" : "s"} scanned.`);
    process.exit(1);
  }
  console.log(`raw-color-scan · pass, ${files.length} file${files.length === 1 ? "" : "s"} scanned, no raw colors.`);
}

main();
