import { createHash } from "node:crypto";
import { createNightlyVersion, validateNightlySource, type NightlySource } from "./dev-nightly.ts";

export const NIGHTLY_REPOSITORY = "dadadave80/lattice-studio";
export interface NightlyIdentity { sha: string; tag: string; title: string; version: string }
export interface AssetFingerprint { name: string; size: number; digest: string }
export interface RemoteAsset extends AssetFingerprint { state: string }
export interface HistoryRelease { tag_name: string; prerelease: boolean; draft: boolean; published_at: string | null }

export function nightlyIdentity(source: NightlySource & { repository: string | undefined }, baseVersion: string, timestamp: string, createdAt: string): NightlyIdentity {
  if (source.repository !== NIGHTLY_REPOSITORY) throw new Error(`The nightly repository must be ${NIGHTLY_REPOSITORY}.`);
  const sha = validateNightlySource(source);
  const date = new Date(createdAt);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(createdAt) || !Number.isFinite(date.valueOf()) || `${date.toISOString().slice(0, 19)}Z` !== createdAt) {
    throw new Error("The original CI run must have a valid UTC creation time.");
  }
  return { sha, tag: `nightly-${sha}`, title: `Nightly (${createdAt.slice(0, 10)})`, version: createNightlyVersion(baseVersion, timestamp, sha) };
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function checksumManifest(files: ReadonlyMap<string, Uint8Array>): string {
  return [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, bytes]) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name === "SHA256SUMS") throw new Error("Invalid checksum filename.");
    return `${sha256(bytes)}  ${name}\n`;
  }).join("");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function nightlyMetadata(identity: NightlyIdentity, manifest: unknown, bytes: Uint8Array): string {
  if (!record(manifest) || typeof manifest.default !== "string" || !Array.isArray(manifest.catalogs)) throw new Error("Invalid catalog manifest.");
  const matches: unknown[] = manifest.catalogs.filter((item: unknown) => record(item) && item.id === manifest.default);
  const entry = matches[0];
  if (matches.length !== 1 || !record(entry) || typeof entry.hash !== "string" || !/^0x[0-9a-f]{64}$/.test(entry.hash)
      || typeof entry.commit !== "string" || !/^[0-9a-f]{40}$/.test(entry.commit)) throw new Error("Invalid or ambiguous default catalog.");
  return `${JSON.stringify({ schemaVersion: 1, repository: NIGHTLY_REPOSITORY, sourceCommit: identity.sha, tag: identity.tag, version: identity.version,
    catalog: { id: manifest.default, hash: entry.hash, latticeCommit: entry.commit }, build: { bun: "1.4.2", target: "node" },
    package: { name: `lattice-studio-${identity.version}.tgz`, sha256: sha256(bytes), size: bytes.byteLength } }, null, 2)}\n`;
}

export function missingAssets(expected: readonly AssetFingerprint[], actual: readonly RemoteAsset[]): readonly string[] {
  const wanted = new Map(expected.map((asset) => [asset.name, asset]));
  if (wanted.size !== expected.length) throw new Error("Duplicate expected assets.");
  const seen = new Set<string>();
  for (const asset of actual) {
    const match = wanted.get(asset.name);
    if (!match || seen.has(asset.name)) throw new Error("Unexpected or duplicate remote asset.");
    seen.add(asset.name);
    if (asset.state !== "uploaded" || asset.size !== match.size || !/^sha256:[0-9a-f]{64}$/.test(asset.digest) || asset.digest !== match.digest) {
      throw new Error(`Conflicting nightly asset: ${asset.name}.`);
    }
  }
  return expected.filter((asset) => !seen.has(asset.name)).map((asset) => asset.name);
}

export function selectHistory(
  releases: readonly HistoryRelease[], sha: string, commit: (tag: string) => string | undefined,
  distance: (ancestor: string, descendant: string) => number | undefined,
): { previousTag?: string; supersedingTag?: string } {
  const nightlies: { tag: string; distance: number; published: string }[] = [];
  const stable: typeof nightlies = [];
  const descendants: typeof nightlies = [];
  for (const release of releases) {
    if (release.draft || !release.published_at) continue;
    const nightly = /^nightly-([0-9a-f]{40})$/.exec(release.tag_name);
    const cli = !release.prerelease && /^lattice-studio-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(release.tag_name);
    if (!nightly && !cli) continue;
    const resolved = commit(release.tag_name);
    if (!resolved || (nightly && (resolved !== nightly[1] || !release.prerelease))) throw new Error(`Conflicting historical release tag: ${release.tag_name}.`);
    if (resolved === sha) continue;
    const before = distance(resolved, sha);
    const candidate = { tag: release.tag_name, distance: before ?? 0, published: release.published_at };
    if (before !== undefined) (nightly ? nightlies : stable).push(candidate);
    if (nightly) {
      const after = distance(sha, resolved);
      if (after !== undefined) descendants.push({ ...candidate, distance: after });
    }
  }
  const nearest = (items: typeof nightlies) => items.sort((a, b) => a.distance - b.distance || b.published.localeCompare(a.published) || a.tag.localeCompare(b.tag))[0]?.tag;
  const previousTag = nearest(nightlies) ?? nearest(stable);
  const supersedingTag = nearest(descendants);
  return { ...(previousTag ? { previousTag } : {}), ...(supersedingTag ? { supersedingTag } : {}) };
}
