#!/usr/bin/env bun
// `bun run golden`: asks Lattice's own deploy scripts what each v1 recipe cuts and compares the routing with
// golden/expected/<Recipe>.routing.json. `bun run golden --update` rewrites those files instead; nothing else
// writes them. Then runs every other golden suite (golden/<suite>/run.ts) with the same arguments.
// Exit codes: 0 all match, 1 drift or a failed harness, 2 bad arguments or a missing tool or checkout.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { diffRouting, parseRoutingFile } from "./lib/diff.ts";
import { REPO_ROOT, SetupError, artifactSignatures, latticeDir, runForgeHarness } from "./lib/forge.ts";
import { HarnessError, type RoutingFile, buildRoutingFile, parseReports, serialize } from "./lib/report.ts";

const GOLDEN = import.meta.dir;
const HARNESS = join(GOLDEN, "harness", "StudioGoldenRouting.t.sol");
const EXPECTED = join(GOLDEN, "expected");
/** The v1 recipes. The harness must report each of these, and nothing else. */
const RECIPES = ["ERC20", "GovernedVault", "SafeDiamondCut"] as const;

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== "--update");
if (unknown.length > 0) {
  console.error(`Unknown argument ${unknown.join(" ")}. Usage: bun run golden [--update]`);
  process.exit(2);
}
const update = args.includes("--update");

const started = performance.now();
let code = 0;
try {
  code = await routing();
} catch (e) {
  if (e instanceof SetupError) {
    console.error(`golden: ${e.message}`);
    process.exit(2);
  }
  if (e instanceof HarnessError) {
    console.error(`golden: the harness failed: ${e.message}`);
    code = 1;
  } else throw e;
}
console.log(`golden: recipe routing took ${seconds(started)}.`);

for (const suite of new Bun.Glob("*/run.ts").scanSync({ cwd: GOLDEN })) {
  console.log(`golden: running ${relative(REPO_ROOT, join(GOLDEN, suite))}`);
  const p = Bun.spawnSync(["bun", join(GOLDEN, suite), ...args], { stdout: "inherit", stderr: "inherit", env: process.env });
  if (p.exitCode !== 0) code = Math.max(code, p.exitCode ?? 1);
}
process.exit(code);

async function routing(): Promise<number> {
  const lattice = latticeDir();
  console.log(`golden: asking Lattice's deploy scripts at ${lattice} (FOUNDRY_PROFILE=ci)…`);
  const before = gitStatus(lattice);
  const run = await runForgeHarness({ lattice, files: [HARNESS] });
  const after = gitStatus(lattice);
  if (before === null || after === null) {
    console.log("golden: git couldn't read the Lattice checkout's status, so the clean-checkout check was skipped.");
  } else if (before !== after) {
    throw new HarnessError(`the run left changes in the Lattice checkout:\n${after}`);
  }

  const failed = run.tests.filter((t) => !t.ok);
  if (run.tests.length === 0 || failed.length > 0 || run.exitCode !== 0) {
    for (const t of failed) console.error(`  ${t.test} failed: ${t.reason ?? "no reason given"}`);
    console.error(run.output.split("\n").slice(-40).join("\n"));
    throw new HarnessError(
      run.tests.length === 0 ? `forge test ran no tests (exit ${run.exitCode}).` : `forge test exited ${run.exitCode}.`,
    );
  }

  const reports = parseReports(run.tests.flatMap((t) => t.logs));
  const names = reports.map((r) => r.recipe).sort();
  if (names.join(",") !== [...RECIPES].sort().join(",")) {
    throw new HarnessError(`expected reports for ${RECIPES.join(", ")}; got ${names.join(", ") || "none"}.`);
  }
  const signatures = artifactSignatures(lattice);
  const files = reports.map((r) => buildRoutingFile(r, signatures)).sort((a, b) => a.recipe.localeCompare(b.recipe));
  return update ? write(files) : compare(files);
}

function write(files: RoutingFile[]): number {
  mkdirSync(EXPECTED, { recursive: true });
  for (const file of files) {
    const path = expectedPath(file.recipe);
    const text = serialize(file);
    const old = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (old === text) {
      console.log(`  ${file.recipe}: unchanged (${summary(file)})`);
      continue;
    }
    writeFileSync(path, text);
    console.log(`  ${file.recipe}: ${old === null ? "wrote" : "updated"} ${relative(REPO_ROOT, path)} (${summary(file)})`);
  }
  return 0;
}

function compare(files: RoutingFile[]): number {
  let drift = 0;
  for (const actual of files) {
    const path = expectedPath(actual.recipe);
    const rel = relative(REPO_ROOT, path);
    if (!existsSync(path)) {
      console.error(`  ${actual.recipe}: no ${rel}. Run bun run golden --update to record it.`);
      drift++;
      continue;
    }
    const parsed = parseRoutingFile(readFileSync(path, "utf8"));
    if (!parsed.ok) {
      console.error(`  ${actual.recipe}: ${rel} ${parsed.error}.`);
      drift++;
      continue;
    }
    const lines = diffRouting(parsed.value, actual);
    if (lines.length === 0) {
      console.log(`  ${actual.recipe}: matches (${summary(actual)})`);
      continue;
    }
    drift++;
    console.error(`  ${actual.recipe}: ${lines.length} ${lines.length === 1 ? "difference" : "differences"} from ${rel} (expected → Lattice now)`);
    for (const line of lines) console.error(`    ${line}`);
  }
  if (drift > 0) {
    console.error(
      `golden: ${drift} of ${files.length} recipes don't match their expected files. If Lattice changed on purpose, review the differences and run bun run golden --update.`,
    );
    return 1;
  }
  return 0;
}

function expectedPath(recipe: string): string {
  return join(EXPECTED, `${recipe}.routing.json`);
}

function summary(file: RoutingFile): string {
  const steps = file.init.steps.length;
  return `${Object.keys(file.routing).length} selectors on ${file.facets.length} facets, ${file.init.kind} init with ${steps} ${steps === 1 ? "step" : "steps"}`;
}

/** `git status --porcelain` of the checkout, or null when git can't say (not a git checkout). */
function gitStatus(dir: string): string | null {
  const p = Bun.spawnSync(["git", "-C", dir, "status", "--porcelain"], { stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString() : null;
}

function seconds(from: number): string {
  return `${((performance.now() - from) / 1000).toFixed(1)} s`;
}
