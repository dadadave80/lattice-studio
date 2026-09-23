/** Test support for C7a: v1 fixture recipes with every required argument filled, and their analyses. */
import { keccak256 } from "viem";
import { analyze } from "../../analysis";
import { recipeHash } from "../../canonical";
import type { Analysis, PlanEntry } from "../../model/analysis";
import type { Catalog, Facet, InitSpec, SharedContract } from "../../model/catalog";
import { toChecksum, type Hex, type Hex4 } from "../../model/hex";
import type { Project } from "../../model/project";
import type { Arg, Recipe } from "../../model/recipe";
import { loadTemplate, templateList } from "../../plan";
import { loadFixtureCatalog, makeProject } from "../../testing";

/** Arguments the fixture templates leave for the person to fill in (INIT-01), by template. */
const FILL: Record<string, (recipe: Recipe) => void> = {
  GovernedVault: (recipe) => {
    if (recipe.init.kind !== "bundle") return;
    const p = recipe.init.args["p"] as Record<string, Arg>;
    p["asset"] = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
  },
  SafeDiamondCut: (recipe) => {
    if (recipe.init.kind !== "steps") return;
    const step = recipe.init.steps[0];
    if (step) step.args["safe"] = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
  },
};

export type Fixture = { catalog: Catalog; project: Project; analysis: Analysis };

/** The minimal catalog's proxy creation code (its `initCodeHash` is keccak256 of these bytes). */
export const MINIMAL_PROXY_CODE: Hex = "0x6000";

function shared(n: number): SharedContract {
  const byte = n.toString(16).padStart(2, "0");
  return {
    salt: `0x${byte.repeat(32)}`,
    version: "1.2.3",
    address: toChecksum(`0x${"00".repeat(19)}${byte}`),
    codehash: `0x${"c0".repeat(31)}${byte}`,
    initCodeHash: `0x${"1c".repeat(31)}${byte}`,
    creationCode: { path: `code/${n}.creation.hex`, bytes: 1, hash: `0x${"00".repeat(32)}` },
  };
}

const SHARD = { path: "shards/x.json", bytes: 1, hash: `0x${"00".repeat(32)}` } as const;

/**
 * A catalog, recipe and analysis written here by hand, so C7a's structure snapshot pins only C7a's own output:
 * no fixture catalog (K3), routing or plan order (C2, C5a) or init plan (C4a) data. Two facets, one bundle init
 * with a tuple, a string and both references.
 */
export function minimalFixture(path: Project["deploy"]["path"]): Fixture {
  const facet = (name: string, n: number, selectors: [Hex4, string][]): Facet => ({
    name,
    area: "diamond",
    source: `src/${name}.sol`,
    summary: name,
    selectors: selectors.map(([hex, signature]) => ({ hex, signature })),
    touches: [],
    release: shared(n),
    requires: [],
    detail: SHARD,
  });
  const loupe = facet("Loupe", 1, [
    ["0x7a0ed627", "facets()"],
    ["0xadfca15e", "facetFunctionSelectors(address)"],
    ["0x52ef6b2c", "facetAddresses()"],
    ["0xcdffacc6", "facetAddress(bytes4)"],
  ]);
  const token = facet("Token", 2, [
    ["0xa9059cbb", "transfer(address,uint256)"],
    ["0x06fdde03", "name()"],
  ]);
  const init: InitSpec = {
    name: "TokenInit",
    contract: "TokenInit",
    fn: "init((address,string,uint8),address)",
    kind: "bundle",
    params: [
      {
        name: "p",
        type: "tuple",
        doc: "",
        components: [
          { name: "owner", type: "address", doc: "" },
          { name: "name", type: "string", doc: "" },
          { name: "decimals", type: "uint8", doc: "" },
        ],
      },
      { name: "admin", type: "address", doc: "" },
    ],
    initializes: [],
    after: [],
    sameCall: [],
    release: shared(3),
  };
  const catalog: Catalog = {
    lattice: { tag: "v1.2.3", commit: "1".repeat(40) },
    toolchain: { foundry: "1.8.3", solc: "0.8.36" },
    hash: `0x${"ca".repeat(32)}`,
    deployer: { address: "0x4e59b44847b379578588920cA78FbF26c0B4956C", codehash: `0x${"de".repeat(32)}` },
    registry: shared(4),
    factory: shared(5),
    proxy: { creationCode: SHARD, initCodeHash: keccak256(MINIMAL_PROXY_CODE), standardJson: SHARD },
    facets: [loupe, token],
    inits: [init],
    recipes: [],
    chains: [],
    seams: [],
  };
  const recipe: Recipe = {
    schemaVersion: 1,
    catalog: { tag: catalog.lattice.tag, hash: catalog.hash },
    facets: ["Loupe", "Token"],
    owners: {},
    exclude: [],
    init: { kind: "bundle", spec: "TokenInit", args: { p: { owner: { $ref: "self" }, name: 'Minimal "token"', decimals: "18" }, admin: { $ref: "deployer" } } },
  };
  const plan: PlanEntry[] = [loupe, token].map((f) => ({
    facet: f.name,
    address: f.release.address,
    codehash: f.release.codehash,
    version: f.release.version,
    selectors: f.selectors.map((s) => s.hex),
  }));
  const analysis: Analysis = {
    recipeHash: recipeHash(recipe, catalog),
    routing: {},
    problems: [],
    plan,
    init: null,
    stats: { facets: 2, routed: 6, exported: 6, excluded: 0, namespaces: 0 },
  };
  const project: Project = {
    id: "minimal",
    name: "Minimal",
    recipe,
    layout: {},
    deploy: { path, entropy: `0x${"ab".repeat(11)}`, scope: path === "factory" ? "every-chain" : "this-chain" },
    provenance: {},
    predicted: [],
  };
  return { catalog, project, analysis };
}

export function fixtureCatalog(): Catalog {
  const loaded = loadFixtureCatalog();
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

/** The v1 recipes the fixture catalog can load. */
export function v1Recipes(catalog: Catalog): string[] {
  return templateList(catalog)
    .filter((item) => item.loadable)
    .map((item) => item.name);
}

/** A project around template `name` with its required arguments filled and its analysis. */
export function fixtureProject(catalog: Catalog, name: string, deploy?: Partial<Project["deploy"]>): Fixture {
  const loaded = loadTemplate(catalog, name);
  if (!loaded.ok) throw new Error(loaded.error);
  const recipe = loaded.value;
  FILL[name]?.(recipe);
  const base = makeProject({ name, recipe });
  const project: Project = { ...base, deploy: { ...base.deploy, ...deploy } };
  return { catalog, project, analysis: analyze(recipe, catalog, { known: [], unconfirmed: [] }) };
}
