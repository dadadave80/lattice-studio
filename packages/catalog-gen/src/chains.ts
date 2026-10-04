/**
 * Per-chain releases (spec L198-L203, contracts §3.1 `ChainRelease`): what Lattice's own release manifests say
 * about each chain, read from `deployments/<chainid>/release-<version>.json` in the checkout when present. None
 * exist at the pin, so the catalog's `chains` is empty there.
 *
 * `DeployRelease._writeManifest` (`script/deploy/DeployRelease.s.sol#L292-L321` at the pin) writes the version,
 * the chain id, CreateX, the registry, the factory, the registry's owner, a timestamp and one entry per facet
 * (name, address, codehash, selectors hash, salt). It records no build commit, no codehash for the factory, no
 * standard JSON and no proxy init-code hash, and `ChainRelease.factory` needs all four. So a chain whose factory
 * isn't the canonical one is left out of `chains`, and the gap is listed for Lattice A4 (manifest v1). A chain
 * whose factory is the canonical one, and whose registry and facets are this catalog's, is recorded with its
 * chain id alone.
 */
import { join } from "node:path";
import { type Address, err, isAddress, ok, type Result, sameAddress } from "@lattice-studio/core";
import * as z from "zod";
import type { ChainReleaseInput } from "./write";

/** Where Lattice writes its per-chain release manifests, relative to the checkout. */
export const DEPLOYMENTS_DIR = "deployments";

/** What the manifest leaves out that `ChainRelease.factory` needs (Lattice A4). */
export const MISSING_FACTORY_FIELDS = ["build commit", "codehash", "standard JSON", "proxy init-code hash"] as const;

const AddressSchema = z.string().refine((s) => isAddress(s), { message: "is not an address." });
const Bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, { message: "is not 32 bytes of hex." });
/** `vm.serializeUint` writes a JSON number; a decimal string is accepted too. */
const UintSchema = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/).transform(Number)]);

const FacetEntrySchema = z.looseObject({
  name: z.string().min(1),
  address: AddressSchema,
  codehash: Bytes32Schema,
  selectorsHash: Bytes32Schema.optional(),
  salt: Bytes32Schema.optional(),
});

/**
 * `vm.serializeString(root, "facets", facetsJson)` nests the facets as an object; a manifest that kept it as a
 * JSON string is read the same way.
 */
const FacetsSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}, z.record(z.string(), FacetEntrySchema));

const ManifestSchema = z.looseObject({
  version: z.string().min(1),
  chainid: UintSchema,
  createx: AddressSchema.optional(),
  registry: AddressSchema,
  factory: AddressSchema,
  owner: AddressSchema.optional(),
  timestamp: UintSchema.optional(),
  facets: FacetsSchema,
});

/** One release manifest as `DeployRelease` writes it. */
export type ReleaseManifest = z.infer<typeof ManifestSchema>;

/** Parses one manifest's JSON; `file` names it in the error. */
export function parseReleaseManifest(json: unknown, file: string): Result<ReleaseManifest, string> {
  const parsed = ManifestSchema.safeParse(json);
  if (parsed.success) return ok(parsed.data);
  const why = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ");
  return err(`${file}: ${why}`);
}

/** What the catalog predicts for the same release, to compare a manifest against. */
export type ExpectedRelease = {
  version: string;
  /** The canonical LatticeFactory's address. */
  factory: Address;
  registry: Address;
  /** Each facet's release address, by name. */
  facets: Readonly<Record<string, Address>>;
};

/** The catalog's `chains` and what Lattice's manifests couldn't give it. */
export type ChainReleases = { chains: ChainReleaseInput[]; gaps: string[] };

/**
 * `ChainRelease` entries from parsed manifests, sorted by chain id. A manifest for another version, or two for
 * one chain, is an error. A chain is recorded (as `{ chainId }`) only when its factory is the canonical one and
 * its registry and every catalog facet are at this catalog's release addresses. Otherwise it's left out with a
 * gap line per reason: a chain-specific factory (see the file header), or a release built another way (at the
 * pin, `DeployRelease` still deploys through CreateX, not Arachnid's proxy).
 */
export function chainReleasesFrom(
  manifests: readonly { file: string; chainId: number; manifest: ReleaseManifest }[],
  expected: ExpectedRelease,
): Result<ChainReleases, string> {
  const chains: ChainReleaseInput[] = [];
  const gaps: string[] = [];
  const seen = new Map<number, string>();
  for (const { file, chainId, manifest } of [...manifests].sort((a, b) => a.chainId - b.chainId)) {
    if (manifest.version !== expected.version) {
      return err(`${file} is for Lattice ${manifest.version}, not ${expected.version}.`);
    }
    if (manifest.chainid !== chainId) return err(`${file} sits under chain ${chainId} but says chain ${manifest.chainid}.`);
    const other = seen.get(chainId);
    if (other !== undefined) return err(`${other} and ${file} are both releases for chain ${chainId}.`);
    seen.set(chainId, file);

    const chainGaps: string[] = [];
    if (!sameAddress(manifest.factory, expected.factory)) {
      chainGaps.push(
        `Chain ${chainId}: its LatticeFactory ${manifest.factory} isn't the canonical one (${expected.factory}), and ` +
          `${file} doesn't record its ${MISSING_FACTORY_FIELDS.join(", ")}, so Studio can't use it (Lattice A4).`,
      );
    }
    if (!sameAddress(manifest.registry, expected.registry)) {
      chainGaps.push(`Chain ${chainId}: its LatticeRegistry ${manifest.registry} isn't the catalog's ${expected.registry}.`);
    }
    const moved: string[] = [];
    const unknown: string[] = [];
    for (const [name, entry] of Object.entries(manifest.facets)) {
      const want = expected.facets[entry.name] ?? expected.facets[name];
      if (want === undefined) unknown.push(name);
      else if (!sameAddress(entry.address, want)) moved.push(name);
    }
    moved.sort();
    unknown.sort();
    if (unknown.length > 0) {
      chainGaps.push(
        `Chain ${chainId}: ${file} lists ${unknown.length} facet${unknown.length === 1 ? "" : "s"} the catalog doesn't ` +
          `have (${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? ", …" : ""}).`,
      );
    }
    if (moved.length > 0) {
      chainGaps.push(
        `Chain ${chainId}: ${moved.length} of ${Object.keys(manifest.facets).length} facets in ${file} aren't at the ` +
          `catalog's addresses (${moved.slice(0, 5).join(", ")}${moved.length > 5 ? ", …" : ""}).`,
      );
    }
    const listed = new Set(Object.entries(manifest.facets).flatMap(([key, entry]) => [key, entry.name]));
    const absent = Object.keys(expected.facets).filter((name) => !listed.has(name)).sort();
    if (absent.length > 0) {
      chainGaps.push(
        `Chain ${chainId}: ${file} lists no release of ${absent.length} catalog facet${absent.length === 1 ? "" : "s"} ` +
          `(${absent.slice(0, 5).join(", ")}${absent.length > 5 ? ", …" : ""}).`,
      );
    }
    // Recorded only when the chain holds exactly this catalog's release behind the canonical factory; otherwise
    // left out, with the reasons, so nothing reads it as ready.
    if (chainGaps.length === 0) chains.push({ chainId });
    else gaps.push(...chainGaps, `Chain ${chainId} is left out of the catalog's chains.`);
  }
  return ok({ chains, gaps });
}

/**
 * Reads every `deployments/<chainid>/release-<version>.json` in a checkout. No `deployments/` folder, or none for
 * this version, gives no chains and no gaps.
 */
export async function readChainReleases(latticeDir: string, expected: ExpectedRelease): Promise<Result<ChainReleases, string>> {
  const glob = new Bun.Glob(`${DEPLOYMENTS_DIR}/*/release-${expected.version}.json`);
  const found: { file: string; chainId: number; manifest: ReleaseManifest }[] = [];
  const files: string[] = [];
  try {
    for await (const file of glob.scan({ cwd: latticeDir, onlyFiles: true })) files.push(file.split("\\").join("/"));
  } catch {
    return ok({ chains: [], gaps: [] });
  }
  for (const file of files.sort()) {
    const dir = file.split("/")[1] ?? "";
    if (!/^\d+$/.test(dir)) return err(`${file}: ${dir} isn't a chain id.`);
    let json: unknown;
    try {
      json = await Bun.file(join(latticeDir, file)).json();
    } catch {
      return err(`${file} isn't JSON.`);
    }
    const manifest = parseReleaseManifest(json, file);
    if (!manifest.ok) return manifest;
    found.push({ file, chainId: Number(dir), manifest: manifest.value });
  }
  return chainReleasesFrom(found, expected);
}
