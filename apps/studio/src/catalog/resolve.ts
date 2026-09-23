/**
 * The shared contract (or facet) a name refers to, resolved exactly as core's `packages/core/src/deploy/missing.ts`
 * `resolve` does and as K2's minimal loader (`contracts/catalog.ts`) does: "LatticeRegistry" and "LatticeFactory";
 * a library by name (`catalog.libraries`); a facet by name; an init by `name` or by `contract`
 * (`DiamondIntrospectionInit`'s two entry points share one contract); and "Lattice" for the proxy, which has no
 * `SharedContract` of its own.
 */
import type { Catalog, ShardRef, SharedContract } from "@lattice-studio/core";

export type ResolvedRelease = { release: SharedContract; detail?: ShardRef };

/** The release a name stands for; undefined when the catalog has nothing by that name. */
export function resolveRelease(catalog: Catalog, name: string): ResolvedRelease | undefined {
  if (name === "LatticeRegistry") return { release: catalog.registry };
  if (name === "LatticeFactory") return { release: catalog.factory };
  const library = catalog.libraries?.find((entry) => entry.name === name);
  if (library) return { release: library.release };
  const facet = catalog.facets.find((entry) => entry.name === name);
  if (facet) return { release: facet.release, detail: facet.detail };
  const init = catalog.inits.find((entry) => entry.name === name) ?? catalog.inits.find((entry) => entry.contract === name);
  return init?.release ? { release: init.release } : undefined;
}

/** The `ShardRef` a name's ABI shard or creation code lives at, by the same resolution. */
export function shardRef(catalog: Catalog, name: string, kind: "detail" | "code"): ShardRef | undefined {
  if (name === "Lattice") return kind === "detail" ? catalog.proxy.detail : catalog.proxy.creationCode;
  const found = resolveRelease(catalog, name);
  if (!found) return undefined;
  return kind === "code" ? found.release.creationCode : (found.detail ?? found.release.detail);
}
