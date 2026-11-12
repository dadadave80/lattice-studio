#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { npmCommand, type NpmRunner } from "./dev-nightly.ts";

const repository = "dadadave80/lattice-studio";
const repositoryUrl = `https://github.com/${repository}`;
const target = "@dadadave80/lattice-studio";
const registry = "https://npm.pkg.github.com/";

export interface PreparedMirror {
  version: string;
  tag: "dev" | "latest";
  sourceSha: string;
  tarball: string;
  integrity: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function validateMirrorVersion(version: string | undefined): { tag: "dev" | "latest"; sha?: string } {
  const match = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-dev\.[1-9]\d*\.g([0-9a-f]{40}))?$/.exec(version ?? "");
  if (!match || match[0] !== version) throw new Error("SOURCE_VERSION must be an exact published stable or dev-nightly version.");
  return match[1] ? { tag: "dev", sha: match[1] } : { tag: "latest" };
}

function sourceTarball(version: string): string {
  return `https://registry.npmjs.org/lattice-studio/-/lattice-studio-${version}.tgz`;
}

function sourceAttestations(version: string): string {
  return `https://registry.npmjs.org/-/npm/v1/attestations/lattice-studio@${version}`;
}

function validRepository(value: unknown): boolean {
  const entry = record(value);
  return entry?.url === `git+${repositoryUrl}.git` && entry.directory === "packages/cli";
}

function sha512(bytes: Uint8Array): { integrity: string; hex: string } {
  const digest = createHash("sha512").update(bytes).digest();
  return { integrity: `sha512-${digest.toString("base64")}`, hex: digest.toString("hex") };
}

function sourceBundle(attestations: unknown): unknown {
  const entries = record(attestations)?.attestations;
  const provenance = Array.isArray(entries) ? entries.find((entry: unknown) => record(entry)?.predicateType === "https://slsa.dev/provenance/v1") as unknown : undefined;
  const bundle = record(provenance)?.bundle;
  if (!record(bundle)) throw new Error("The published npm package must have a SLSA provenance bundle.");
  return bundle;
}

type SignatureOptions = { certificateIssuer: string; certificateIdentityURI: string; tufCachePath: string };
type SignatureVerifier = (bundle: unknown, options: SignatureOptions) => Promise<unknown>;

export async function verifyPublishedSourceSignature(version: string, attestations: unknown, runnerTemp: string, verify: SignatureVerifier): Promise<void> {
  const selected = validateMirrorVersion(version);
  const workflow = selected.tag === "dev" ? ".github/workflows/dev-nightly.yml@refs/heads/dev" : `.github/workflows/publish-cli.yml@refs/tags/lattice-studio-v${version}`;
  const bundle = sourceBundle(attestations);
  try {
    await verify(bundle, {
      certificateIssuer: "https://token.actions.githubusercontent.com",
      certificateIdentityURI: `${repositoryUrl}/${workflow}`,
      tufCachePath: join(runnerTemp, "sigstore-cache"),
    });
  } catch {
    throw new Error("The npm provenance signature could not be verified.");
  }
}

export function verifyPublishedSource(version: string, metadata: unknown, attestations: unknown, archive: Uint8Array): { sourceSha: string; integrity: string; tag: "dev" | "latest" } {
  const selected = validateMirrorVersion(version);
  const pkg = record(metadata);
  const dist = record(pkg?.dist);
  const digest = sha512(archive);
  if (pkg?.name !== "lattice-studio" || pkg.version !== version || !validRepository(pkg.repository)
    || dist?.tarball !== sourceTarball(version) || dist.integrity !== digest.integrity
    || record(dist.attestations)?.url !== sourceAttestations(version)) {
    throw new Error("The published npm package identity, repository or archive integrity does not match.");
  }
  const payload = record(record(sourceBundle(attestations))?.dsseEnvelope)?.payload;
  let statement: Record<string, unknown> | undefined;
  try {
    statement = typeof payload === "string" ? record(JSON.parse(Buffer.from(payload, "base64").toString()) as unknown) : undefined;
  } catch {
    throw new Error("The published npm provenance payload is malformed.");
  }
  const subjects = statement?.subject;
  const subject = Array.isArray(subjects) && subjects.length === 1 ? record(subjects[0]) : undefined;
  const build = record(record(statement?.predicate)?.buildDefinition);
  const workflow = record(record(build?.externalParameters)?.workflow);
  const dependencies = build?.resolvedDependencies;
  const ref = selected.tag === "dev" ? "refs/heads/dev" : `refs/tags/lattice-studio-v${version}`;
  const dependency = Array.isArray(dependencies) ? dependencies.find((entry: unknown) => record(entry)?.uri === `git+${repositoryUrl}@${ref}`) as unknown : undefined;
  const sourceSha = record(record(dependency)?.digest)?.gitCommit;
  if (subject?.name !== `pkg:npm/lattice-studio@${version}` || record(subject.digest)?.sha512 !== digest.hex
    || workflow?.repository !== repositoryUrl || workflow.ref !== ref
    || workflow.path !== (selected.tag === "dev" ? ".github/workflows/ci.yml" : ".github/workflows/publish-cli.yml")
    || typeof sourceSha !== "string" || !/^[0-9a-f]{40}$/.test(sourceSha) || sourceSha.length !== 40
    || (selected.sha !== undefined && sourceSha !== selected.sha)) {
    throw new Error("The npm provenance must identify this archive and its tested source commit.");
  }
  return { sourceSha, integrity: digest.integrity, tag: selected.tag };
}

export function prepareMirrorManifest(value: unknown, version: string): Record<string, unknown> {
  const manifest = record(value);
  if (manifest?.name !== "lattice-studio" || manifest.version !== version || manifest.private === true || !validRepository(manifest.repository)) {
    throw new Error("The approved CLI manifest identity, version or repository does not match.");
  }
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    if (manifest[field] === undefined) continue;
    const dependencies = record(manifest[field]);
    if (!dependencies || Object.values(dependencies).some(range => typeof range !== "string" || range.startsWith("workspace:"))) {
      throw new Error("The approved CLI manifest must not contain workspace dependencies.");
    }
  }
  const config = manifest.publishConfig === undefined ? {} : record(manifest.publishConfig);
  if (!config) throw new Error("The approved CLI publishConfig must be an object.");
  return { ...manifest, name: target, publishConfig: { ...config, registry } };
}

function expectedTarball(runnerTemp: string, version: string): string {
  return join(runnerTemp, "github-cli-package", `dadadave80-lattice-studio-${version}.tgz`);
}

export function validatePreparedMirror(value: unknown, version: string, runnerTemp: string, suppliedTarball: string | undefined): PreparedMirror {
  const selected = validateMirrorVersion(version);
  const state = record(value);
  const path = expectedTarball(runnerTemp, version);
  if (!isAbsolute(runnerTemp) || state?.version !== version || state.tag !== selected.tag
    || typeof state.sourceSha !== "string" || !/^[0-9a-f]{40}$/.test(state.sourceSha) || state.sourceSha.length !== 40
    || (selected.sha !== undefined && state.sourceSha !== selected.sha)
    || state.tarball !== path || suppliedTarball !== path
    || typeof state.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(state.integrity)) {
    throw new Error("The prepared GitHub package identity, version, commit or artifact path does not match.");
  }
  return { version, tag: selected.tag, sourceSha: state.sourceSha, tarball: path, integrity: state.integrity };
}

function publishedIntegrity(prepared: PreparedMirror, run: NpmRunner): string | undefined {
  const result = run(["view", `${target}@${prepared.version}`, "dist", "--json", "--registry", registry]);
  let value: unknown;
  try { value = JSON.parse(result.stdout) as unknown; } catch { throw new Error("GitHub package lookup returned malformed JSON."); }
  if (result.exitCode !== 0) {
    if (record(record(value)?.error)?.code === "E404") return undefined;
    throw new Error(`GitHub package lookup failed (exit ${result.exitCode}).`);
  }
  const dist = record(value);
  if (typeof dist?.integrity === "string") return dist.integrity;
  if (dist?.integrity !== undefined || typeof dist?.tarball !== "string" || !dist.tarball.startsWith(`${registry}download/`)) {
    throw new Error("GitHub package lookup did not return valid archive metadata.");
  }
  // Some registries omit integrity. npm pack computes SHA512 from the downloaded archive.
  const download = run(["pack", `${target}@${prepared.version}`, "--registry", registry, "--ignore-scripts", "--json", "--pack-destination", join(dirname(prepared.tarball), "registry-verification")]);
  let packages: unknown;
  try { packages = JSON.parse(download.stdout) as unknown; } catch { throw new Error("The GitHub archive verification download failed."); }
  const item = Array.isArray(packages) && packages.length === 1 ? record(packages[0]) : undefined;
  if (download.exitCode !== 0 || item?.name !== target || item.version !== prepared.version || typeof item.integrity !== "string") {
    throw new Error("The GitHub archive verification download did not identify the exact package version.");
  }
  return item.integrity;
}

export function publishMirror(prepared: PreparedMirror, run: NpmRunner): "published" | "already published" {
  const existing = publishedIntegrity(prepared, run);
  if (existing !== undefined) {
    if (existing !== prepared.integrity) throw new Error("The immutable GitHub version already exists with different contents.");
    return "already published";
  }
  try {
    run(["publish", prepared.tarball, "--registry", registry, "--tag", prepared.tag, "--ignore-scripts", "--provenance=false", "--json"]);
  } catch {
    // A lost upload response is resolved by an exact registry read, never another upload.
  }
  if (publishedIntegrity(prepared, run) !== prepared.integrity) throw new Error("The GitHub package upload was not confirmed by the exact archive integrity.");
  return "published";
}

async function publicGet(url: string): Promise<Response> {
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`The public npm source could not be read (HTTP ${response.status}).`);
  return response;
}

function parseJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if ((mode !== "prepare" && mode !== "publish") || process.argv.length !== 3) throw new Error("Usage: bun scripts/ci/mirror-cli-package.ts <prepare|publish>.");
  const version = process.env.SOURCE_VERSION;
  validateMirrorVersion(version);
  if (!version || process.env.GITHUB_REPOSITORY !== repository) throw new Error("GitHub mirroring requires the lattice-studio source repository.");
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp || !isAbsolute(runnerTemp)) throw new Error("RUNNER_TEMP must be an absolute directory.");
  const directory = join(runnerTemp, "github-cli-package");
  const packageDirectory = join(directory, "package");
  const statePath = join(directory, "prepared.json");
  const run: NpmRunner = args => {
    const result = Bun.spawnSync(npmCommand(runnerTemp, args), {
      cwd: packageDirectory, stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NPM_CONFIG_CACHE: join(runnerTemp, "npm-cache"), NPM_CONFIG_UPDATE_NOTIFIER: "false" },
    });
    return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  };
  if (mode === "prepare") {
    const output = process.env.GITHUB_OUTPUT;
    if (!output) throw new Error("GITHUB_OUTPUT is required to report the prepared mirror.");
    const metadata: unknown = await (await publicGet(`https://registry.npmjs.org/lattice-studio/${version}`)).json();
    const attestations: unknown = await (await publicGet(sourceAttestations(version))).json();
    const archive = new Uint8Array(await (await publicGet(sourceTarball(version))).arrayBuffer());
    if (archive.byteLength >= 256 * 1024 * 1024) throw new Error("The approved npm archive exceeds GitHub Packages' size limit.");
    const source = verifyPublishedSource(version, metadata, attestations, archive);
    const require = createRequire(join(runnerTemp, "npm-cli", "node_modules", "npm", "package.json"));
    const sigstore = require("sigstore") as { verify: SignatureVerifier };
    await verifyPublishedSourceSignature(version, attestations, runnerTemp, (bundle, options) => sigstore.verify(bundle, options));
    mkdirSync(directory); // Each Actions job starts with a fresh temporary directory.
    const archivePath = join(directory, "approved-npm.tgz");
    writeFileSync(archivePath, archive);
    const pacote = require("pacote") as { extract: (source: string, destination: string, options: { integrity: string; cache: string; ignoreScripts: boolean }) => Promise<unknown> };
    await pacote.extract(archivePath, packageDirectory, { integrity: source.integrity, cache: join(runnerTemp, "npm-cache"), ignoreScripts: true });
    const bundle = readFileSync(join(packageDirectory, "dist", "main.js"));
    const readme = readFileSync(join(packageDirectory, "README.md"));
    const manifestPath = join(packageDirectory, "package.json");
    writeFileSync(manifestPath, `${JSON.stringify(prepareMirrorManifest(parseJson(manifestPath), version), null, 2)}\n`);
    const pack = run(["pack", "--ignore-scripts", "--json", "--pack-destination", directory]);
    if (pack.exitCode !== 0) throw new Error("The scoped GitHub archive could not be packed.");
    const packed: unknown = JSON.parse(pack.stdout);
    const item = Array.isArray(packed) && packed.length === 1 ? record(packed[0]) : undefined;
    const tarball = expectedTarball(runnerTemp, version);
    const integrity = sha512(readFileSync(tarball)).integrity;
    if (item?.name !== target || item.version !== version || item.integrity !== integrity
      || !bundle.equals(readFileSync(join(packageDirectory, "dist", "main.js"))) || !readme.equals(readFileSync(join(packageDirectory, "README.md")))) {
      throw new Error("Packing changed the approved CLI contents or package identity.");
    }
    const state: PreparedMirror = { version, tag: source.tag, sourceSha: source.sourceSha, tarball, integrity };
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    appendFileSync(output, `tarball=${tarball}\nversion=${version}\ntag=${state.tag}\nsource_sha=${state.sourceSha}\n`);
    console.log(`mirror-cli-package · prepared ${target}@${version} from approved npm commit ${state.sourceSha}; CLI bundle and README are unchanged.`);
  } else {
    if (!process.env.NODE_AUTH_TOKEN || !process.env.NPM_CONFIG_USERCONFIG) throw new Error("GitHub registry authentication must be configured for publishing.");
    const prepared = validatePreparedMirror(parseJson(statePath), version, runnerTemp, process.env.TARBALL);
    if (sha512(readFileSync(prepared.tarball)).integrity !== prepared.integrity) throw new Error("The prepared mirror archive changed before publication.");
    mkdirSync(join(directory, "registry-verification"), { recursive: true });
    const result = publishMirror(prepared, run);
    console.log(`mirror-cli-package · ${result} ${target}@${version} under ${prepared.tag}.`);
  }
}

if (import.meta.main) {
  main().catch(error => {
    console.error(`mirror-cli-package · ${error instanceof Error ? error.message : "The mirror command failed."}`);
    process.exitCode = 1;
  });
}
