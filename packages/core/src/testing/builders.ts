/**
 * Builders for small, deterministic test catalogs, recipes and projects. Release data is fake but shaped
 * right: every hash is keccak256 of a readable "test:" string, so nothing collides with a real release.
 */
import { keccak256, stringToHex, toFunctionSelector } from "viem";
import type { Catalog, Facet, InitSpec, RecipeTemplate, SharedContract, ShardRef } from "../model/catalog";
import type { Hex, Hex4 } from "../model/hex";
import { toChecksum } from "../model/hex";
import type { Project } from "../model/project";
import type { Recipe } from "../model/recipe";
import { hex } from "./ids";

function fakeHash(label: string): Hex {
  return keccak256(stringToHex(`test:${label}`));
}

/** A fake shard reference for `path`. */
export function makeShard(path: string): ShardRef {
  return { path, bytes: 0, hash: fakeHash(path) };
}

/** A fake shared contract; the address is the last 20 bytes of a hash of the name. */
export function makeShared(name: string, version = "0.4.0"): SharedContract {
  return {
    salt: keccak256(stringToHex(`lattice.${name}.${version}`)),
    version,
    address: toChecksum(`0x${fakeHash(`address:${name}`).slice(-40)}`),
    codehash: fakeHash(`codehash:${name}`),
    initCodeHash: fakeHash(`initcode:${name}`),
    creationCode: makeShard(`code/${name}.creation.hex`),
  };
}

/** A selector given as its signature (hex computed) or as `{ hex, signature }` (e.g. Receive's `0x00000000`). */
export type SelectorInput = string | { hex: Hex4; signature: string };

/** Facet fields a test sets; `selectors` may be plain signatures. */
export type FacetInput = Omit<Partial<Facet>, "selectors"> & { name: string; selectors?: SelectorInput[] };

/** A facet with empty overlay data and fake release data. */
export function makeFacet(input: FacetInput): Facet {
  const { selectors = [], ...rest } = input;
  return {
    area: "utils",
    source: `src/${input.name}.sol`,
    summary: `${input.name} (test facet)`,
    touches: [],
    release: makeShared(input.name),
    requires: [],
    detail: makeShard(`shards/${input.name}.json`),
    ...rest,
    selectors: selectors.map((s) => (typeof s === "string" ? { hex: toFunctionSelector(s), signature: s } : s)),
  };
}

/** An init spec: a `step` with no params unless the test says otherwise. */
export function makeInit(input: Partial<InitSpec> & { name: string }): InitSpec {
  return {
    contract: input.name,
    fn: "init()",
    kind: "step",
    params: [],
    initializes: [],
    after: [],
    sameCall: [],
    release: makeShared(input.name),
    ...input,
  };
}

/** A catalog tagged "test" with the given parts. `hash` is fake unless given. */
export function makeCatalog(input: Partial<Catalog> = {}): Catalog {
  return {
    lattice: { tag: "test", commit: "0".repeat(40) },
    toolchain: { foundry: "1.8.3", solc: "0.8.36" },
    hash: fakeHash("catalog"),
    deployer: {
      address: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
      codehash: "0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989",
    },
    registry: makeShared("LatticeRegistry"),
    factory: makeShared("LatticeFactory"),
    proxy: {
      creationCode: makeShard("code/Lattice.creation.hex"),
      initCodeHash: fakeHash("initcode:Lattice"),
      standardJson: makeShard("json/Lattice.standard.json"),
    },
    facets: [],
    inits: [],
    recipes: [],
    chains: [],
    seams: [],
    ...input,
  };
}

/** An empty recipe pinned to `catalog` (or to a "test" catalog). */
export function makeRecipe(input: Partial<Recipe> = {}, catalog?: Pick<Catalog, "lattice" | "hash">): Recipe {
  return {
    schemaVersion: 1,
    catalog: { tag: catalog?.lattice.tag ?? "test", hash: catalog?.hash ?? fakeHash("catalog") },
    facets: [],
    owners: {},
    exclude: [],
    init: { kind: "none" },
    ...input,
  };
}

/** A recipe template in phase v1 on the plain Lattice proxy. */
export function makeTemplate(input: Partial<RecipeTemplate> & { name: string }): RecipeTemplate {
  return {
    script: `script/Deploy${input.name}.s.sol`,
    proxy: "Lattice",
    recipe: makeRecipe(),
    phase: "v1",
    ...input,
  };
}

/** A project around `recipe` (or an empty one), with fixed entropy and no layout. */
export function makeProject(input: Partial<Project> = {}): Project {
  return {
    id: "test-project",
    name: "Untitled",
    recipe: makeRecipe(),
    layout: {},
    deploy: { path: "factory", entropy: hex(1, 11), scope: "every-chain" },
    provenance: {},
    predicted: [],
    ...input,
  };
}
