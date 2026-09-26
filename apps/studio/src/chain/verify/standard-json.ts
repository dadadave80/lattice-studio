/**
 * The proxy's standard JSON for verification (spec L577, contracts §4 `json/<Name>.standard.json`): the catalog
 * tag's build, or a chain-specific factory's build commit when `chainId` has one and the deploy used LatticeFactory
 * (`ChainRelease.factory` exists only for the factory path; CreateX deploys the plain `Lattice` proxy everywhere).
 * Every fetched file is checked against its `ShardRef.hash` before it's parsed, as `catalog/loader.ts` does for
 * every other shard.
 *
 * `compilerVersion` is `catalog.toolchain.solcLong` (solc's full version, e.g. "0.8.36+commit.8a97fa7a"), which
 * Sourcify's job resolves the compiler binary by; a catalog written before FX20 carries none, so this falls back
 * to the short `solc` (Sourcify's schema accepts it, `^v?\d+\.\d+\.\d+.*$`, but the job most likely fails to
 * resolve a binary from it, reported as an ordinary "Couldn't verify" once regenerating the catalog is the fix).
 */
import { keccak256 } from "viem";
import type { Catalog, Deployment, Result, ShardRef } from "@lattice-studio/core";
import { err, ok } from "@lattice-studio/core";
import { catalogDirFor } from "@/catalog";
import { getCatalogStatus } from "@/contracts";
import type { ProxyBuild, VerifyFetch } from "./ports";

/** The `Lattice` proxy's standard JSON ref for this chain and path (spec L577). */
export function proxyRef(catalog: Catalog, chainId: number, path: Deployment["path"]): ShardRef {
  if (path === "factory") {
    const chainSpecific = catalog.chains.find((c) => c.chainId === chainId)?.factory?.proxyStandardJson;
    if (chainSpecific) return chainSpecific;
  }
  return catalog.proxy.standardJson;
}

/** Fetches and hash-checks a shard from the loaded catalog's directory. */
async function fetchShard(fetchImpl: VerifyFetch, dir: string, ref: ShardRef): Promise<Result<Uint8Array, string>> {
  let response: Response;
  try {
    response = await fetchImpl(`${dir}${ref.path}`);
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) return err(`${ref.path} answered ${response.status}.`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (keccak256(buffer).toLowerCase() !== ref.hash.toLowerCase()) {
    return err(`${ref.path} doesn't match the catalog's hash for it. Reload the catalog.`);
  }
  return ok(buffer);
}

/** The real `VerifyDeps.proxyBuild`: reads the loaded catalog (`@/contracts`), never a project's own pin. */
export async function loadProxyBuild(fetchImpl: VerifyFetch, chainId: number, path: Deployment["path"]): Promise<Result<ProxyBuild, string>> {
  const status = getCatalogStatus();
  if (status.status !== "ready") return err("The catalog hasn't loaded.");
  const ref = proxyRef(status.catalog, chainId, path);
  const bytes = await fetchShard(fetchImpl, catalogDirFor(status.id, status.manifest), ref);
  if (!bytes.ok) return bytes;
  let stdJsonInput: unknown;
  try {
    stdJsonInput = JSON.parse(new TextDecoder().decode(bytes.value));
  } catch {
    return err(`${ref.path} isn't valid JSON.`);
  }
  const { solcLong, solc } = status.catalog.toolchain;
  return ok({ stdJsonInput, compilerVersion: solcLong ?? solc });
}
