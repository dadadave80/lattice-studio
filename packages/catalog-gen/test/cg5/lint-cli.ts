#!/usr/bin/env bun
/**
 * Authoring aid: lints `overlay/` against the Lattice checkout and prints every issue, or only an area's.
 *
 *   bun packages/catalog-gen/test/cg5/lint-cli.ts [area…] [--errors]
 */
import { AREAS } from "@lattice-studio/core";
import { loadOverlay } from "../../src/overlay";
import { formatIssue, formatLintSummary, formatParseIssues, lintOverlay } from "../../src/overlay-lint";
import { latticeDir, latticeFacts } from "./facts";

const args = process.argv.slice(2);
const areas = args.filter((a) => (AREAS as readonly string[]).includes(a));
const errorsOnly = args.includes("--errors");

const dir = latticeDir();
if (dir === null) {
  console.error("No Lattice checkout: set LATTICE_DIR or check out the lattice/ submodule.");
  process.exit(2);
}
const overlay = await loadOverlay();
if (!overlay.ok) {
  console.error(formatParseIssues(overlay.error));
  process.exit(1);
}
const facts = await latticeFacts(dir);
if (!facts.built) console.log("lattice/out is missing, so init params aren't checked: FOUNDRY_PROFILE=ci forge build --root lattice");
const result = lintOverlay(overlay.value, facts);
const pick = (i: { area?: string }) => areas.length === 0 || (i.area !== undefined && areas.includes(i.area));
for (const e of result.errors.filter(pick)) console.log(formatIssue(e));
if (!errorsOnly) for (const w of result.warnings.filter(pick)) console.log(formatIssue(w));
console.log(formatLintSummary({ errors: [], warnings: result.warnings }).replace(/^Overlay lint: 0 errors/, `Overlay lint: ${result.errors.length} errors`));
process.exit(result.errors.some(pick) ? 1 : 0);
