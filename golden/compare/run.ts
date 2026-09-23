#!/usr/bin/env bun
// `bun run golden` runs this after the routing check: Studio's plan for each v1 recipe against
// golden/expected/<Recipe>.routing.json. The same comparison runs under `bun test` (golden/compare.test.ts).
// `--update` changes nothing here: the expected files record Lattice's side, and Studio's side is never recorded.
// Exit codes: 0 all match or nothing to compare (no catalog/manifest.json or no expected files: skipped, with the
// reason), 1 drift or a catalog that's there but doesn't load, 2 bad arguments.

import { diffStudio, studioSide } from "./compare.ts";
import { loadGolden, readCatalog } from "./load.ts";

const unknown = process.argv.slice(2).filter((a) => a !== "--update");
if (unknown.length > 0) {
  console.error(`Unknown argument ${unknown.join(" ")}. Usage: bun run golden [--update]`);
  process.exit(2);
}

// STUDIO_GOLDEN_CATALOG points at another catalog folder (the tests use a broken copy); the default is catalog/.
const catalogDir = process.env["STUDIO_GOLDEN_CATALOG"];
const setup = loadGolden(catalogDir === undefined || catalogDir === "" ? readCatalog() : readCatalog(catalogDir));
if (!setup.ready) {
  if ("error" in setup) {
    console.error(`golden: Studio's plan couldn't be compared: ${setup.error}`);
    process.exit(1);
  }
  console.log(`golden: Studio's plan wasn't compared: ${setup.skip}`);
  process.exit(0);
}

console.log(`golden: comparing Studio's plan with the expected files (catalog ${setup.catalog.lattice.tag})…`);
let failed = setup.problems.length;
for (const problem of setup.problems) console.error(`  ${problem}`);
for (const c of setup.cases) {
  const lines = diffStudio(c.expected, studioSide(c.template, c.recipe, setup.catalog));
  if (lines.length === 0) {
    console.log(`  ${c.name}: Studio's plan matches ${c.path}`);
    continue;
  }
  failed++;
  console.error(`  ${c.name}: ${lines.length} ${lines.length === 1 ? "difference" : "differences"} from ${c.path} (expected, Studio)`);
  for (const line of lines) console.error(`    ${line}`);
}
if (failed > 0) {
  console.error(`golden: Studio's plan differs from Lattice's scripts in ${failed} ${failed === 1 ? "place" : "places"}. Fix Studio's catalog or core, not the expected files.`);
  process.exit(1);
}
process.exit(0);
