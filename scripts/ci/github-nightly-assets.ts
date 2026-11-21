#!/usr/bin/env bun
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { exportRecipeJson, loadTemplate, validateCatalog, validateCatalogManifest, validateRecipesShard, withRecipes } from "@lattice-studio/core";
import { createNightlyVersion } from "./dev-nightly.ts";
import { checksumManifest, nightlyIdentity, nightlyMetadata, type NightlyIdentity } from "./github-nightly-policy.ts";
import { prepareCliPackage } from "./prepare-cli-package.ts";

const root = resolve(import.meta.dir, "..", "..");
const cli = join(root, "packages", "cli");

export type AssetRunner = (argv: readonly string[], cwd: string) => { exitCode: number; stdout: string; stderr: string };

const runCommand: AssetRunner = (argv, cwd) => {
  const result = Bun.spawnSync([...argv], { cwd, stdout: "pipe", stderr: "pipe" });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
};

function command(run: AssetRunner, argv: readonly string[], cwd = root): string {
  const result = run(argv, cwd);
  if (result.exitCode !== 0) throw new Error(`${argv[0]} ${argv[1]} failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
  return result.stdout;
}

function outsideRepository(path: string): string {
  if (!isAbsolute(path)) throw new Error("The asset directory must be absolute and outside the repository.");
  let parent = resolve(path);
  while (!existsSync(parent)) parent = dirname(parent);
  const target = resolve(realpathSync(parent), relative(parent, resolve(path)));
  const fromRoot = relative(realpathSync(root), target);
  if (fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))) {
    throw new Error("The asset directory must be outside the repository.");
  }
  return target;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function erc20Recipe(manifest: unknown): string {
  const parsed = validateCatalogManifest(manifest);
  if (!parsed.ok) throw new Error("The committed catalog manifest is invalid.");
  const entry = parsed.value.catalogs.find((candidate) => candidate.id === parsed.value.default);
  if (!entry) throw new Error("The committed catalog has no default entry.");
  const index = join(root, "catalog", entry.path);
  const catalog = validateCatalog(JSON.parse(readFileSync(index, "utf8")) as unknown);
  if (!catalog.ok || catalog.value.hash !== entry.hash) throw new Error("The default catalog does not match its manifest.");
  let loaded = catalog.value;
  if (loaded.shards) {
    const recipes = validateRecipesShard(JSON.parse(readFileSync(join(dirname(index), loaded.shards.recipes.path), "utf8")) as unknown);
    if (!recipes.ok) throw new Error("The default catalog recipe shard is invalid.");
    loaded = withRecipes(loaded, recipes.value);
  }
  const recipe = loadTemplate(loaded, "ERC20");
  if (!recipe.ok) throw new Error(`The ERC20 smoke recipe cannot load: ${recipe.error}`);
  return exportRecipeJson(recipe.value, loaded).text;
}

export async function buildNightlyAssets(identity: NightlyIdentity, outputDirectory: string, run: AssetRunner = runCommand): Promise<void> {
  const output = outsideRepository(outputDirectory);
  const path = join(cli, "package.json");
  const original = readFileSync(path);
  const manifest: unknown = JSON.parse(original.toString());
  if (!record(manifest) || manifest.name !== "lattice-studio" || typeof manifest.version !== "string") {
    throw new Error("The CLI manifest must identify lattice-studio and its version.");
  }
  const sha = command(run, ["git", "rev-parse", "HEAD"]).trim();
  const timestamp = command(run, ["git", "show", "-s", "--format=%ct", sha]).trim();
  if (sha !== identity.sha || identity.tag !== `nightly-${sha}` || createNightlyVersion(manifest.version, timestamp, sha) !== identity.version) {
    throw new Error("The nightly source and version must match the checked-out commit.");
  }
  if (existsSync(output) && readdirSync(output).length !== 0) throw new Error("The nightly asset directory must be empty.");
  mkdirSync(output, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "studio-nightly-package-"));
  try {
    const staged = join(scratch, "package");
    mkdirSync(join(staged, "dist"), { recursive: true });
    try {
      writeFileSync(path, `${JSON.stringify({ ...manifest, version: identity.version }, null, 2)}\n`);
      command(run, [process.execPath, "build", "src/main.ts", "--target=node", "--outfile", join(staged, "dist", "main.js"), "--banner", "#!/usr/bin/env node"], cli);
    } finally {
      writeFileSync(path, original);
    }
    const prepared = prepareCliPackage({ ...manifest, version: identity.version });
    writeFileSync(join(staged, "package.json"), `${JSON.stringify(prepared, null, 2)}\n`);
    copyFileSync(join(cli, "README.md"), join(staged, "README.md"));
    copyFileSync(join(root, "LICENSE"), join(staged, "LICENSE"));
    command(run, [process.execPath, "pm", "pack", "--ignore-scripts", "--destination", output], staged);

    const filename = `lattice-studio-${identity.version}.tgz`;
    const archive = join(output, filename);
    const names = command(run, ["tar", "-tzf", archive]).trim().split("\n").sort();
    const expected = ["package/LICENSE", "package/README.md", "package/dist/main.js", "package/package.json"];
    if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error("The nightly package contains unexpected or missing files.");
    const smoke = join(scratch, "smoke");
    mkdirSync(smoke);
    command(run, ["tar", "-xzf", archive, "-C", smoke]);
    const extracted: unknown = JSON.parse(readFileSync(join(smoke, "package", "package.json"), "utf8"));
    if (!record(extracted) || extracted.name !== "lattice-studio" || extracted.version !== identity.version || extracted.private !== undefined
        || !record(extracted.bin) || extracted.bin["lattice-studio"] !== "./dist/main.js"
        || JSON.stringify(extracted.dependencies) !== JSON.stringify(prepared.dependencies)) {
      throw new Error("The packed CLI manifest does not match its prepared identity.");
    }
    if (command(run, ["node", "package/dist/main.js", "--version"], smoke) !== `${identity.version}\n`) {
      throw new Error("The extracted CLI reports the wrong nightly version.");
    }
    if (!command(run, ["node", "package/dist/main.js", "--help"], smoke).includes("verify-catalog")) {
      throw new Error("The extracted CLI help is incomplete.");
    }
    const catalogManifest: unknown = JSON.parse(readFileSync(join(root, "catalog", "manifest.json"), "utf8"));
    writeFileSync(join(smoke, "recipe.json"), erc20Recipe(catalogManifest));
    if (!command(run, ["node", "package/dist/main.js", "check", "recipe.json"], smoke).startsWith("ERC20 · recipe 0x")) {
      throw new Error("The extracted CLI did not check its bundled ERC20 recipe.");
    }
    const tarball = readFileSync(archive);
    const metadata = Buffer.from(nightlyMetadata(identity, catalogManifest, tarball));
    writeFileSync(join(output, "nightly.json"), metadata);
    writeFileSync(join(output, "SHA256SUMS"), checksumManifest(new Map([[filename, tarball], ["nightly.json", metadata]])));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  if (process.argv.length !== 3 || process.argv[2] !== "build") throw new Error("Usage: bun scripts/ci/github-nightly-assets.ts build.");
  if (Bun.version !== "1.4.2") throw new Error("Nightly publication requires pinned Bun 1.4.2.");
  if (!command(runCommand, ["node", "--version"]).startsWith("v22.")) throw new Error("Nightly publication requires Node 22 for smoke tests.");
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp || !isAbsolute(runnerTemp)) throw new Error("RUNNER_TEMP must be an absolute directory.");
  const context: unknown = JSON.parse(readFileSync(join(runnerTemp, "github-nightly-context.json"), "utf8"));
  if (!record(context) || context.runId !== process.env.GITHUB_RUN_ID || typeof context.createdAt !== "string") {
    throw new Error("The checked nightly context must match this workflow run.");
  }
  const event: unknown = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));
  if (!record(event) || !record(event.inputs) || (event.inputs.release_dev_nightly !== true && event.inputs.release_dev_nightly !== "true")
      || (event.inputs.browser_diagnostics !== undefined && event.inputs.browser_diagnostics !== false && event.inputs.browser_diagnostics !== "false")) {
    throw new Error("Nightly assets require an opted-in non-diagnostic CI dispatch.");
  }
  const manifest: unknown = JSON.parse(readFileSync(join(cli, "package.json"), "utf8"));
  if (!record(manifest) || typeof manifest.version !== "string") throw new Error("The CLI manifest has no version.");
  const head = command(runCommand, ["git", "rev-parse", "HEAD"]).trim();
  const identity = nightlyIdentity({ repository: process.env.GITHUB_REPOSITORY, eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA, head }, manifest.version,
    command(runCommand, ["git", "show", "-s", "--format=%ct", head]).trim(), context.createdAt);
  if (JSON.stringify(context.identity) !== JSON.stringify(identity) || process.env.NIGHTLY_VERSION !== identity.version) {
    throw new Error("The nightly context and supplied version must match the tested source.");
  }
  await buildNightlyAssets(identity, join(runnerTemp, "github-nightly-assets"));
  console.log(`github-nightly-assets · built and smoke-tested ${identity.version}; tarball, metadata and checksums are ready.`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`github-nightly-assets · ${error instanceof Error ? error.message : "The nightly package build failed."}`);
    process.exitCode = 1;
  });
}
