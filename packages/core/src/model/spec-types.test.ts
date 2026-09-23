// The spec's data-model types (spec L138-L278), pasted verbatim and checked against the model: same names,
// same fields, same types, with only the additions contracts §3.1 lists. Checked by `bun run typecheck`;
// the runtime tests below validate spec-shaped literals against the schemas.
// Regenerate the block from the spec, never edit it by hand.
import { describe, expect, test } from "bun:test";
import type { Address, Anchor, Area, CommandRef, Hex, Hex4, Json, ShardRef } from "./index";
import type * as M from "./index";
import { validateCatalog, validateProjectFile, validateRecipe } from "./index";

// ── spec L139-L278, verbatim ──────────────────────────────────────────────────────────────────────
type Catalog = {
  lattice: { tag: string; commit: string }            // "v0.4.0" and the commit that tag points to
  toolchain: { foundry: string; solc: string }        // "1.8.1", "0.8.36"
  hash: Hex                                           // keccak256 of the canonical index
  deployer: { address: Address; codehash: Hex }       // Arachnid's deterministic deployment proxy, 0x4e59…956C
  registry: SharedContract; factory: SharedContract   // versionless salts; constructor arguments are in the creation code
  proxy: { creationCode: ShardRef; initCodeHash: Hex; standardJson: ShardRef }   // Lattice at this tag
  facets: Facet[]; inits: InitSpec[]; recipes: RecipeTemplate[]; chains: ChainRelease[]
  seams: Seam[]                                       // overlay
}
type SharedContract = {                               // deployed once per chain through Arachnid's proxy
  salt: Hex                                           // keccak256("lattice.<Name>.<version>"), passed unhashed
  version: string                                     // release version; also the registry version a RecipeEntry pins
  address: Address                                    // CREATE2(deployer, salt, initCodeHash): the same on every chain
  codehash: Hex; initCodeHash: Hex                    // runtime codehash, and the hash the address commits to
  creationCode: ShardRef                              // enough for anyone to deploy it byte for byte
}
type Facet = {
  name: string                                        // FacetInventory name, e.g. "ERC20"
  area: Area; source: string; summary: string
  selectors: { hex: Hex4; signature: string }[]       // exportSelectors() minus 0x0ef22643
  storage?: { id: string; slot: Hex }                 // own ERC-7201 namespace
  touches: string[]                                   // namespaces its libraries write
  release: SharedContract
  requires: { anyOf: string[]; strength: "hard" | "convention"; reason: string }[]   // overlay
  family?: "upgrade" | "access" | "account"           // overlay: one member per diamond
  defaultOwnerOf?: Hex4[]                             // overlay: wins these by default
  init?: string                                       // InitSpec name
  detail: ShardRef                                    // ABI with errors and events, NatSpec, layout
}
type Seam = {
  selector: Hex4
  when: string[]                                      // active once all of these are placed, e.g. ["ERC20Votes"]
  anyOf: string[]                                     // facets allowed to serve it, preferred first
  reason: string                                      // "moves vote checkpoints with balances"
}
type InitSpec = {
  name: string; contract: string; fn: string          // "ERC20Init", "init(string,string)"
  kind: "step" | "bundle"                             // a bundle is one call whose order is fixed in Solidity
  params: {
    name: string; type: string; doc: string
    unit?: "seconds" | "percent" | "wei"; rule?: string
    example?: Json                                    // a template's demo value, flagged until changed (INIT-05)
    authority?: true                                  // receives a role, ownership or upgrade rights
  }[]
  initializes: { module: string; with?: Record<string, string> }[]   // e.g. EIP712 with name from "name_", version "1"
  after: string[]                                     // documented order constraints (overlay)
  sameCall: string[]                                  // modules that must initialize in the same initialize() call
  sequence?: string[]                                 // bundles: internal order, shown read-only
  registersInterfaces?: true                          // sets its own ERC-165 flags, so no introspection step is added
  ctorArgs?: { name: string; type: string }[]         // present: deployed per use, not as a shared contract
  release?: SharedContract                            // absent when ctorArgs is present
}
type RecipeTemplate = {
  name: string; script: string                        // "GovernedVault", "script/base/defi/DeployGovernedVault.s.sol"
  proxy: "Lattice" | "AccountDiamond" | "ModularAccount6900"
  recipe: Recipe                                      // facets, owners, exclusions and init, as the script builds them
  phase: "v1" | "v1.1" | "later"
}
type ChainRelease = {
  chainId: number
  factory?: { address: Address; codehash: Hex; buildCommit: string; proxyStandardJson: ShardRef }
                                                      // a chain-specific factory, such as one with ENS reverse records,
                                                      // used instead of the canonical one
}

type Recipe = {
  $schema?: string                                    // hosted JSON Schema, for editor autocomplete
  schemaVersion: 1
  name?: string                                       // display only; written on export and in share links
  catalog: { tag: string; hash: Hex }
  template?: { name: string; catalogHash: Hex }       // provenance; its owners and exclusions are copied in at load
  facets: string[]                                    // a set, kept in catalog order; cut order follows it
  owners: Record<Hex4, string>                        // contested selector → the placed facet that serves it
  exclude: Hex4[]                                     // selectors left out of the diamond entirely
  init:
    | { kind: "bundle"; spec: string; args: Record<string, Arg> }             // e.g. GovernedVaultInit
    | { kind: "steps"; steps: { spec: string; args: Record<string, Arg> }[] } // MultiInit, in call order
    | { kind: "none" }
  immutable?: true                                    // acknowledged: no upgrade mechanism
}
type Arg =
  | string                                            // integers as decimal strings, hex lowercase, addresses EIP-55
  | boolean | Arg[] | { [field: string]: Arg }
  | { $ref: "self" | "deployer" }                     // this diamond or the deploying account, resolved at build time

type Project = {
  id: string; name: string; recipe: Recipe
  layout: Record<string, { x: number; y: number; pins: "left" | "right"; expanded?: true }>
  deploy: {
    path: "factory" | "createx"                       // LatticeFactory by default; CreateX CREATE3 when chosen
    entropy: Hex                                      // 11 random bytes; the salt is from ‖ flag ‖ entropy
    scope: "every-chain" | "this-chain"               // flag 0x00 or 0x01; read only on the CreateX path
  }
  provenance: Record<string, "link" | "file" | "confirmed">   // per init-argument path, for LINK-01
  predicted: { chainId: number; address: Address }[]  // this diamond's earlier predicted addresses, for AUTH-02
}
type Deployment = {                                   // own store, keyed by [chainId, address], indexed by project id
  projectId: string; chainId: number; address: Address
  path: "factory" | "createx"; deployer: Address; salt: Hex
  status: "pending" | "proposed" | "confirmed" | "mismatch" | "failed"
  tx?: Hex; safeTxHash?: Hex; callsId?: string; block?: number
  recipeHash: Hex; catalogHash: Hex; at: string
  verification: "pending" | "match" | "exact_match" | "failed"
  revision: number                                    // 1 at deploy, +1 per upgrade (v2)
  fromFile?: true                                     // imported: shown "From file" until re-read on-chain
}
type ProjectFile = { project: Project; deployments: Deployment[] }   // a .lattice.json file

type Analysis = {
  recipeHash: Hex
  routing: Record<Hex4, { owner?: string; contenders: string[]; via: "only" | "seam" | "default" | "chosen" }>
  problems: Problem[]                                 // blockers, then warnings, then info; catalog order within
  plan: { facet: string; address: Address; selectors: Hex4[] }[]   // one Add per facet with ≥ 1 routed selector, in catalog order
  init: { target: Address; data?: Hex; refs: ("self" | "deployer")[] } | null   // data once a deploy context resolves every ref
  stats: { facets: number; routed: number; exported: number; excluded: number; namespaces: number }
}
type AnalysisContext = {
  deploy?: { chainId: number; path: "factory" | "createx"; from: Address; salt: Hex }   // resolves refs; enables NET checks
  known: Address[]                                    // earlier predictions and recorded deployments (AUTH-02)
  unconfirmed: string[]                               // argument paths that came from a link or file (LINK-01)
}
type Problem = {
  id: string                                          // stable, e.g. "SEL-01:0xcdfe7f5c"
  severity: "blocker" | "warning" | "info"
  where: Anchor[]                                     // facet, selector or init field
  message: string; fixes: CommandRef[]
}
// ── end of spec block ──

// ── assertions ────────────────────────────────────────────────────────────────────────────────────

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** Each assignable to the other. */
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type Keys<T> = keyof T;
type Item<T> = T extends readonly (infer U)[] ? U : never;
type Value<T> = T extends Record<string, infer U> ? U : never;
type Present<T> = Exclude<T, undefined | null>;

/** Every assertion; a `false` anywhere fails `bun run typecheck`. */
export type SpecTypeAssertions = [
  // Catalog (L139-L148) + provisional (contracts §3.1)
  Assert<Equals<Keys<M.Catalog>, Keys<Catalog> | "provisional" | "libraries" | "registryOwner">>,
  Assert<Mutual<Omit<M.Catalog, "provisional" | "libraries" | "registryOwner" | "facets" | "inits" | "recipes" | "chains">, Omit<Catalog, "facets" | "inits" | "recipes" | "chains">>>,
  Assert<Equals<M.Catalog["provisional"], string | undefined>>,
  // proxy gains `detail` (its ABI shard, for revert decoding)
  Assert<Equals<Keys<M.Catalog["proxy"]>, Keys<Catalog["proxy"]> | "detail">>,
  Assert<Mutual<Omit<M.Catalog["proxy"], "detail">, Catalog["proxy"]>>,
  // SharedContract (L149-L155) + detail (ABI shard of a non-facet contract)
  Assert<Equals<Keys<M.SharedContract>, Keys<SharedContract> | "detail" | "dependsOn" | "provisional">>,
  Assert<Mutual<Omit<M.SharedContract, "detail" | "dependsOn" | "provisional">, SharedContract>>,
  Assert<Equals<M.SharedContract["detail"], M.ShardRef | undefined>>,
  // Facet (L156-L168)
  Assert<Equals<Keys<M.Facet>, Keys<Facet>>>,
  Assert<Mutual<M.Facet, Facet>>,
  Assert<Equals<Keys<Item<M.Facet["requires"]>>, Keys<Item<Facet["requires"]>>>>,
  Assert<Equals<Keys<Item<M.Facet["selectors"]>>, Keys<Item<Facet["selectors"]>>>>,
  Assert<Equals<Keys<Present<M.Facet["storage"]>>, Keys<Present<Facet["storage"]>>>>,
  // Seam (L169-L174)
  Assert<Equals<Keys<M.Seam>, Keys<Seam>>>,
  Assert<Mutual<M.Seam, Seam>>,
  // InitSpec (L175-L191); params gain `components` (contracts §3.1) and `role` (contracts §4 overlay)
  Assert<Equals<Keys<M.InitSpec>, Keys<InitSpec>>>,
  Assert<Mutual<Omit<M.InitSpec, "params">, Omit<InitSpec, "params">>>,
  Assert<Equals<Keys<Item<M.InitSpec["params"]>>, Keys<Item<InitSpec["params"]>> | "components" | "role" | "exampleSource">>,
  Assert<Mutual<Omit<Item<M.InitSpec["params"]>, "components" | "role" | "exampleSource">, Item<InitSpec["params"]>>>,
  Assert<Equals<Present<Item<M.InitSpec["params"]>["components"]>, M.InitParam[]>>,
  Assert<Equals<Keys<Item<M.InitSpec["initializes"]>>, Keys<Item<InitSpec["initializes"]>>>>,
  // RecipeTemplate (L192-L197)
  Assert<Equals<Keys<M.RecipeTemplate>, Keys<RecipeTemplate>>>,
  Assert<Mutual<M.RecipeTemplate, RecipeTemplate>>,
  // ChainRelease (L198-L203); factory gains proxyInitCodeHash (contracts §3.1)
  Assert<Equals<Keys<M.ChainRelease>, Keys<ChainRelease>>>,
  Assert<Equals<Keys<Present<M.ChainRelease["factory"]>>, Keys<Present<ChainRelease["factory"]>> | "proxyInitCodeHash">>,
  Assert<Mutual<Omit<Present<M.ChainRelease["factory"]>, "proxyInitCodeHash">, Present<ChainRelease["factory"]>>>,
  Assert<Equals<Present<M.ChainRelease["factory"]>["proxyInitCodeHash"], Hex>>,
  // Recipe and Arg (L209-L227)
  Assert<Equals<Keys<M.Recipe>, Keys<Recipe>>>,
  Assert<Mutual<M.Recipe, Recipe>>,
  Assert<Mutual<M.Recipe["init"], Recipe["init"]>>,
  Assert<Mutual<M.Arg, Arg>>,
  // Project, Deployment, ProjectFile (L233-L254)
  Assert<Equals<Keys<M.Project>, Keys<Project>>>,
  Assert<Mutual<M.Project, Project>>,
  Assert<Equals<Keys<Value<M.Project["layout"]>>, Keys<Value<Project["layout"]>>>>,
  Assert<Equals<Keys<M.Project["deploy"]>, Keys<Project["deploy"]>>>,
  Assert<Equals<Keys<M.Deployment>, Keys<Deployment>>>,
  Assert<Mutual<M.Deployment, Deployment>>,
  Assert<Equals<Keys<M.ProjectFile>, Keys<ProjectFile>>>,
  Assert<Mutual<M.ProjectFile, ProjectFile>>,
  // Analysis (L260-L267); plan rows are PlanEntry: the spec's fields plus codehash and version (contracts §3.1)
  Assert<Equals<Keys<M.Analysis>, Keys<Analysis>>>,
  Assert<Mutual<Omit<M.Analysis, "plan" | "problems">, Omit<Analysis, "plan" | "problems">>>,
  Assert<Equals<Keys<Item<M.Analysis["plan"]>>, Keys<Item<Analysis["plan"]>> | "codehash" | "version">>,
  Assert<Mutual<Pick<Item<M.Analysis["plan"]>, "facet" | "address" | "selectors">, Item<Analysis["plan"]>>>,
  Assert<Equals<Keys<Value<M.Analysis["routing"]>>, Keys<Value<Analysis["routing"]>>>>,
  Assert<Equals<Keys<M.Analysis["stats"]>, Keys<Analysis["stats"]>>>,
  // AnalysisContext (L268-L272) + chain (contracts §3.1) + refs, unconfirmedFrom, knownFrom
  Assert<Equals<Keys<M.AnalysisContext>, Keys<AnalysisContext> | "chain" | "refs" | "unconfirmedFrom" | "knownFrom">>,
  Assert<Mutual<Omit<M.AnalysisContext, "chain" | "refs" | "unconfirmedFrom" | "knownFrom">, AnalysisContext>>,
  Assert<Equals<M.AnalysisContext["unconfirmed"], string[]>>,
  Assert<Equals<M.AnalysisContext["known"], M.Address[]>>,
  Assert<Equals<Keys<Present<M.AnalysisContext["deploy"]>>, Keys<Present<AnalysisContext["deploy"]>>>>,
  // Problem (L273-L278) + code, params, ack (contracts §3.1)
  Assert<Equals<Keys<M.Problem>, Keys<Problem> | "code" | "params" | "ack">>,
  Assert<Mutual<Omit<M.Problem, "code" | "params" | "ack">, Problem>>,
  Assert<Equals<M.Problem["ack"], true | undefined>>,
  Assert<Equals<M.Problem["params"], Record<string, Json>>>,
];

// ── contract additions (contracts §3.1) ───────────────────────────────────────────────────────────

/** The additions as contracts §3.1 writes them, checked the same way. */
type ContractFacetDetail = {
  name: string;
  abi: M.AbiItem[];
  natspec: { notice?: string; dev?: string; functions: Record<Hex4, { notice?: string; dev?: string; params?: Record<string, string> }> };
  storageLayout?: unknown;
  source: { path: string; url: string };
};
type ContractChainState = {
  chainId: number; online: boolean; probedAt: string;
  deployer: { present: boolean; codehash?: Hex };
  createx?: { present: boolean; codehash?: Hex };
  multicall3?: { present: boolean; codehash?: Hex };
  shared: Record<string, { present: boolean; codehash?: Hex }>;
  registry?: { records: Record<string, { facet: Address; codehash: Hex } | null> };
  simulate: boolean;
  gasCap?: string;
  codeAt: Record<string, Hex | "0x">;
  predictedHasCode?: boolean;
  gasEstimate?: string;
};
type ContractPlanEntry = { facet: string; address: Address; codehash: Hex; version: string; selectors: Hex4[] };
type ContractPlanComparison = {
  matches: boolean;
  missing: { facet: string; selectors: Hex4[] }[];
  extra: { address: Address; selectors: Hex4[] }[];
  moved: { selector: Hex4; expected: Address; actual: Address }[];
};
type ContractConsoleLine = {
  tag: "Note" | "Placed" | "Resolved" | "Collision" | "Missing" | "Init" | "Deploy" | "Verify" | "Error";
  text: string; dim?: true; anchor?: Anchor; at: string;
};
type ContractAnchor =
  | { kind: "diamond" }
  | { kind: "facet"; facet: string }
  | { kind: "selector"; selector: Hex4; facet?: string }
  | { kind: "init"; path: string }
  | { kind: "chain"; chainId: number };

export type ContractAssertions = [
  Assert<Equals<M.Hex, `0x${string}`>>,
  Assert<Equals<M.Hex4, M.Hex>>,
  Assert<Equals<M.Address, M.Hex>>,
  Assert<Equals<M.Area, "access" | "accounts" | "amm" | "crosschain" | "defi" | "diamond" | "ens" | "governance" | "oracles" | "privacy" | "security" | "tokens" | "utils">>,
  Assert<Equals<Keys<M.ShardRef>, "path" | "bytes" | "hash">>,
  Assert<Equals<Keys<M.FacetDetail>, Keys<ContractFacetDetail>>>,
  Assert<Mutual<M.FacetDetail, ContractFacetDetail>>,
  Assert<Equals<M.Severity, "blocker" | "warning" | "info">>,
  // ChainState gains `name`, the display name
  Assert<Equals<Keys<M.ChainState>, Keys<ContractChainState> | "name">>,
  Assert<Mutual<Omit<M.ChainState, "name">, ContractChainState>>,
  Assert<Equals<M.ChainState["name"], string>>,
  Assert<Equals<Keys<M.PlanEntry>, Keys<ContractPlanEntry>>>,
  Assert<Mutual<M.PlanEntry, ContractPlanEntry>>,
  Assert<Mutual<M.PlanComparison, ContractPlanComparison>>,
  Assert<Equals<Keys<M.ConsoleLine>, Keys<ContractConsoleLine>>>,
  Assert<Mutual<M.ConsoleLine, ContractConsoleLine>>,
  Assert<Mutual<M.Anchor, ContractAnchor>>,
  Assert<Mutual<M.CommandRef, { id: M.CommandId; args?: Record<string, Json> }>>,
  Assert<Mutual<M.EditResult, { project: M.Project; changed: boolean; summary: string }>>,
  Assert<Mutual<M.Result<number, string>, { ok: true; value: number } | { ok: false; error: string }>>,
  Assert<Equals<M.Routing, M.Analysis["routing"]>>,
  Assert<Equals<M.Layout, M.Project["layout"]>>,
];

// ── runtime: spec-shaped literals pass the schemas ────────────────────────────────────────────────

const hash: Hex = `0x${"ab".repeat(32)}`;
const shard: ShardRef = { path: "shards/ERC20.json", bytes: 1024, hash };
const shared: SharedContract = {
  salt: hash,
  version: "0.4.0",
  address: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  codehash: hash,
  initCodeHash: hash,
  creationCode: shard,
};
const area: Area = "tokens";

const recipe: M.Recipe = {
  $schema: "https://lattice-studio.invalid/schema/recipe.v1.json",
  schemaVersion: 1,
  name: "GovernedVault",
  catalog: { tag: "v0.4.0", hash },
  template: { name: "GovernedVault", catalogHash: hash },
  facets: ["ERC20", "GovernedVault"],
  owners: { "0xa9059cbb": "GovernedVault" },
  exclude: ["0x0ef22643"],
  init: {
    kind: "bundle",
    spec: "GovernedVaultInit",
    args: { p: { asset: "0x5FbDB2315678afecb367f032d93F642f64180aa3", name: "Grant vault", decimalsOffset: "0", admin: { $ref: "self" } } },
  },
};

const catalog: M.Catalog = {
  lattice: { tag: "v0.4.0", commit: "05004d4" },
  toolchain: { foundry: "1.8.1", solc: "0.8.36" },
  hash,
  deployer: { address: "0x4e59b44847b379578588920cA78FbF26c0B4956C", codehash: hash },
  registry: shared,
  factory: shared,
  proxy: { creationCode: shard, initCodeHash: hash, standardJson: shard },
  facets: [
    {
      name: "ERC20",
      area,
      source: "src/tokens/ERC20.sol",
      summary: "Fungible token",
      selectors: [{ hex: "0xa9059cbb", signature: "transfer(address,uint256)" }],
      storage: { id: "lattice.storage.ERC20", slot: hash },
      touches: [],
      release: shared,
      requires: [{ anyOf: ["ERC4626"], strength: "hard", reason: "runs the assets behind ERC4626's shares" }],
      family: "access",
      defaultOwnerOf: ["0xa9059cbb"],
      init: "ERC20Init",
      detail: shard,
    },
  ],
  inits: [
    {
      name: "GovernedVaultInit",
      contract: "GovernedVaultInit",
      fn: "init((address,string,string,uint8,uint256,uint48,uint32,uint256,uint256))",
      kind: "bundle",
      params: [
        {
          name: "p",
          type: "tuple",
          doc: "Vault parameters",
          components: [{ name: "asset", type: "address", doc: "The asset", authority: true, role: "DEFAULT_ADMIN_ROLE" }],
        },
      ],
      initializes: [{ module: "EIP712", with: { name: "name_", version: "1" } }],
      after: [],
      sameCall: [],
      sequence: ["AccessControl", "EmergencyStop"],
      registersInterfaces: true,
      release: shared,
    },
  ],
  recipes: [{ name: "GovernedVault", script: "script/base/defi/DeployGovernedVault.s.sol", proxy: "Lattice", recipe, phase: "v1" }],
  chains: [{ chainId: 11155111, factory: { address: shared.address, codehash: hash, buildCommit: "fba66cb", proxyStandardJson: shard, proxyInitCodeHash: hash } }],
  seams: [{ selector: "0xa9059cbb", when: ["ERC20Votes"], anyOf: ["GovernedVault", "ERC20Votes"], reason: "moves vote checkpoints with balances" }],
  provisional: "Lattice 0.2.0 at dev f4a32c8; v1 targets 0.4.0",
};

const projectFile: M.ProjectFile = {
  project: {
    id: "p1",
    name: "GovernedVault",
    recipe,
    layout: { ERC20: { x: 0, y: 8, pins: "right", expanded: true } },
    deploy: { path: "factory", entropy: `0x${"01".repeat(11)}`, scope: "every-chain" },
    provenance: { "bundle.p.asset": "link" },
    predicted: [{ chainId: 11155111, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3" }],
  },
  deployments: [
    {
      projectId: "p1",
      chainId: 11155111,
      address: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      path: "factory",
      deployer: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      salt: hash,
      status: "confirmed",
      tx: hash,
      block: 9123460,
      recipeHash: hash,
      catalogHash: hash,
      at: "2026-09-23T10:00:00.000Z",
      verification: "exact_match",
      revision: 1,
      fromFile: true,
    },
  ],
};

const analysis: M.Analysis = {
  recipeHash: hash,
  routing: { "0xa9059cbb": { owner: "GovernedVault", contenders: ["ERC20", "GovernedVault"], via: "seam" } },
  problems: [
    {
      id: "SEL-01:0xcdfe7f5c",
      code: "SEL-01",
      severity: "blocker",
      where: [{ kind: "selector", selector: "0xcdfe7f5c" }],
      params: { selector: "0xcdfe7f5c", contenders: ["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"] },
      message: "`sendMessage(bytes,bytes,bytes[])` 0xcdfe7f5c is exported by AxelarGatewayAdapter and HyperlaneGatewayAdapter. Choose one owner.",
      fixes: [{ id: "selector.route", args: { selector: "0xcdfe7f5c", facet: "AxelarGatewayAdapter", verb: "keep" } }],
    },
  ],
  plan: [{ facet: "ERC20", address: shared.address, codehash: hash, version: "0.4.0", selectors: ["0xa9059cbb"] }],
  init: { target: shared.address, refs: ["self"] },
  stats: { facets: 14, routed: 120, exported: 143, excluded: 0, namespaces: 12 },
};

const context: M.AnalysisContext = {
  deploy: { chainId: 11155111, path: "createx", from: shared.address, salt: hash },
  known: [shared.address],
  unconfirmed: ["bundle.p.asset"],
};

const commandRef: CommandRef = { id: "facet.place", args: { facet: "DiamondLoupeFacet" } };

describe("spec data model", () => {
  test("spec-shaped literals typecheck and pass the schemas", () => {
    expect(validateRecipe(recipe).ok).toBe(true);
    expect(validateCatalog(catalog).ok).toBe(true);
    expect(validateProjectFile(projectFile).ok).toBe(true);
    expect(analysis.plan[0]?.selectors).toEqual(["0xa9059cbb"]);
    expect(context.unconfirmed).toEqual(["bundle.p.asset"]);
    expect(commandRef.id).toBe("facet.place");
  });
});
