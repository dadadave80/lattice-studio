#!/usr/bin/env bun
// Golden suite for shared-contract addresses (spec "Shared contracts are pinned too"): runs Lattice's own
// DeployRelease.release() in a forge test and checks that the registry, the factory and every facet are where
// the default catalog predicts. golden/run.ts runs it after the recipe routing check, with the same arguments.
// Exit codes: 0 everything matches, or skipped while Lattice A1 isn't at the pin; 1 drift or a failed harness;
// 2 bad arguments, a missing tool, checkout or catalog, or a catalog built from another commit.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { CatalogManifestSchema, CatalogSchema } from "@lattice-studio/core";
import { REPO_ROOT, SetupError, latticeDir, runForgeHarness } from "../lib/forge.ts";
import {
  type CatalogRelease,
  REGISTRY,
  SKIP_REASON,
  compareRelease,
  detectDeployer,
  expectedFromCatalog,
  failed,
  formatComparison,
  parseReleaseLogs,
} from "./compare.ts";

const HARNESS = join(import.meta.dir, "harness", "StudioGoldenRelease.t.sol");
const CATALOG = join(REPO_ROOT, "catalog");
const PREFIX = "golden/release:";

class HarnessError extends Error {
  override name = "HarnessError";
}

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== "--update");
if (unknown.length > 0) {
  console.error(`${PREFIX} unknown argument ${unknown.join(" ")}. Usage: bun golden/release/run.ts [--update]`);
  process.exit(2);
}
if (args.includes("--update")) {
  console.log(`${PREFIX} nothing to update here: the catalog is the expectation, and bun run catalog rebuilds it.`);
}

const started = performance.now();
let code: number;
try {
  code = await main();
} catch (e) {
  if (e instanceof SetupError) {
    console.error(`${PREFIX} ${e.message}`);
    code = 2;
  } else if (e instanceof HarnessError) {
    console.error(`${PREFIX} the harness failed: ${e.message}`);
    code = 1;
  } else throw e;
}
console.log(`${PREFIX} shared-contract addresses took ${((performance.now() - started) / 1000).toFixed(1)} s.`);
process.exit(code);

async function main(): Promise<number> {
  const { id, catalog } = loadCatalog();
  const lattice = latticeDir();
  const head = gitOutput(lattice, ["rev-parse", "HEAD"]);
  if (head === null) {
    console.log(`${PREFIX} git couldn't read the Lattice checkout's commit, so the catalog's commit wasn't checked.`);
  } else if (head.trim() !== catalog.lattice.commit) {
    throw new SetupError(
      `catalog ${id} was built from Lattice ${catalog.lattice.commit}, but ${lattice} is at ${head.trim()}. ` +
        "Run bun run catalog against this checkout, or point LATTICE_DIR at the catalog's commit.",
    );
  }

  const expected = expectedFromCatalog(catalog);
  console.log(`${PREFIX} releasing Lattice at ${lattice} with DeployRelease (FOUNDRY_PROFILE=ci), catalog ${id}…`);
  process.env["STUDIO_RELEASE_OWNER"] = expected.registryOwner;
  const before = gitOutput(lattice, ["status", "--porcelain"]);
  const run = await runForgeHarness({ lattice, files: [HARNESS], folder: `.studio-golden-release-${process.pid}` });
  const after = gitOutput(lattice, ["status", "--porcelain"]);
  if (before === null || after === null) {
    console.log(`${PREFIX} git couldn't read the Lattice checkout's status, so the clean-checkout check was skipped.`);
  } else if (before !== after) {
    throw new HarnessError(`the run left changes in the Lattice checkout:\n${after}`);
  } else if (after !== "") {
    console.warn(`${PREFIX} warning: the Lattice checkout at ${lattice} already had changes before this run:\n${after}`);
  }

  const failures = run.tests.filter((t) => !t.ok);
  if (run.tests.length === 0 || failures.length > 0 || run.exitCode !== 0) {
    for (const t of failures) console.error(`  ${t.test} failed: ${t.reason ?? "no reason given"}`);
    console.error(run.output.split("\n").slice(-40).join("\n"));
    throw new HarnessError(
      run.timedOut
        ? `forge test timed out after ${run.timeoutSeconds} s.`
        : run.tests.length === 0
          ? `forge test ran no tests (exit ${run.exitCode}).`
          : `forge test exited ${run.exitCode}.`,
    );
  }
  const report = parseReleaseLogs(run.tests.flatMap((t) => t.logs));
  if (!report.ok) throw new HarnessError(report.error);

  const registry = expected.contracts.find((c) => c.name === REGISTRY);
  const deployed = report.value.contracts.find((c) => c.name === REGISTRY);
  if (!registry || !deployed) throw new HarnessError(`${REGISTRY} is missing from the catalog or the release.`);
  const model = detectDeployer(registry, deployed.address);
  if (model === "unknown") {
    console.error(
      `${PREFIX} DeployRelease put ${REGISTRY} at ${deployed.address}, which neither Arachnid's proxy nor CreateX's raw-salt ` +
        "formula gives for the catalog's salt and init-code hash. Check the registry owner and the build settings.",
    );
    return 1;
  }

  if (model === "createx-raw") {
    console.log(`${PREFIX} skipped: ${SKIP_REASON}. DeployRelease still deploys through CreateX raw salts.`);
  }
  const comparison = compareRelease(expected, report.value, model);
  const bad = failed(comparison);
  const log = bad ? console.error : console.log;
  const [summary, ...details] = formatComparison(comparison);
  log(`${PREFIX} ${summary}`);
  for (const line of details) log(line);
  if (!bad) return 0;
  console.error(
    model === "createx-raw"
      ? `${PREFIX} the catalog's salts or init-code hashes don't match what DeployRelease deploys.`
      : `${PREFIX} catalog ${id} doesn't predict where DeployRelease deploys. If Lattice changed on purpose, rebuild it with bun run catalog.`,
  );
  return 1;
}

/** The default catalog from `catalog/manifest.json`, validated. */
function loadCatalog(): { id: string; catalog: CatalogRelease & { lattice: { tag: string; commit: string } } } {
  const manifestPath = join(CATALOG, "manifest.json");
  if (!existsSync(manifestPath)) throw new SetupError(`No ${relative(REPO_ROOT, manifestPath)}. Run bun run catalog.`);
  const manifest = CatalogManifestSchema.safeParse(JSON.parse(readFileSync(manifestPath, "utf8")));
  if (!manifest.success) throw new SetupError(`${relative(REPO_ROOT, manifestPath)} isn't a catalog manifest: ${manifest.error.message}`);
  const id = manifest.data.default;
  const entry = manifest.data.catalogs.find((c) => c.id === id);
  if (!entry) throw new SetupError(`catalog/manifest.json names default catalog ${id} but doesn't list it.`);
  const indexPath = join(CATALOG, entry.path);
  if (!existsSync(indexPath)) throw new SetupError(`No ${relative(REPO_ROOT, indexPath)}. Run bun run catalog.`);
  const catalog = CatalogSchema.safeParse(JSON.parse(readFileSync(indexPath, "utf8")));
  if (!catalog.success) throw new SetupError(`${relative(REPO_ROOT, indexPath)} isn't a catalog: ${catalog.error.message}`);
  return { id, catalog: catalog.data };
}

/** `git -C <dir> <args>` output, or null when git can't say (not a git checkout). */
function gitOutput(dir: string, gitArgs: string[]): string | null {
  const p = Bun.spawnSync(["git", "-C", dir, ...gitArgs], { stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString() : null;
}
