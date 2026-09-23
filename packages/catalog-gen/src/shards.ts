/**
 * Shard content and file-hashing primitives for the catalog writer (contracts §4, §3.1).
 *
 * A shard's ABI is CG1's `shardAbi`: functions, errors and events, with `exportSelectors()` dropped. `Receive`'s
 * only ABI entry is `receive`, which is none of the three, so its shard ABI is empty — `0x00000000` (the
 * zero selector Receive exports) needs special-casing wherever a selector is looked up in a facet's ABI.
 *
 * `ShardRef.hash` is keccak256 of the exact bytes a file is written with, so every write goes through
 * `jsonFileBytes` or `textFileBytes` first and `shardRefFor` hashes the same bytes that reach disk.
 */
import type { AbiItem, FacetDetail, Hex, ShardRef } from "@lattice-studio/core";
import { keccak256 } from "viem";
import { shardAbi } from "./artifacts";
import type { FacetSelector, SolcMetadata } from "./artifacts";
import { facetNatspec } from "./natspec";

/** `catalog/<id>/code/<Name>.creation.hex` (contracts §4): a shared contract's, or a facet's, creation code. */
export function codePath(name: string): string {
  return `code/${name}.creation.hex`;
}

/** `catalog/<id>/shards/<Name>.json` (contracts §4): a `FacetDetail` shard, for a facet or any other contract. */
export function detailPath(name: string): string {
  return `shards/${name}.json`;
}

/** `catalog/<id>/json/<Name>.standard.json` (contracts §4): standard JSON input for Sourcify or a chain build. */
export function standardJsonPath(name: string): string {
  return `json/${name}.standard.json`;
}

/** A written JSON file's exact bytes: two-space indent, trailing newline, UTF-8. */
export function jsonFileBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Every plain object's keys sorted (the same order C1's `canonicalJson` uses: default string sort). */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep(value[key]);
    return sorted;
  }
  return value;
}

/**
 * A written JSON file's exact bytes, with every object's keys in canonical (sorted) order: two-space indent,
 * trailing newline, UTF-8. Used for `index.json` (contracts §4, orchestrator ruling 2026-09-23) so the file
 * doesn't depend on the order the catalog's input objects happened to be built in — the CI drift check
 * (`bun run catalog` then `git diff --exit-code catalog/`, spec L928) compares bytes, not just data.
 */
export function sortedJsonFileBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(sortKeysDeep(value), null, 2)}\n`);
}

/** A written text file's exact bytes (creation code hex: the literal string, no added newline). */
export function textFileBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** The `ShardRef` for a file already reduced to the exact bytes it's written with. */
export function shardRefFor(path: string, bytes: Uint8Array): ShardRef {
  return { path, bytes: bytes.length, hash: keccak256(bytes) as Hex };
}

/**
 * A facet's or shared contract's ABI shard (`FacetDetail`, contracts §3.1): CG1's `shardAbi` for `abi` (functions,
 * errors and events; `exportSelectors()` and `receive`/`fallback`/`constructor` dropped), CG1's `facetNatspec` for
 * `selectors`' NatSpec, and the given source. `selectors` is the routed selectors whose function-level NatSpec
 * should appear; an empty list still carries the contract's own notice and dev note.
 */
export function buildFacetDetail(
  name: string,
  abi: AbiItem[],
  metadata: Pick<SolcMetadata, "output">,
  selectors: FacetSelector[],
  source: FacetDetail["source"],
  storageLayout?: unknown,
): FacetDetail {
  const base = { name, abi: shardAbi(abi), natspec: facetNatspec(metadata, selectors) };
  return storageLayout !== undefined ? { ...base, storageLayout, source } : { ...base, source };
}
