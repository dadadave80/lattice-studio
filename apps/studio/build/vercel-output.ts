/**
 * Turns a finished `dist/` into Vercel's Build Output (https://vercel.com/docs/build-output-api), with the CSP
 * header computed from the page being deployed. The last step of Vercel's build command:
 *
 *   bun apps/studio/build/vercel-output.ts apps/studio/dist apps/studio/.vercel/output
 *
 * It moves `dist/` rather than copying it: should Vercel ever stop reading the Build Output, the deploy fails on
 * the missing output directory instead of shipping the page without its headers.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildOutputConfig, contentSecurityPolicy, formatJson, inlineHashes } from "./headers.ts";

export function writeBuildOutput(dist: string, output: string): void {
  const hashes = inlineHashes(readFileSync(join(dist, "index.html"), "utf8"));
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  renameSync(dist, join(output, "static"));
  const config = buildOutputConfig(contentSecurityPolicy(hashes, { frameAncestors: true }));
  writeFileSync(join(output, "config.json"), formatJson(config));
}

if (import.meta.main) {
  const [dist, output] = process.argv.slice(2);
  if (!dist || !output) {
    console.error("Usage: bun apps/studio/build/vercel-output.ts <dist> <output>");
    process.exit(1);
  }
  writeBuildOutput(dist, output);
  console.log(`Wrote the Build Output for ${dist} to ${output}.`);
}
