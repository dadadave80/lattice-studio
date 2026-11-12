import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  prepareMirrorManifest,
  publishMirror,
  validateMirrorVersion,
  validatePreparedMirror,
  verifyPublishedSource,
  verifyPublishedSourceSignature,
  type PreparedMirror,
} from "./mirror-cli-package.ts";
import type { CommandResult, NpmRunner } from "./dev-nightly.ts";

const sha = "a08c041a7397dd20efae60c985150cdbef4d1701";
const version = `0.2.0-dev.1794452361.g${sha}`;
const archive = Buffer.from("the already approved CLI archive");
const hex = createHash("sha512").update(archive).digest("hex");
const integrity = `sha512-${Buffer.from(hex, "hex").toString("base64")}`;
const repository = { type: "git", url: "git+https://github.com/dadadave80/lattice-studio.git", directory: "packages/cli" };

function fixtureSource(selected = version) {
  const nightly = selected.includes("-dev.");
  return {
    metadata: {
      name: "lattice-studio", version: selected, repository,
      dist: { integrity, tarball: `https://registry.npmjs.org/lattice-studio/-/lattice-studio-${selected}.tgz`, attestations: { url: `https://registry.npmjs.org/-/npm/v1/attestations/lattice-studio@${selected}` } },
    },
    statement: {
      subject: [{ name: `pkg:npm/lattice-studio@${selected}`, digest: { sha512: hex } }],
      predicate: { buildDefinition: {
        externalParameters: { workflow: { repository: "https://github.com/dadadave80/lattice-studio", ref: nightly ? "refs/heads/dev" : `refs/tags/lattice-studio-v${selected}`, path: nightly ? ".github/workflows/ci.yml" : ".github/workflows/publish-cli.yml" } },
        resolvedDependencies: [{ uri: `git+https://github.com/dadadave80/lattice-studio@${nightly ? "refs/heads/dev" : `refs/tags/lattice-studio-v${selected}`}`, digest: { gitCommit: sha } }],
      } },
    },
  };
}

function attestations(statement: unknown): unknown {
  return { attestations: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString("base64") } } }] };
}

function ok(value: unknown): CommandResult {
  return { exitCode: 0, stdout: JSON.stringify(value), stderr: "" };
}
const absent: CommandResult = { exitCode: 1, stdout: '{"error":{"code":"E404"}}', stderr: "" };
const prepared: PreparedMirror = { version, tag: "dev", sourceSha: sha, tarball: `/runner/temp/github-cli-package/dadadave80-lattice-studio-${version}.tgz`, integrity };

function runner(results: CommandResult[]): { run: NpmRunner; calls: string[][] } {
  const calls: string[][] = [];
  return { calls, run(args) { calls.push([...args]); const result = results[calls.length - 1]; if (!result) throw new Error("Unexpected fixture npm command"); return result; } };
}

describe("approved npm source", () => {
  test("accepts only exact stable versions or deterministic dev versions", () => {
    expect(validateMirrorVersion(version)).toEqual({ tag: "dev", sha });
    expect(validateMirrorVersion("0.2.1")).toEqual({ tag: "latest" });
    for (const invalid of [undefined, "dev", "latest", "v0.2.0", "01.2.0", "0.0.0-stage", "0.2.0-rc.1", `${version}\n`, "0.2.0-dev.01.g" + sha]) expect(() => validateMirrorVersion(invalid)).toThrow();
  });

  test("matches the approved archive to npm integrity, provenance and the tested dev SHA", () => {
    const { metadata, statement } = fixtureSource();
    expect(verifyPublishedSource(version, metadata, attestations(statement), archive)).toEqual({ sourceSha: sha, integrity, tag: "dev" });
    const stable = fixtureSource("0.2.1");
    expect(verifyPublishedSource("0.2.1", stable.metadata, attestations(stable.statement), archive)).toEqual({ sourceSha: sha, integrity, tag: "latest" });
  });

  test("fails closed on a different package, repository, tarball or digest", () => {
    const { metadata, statement } = fixtureSource();
    for (const changed of [
      { ...metadata, name: "other" },
      { ...metadata, version: "0.2.0" },
      { ...metadata, repository: { ...repository, url: "https://github.com/other/repo" } },
      { ...metadata, dist: { ...metadata.dist, tarball: "https://example.com/package.tgz" } },
      { ...metadata, dist: { ...metadata.dist, integrity: "sha512-wrong" } },
    ]) expect(() => verifyPublishedSource(version, changed, attestations(statement), archive)).toThrow();
    expect(() => verifyPublishedSource(version, metadata, attestations(statement), Buffer.from("changed"))).toThrow();
  });

  test("rejects absent, unrelated, malformed or mismatched source provenance", () => {
    const { metadata, statement } = fixtureSource();
    for (const changed of [
      null,
      { ...statement, subject: [{ name: "pkg:npm/other@1", digest: { sha512: hex } }] },
      { ...statement, subject: [{ name: `pkg:npm/lattice-studio@${version}`, digest: { sha512: "wrong" } }] },
      { ...statement, predicate: { buildDefinition: { ...statement.predicate.buildDefinition, resolvedDependencies: [{ uri: "git+https://github.com/other/repo@refs/heads/dev", digest: { gitCommit: sha } }] } } },
      { ...statement, predicate: { buildDefinition: { ...statement.predicate.buildDefinition, resolvedDependencies: [{ uri: "git+https://github.com/dadadave80/lattice-studio@refs/heads/dev", digest: { gitCommit: "b".repeat(40) } }] } } },
      { ...statement, predicate: { buildDefinition: { ...statement.predicate.buildDefinition, externalParameters: { workflow: { repository: "https://github.com/dadadave80/lattice-studio", ref: "refs/heads/main", path: ".github/workflows/ci.yml" } } } } },
    ]) expect(() => verifyPublishedSource(version, metadata, attestations(changed), archive)).toThrow();
    expect(() => verifyPublishedSource(version, metadata, { attestations: [] }, archive)).toThrow();
    expect(() => verifyPublishedSource(version, metadata, { attestations: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: "bad" } } }] }, archive)).toThrow();
  });

  test("renames only the manifest identity and target registry", () => {
    const manifest = { name: "lattice-studio", version, repository, bin: { "lattice-studio": "./dist/main.js" }, files: ["dist", "README.md"], dependencies: { viem: "^2.56.8" } };
    expect(prepareMirrorManifest(manifest, version)).toEqual({ ...manifest, name: "@dadadave80/lattice-studio", publishConfig: { registry: "https://npm.pkg.github.com/" } });
    expect(manifest.name).toBe("lattice-studio");
    for (const invalid of [null, { ...manifest, private: true }, { ...manifest, dependencies: { core: "workspace:*" } }, { ...manifest, version: "0.2.0" }]) expect(() => prepareMirrorManifest(invalid, version)).toThrow();
  });

  test("verifies the signed bundle against GitHub's issuer and the reusable nightly identity", async () => {
    const source = attestations(fixtureSource().statement);
    const calls: unknown[] = [];
    await verifyPublishedSourceSignature(version, source, "/runner/temp", async (bundle, options) => { calls.push({ bundle, options }); });
    expect(calls).toEqual([{
      bundle: (source as { attestations: { bundle: unknown }[] }).attestations[0]?.bundle,
      options: {
        certificateIssuer: "https://token.actions.githubusercontent.com",
        certificateIdentityURI: "https://github.com/dadadave80/lattice-studio/.github/workflows/dev-nightly.yml@refs/heads/dev",
        tufCachePath: "/runner/temp/sigstore-cache",
      },
    }]);
  });

  test("verifies stable signatures against the matching release tag and fails closed on verifier rejection", async () => {
    const source = attestations(fixtureSource("0.2.1").statement);
    await verifyPublishedSourceSignature("0.2.1", source, "/runner/temp", async (_bundle, options) => {
      expect(options.certificateIdentityURI).toBe("https://github.com/dadadave80/lattice-studio/.github/workflows/publish-cli.yml@refs/tags/lattice-studio-v0.2.1");
    });
    await expect(verifyPublishedSourceSignature(version, source, "/runner/temp", async () => { throw new Error("Invalid signature"); })).rejects.toThrow("signature");
  });
});

describe("prepared GitHub mirror", () => {
  test("checks the prepared version, tag, commit, integrity and exact temp artifact path", () => {
    expect(validatePreparedMirror(prepared, version, "/runner/temp", prepared.tarball)).toEqual(prepared);
    for (const changed of [null, { ...prepared, version: "0.2.0" }, { ...prepared, tag: "latest" }, { ...prepared, sourceSha: "b".repeat(40) }, { ...prepared, integrity: "bad" }, { ...prepared, tarball: "/outside/archive.tgz" }]) expect(() => validatePreparedMirror(changed, version, "/runner/temp", prepared.tarball)).toThrow();
    expect(() => validatePreparedMirror(prepared, version, "/runner/temp", "/other.tgz")).toThrow();
  });

  test("skips an exact already-published GitHub artifact", () => {
    const { run, calls } = runner([ok({ integrity })]);
    expect(publishMirror(prepared, run)).toBe("already published");
    expect(calls).toEqual([["view", `@dadadave80/lattice-studio@${version}`, "dist", "--json", "--registry", "https://npm.pkg.github.com/"]]);
  });

  test("downloads and hashes the exact target when GitHub omits dist.integrity", () => {
    const { run, calls } = runner([ok({ tarball: "https://npm.pkg.github.com/download/approved" }), ok([{ name: "@dadadave80/lattice-studio", version, integrity }])]);
    expect(publishMirror(prepared, run)).toBe("already published");
    expect(calls[1]).toEqual(["pack", `@dadadave80/lattice-studio@${version}`, "--registry", "https://npm.pkg.github.com/", "--ignore-scripts", "--json", "--pack-destination", "/runner/temp/github-cli-package/registry-verification"]);
  });

  test("publishes only the scoped tarball to GitHub, then verifies its integrity", () => {
    const { run, calls } = runner([absent, ok({}), ok({ integrity })]);
    expect(publishMirror(prepared, run)).toBe("published");
    expect(calls[1]).toEqual(["publish", prepared.tarball, "--registry", "https://npm.pkg.github.com/", "--tag", "dev", "--ignore-scripts", "--provenance=false", "--json"]);
  });

  test("recovers an interrupted response only after matching registry confirmation", () => {
    const { run, calls } = runner([absent, { exitCode: 1, stdout: "", stderr: "response lost" }, ok({ integrity })]);
    expect(publishMirror(prepared, run)).toBe("published");
    expect(calls.filter(call => call[0] === "publish")).toHaveLength(1);
  });

  test("fails closed on auth, malformed response, mismatched immutable version or unconfirmed upload", () => {
    for (const result of [ok({ integrity: "sha512-other" }), ok(null), ok({}), { exitCode: 1, stdout: '{"error":{"code":"E401"}}', stderr: "" }, { exitCode: 1, stdout: "", stderr: "E404" }]) {
      const { run, calls } = runner([result]);
      expect(() => publishMirror(prepared, run)).toThrow();
      expect(calls).toHaveLength(1);
    }
    const { run } = runner([absent, ok({}), absent]);
    expect(() => publishMirror(prepared, run)).toThrow("not confirmed");
  });

  test("rejects malformed, mismatched or failed target archive downloads", () => {
    for (const result of [ok([{ name: "other", version, integrity }]), ok([{ name: "@dadadave80/lattice-studio", version: "0.2.0", integrity }]), ok([]), { exitCode: 1, stdout: "", stderr: "private" }]) {
      const { run, calls } = runner([ok({ tarball: "https://npm.pkg.github.com/download/approved" }), result]);
      expect(() => publishMirror(prepared, run)).toThrow();
      expect(calls.filter(call => call[0] === "publish")).toEqual([]);
    }
  });
});
