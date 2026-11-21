#!/usr/bin/env bun
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { checksumManifest, missingAssets, NIGHTLY_REPOSITORY, nightlyIdentity, nightlyMetadata, selectHistory, sha256,
  type NightlyIdentity, type RemoteAsset } from "./github-nightly-policy.ts";
import { createNightlyVersion, validateNightlySource } from "./dev-nightly.ts";

export type GitHubRunner = (argv: readonly string[], input?: Uint8Array) => { exitCode: number; stdout: Uint8Array; stderr: string };
type GitReader = (args: readonly string[]) => string;
type Environment = Record<string, string | undefined>;
interface Release {
  id: number; tag_name: string; target_commitish: string; name: string; body: string;
  draft: boolean; prerelease: boolean; published_at: string | null; html_url: string; immutable: boolean;
}
interface Asset { id: number; name: string; size: number; state: string; digest: string | null }
interface Outcome { published: boolean; superseded: boolean; release_url: string; immutable?: boolean }
interface RunContext { runId: string; createdAt: string; identity: NightlyIdentity }
const root = join(import.meta.dir, "..", "..");
const prefix = `repos/${NIGHTLY_REPOSITORY}`;
const web = `https://github.com/${NIGHTLY_REPOSITORY}`;
const encoder = new TextEncoder();

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function parse(bytes: Uint8Array): unknown {
  try { return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown; } catch { throw new Error("GitHub returned malformed JSON."); }
}
function releaseUrl(value: unknown): value is string {
  if (typeof value !== "string" || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.origin === "https://github.com" && url.search === "" && url.hash === "" && url.href === value
      && /^\/dadadave80\/lattice-studio\/releases\/(?:tag\/[^?#]+|[1-9]\d*)$/.test(url.pathname);
  } catch { return false; }
}
function release(value: unknown): Release {
  if (!record(value) || !positiveId(value.id) || typeof value.tag_name !== "string" || typeof value.target_commitish !== "string"
      || (value.name !== null && typeof value.name !== "string") || (value.body !== null && typeof value.body !== "string")
      || typeof value.draft !== "boolean" || typeof value.prerelease !== "boolean" || (value.published_at !== null && typeof value.published_at !== "string")
      || !releaseUrl(value.html_url) || typeof value.immutable !== "boolean") {
    throw new Error("GitHub returned malformed release metadata.");
  }
  return { id: value.id, tag_name: value.tag_name, target_commitish: value.target_commitish, name: value.name ?? "", body: value.body ?? "",
    draft: value.draft, prerelease: value.prerelease, published_at: value.published_at, html_url: value.html_url, immutable: value.immutable };
}
function asset(value: unknown): Asset {
  if (!record(value) || !positiveId(value.id) || typeof value.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.name)
      || typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 0 || typeof value.state !== "string"
      || (value.digest !== null && (typeof value.digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.digest)))) {
    throw new Error("GitHub returned malformed asset metadata.");
  }
  return { id: value.id, name: value.name, size: value.size, state: value.state, digest: value.digest };
}

export function validateDispatch(env: Environment, event: unknown, head: string): string {
  if (env.GITHUB_REPOSITORY !== NIGHTLY_REPOSITORY || (env.GH_REPO !== undefined && env.GH_REPO !== NIGHTLY_REPOSITORY)) throw new Error("The nightly repository is not authorized.");
  validateNightlySource({ eventName: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF, sha: env.GITHUB_SHA, head });
  if (!record(event) || !record(event.inputs) || (event.inputs.release_dev_nightly !== true && event.inputs.release_dev_nightly !== "true")
      || (event.inputs.browser_diagnostics !== undefined && event.inputs.browser_diagnostics !== false && event.inputs.browser_diagnostics !== "false")) {
    throw new Error("A non-diagnostic CI dispatch must explicitly request release_dev_nightly.");
  }
  if (!env.GITHUB_RUN_ID || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID) || !Number.isSafeInteger(Number(env.GITHUB_RUN_ID))) throw new Error("Missing or invalid CI run ID.");
  return env.GITHUB_RUN_ID;
}

export function validateRunMetadata(value: unknown, runId: string, sha: string): string {
  if (!record(value) || value.id !== Number(runId) || value.event !== "workflow_dispatch" || value.head_branch !== "dev" || value.head_sha !== sha
      || value.path !== ".github/workflows/ci.yml" || typeof value.created_at !== "string" || !record(value.repository)
      || value.repository.full_name !== NIGHTLY_REPOSITORY) throw new Error("The Actions run does not identify this full CI dispatch.");
  return value.created_at;
}

export class NightlyGithub {
  constructor(private readonly run: GitHubRunner, private readonly git: GitReader) {}

  private request(method: string, endpoint: string, input?: unknown, binary = false): Uint8Array {
    const argv = ["api", endpoint, "--method", method, "--include", "-H", `Accept: ${binary ? "application/octet-stream" : "application/vnd.github+json"}`];
    if (input !== undefined) argv.push("--input", "-");
    const result = this.run(argv, input === undefined ? undefined : encoder.encode(JSON.stringify(input)));
    const raw = Buffer.from(result.stdout);
    let split = raw.indexOf("\r\n\r\n");
    let separator = 4;
    if (split < 0) { split = raw.indexOf("\n\n"); separator = 2; }
    const status = /^HTTP\/\S+ (\d{3})(?:\s|$)/.exec(raw.subarray(0, Math.max(split, 0)).toString("utf8"));
    if (split < 0 || !status || result.exitCode !== 0 || Number(status[1]) < 200 || Number(status[1]) >= 300) {
      throw new Error(`GitHub ${method} ${endpoint} failed${status ? ` (HTTP ${status[1]})` : " with an unrecognized response"}.`);
    }
    return raw.subarray(split + separator);
  }

  private json(method: string, endpoint: string, input?: unknown): unknown {
    return parse(this.request(method, endpoint, input));
  }

  private list(endpoint: string): unknown[] {
    const all: unknown[] = [];
    for (let page = 1; ; page += 1) {
      const value = this.json("GET", `${endpoint}?per_page=100&page=${page}`);
      if (!Array.isArray(value)) throw new Error("GitHub returned a malformed paginated collection.");
      all.push(...value);
      if (value.length < 100) return all;
    }
  }

  private releases(): Release[] {
    return this.list(`${prefix}/releases`).map(release);
  }

  private find(releases: readonly Release[], tag: string): Release | undefined {
    const matches = releases.filter((item) => item.tag_name === tag);
    if (matches.length > 1) throw new Error(`Duplicate nightly release states for ${tag}.`);
    return matches[0];
  }

  private tagCommit(tag: string): string | undefined {
    const refs = this.json("GET", `${prefix}/git/matching-refs/tags/${encodeURIComponent(tag)}`);
    if (!Array.isArray(refs) || refs.some((item: unknown) => !record(item) || typeof item.ref !== "string")) throw new Error("GitHub returned malformed tag refs.");
    const matches: unknown[] = refs.filter((item: unknown) => record(item) && item.ref === `refs/tags/${tag}`);
    if (matches.length > 1) throw new Error(`Duplicate tag refs for ${tag}.`);
    if (!matches.length) return undefined;
    let object: unknown = (matches[0] as Record<string, unknown>).object;
    for (let depth = 0; depth < 8; depth += 1) {
      if (!record(object) || typeof object.sha !== "string" || !/^[0-9a-f]{40}$/.test(object.sha)) throw new Error(`Invalid Git object for tag ${tag}.`);
      if (object.type === "commit") return object.sha;
      if (object.type !== "tag") throw new Error(`Tag ${tag} does not identify a commit.`);
      const tagged = this.json("GET", `${prefix}/git/tags/${object.sha}`);
      if (!record(tagged)) throw new Error(`Malformed annotated tag ${tag}.`);
      object = tagged.object;
    }
    throw new Error(`Tag ${tag} exceeds the annotated-tag depth limit.`);
  }

  private sourceIdentity(sha: string, title: string): NightlyIdentity {
    const manifest = parse(encoder.encode(this.git(["show", `${sha}:packages/cli/package.json`])));
    if (!record(manifest) || manifest.name !== "lattice-studio" || typeof manifest.version !== "string") throw new Error("Invalid source CLI manifest.");
    return { sha, tag: `nightly-${sha}`, title,
      version: createNightlyVersion(manifest.version, this.git(["show", "-s", "--format=%ct", sha]), sha) };
  }

  private fingerprints(item: Release): { actual: RemoteAsset[]; files: Map<string, Uint8Array> } {
    const entries = this.list(`${prefix}/releases/${item.id}/assets`).map(asset);
    const files = new Map<string, Uint8Array>();
    const actual = entries.map((entry) => {
      if (entry.state !== "uploaded" || files.has(entry.name)) throw new Error(`Conflicting or unfinished nightly asset: ${entry.name}.`);
      const bytes = this.request("GET", `${prefix}/releases/assets/${entry.id}`, undefined, true);
      const digest = `sha256:${sha256(bytes)}`;
      if (bytes.byteLength !== entry.size || (entry.digest !== null && entry.digest !== digest)) throw new Error(`Conflicting nightly asset bytes: ${entry.name}.`);
      files.set(entry.name, bytes);
      return { name: entry.name, size: entry.size, state: entry.state, digest };
    });
    return { actual, files };
  }

  private validateFiles(identity: NightlyIdentity, files: ReadonlyMap<string, Uint8Array>): void {
    const tarball = `lattice-studio-${identity.version}.tgz`;
    const bytes = files.get(tarball);
    const metadata = files.get("nightly.json");
    const sums = files.get("SHA256SUMS");
    if (files.size !== 3 || !bytes || !metadata || !sums) throw new Error("Nightly requires the exact package, metadata and checksum assets.");
    const catalog = parse(encoder.encode(this.git(["show", `${identity.sha}:catalog/manifest.json`])));
    if (Buffer.from(metadata).toString() !== nightlyMetadata(identity, catalog, bytes)
        || Buffer.from(sums).toString() !== checksumManifest(new Map([[tarball, bytes], ["nightly.json", metadata]]))) {
      throw new Error("Nightly metadata or checksums do not match the source and package bytes.");
    }
  }

  private validateRelease(item: Release, identity: NightlyIdentity): void {
    if (item.tag_name !== identity.tag || !item.prerelease || !/^Nightly \(\d{4}-\d{2}-\d{2}\)$/.test(item.name)) throw new Error("Conflicting nightly release identity or type.");
    const commit = this.tagCommit(identity.tag);
    if ((commit !== undefined && commit !== identity.sha) || (!commit && (!item.draft || item.target_commitish !== identity.sha))) {
      throw new Error(`Conflicting nightly tag target: ${identity.tag}.`);
    }
    if (item.draft && !item.body.includes(`<!-- lattice-studio-nightly:${identity.sha} -->`)) throw new Error("The existing draft is not a recognized nightly draft.");
  }

  private verifyPublished(item: Release, identity: NightlyIdentity): Outcome {
    this.validateRelease(item, identity);
    if (item.draft || !item.published_at) throw new Error("Nightly publication is not confirmed.");
    const { files } = this.fingerprints(item);
    this.validateFiles(identity, files);
    return { published: true, superseded: false, release_url: item.html_url, immutable: item.immutable };
  }

  private history(releases: readonly Release[], identity: NightlyIdentity): { previousTag?: string; supersedingTag?: string } {
    if (this.git(["rev-parse", "--is-shallow-repository"]) !== "false") throw new Error("Nightly changelog requires complete Git history.");
    const history = selectHistory(releases, identity.sha, (tag) => this.tagCommit(tag), (ancestor, descendant) => {
      if (this.git(["merge-base", ancestor, descendant]) !== ancestor) return undefined;
      const count = this.git(["rev-list", "--count", `${ancestor}..${descendant}`]);
      if (!/^\d+$/.test(count) || !Number.isSafeInteger(Number(count))) throw new Error("Invalid Git ancestry distance.");
      return Number(count);
    });
    if (history.supersedingTag) {
      const newer = this.find(releases, history.supersedingTag);
      if (!newer) throw new Error("Missing superseding nightly metadata.");
      this.verifyPublished(newer, this.sourceIdentity(history.supersedingTag.slice(8), newer.name));
    }
    return history;
  }

  inspect(identity: NightlyIdentity): Outcome {
    const releases = this.releases();
    const existing = this.find(releases, identity.tag);
    if (existing && !existing.draft) return this.verifyPublished(existing, identity);
    const { supersedingTag } = this.history(releases, identity);
    return { published: false, superseded: Boolean(supersedingTag), release_url: supersedingTag ? `${web}/releases/tag/${supersedingTag}` : "" };
  }

  runMetadata(runId: string): unknown {
    return this.json("GET", `${prefix}/actions/runs/${runId}`);
  }

  private notes(identity: NightlyIdentity, previousTag: string | undefined, runId: string, files: ReadonlyMap<string, Uint8Array>): string {
    let changes: string;
    if (previousTag) {
      const value = this.json("POST", `${prefix}/releases/generate-notes`, { tag_name: identity.tag, target_commitish: identity.sha, previous_tag_name: previousTag });
      if (!record(value) || typeof value.body !== "string") throw new Error("GitHub returned malformed generated notes.");
      changes = value.body;
    } else {
      const escape = (text: string) => text.replace(/[\\`*_{}[\]()<>!|]/g, "\\$&");
      const entries = this.git(["log", "--reverse", "--format=%H%x00%s%x00%an", identity.sha]).split("\n").filter(Boolean).map((line) => {
        const [sha, subject, author, extra] = line.split("\0");
        if (!sha || !/^[0-9a-f]{40}$/.test(sha) || subject === undefined || author === undefined || extra !== undefined) throw new Error("Invalid initial changelog entry.");
        return `- ${escape(subject)} by ${escape(author)} ([${sha.slice(0, 7)}](${web}/commit/${sha}))`;
      });
      changes = `Initial nightly: all reachable commits, including the initial commit.\n\n${entries.join("\n")}`;
    }
    const metadata = parse(files.get("nightly.json") ?? new Uint8Array());
    if (!record(metadata) || !record(metadata.catalog)) throw new Error("Missing nightly catalog metadata.");
    return [`<!-- lattice-studio-nightly:${identity.sha} -->`, identity.title, "", `Source: [${identity.sha}](${web}/commit/${identity.sha}) · [Full CI](${web}/actions/runs/${runId})`,
      `CLI version: \`${identity.version}\`. Requires Node 22 or later.`, `Catalog: \`${String(metadata.catalog.id)}\`, hash \`${String(metadata.catalog.hash)}\`, Lattice \`${String(metadata.catalog.latticeCommit)}\`.`, "",
      "Download the CLI package and SHA256SUMS from Assets, then verify with `sha256sum --check SHA256SUMS` (or `shasum -a 256 --check SHA256SUMS` on macOS). Download nightly.json too: SHA256SUMS covers both files.",
      `Install the downloaded package with \`npm install --global ./lattice-studio-${identity.version}.tgz\`. Installation may resolve declared registry dependencies.`,
      "The GitHub download is available immediately. npm `lattice-studio@dev` updates only after separate npm approval; this release does not publish a GitHub Packages mirror.", "", changes, ""].join("\n");
  }

  publish(identity: NightlyIdentity, files: ReadonlyMap<string, Uint8Array>, directory: string, runId: string): Outcome {
    this.validateFiles(identity, files);
    let releases = this.releases();
    let item = this.find(releases, identity.tag);
    if (item && !item.draft) return this.verifyPublished(item, identity);
    const history = this.history(releases, identity);
    if (history.supersedingTag) return { published: false, superseded: true, release_url: `${web}/releases/tag/${history.supersedingTag}` };
    const target = this.tagCommit(identity.tag);
    if (target !== undefined && target !== identity.sha) throw new Error("Conflicting nightly tag target.");
    if (!item) {
      const body = this.notes(identity, history.previousTag, runId, files);
      try {
        this.json("POST", `${prefix}/releases`, { tag_name: identity.tag, target_commitish: identity.sha, name: identity.title, body, draft: true, prerelease: true, make_latest: "false" });
      } catch { /* A failed response can follow successful creation; the authoritative reread decides. */ }
      releases = this.releases();
      item = this.find(releases, identity.tag);
      if (!item) throw new Error(`Nightly draft creation was not confirmed for ${identity.tag}.`);
    }
    this.validateRelease(item, identity);
    if (!item.draft) return this.verifyPublished(item, identity);
    const expected = [...files].map(([name, bytes]) => ({ name, size: bytes.byteLength, digest: `sha256:${sha256(bytes)}` }));
    const missing = missingAssets(expected, this.fingerprints(item).actual);
    if (missing.length) {
      try { this.run(["release", "upload", identity.tag, ...missing.map((name) => join(directory, name)), "--repo", NIGHTLY_REPOSITORY]); }
      catch { /* Read server state after an uncertain upload instead of retrying it. */ }
    }
    item = release(this.json("GET", `${prefix}/releases/${item.id}`));
    this.validateRelease(item, identity);
    if (!item.draft) return this.verifyPublished(item, identity);
    if (missingAssets(expected, this.fingerprints(item).actual).length) throw new Error(`Nightly uploads are incomplete for ${identity.tag}; rerun to resume the draft.`);
    try { this.json("PATCH", `${prefix}/releases/${item.id}`, { draft: false, prerelease: true, make_latest: "false" }); }
    catch { /* A lost publication response is resolved by reading the release and its tag. */ }
    return this.verifyPublished(release(this.json("GET", `${prefix}/releases/${item.id}`)), identity);
  }
}

function readJson(path: string): unknown {
  return parse(readFileSync(path));
}
function main(): void {
  const mode = process.argv[2];
  if ((mode !== "inspect" && mode !== "publish") || process.argv.length !== 3) throw new Error("Usage: bun scripts/ci/github-nightly.ts <inspect|publish>.");
  const git: GitReader = (args) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(`Git ${args[0]} failed while checking nightly source history.`);
    return result.stdout.toString().trim();
  };
  const run: GitHubRunner = (args, input) => {
    const result = Bun.spawnSync(["gh", ...args], { cwd: root, stdin: input, stdout: "pipe", stderr: "pipe" });
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr.toString() };
  };
  const temp = process.env.RUNNER_TEMP;
  if (!temp || !isAbsolute(temp) || !process.env.GITHUB_EVENT_PATH) throw new Error("Absolute RUNNER_TEMP and GITHUB_EVENT_PATH are required.");
  const runId = validateDispatch(process.env, readJson(process.env.GITHUB_EVENT_PATH), git(["rev-parse", "HEAD"]));
  const github = new NightlyGithub(run, git);
  const contextPath = join(temp, "github-nightly-context.json");
  let createdAt: string;
  let saved: unknown;
  if (mode === "inspect") createdAt = validateRunMetadata(github.runMetadata(runId), runId, process.env.GITHUB_SHA ?? "");
  else {
    saved = readJson(contextPath);
    if (!record(saved) || saved.runId !== runId || typeof saved.createdAt !== "string") throw new Error("Nightly run context does not match this CI run.");
    createdAt = saved.createdAt;
  }
  const manifest = readJson(join(root, "packages", "cli", "package.json"));
  if (!record(manifest) || manifest.name !== "lattice-studio" || typeof manifest.version !== "string") throw new Error("Invalid checked-out CLI manifest.");
  const identity = nightlyIdentity({ repository: process.env.GITHUB_REPOSITORY, eventName: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA, head: git(["rev-parse", "HEAD"]) }, manifest.version, git(["show", "-s", "--format=%ct", "HEAD"]), createdAt);
  let outcome: Outcome;
  if (mode === "inspect") {
    const context: RunContext = { runId, createdAt, identity };
    writeFileSync(contextPath, `${JSON.stringify(context)}\n`);
    outcome = github.inspect(identity);
    const output = process.env.GITHUB_OUTPUT;
    if (!output) throw new Error("GITHUB_OUTPUT is required for nightly inspection.");
    appendFileSync(output, `published=${outcome.published}\nsuperseded=${outcome.superseded}\nversion=${identity.version}\nrelease_url=${outcome.release_url}\n`);
  } else {
    if (!record(saved) || JSON.stringify(saved.identity) !== JSON.stringify(identity) || process.env.NIGHTLY_VERSION !== identity.version) throw new Error("Nightly source, saved identity and requested version differ.");
    const directory = join(temp, "github-nightly-assets");
    const files = new Map(readdirSync(directory).map((name) => [name, readFileSync(join(directory, name))]));
    outcome = github.publish(identity, files, directory, runId);
  }
  const message = outcome.published ? `Verified ${outcome.release_url}${outcome.immutable === undefined ? "" : `; immutable=${outcome.immutable}`}.`
    : outcome.superseded ? `Skipped superseded ${identity.tag}; newer release: ${outcome.release_url}.` : `Prepared ${identity.version} for GitHub nightly packaging.`;
  console.log(`github-nightly · ${message}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### GitHub nightly\n\n${message}\n`);
}

if (import.meta.main) {
  try { main(); } catch (error) {
    console.error(`github-nightly · ${error instanceof Error ? error.message : "The nightly command failed."}`);
    process.exitCode = 1;
  }
}
