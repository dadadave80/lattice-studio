#!/usr/bin/env bun
// `bun scripts/ci/network-boundary-scan.ts` (§19 audit #2, spec L97 "only the lazily loaded chain module talks
// to the network"): fails on `fetch`, `new WebSocket`, or a viem client/transport anywhere in `apps/studio/src`
// outside `chain/` and the same-origin catalog callers §19 row 2 names. Prints file:line per finding and exits 1
// on any.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { findNetworkCalls, isAllowedNetworkFile, parseSource } from "./network-boundary-scan-logic.ts";

const root = join(import.meta.dir, "..", "..");
const srcDir = join(root, "apps", "studio", "src");
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

function main(): void {
  let findings = 0;
  let filesScanned = 0;
  for (const file of findSourceFiles(srcDir)) {
    const relPath = relative(srcDir, file);
    if (isAllowedNetworkFile(relPath)) continue;
    filesScanned++;
    const text = readFileSync(file, "utf8");
    for (const finding of findNetworkCalls(parseSource(file, text))) {
      console.log(
        `${relative(root, file)}:${finding.line}: "${finding.match}" reaches the network outside chain/ and §19's allowed callers.`,
      );
      findings++;
    }
  }
  if (findings > 0) {
    console.error(`network-boundary-scan · fail, ${findings} finding${findings === 1 ? "" : "s"} across ${filesScanned} files scanned.`);
    process.exit(1);
  }
  console.log(`network-boundary-scan · pass, ${filesScanned} files scanned, no findings.`);
}

main();
