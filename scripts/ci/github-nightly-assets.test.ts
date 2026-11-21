import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNightlyAssets, type AssetRunner } from "./github-nightly-assets.ts";
import { nightlyIdentity, sha256 } from "./github-nightly-policy.ts";

const root = join(import.meta.dir, "..", "..");
const manifestPath = join(root, "packages", "cli", "package.json");
const originalManifest = readFileSync(manifestPath);
const git = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root }).stdout.toString().trim();
const sha = git(["rev-parse", "HEAD"]);
const manifest = JSON.parse(originalManifest.toString()) as { version: string };
const identity = nightlyIdentity({ repository: "dadadave80/lattice-studio", eventName: "workflow_dispatch", ref: "refs/heads/dev", sha, head: sha }, manifest.version, git(["show", "-s", "--format=%ct", sha]), "2026-11-12T03:17:00Z");
const scratch = mkdtempSync(join(tmpdir(), "github-nightly-assets-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("packs only the CLI and verifies its extracted Node version and ERC20 recipe outside the checkout", async () => {
  const output = join(scratch, "first");
  await buildNightlyAssets(identity, output);
  const filename = `lattice-studio-${identity.version}.tgz`;
  expect(readdirSync(output).sort()).toEqual(["SHA256SUMS", filename, "nightly.json"].sort());
  const listing = Bun.spawnSync(["tar", "-tzf", join(output, filename)]);
  expect(listing.exitCode).toBe(0);
  expect(listing.stdout.toString().trim().split("\n").sort()).toEqual(["package/LICENSE", "package/README.md", "package/dist/main.js", "package/package.json"]);
  const packedManifest = Bun.spawnSync(["tar", "-xOf", join(output, filename), "package/package.json"]);
  const pkg = JSON.parse(packedManifest.stdout.toString()) as { name: string; version: string; private?: boolean; dependencies: Record<string, string>; bin: Record<string, string> };
  expect(pkg).toMatchObject({ name: "lattice-studio", version: identity.version, bin: { "lattice-studio": "./dist/main.js" } });
  expect(pkg.private).toBeUndefined();
  expect(Object.values(pkg.dependencies).some((range) => range.startsWith("workspace:"))).toBe(false);
  expect(pkg.dependencies.viem).toBeDefined();
  const metadata = JSON.parse(readFileSync(join(output, "nightly.json"), "utf8")) as { sourceCommit: string; version: string; package: { sha256: string } };
  expect(metadata).toMatchObject({ sourceCommit: sha, version: identity.version, package: { sha256: sha256(readFileSync(join(output, filename))) } });
  const sums = readFileSync(join(output, "SHA256SUMS"), "utf8");
  expect(sums).toBe(`${sha256(readFileSync(join(output, filename)))}  ${filename}\n${sha256(readFileSync(join(output, "nightly.json")))}  nightly.json\n`);
  expect(readFileSync(manifestPath)).toEqual(originalManifest);
}, 60_000);

test("equivalent source packs to identical bytes despite different temporary paths and mtimes", async () => {
  const stat = Bun.spawnSync(["git", "status", "--porcelain", "--", "packages/cli/package.json"], { cwd: root });
  expect(stat.stdout.toString()).toBe("");
  const runner: AssetRunner = (argv, cwd) => {
    if (argv.includes("pack")) {
      for (const filename of ["README.md", "dist/main.js", "package.json", "LICENSE"]) {
        const file = join(cwd, filename);
        const bytes = readFileSync(file);
        const mode = statSync(file).mode;
        unlinkSync(file);
        writeFileSync(file, bytes, { mode });
        utimesSync(file, new Date(1000), new Date(1000));
      }
    }
    const result = Bun.spawnSync([...argv], { cwd, stdout: "pipe", stderr: "pipe" });
    return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  };
  await buildNightlyAssets(identity, join(scratch, "second"), runner);
  for (const filename of readdirSync(join(scratch, "first"))) {
    expect(readFileSync(join(scratch, "second", filename)), filename).toEqual(readFileSync(join(scratch, "first", filename)));
  }
}, 60_000);

test("refuses a repository output directory and a mismatched nightly version", async () => {
  await expect(buildNightlyAssets(identity, join(root, "dist-nightly"))).rejects.toThrow("outside");
  await expect(buildNightlyAssets({ ...identity, version: "0.2.0-dev.wrong" }, join(scratch, "wrong"))).rejects.toThrow("version");
  expect(readFileSync(manifestPath)).toEqual(originalManifest);
});

test("failed build, pack and smoke commands restore the source manifest and do not emit complete assets", async () => {
  for (const phase of ["build", "pack", "smoke"] as const) {
    let failed = false;
    const runner: AssetRunner = (argv, cwd) => {
      const matches = phase === "build" ? argv.includes("--target=node") : phase === "pack" ? argv.includes("pack") : argv[0] === "node";
      if (matches) {
        failed = true;
        return { exitCode: 23, stdout: "", stderr: "fixture failure" };
      }
      const result = Bun.spawnSync([...argv], { cwd, stdout: "pipe", stderr: "pipe" });
      return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
    };
    const output = join(scratch, `failed-${phase}`);
    await expect(buildNightlyAssets(identity, output, runner)).rejects.toThrow("fixture failure");
    expect(failed).toBe(true);
    expect(readFileSync(manifestPath)).toEqual(originalManifest);
    expect(readdirSync(output)).not.toContain("SHA256SUMS");
  }
}, 60_000);

test.skipIf(Bun.version !== "1.4.2")("runtime entry point validates dispatch/context values before building", () => {
  const runtime = join(scratch, "runtime");
  mkdirSync(runtime);
  const eventPath = join(scratch, "event.json");
  const contextPath = join(runtime, "github-nightly-context.json");
  const context = { runId: "123", createdAt: "2026-11-12T03:17:00Z", identity };
  for (const failure of ["run", "release", "diagnostic", "ref", "version", "context", "valid"] as const) {
    writeFileSync(contextPath, JSON.stringify(failure === "context" ? { ...context, identity: { ...identity, sha: "b".repeat(40) } } : context), { flag: "w" });
    writeFileSync(eventPath, JSON.stringify({ inputs: {
      release_dev_nightly: failure === "release" ? "false" : "true",
      browser_diagnostics: failure === "diagnostic" ? "true" : "false",
    } }));
    const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "github-nightly-assets.ts"), "build"], {
      cwd: root,
      env: { ...process.env, RUNNER_TEMP: runtime, GITHUB_EVENT_PATH: eventPath,
        GITHUB_RUN_ID: failure === "run" ? "456" : "123", GITHUB_REPOSITORY: "dadadave80/lattice-studio",
        GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: failure === "ref" ? "refs/heads/main" : "refs/heads/dev",
        GITHUB_SHA: sha, NIGHTLY_VERSION: failure === "version" ? "0.2.0-wrong" : identity.version },
      stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode, failure).toBe(failure === "valid" ? 0 : 1);
    if (failure !== "valid") expect(result.stderr.toString(), failure).toContain("github-nightly-assets ·");
    expect(readFileSync(manifestPath), failure).toEqual(originalManifest);
    expect(readdirSync(runtime).sort(), failure).toEqual(failure === "valid"
      ? ["github-nightly-assets", "github-nightly-context.json"] : ["github-nightly-context.json"]);
  }
}, 60_000);
