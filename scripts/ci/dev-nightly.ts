#!/usr/bin/env bun
import { appendFileSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const packageName = "lattice-studio";
const root = join(import.meta.dir, "..", "..");
const cliDirectory = join(root, "packages", "cli");

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type NpmRunner = (args: readonly string[]) => CommandResult;

export interface NightlySource {
  eventName: string | undefined;
  ref: string | undefined;
  sha: string | undefined;
  head: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCommitSha(value: string | undefined): value is string {
  return value !== undefined && value.length === 40 && /^[0-9a-f]{40}$/.test(value);
}

export function validateNightlySource(source: NightlySource): string {
  if (source.eventName !== "workflow_dispatch" || source.ref !== "refs/heads/dev") {
    throw new Error("Nightly staging requires a workflow_dispatch CI run on refs/heads/dev.");
  }
  if (!isCommitSha(source.sha)) throw new Error("GITHUB_SHA must be the full 40-character commit SHA.");
  if (source.head !== source.sha) throw new Error("The checked-out HEAD must match the dev commit that passed CI.");
  return source.sha;
}

export function createNightlyVersion(packageVersion: string, commitTimestamp: string, sha: string): string {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(packageVersion);
  if (!match || match[0] !== packageVersion) throw new Error("The CLI package version must be a valid major.minor.patch version.");
  if (!/^[1-9]\d*$/.test(commitTimestamp) || commitTimestamp.trim() !== commitTimestamp || !Number.isSafeInteger(Number(commitTimestamp))) {
    throw new Error("The commit timestamp must be a positive Unix timestamp.");
  }
  if (!isCommitSha(sha)) throw new Error("The nightly version requires the full commit SHA.");
  return `${match[1]}.${match[2]}.${match[3]}-dev.${commitTimestamp}.g${sha}`;
}

export function npmCommand(runnerTemp: string | undefined, args: readonly string[]): string[] {
  if (!runnerTemp || !isAbsolute(runnerTemp)) throw new Error("RUNNER_TEMP must be an absolute directory containing the isolated npm CLI.");
  return [process.execPath, join(runnerTemp, "npm-cli", "node_modules", "npm", "bin", "npm-cli.js"), ...args];
}

function parseResponse(result: CommandResult, operation: string): unknown {
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    throw new Error(`${operation} returned malformed JSON (exit ${result.exitCode}).`);
  }
}

function isNotFound(value: unknown): boolean {
  return isRecord(value) && isRecord(value.error) && value.error.code === "E404";
}

function hasStagedVersion(version: string, run: NpmRunner): boolean {
  const result = run(["stage", "list", packageName, "--json"]);
  const value = parseResponse(result, "npm stage list");
  if (result.exitCode !== 0) {
    if (isNotFound(value)) return false;
    throw new Error(`npm stage list failed (exit ${result.exitCode}).`);
  }
  if (!Array.isArray(value)) throw new Error("npm stage list must return a JSON array of staged versions.");
  let exists = false;
  for (const item of value as unknown[]) {
    if (!isRecord(item) || typeof item.packageName !== "string" || typeof item.version !== "string" || typeof item.tag !== "string") {
      throw new Error("npm stage list returned a malformed staged version.");
    }
    if (item.packageName === packageName && item.version === version) {
      if (item.tag !== "dev") throw new Error("The exact nightly version is already staged with a tag other than dev.");
      exists = true;
    }
  }
  return exists;
}

function hasPublishedVersion(version: string, run: NpmRunner): boolean {
  const result = run(["view", `${packageName}@${version}`, "version", "--json"]);
  const value = parseResponse(result, "npm view");
  if (result.exitCode !== 0) {
    if (isNotFound(value)) return false;
    throw new Error(`npm view failed (exit ${result.exitCode}).`);
  }
  if (value !== version) throw new Error("npm view returned a value other than the exact nightly version.");
  return true;
}

export function queryNightlyVersion(version: string, run: NpmRunner): boolean {
  const staged = hasStagedVersion(version, run);
  const published = hasPublishedVersion(version, run);
  return staged || published;
}

function confirmsStage(result: CommandResult, version: string): boolean {
  if (result.exitCode !== 0) return false;
  let value: unknown;
  try {
    value = JSON.parse(result.stdout) as unknown;
  } catch {
    return false;
  }
  if (!isRecord(value) || value.error !== undefined) return false;
  const item = value[packageName];
  return isRecord(item) && item.name === packageName && item.version === version
    && typeof item.stageId === "string" && item.stageId.length > 0;
}

export function stageNightlyVersion(version: string, suppliedVersion: string | undefined, run: NpmRunner, manifestVersion: string): "staged" | "confirmed" {
  if (suppliedVersion !== version) throw new Error("NIGHTLY_VERSION must match the version computed from the checked-out dev commit.");
  if (manifestVersion !== version) throw new Error("The CLI manifest version must exactly match the computed NIGHTLY_VERSION before staging.");
  let result: CommandResult | undefined;
  try {
    result = run(["stage", "publish", "--provenance", "--access", "public", "--tag", "dev", "--json"]);
  } catch {
    // A lost response can follow a successful upload. Confirm it without retrying the upload.
  }
  if (result && confirmsStage(result, version)) return "staged";
  let exists: boolean;
  try {
    exists = queryNightlyVersion(version, run);
  } catch {
    throw new Error("Nightly staging returned an unsuccessful or ambiguous response and registry confirmation failed.");
  }
  if (!exists) throw new Error("Nightly staging was not confirmed by the exact staged or published version; no upload was retried.");
  return "confirmed";
}

function gitValue(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error("Could not read the checked-out Git commit.");
  return result.stdout.toString().trim();
}

function main(): void {
  const mode = process.argv[2];
  if ((mode !== "check" && mode !== "stage") || process.argv.length !== 3) {
    throw new Error("Usage: bun scripts/ci/dev-nightly.ts <check|stage>.");
  }
  const sha = validateNightlySource({
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA,
    head: gitValue(["rev-parse", "HEAD"]),
  });
  const manifest: unknown = JSON.parse(readFileSync(join(cliDirectory, "package.json"), "utf8"));
  if (!isRecord(manifest) || manifest.name !== packageName || typeof manifest.version !== "string") {
    throw new Error("The CLI package must identify lattice-studio and its version.");
  }
  const version = createNightlyVersion(manifest.version, gitValue(["show", "-s", "--format=%ct", sha]), sha);
  const run: NpmRunner = (args) => {
    const result = Bun.spawnSync(npmCommand(process.env.RUNNER_TEMP, args), { cwd: cliDirectory, stdout: "pipe", stderr: "pipe" });
    return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  };
  if (mode === "check") {
    const output = process.env.GITHUB_OUTPUT;
    if (!output) throw new Error("GITHUB_OUTPUT is required to report the checked nightly version.");
    const exists = queryNightlyVersion(version, run);
    appendFileSync(output, `version=${version}\nexists=${exists}\n`);
    console.log(`dev-nightly · ${version} ${exists ? "is already staged or published" : "has not been staged or published"}.`);
  } else {
    const outcome = stageNightlyVersion(version, process.env.NIGHTLY_VERSION, run, manifest.version);
    console.log(`dev-nightly · ${version} ${outcome === "staged" ? "was staged under dev" : "was confirmed in the registry"}; npm approval requires 2FA.`);
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(`dev-nightly · ${error instanceof Error ? error.message : "The nightly command failed."}`);
    process.exitCode = 1;
  }
}
