import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checksumManifest, nightlyMetadata, sha256, type NightlyIdentity } from "./github-nightly-policy.ts";
import { NightlyGithub, validateDispatch, validateRunMetadata, type GitHubRunner } from "./github-nightly.ts";

const sha = "a".repeat(40);
const identity: NightlyIdentity = { sha, tag: `nightly-${sha}`, title: "Nightly (2026-11-12)", version: `0.2.0-dev.1794446400.g${sha}` };
const repo = "dadadave80/lattice-studio";
const catalog = { default: "v0.5.0", catalogs: [{ id: "v0.5.0", hash: `0x${"b".repeat(64)}`, commit: "c".repeat(40) }] };
const payload = new TextEncoder().encode("fixture package");
const metadata = new TextEncoder().encode(nightlyMetadata(identity, catalog, payload));
const files = new Map([[`lattice-studio-${identity.version}.tgz`, payload], ["nightly.json", metadata]]);
files.set("SHA256SUMS", new TextEncoder().encode(checksumManifest(files)));

function fixture(options: { existing?: "published" | "draft"; missing?: string[]; corrupt?: string; tag?: string | null; ambiguous?: string; starter?: boolean;
  target?: string; extra?: boolean; digestNull?: boolean; uploadIncomplete?: boolean; createMissing?: boolean; publishPending?: boolean;
  htmlUrl?: string; publishedDuringUpload?: boolean } = {}) {
  const calls: { argv: readonly string[]; body?: unknown }[] = [];
  let draft = options.existing === "draft";
  let exists = options.existing !== undefined;
  let tag: string | null = options.tag === undefined ? (exists && !draft ? sha : null) : options.tag;
  const assets = new Map([...files].filter(([name]) => !(options.missing ?? (exists ? [] : [...files.keys()])).includes(name)));
  if (options.extra) assets.set("extra.txt", payload);
  const release = () => ({ id: 12, tag_name: identity.tag, target_commitish: options.target ?? sha, name: identity.title,
    body: `<!-- lattice-studio-nightly:${sha} -->\n${identity.version}`, draft, prerelease: true, immutable: !draft,
    published_at: draft ? null : "2026-11-12T04:00:00Z", html_url: options.htmlUrl ?? `https://github.com/${repo}/releases/tag/${identity.tag}` });
  const assetList = () => [...assets].map(([name, bytes], i) => ({ id: i + 1, name, size: bytes.byteLength,
    state: options.starter ? "starter" : "uploaded", digest: options.digestNull ? null : `sha256:${sha256(bytes)}` }));
  const response = (value: unknown, status = 200, binary = false) => ({ exitCode: status >= 400 ? 1 : 0,
    stdout: Buffer.concat([Buffer.from(`HTTP/2.0 ${status} Status\r\ncontent-type: ${binary ? "application/octet-stream" : "application/json"}\r\n\r\n`),
      binary ? Buffer.from(value as Uint8Array) : Buffer.from(JSON.stringify(value))]), stderr: "" });
  const run: GitHubRunner = (argv, input) => {
    const body: unknown = input ? JSON.parse(Buffer.from(input).toString()) : undefined;
    calls.push({ argv, ...(body === undefined ? {} : { body }) });
    if (argv[0] === "release") {
      for (const path of argv.slice(3).filter((value) => value.startsWith("/assets/"))) {
        const name = path.slice("/assets/".length);
        const bytes = files.get(name);
        if (!bytes) throw new Error(`Unexpected upload ${name}`);
        if (!options.uploadIncomplete) assets.set(name, bytes);
      }
      if (options.publishedDuringUpload) { draft = false; tag = sha; }
      return { exitCode: options.ambiguous === "upload" ? 1 : 0, stdout: new Uint8Array(), stderr: "lost response" };
    }
    const method = argv[argv.indexOf("--method") + 1];
    const endpoint = argv[1];
    if (endpoint?.includes("git/matching-refs/")) return response(tag ? [{ ref: `refs/tags/${identity.tag}`, object: { type: "commit", sha: tag } }] : []);
    if (endpoint?.endsWith("releases?per_page=100&page=1")) return response(exists ? [release()] : []);
    if (endpoint?.endsWith("releases/12/assets?per_page=100&page=1")) return response(assetList());
    if (endpoint?.includes("releases/assets/")) {
      const id = Number(endpoint.split("/").at(-1));
      const entry = [...assets][id - 1];
      if (!entry) throw new Error("Missing asset");
      return response(options.corrupt === entry[0] ? new Uint8Array([0]) : entry[1], 200, true);
    }
    if (endpoint?.endsWith("/releases") && method === "POST") {
      exists = !options.createMissing; draft = true;
      return options.ambiguous === "create" ? response({ message: "lost" }, 500) : response(release(), 201);
    }
    if (endpoint?.endsWith("/releases/12") && method === "PATCH") {
      draft = options.publishPending ?? false; tag = options.publishPending ? null : sha;
      return options.ambiguous === "publish" ? response({ message: "lost" }, 500) : response(release());
    }
    if (endpoint?.endsWith("/releases/12")) return response(release());
    throw new Error(`Unexpected call: ${argv.join(" ")}`);
  };
  const git = (args: readonly string[]) => {
    if (args[0] === "show" && args[1]?.endsWith(":catalog/manifest.json")) return JSON.stringify(catalog);
    if (args[0] === "show" && args[1]?.endsWith(":packages/cli/package.json")) return JSON.stringify({ name: "lattice-studio", version: "0.2.0" });
    if (args[0] === "show" && args.includes("--format=%ct")) return "1794446400";
    if (args[0] === "rev-parse") return "false";
    if (args[0] === "log") return `${sha}\0Initial feature\0David`;
    throw new Error(`Unexpected Git: ${args.join(" ")}`);
  };
  return { github: new NightlyGithub(run, git), calls, files, run, git, response, release };
}

describe("nightly source boundary", () => {
  const env = { GITHUB_REPOSITORY: repo, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/dev", GITHUB_SHA: sha, GITHUB_RUN_ID: "42" };
  test("requires explicit release intent and rejects diagnostics or wrong source", () => {
    expect(validateDispatch(env, { inputs: { release_dev_nightly: "true", browser_diagnostics: "false" } }, sha)).toBe("42");
    for (const event of [{}, { inputs: { release_dev_nightly: false } }, { inputs: { release_dev_nightly: true, browser_diagnostics: true } }, { inputs: { release_dev_nightly: "true", browser_diagnostics: "garbage" } }]) {
      expect(() => validateDispatch(env, event, sha)).toThrow();
    }
    for (const patch of [{ GITHUB_REPOSITORY: "someone/fork" }, { GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_REF: "refs/heads/main" }, { GITHUB_SHA: "bad" }, { GITHUB_RUN_ID: "42\ninvalid" }]) {
      expect(() => validateDispatch({ ...env, ...patch }, { inputs: { release_dev_nightly: true } }, sha)).toThrow();
    }
  });
  test("run metadata must describe the same full CI dispatch", () => {
    const run = { id: 42, event: "workflow_dispatch", head_branch: "dev", head_sha: sha, path: ".github/workflows/ci.yml", created_at: "2026-11-12T03:17:00Z", repository: { full_name: repo } };
    expect(validateRunMetadata(run, "42", sha)).toBe(run.created_at);
    for (const patch of [{ id: 43 }, { head_sha: "b".repeat(40) }, { path: ".github/workflows/other.yml" }, { event: "pull_request" }, { repository: { full_name: "someone/fork" } }]) {
      expect(() => validateRunMetadata({ ...run, ...patch }, "42", sha)).toThrow();
    }
  });
});

describe("nightly publication state", () => {
  test("verified published release is read-only and skips rebuilding", () => {
    const { github, calls } = fixture({ existing: "published" });
    expect(github.inspect(identity)).toMatchObject({ published: true, superseded: false });
    expect(calls.every(({ argv }) => argv[0] === "api" && argv[argv.indexOf("--method") + 1] === "GET")).toBe(true);
  });
  test("an invisible draft is not inferred absent; App-mode publication resumes it", () => {
    const { github, calls } = fixture({ existing: "draft", missing: ["SHA256SUMS"] });
    expect(github.inspect(identity)).toMatchObject({ published: false });
    github.publish(identity, files, "/assets", "42");
    const uploads = calls.filter(({ argv }) => argv[0] === "release");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.argv).toContain("/assets/SHA256SUMS");
    expect(uploads[0]?.argv.join(" ")).not.toContain("--clobber");
    expect(calls.some(({ argv, body }) => argv.includes("PATCH") && JSON.stringify(body) === JSON.stringify({ draft: false, prerelease: true, make_latest: "false" }))).toBe(true);
  });
  for (const ambiguous of ["create", "upload", "publish"]) {
    test(`lost ${ambiguous} response is confirmed by rereading state`, () => {
      const { github, calls } = fixture({ ambiguous });
      expect(github.publish(identity, files, "/assets", "42")).toMatchObject({ published: true });
      expect(calls.filter(({ argv }) => argv[0] === "release")).toHaveLength(1);
      expect(calls.filter(({ argv }) => argv[1]?.endsWith("/releases") && argv.includes("POST"))).toHaveLength(1);
    });
  }
  test("a complete draft publishes without uploading again", () => {
    const { github, calls } = fixture({ existing: "draft" });
    github.publish(identity, files, "/assets", "42");
    expect(calls.some(({ argv }) => argv[0] === "release")).toBe(false);
  });
  test("concurrent completed publication is verified without another PATCH", () => {
    const { github, calls } = fixture({ existing: "draft", missing: ["SHA256SUMS"], publishedDuringUpload: true });
    expect(github.publish(identity, files, "/assets", "42").published).toBe(true);
    expect(calls.filter(({ argv }) => argv.includes("PATCH"))).toHaveLength(0);
  });
  test("release URLs cannot inject workflow outputs or leave the expected repository", () => {
    for (const htmlUrl of [`https://github.com/${repo}/releases/tag/x\npublished=true`, `https://github.com/${repo}/releases/../other`, `https://github.com/${repo}/releases/tag/x?redirect=bad`, "https://example.com/releases/tag/x"]) {
      expect(() => fixture({ existing: "published", htmlUrl }).github.inspect(identity)).toThrow();
    }
  });
  test("missing server digests are verified from the downloaded bytes", () => {
    const { github } = fixture({ existing: "published", digestNull: true });
    expect(github.inspect(identity).published).toBe(true);
  });
  test("an unexpected extra asset is a conflict", () => {
    const { github } = fixture({ existing: "published", extra: true });
    expect(() => github.inspect(identity)).toThrow();
  });
  test("drafts without a Git ref still require the exact target commit", () => {
    const { github, calls } = fixture({ existing: "draft", target: "b".repeat(40) });
    expect(() => github.publish(identity, files, "/assets", "42")).toThrow("tag");
    expect(calls.every(({ argv }) => argv[argv.indexOf("--method") + 1] === "GET")).toBe(true);
  });
  test("an unconfirmed create or upload is not retried or published", () => {
    for (const options of [{ createMissing: true }, { uploadIncomplete: true }]) {
      const { github, calls } = fixture(options);
      expect(() => github.publish(identity, files, "/assets", "42")).toThrow();
      expect(calls.filter(({ argv }) => argv.includes("PATCH"))).toHaveLength(0);
      expect(calls.filter(({ argv }) => argv[1]?.endsWith("/releases") && argv.includes("POST"))).toHaveLength(1);
    }
  });
  test("a publication that remains draft fails without another PATCH", () => {
    const { github, calls } = fixture({ existing: "draft", publishPending: true });
    expect(() => github.publish(identity, files, "/assets", "42")).toThrow("not confirmed");
    expect(calls.filter(({ argv }) => argv.includes("PATCH"))).toHaveLength(1);
  });
  test("annotated tags are peeled and cycles are bounded", () => {
    for (const cycle of [false, true]) {
      const f = fixture({ existing: "published" });
      const run: GitHubRunner = (args, input) => {
        if (args[1]?.includes("git/matching-refs/")) return f.response([{ ref: `refs/tags/${identity.tag}`, object: { type: "tag", sha: "b".repeat(40) } }]);
        if (args[1]?.includes("git/tags/")) return f.response({ object: { type: cycle ? "tag" : "commit", sha: cycle ? "b".repeat(40) : sha } });
        return f.run(args, input);
      };
      const github = new NightlyGithub(run, f.git);
      if (cycle) expect(() => github.inspect(identity)).toThrow("depth");
      else expect(github.inspect(identity).published).toBe(true);
    }
  });
  test("public inspection follows release pagination", () => {
    const f = fixture({ existing: "published" });
    let secondPage = false;
    const run: GitHubRunner = (args, input) => {
      if (args[1]?.endsWith("releases?per_page=100&page=1")) {
        return f.response(Array.from({ length: 100 }, (_, i) => ({ ...f.release(), id: i + 100, tag_name: `lattice-studio-app-v0.0.${i}`, prerelease: false })));
      }
      if (args[1]?.endsWith("releases?per_page=100&page=2")) {
        secondPage = true;
        return f.response([f.release()]);
      }
      return f.run(args, input);
    };
    expect(new NightlyGithub(run, f.git).inspect(identity).published).toBe(true);
    expect(secondPage).toBe(true);
  });
  test("duplicate matching releases fail rather than choosing a draft", () => {
    const f = fixture({ existing: "draft" });
    const run: GitHubRunner = (args, input) => args[1]?.endsWith("releases?per_page=100&page=1")
      ? f.response([f.release(), f.release()]) : f.run(args, input);
    expect(() => new NightlyGithub(run, f.git).publish(identity, files, "/assets", "42")).toThrow("Duplicate");
  });
  test("a prior CLI release supplies the explicit generated-notes baseline", () => {
    const f = fixture();
    const old = "b".repeat(40);
    let generated: unknown;
    const ancestor = { ...f.release(), id: 41, tag_name: "lattice-studio-v0.1.0", prerelease: false, draft: false, target_commitish: old };
    const run: GitHubRunner = (args, input) => {
      if (args[1]?.endsWith("releases?per_page=100&page=1")) {
        const raw = Buffer.from(f.run(args, input).stdout).toString();
        return f.response([...(JSON.parse(raw.slice(raw.indexOf("\r\n\r\n") + 4)) as unknown[]), ancestor]);
      }
      if (args[1]?.endsWith("git/matching-refs/tags/lattice-studio-v0.1.0")) return f.response([{ ref: "refs/tags/lattice-studio-v0.1.0", object: { type: "commit", sha: old } }]);
      if (args[1]?.endsWith("releases/generate-notes")) {
        generated = JSON.parse(Buffer.from(input ?? []).toString()) as unknown;
        return f.response({ body: "## Generated changes\n\nA feature by David." });
      }
      return f.run(args, input);
    };
    const git = (args: readonly string[]) => args[0] === "merge-base" ? old : args[0] === "rev-list" ? "2" : f.git(args);
    expect(new NightlyGithub(run, git).publish(identity, files, "/assets", "42").published).toBe(true);
    expect(generated).toEqual({ tag_name: identity.tag, target_commitish: sha, previous_tag_name: "lattice-studio-v0.1.0" });
    const created = f.calls.find(({ argv }) => argv[1]?.endsWith("/releases") && argv.includes("POST"))?.body;
    expect(created).toMatchObject({ draft: true, prerelease: true, make_latest: "false" });
    expect((created as { body: string }).body).toContain("## Generated changes");
  });
  test("first nightly includes the initial commit rather than an implicit API range", () => {
    const f = fixture();
    f.github.publish(identity, files, "/assets", "42");
    const created = f.calls.find(({ argv }) => argv[1]?.endsWith("/releases") && argv.includes("POST"))?.body as { body: string };
    expect(created.body).toContain("Initial nightly: all reachable commits");
    expect(created.body).toContain(`https://github.com/${repo}/commit/${sha}`);
    expect(f.calls.some(({ argv }) => argv[1]?.endsWith("generate-notes"))).toBe(false);
  });
  test("supersession verifies the descendant's own version and catalog before skipping", () => {
    for (const wrongCatalog of [false, true]) {
      const f = fixture();
      const newerSha = "c".repeat(40);
      const newer = { sha: newerSha, tag: `nightly-${newerSha}`, title: "Nightly (2026-11-13)", version: `0.3.0-dev.1794532800.g${newerSha}` };
      const newerCatalog = { default: "v0.6.0", catalogs: [{ id: "v0.6.0", hash: `0x${"d".repeat(64)}`, commit: "e".repeat(40) }] };
      const newerFiles = new Map([[`lattice-studio-${newer.version}.tgz`, payload], ["nightly.json", new TextEncoder().encode(nightlyMetadata(newer, wrongCatalog ? catalog : newerCatalog, payload))]]);
      newerFiles.set("SHA256SUMS", new TextEncoder().encode(checksumManifest(newerFiles)));
      const item = { ...f.release(), tag_name: newer.tag, name: newer.title, target_commitish: newerSha, draft: false, published_at: "2026-11-13T04:00:00Z", html_url: `https://github.com/${repo}/releases/tag/${newer.tag}` };
      const run: GitHubRunner = (args) => {
        if (args[args.indexOf("--method") + 1] !== "GET") throw new Error("Supersession must stay read-only");
        if (args[1]?.endsWith("releases?per_page=100&page=1")) return f.response([item]);
        if (args[1]?.includes("git/matching-refs/")) return f.response([{ ref: `refs/tags/${newer.tag}`, object: { type: "commit", sha: newerSha } }]);
        if (args[1]?.endsWith("releases/12/assets?per_page=100&page=1")) return f.response([...newerFiles].map(([name, bytes], i) => ({ id: i + 1, name, size: bytes.byteLength, state: "uploaded", digest: `sha256:${sha256(bytes)}` })));
        if (args[1]?.includes("releases/assets/")) return f.response([...newerFiles.values()][Number(args[1].split("/").at(-1)) - 1], 200, true);
        throw new Error(`Unexpected supersession request: ${args.join(" ")}`);
      };
      const git = (args: readonly string[]) => {
        if (args[0] === "rev-parse") return "false";
        if (args[0] === "merge-base") return sha;
        if (args[0] === "rev-list") return "1";
        if (args[1] === `${newerSha}:packages/cli/package.json`) return JSON.stringify({ name: "lattice-studio", version: "0.3.0" });
        if (args[1] === `${newerSha}:catalog/manifest.json`) return JSON.stringify(newerCatalog);
        if (args.includes("--format=%ct") && args.at(-1) === newerSha) return "1794532800";
        throw new Error(`A superseding release must use its own Git source: ${args.join(" ")}`);
      };
      const github = new NightlyGithub(run, git);
      if (wrongCatalog) expect(() => github.inspect(identity)).toThrow("metadata");
      else expect(github.inspect(identity)).toMatchObject({ published: false, superseded: true, release_url: item.html_url });
    }
  });
  test("wrong tag, corrupt bytes and starter assets stop before writes", () => {
    for (const options of [{ tag: "b".repeat(40) }, { corrupt: "nightly.json" }, { starter: true }]) {
      const { github, calls } = fixture({ existing: "published", ...options });
      expect(() => github.inspect(identity)).toThrow();
      expect(calls.every(({ argv }) => argv[argv.indexOf("--method") + 1] === "GET")).toBe(true);
    }
  });
  test("unrecognized API failures and malformed JSON never become absence", () => {
    for (const stdout of ["HTTP/2.0 401 Unauthorized\r\n\r\n{}", "HTTP/2.0 403 Forbidden\r\n\r\n{}", "HTTP/2.0 404 Not Found\r\n\r\n{}", "HTTP/2.0 429 Rate limited\r\n\r\n{}", "HTTP/2.0 500 Failed\r\n\r\n{}", "HTTP/2.0 200 OK\r\n\r\ninvalid", "invalid"]) {
      const github = new NightlyGithub(() => ({ exitCode: 1, stdout: Buffer.from(stdout), stderr: "failure" }), () => "");
      expect(() => github.inspect(identity)).toThrow();
    }
    const invalidJson = new NightlyGithub(() => ({ exitCode: 0, stdout: Buffer.from("HTTP/2.0 200 OK\r\n\r\ninvalid"), stderr: "" }), () => "");
    expect(() => invalidJson.inspect(identity)).toThrow("malformed JSON");
  });
});

test("CLI inspection saves verified context and publication rejects a tampered handoff before GitHub", () => {
  const directory = mkdtempSync(join(tmpdir(), "studio-nightly-inspect-"));
  const root = join(import.meta.dir, "..", "..");
  try {
    const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();
    const eventPath = join(directory, "event.json");
    const output = join(directory, "output");
    const trace = join(directory, "trace");
    const fakeApi = join(directory, "api.ts");
    writeFileSync(eventPath, JSON.stringify({ inputs: { release_dev_nightly: "true", browser_diagnostics: "false" } }));
    writeFileSync(output, "");
    writeFileSync(trace, "");
    writeFileSync(join(directory, "gh"), '#!/bin/sh\nexec "$FIXTURE_BUN" "$FIXTURE_API" "$@"\n', { mode: 0o755 });
    writeFileSync(fakeApi, `
      import { appendFileSync } from "node:fs";
      const args = process.argv.slice(2);
      appendFileSync(process.env.FIXTURE_TRACE, args.join(" ") + "\\n");
      if (args[0] !== "api" || args[args.indexOf("--method") + 1] !== "GET") throw new Error("Fixture permits reads only");
      let value;
      if (args[1].endsWith("/actions/runs/42")) value = { id: 42, event: "workflow_dispatch", head_branch: "dev", head_sha: process.env.FIXTURE_SHA,
        path: ".github/workflows/ci.yml", created_at: "2026-11-12T03:17:00Z", repository: { full_name: "dadadave80/lattice-studio" } };
      else if (args[1].endsWith("/releases?per_page=100&page=1")) value = [];
      else throw new Error("Unexpected fixture endpoint");
      process.stdout.write("HTTP/2.0 200 OK\\r\\n\\r\\n" + JSON.stringify(value));
    `);
    const env = { ...process.env, PATH: `${directory}:${process.env.PATH}`, GH_TOKEN: "fixture-token", GH_REPO: repo,
      GITHUB_REPOSITORY: repo, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/dev", GITHUB_SHA: revision, GITHUB_RUN_ID: "42",
      GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(directory, "summary"), RUNNER_TEMP: directory,
      FIXTURE_BUN: process.execPath, FIXTURE_API: fakeApi, FIXTURE_SHA: revision, FIXTURE_TRACE: trace };
    const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "github-nightly.ts"), "inspect"], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(readFileSync(output, "utf8")).toContain("published=false\nsuperseded=false\nversion=");
    const contextPath = join(directory, "github-nightly-context.json");
    const context = JSON.parse(readFileSync(contextPath, "utf8")) as { runId: string; createdAt: string; identity: NightlyIdentity };
    expect(context).toMatchObject({ runId: "42", createdAt: "2026-11-12T03:17:00Z", identity: { sha: revision, tag: `nightly-${revision}`, title: "Nightly (2026-11-12)" } });
    writeFileSync(contextPath, JSON.stringify({ ...context, identity: { ...context.identity, sha: "b".repeat(40) } }));
    writeFileSync(trace, "");
    const rejected = Bun.spawnSync([process.execPath, join(import.meta.dir, "github-nightly.ts"), "publish"], {
      cwd: root, env: { ...env, NIGHTLY_VERSION: context.identity.version }, stdout: "pipe", stderr: "pipe",
    });
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr.toString()).toContain("saved identity");
    expect(readFileSync(trace, "utf8")).toBe("");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
