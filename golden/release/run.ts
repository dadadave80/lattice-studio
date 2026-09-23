#!/usr/bin/env bun
// Golden suite for shared-contract addresses (spec "Shared contracts are pinned too"): runs Lattice's own
// DeployRelease.release() in a forge test and checks that the registry, the factory and every facet are where
// the default catalog predicts. golden/run.ts runs it after the recipe routing check, with the same arguments.
// Exit codes: 0 everything matches, or skipped while Lattice A1 isn't at the pin; 1 drift or a failed harness;
// 2 bad arguments, a missing tool, checkout or catalog, or a catalog built from another commit.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { type Catalog, CatalogManifestSchema, CatalogSchema, type Hex } from "@lattice-studio/core";
import { REPO_ROOT, SetupError, latticeDir, runForgeHarness } from "../lib/forge.ts";
import {
  FACTORY,
  REGISTRY,
  SKIP_REASON,
  compareRelease,
  detectDeployer,
  expectedFromCatalog,
  failed,
  formatComparison,
  knownGapNames,
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
  const { id, dir, catalog } = loadCatalog();
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

  // Known-gap contracts are checked against the catalog's creation code, so the harness logs forge's for them.
  const gaps = knownGapNames(expectedFromCatalog(catalog));
  const expected = expectedFromCatalog(catalog, readCreationCodes(dir, catalog, gaps));
  console.log(`${PREFIX} releasing Lattice at ${lattice} with DeployRelease (FOUNDRY_PROFILE=ci), catalog ${id}…`);
  process.env["STUDIO_RELEASE_OWNER"] = expected.registryOwner;
  if (gaps.length > 0) process.env["STUDIO_RELEASE_CODE"] = gaps.join(",");
  else delete process.env["STUDIO_RELEASE_CODE"];
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

  if (report.value.createx === "mock-createx") {
    console.log(`${PREFIX} DeployRelease requires CreateX's code, so the harness etched Lattice's MockCreateX at its address.`);
  }
  const comparison = compareRelease(expected, report.value, model);
  const bad = failed(comparison);
  const log = bad ? console.error : console.log;
  const [summary, ...details] = formatComparison(comparison);
  log(`${PREFIX} ${summary}`);
  for (const line of details) log(line);
  if (bad) {
    console.error(
      model === "createx-raw"
        ? `${PREFIX} the catalog's salts or init-code hashes don't match what DeployRelease deploys (DeployRelease still deploys through CreateX raw salts, so only these were checked).`
        : `${PREFIX} catalog ${id} doesn't predict where DeployRelease deploys. If Lattice changed on purpose, rebuild it with bun run catalog.`,
    );
    return 1;
  }
  if (model === "createx-raw") {
    console.log(
      `${PREFIX} skipped: ${SKIP_REASON}. DeployRelease still deploys through CreateX raw salts, so only the salts and init-code hashes were checked.`,
    );
  }
  return 0;
}

/** The default catalog from `catalog/manifest.json`, validated, and the folder its index is in. */
function loadCatalog(): { id: string; dir: string; catalog: Catalog } {
  const manifestPath = join(CATALOG, "manifest.json");
  const manifest = CatalogManifestSchema.safeParse(readJson(manifestPath));
  if (!manifest.success) throw new SetupError(`${relative(REPO_ROOT, manifestPath)} isn't a catalog manifest: ${manifest.error.message}`);
  const id = manifest.data.default;
  const entry = manifest.data.catalogs.find((c) => c.id === id);
  if (!entry) throw new SetupError(`catalog/manifest.json names default catalog ${id} but doesn't list it.`);
  const indexPath = join(CATALOG, entry.path);
  const catalog = CatalogSchema.safeParse(readJson(indexPath));
  if (!catalog.success) throw new SetupError(`${relative(REPO_ROOT, indexPath)} isn't a catalog: ${catalog.error.message}`);
  return { id, dir: dirname(indexPath), catalog: catalog.data };
}

/** A JSON file's value; a missing or unparsable file is a setup error (exit 2). */
function readJson(path: string): unknown {
  const rel = relative(REPO_ROOT, path);
  if (!existsSync(path)) throw new SetupError(`No ${rel}. Run bun run catalog.`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new SetupError(`${rel} isn't valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The catalog's creation code of each named contract, from its `code/<Name>.creation.hex` file. */
function readCreationCodes(dir: string, catalog: Catalog, names: readonly string[]): Map<string, Hex> {
  const codes = new Map<string, Hex>();
  for (const name of names) {
    const ref =
      name === REGISTRY
        ? catalog.registry.creationCode
        : name === FACTORY
          ? catalog.factory.creationCode
          : catalog.facets.find((f) => f.name === name)?.release.creationCode;
    if (!ref) throw new SetupError(`the catalog has no creation code entry for ${name}.`);
    const path = join(dir, ref.path);
    if (!existsSync(path)) throw new SetupError(`No ${relative(REPO_ROOT, path)}. Run bun run catalog.`);
    const text = readFileSync(path, "utf8").trim();
    if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(text)) throw new SetupError(`${relative(REPO_ROOT, path)} isn't hex creation code.`);
    codes.set(name, text as Hex);
  }
  return codes;
}

/** `git -C <dir> <args>` output, or null when git can't say (not a git checkout). */
function gitOutput(dir: string, gitArgs: string[]): string | null {
  const p = Bun.spawnSync(["git", "-C", dir, ...gitArgs], { stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString() : null;
}
