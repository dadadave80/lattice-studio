import { describe, expect, test } from "bun:test";
import { checksumManifest, missingAssets, nightlyIdentity, nightlyMetadata, selectHistory, sha256 } from "./github-nightly-policy.ts";

const sha = "a".repeat(40);
const source = { repository: "dadadave80/lattice-studio", eventName: "workflow_dispatch", ref: "refs/heads/dev", sha, head: sha };
const identity = { sha, tag: `nightly-${sha}`, title: "Nightly (2026-11-12)", version: `0.2.0-dev.1794446400.g${sha}` };
const catalog = { default: "v0.5.0", catalogs: [{ id: "v0.5.0", hash: `0x${"b".repeat(64)}`, commit: "c".repeat(40) }] };

describe("GitHub nightly identity", () => {
  test("uses the exact source and original UTC run creation time", () => {
    expect(nightlyIdentity(source, "0.2.0", "1794446400", "2026-11-12T23:59:00Z")).toEqual(identity);
  });
  test("rejects untrusted sources and invalid dates", () => {
    for (const override of [{ repository: "someone/fork" }, { eventName: "pull_request" }, { ref: "refs/heads/main" }, { sha: "bad" }, { head: "b".repeat(40) }]) {
      expect(() => nightlyIdentity({ ...source, ...override }, "0.2.0", "1794446400", "2026-11-12T00:00:00Z")).toThrow();
    }
    for (const date of ["bad", "2026-02-30T00:00:00Z", "2026-11-12", "2026-11-12T00:00:00+01:00"]) {
      expect(() => nightlyIdentity(source, "0.2.0", "1794446400", date)).toThrow("UTC");
    }
  });
});

describe("nightly bytes and metadata", () => {
  test("checksums sort filenames, hash bytes, and exclude themselves", () => {
    const bytes = new TextEncoder().encode("abc");
    expect(sha256(bytes)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(checksumManifest(new Map([["z.tgz", bytes], ["nightly.json", bytes]]))).toBe(`${sha256(bytes)}  nightly.json\n${sha256(bytes)}  z.tgz\n`);
    for (const name of ["SHA256SUMS", "../file", "file\nother", "file\n", "-flag"]) expect(() => checksumManifest(new Map([[name, bytes]]))).toThrow();
  });
  test("metadata binds source, version, default catalog and exact package bytes without run identity", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const text = nightlyMetadata(identity, catalog, bytes);
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual({ schemaVersion: 1, repository: source.repository, sourceCommit: sha, tag: identity.tag, version: identity.version,
      catalog: { id: "v0.5.0", hash: catalog.catalogs[0]?.hash, latticeCommit: "c".repeat(40) }, build: { bun: "1.4.2", target: "node" },
      package: { name: `lattice-studio-${identity.version}.tgz`, sha256: sha256(bytes), size: 3 } });
    expect(text).not.toContain("2026-11-12");
    expect(nightlyMetadata({ ...identity, title: "Nightly (2026-11-13)" }, catalog, bytes)).toBe(text);
  });
  test("malformed or ambiguous catalogs fail", () => {
    for (const bad of [null, {}, { ...catalog, default: "missing" }, { ...catalog, catalogs: [...catalog.catalogs, ...catalog.catalogs] }, { default: "x", catalogs: [{ id: "x", hash: "bad", commit: "bad" }] },
      { ...catalog, catalogs: [{ ...catalog.catalogs[0], hash: `${catalog.catalogs[0]?.hash}\n` }] },
      { ...catalog, catalogs: [{ ...catalog.catalogs[0], commit: `${"c".repeat(40)}\n` }] }]) {
      expect(() => nightlyMetadata(identity, bad, new Uint8Array([1]))).toThrow();
    }
  });
  test("remote assets may only be missing or byte-identical", () => {
    const expected = [{ name: "nightly.json", size: 3, digest: `sha256:${"a".repeat(64)}` }];
    const remote = { ...expected[0]!, state: "uploaded" };
    expect(missingAssets(expected, [])).toEqual(["nightly.json"]);
    expect(missingAssets(expected, [remote])).toEqual([]);
    for (const bad of [[remote, remote], [{ ...remote, name: "extra" }], [{ ...remote, size: 2 }], [{ ...remote, digest: "sha256:bad" }], [{ ...remote, state: "starter" }]]) {
      expect(() => missingAssets(expected, bad)).toThrow();
    }
  });
});

describe("nightly changelog history", () => {
  const old = "b".repeat(40);
  const future = "c".repeat(40);
  const release = (tag: string, prerelease = true) => ({ tag_name: tag, prerelease, draft: false, published_at: "2026-11-11T00:00:00Z" });
  const commits = (tag: string) => tag.startsWith("nightly-") ? tag.slice(8) : old;
  const distance = (a: string, b: string) => a === old && b === sha ? 2 : a === sha && b === future ? 1 : undefined;
  test("selects published ancestors, excludes app tags and reports descendants", () => {
    const releases = [release(`nightly-${future}`), release("lattice-studio-app-v0.2.0", false), release(`nightly-${old}`)];
    expect(selectHistory(releases, sha, commits, distance)).toEqual({ previousTag: `nightly-${old}`, supersedingTag: `nightly-${future}` });
    expect(selectHistory([release("lattice-studio-v0.2.0", false)], sha, commits, distance)).toEqual({ previousTag: "lattice-studio-v0.2.0" });
    expect(selectHistory([], sha, commits, distance)).toEqual({});
  });
  test("ignores drafts and rejects a historical nightly whose tag moved", () => {
    expect(selectHistory([{ ...release(`nightly-${old}`), draft: true }], sha, commits, distance)).toEqual({});
    expect(() => selectHistory([release(`nightly-${old}`)], sha, () => future, distance)).toThrow("tag");
  });
});
