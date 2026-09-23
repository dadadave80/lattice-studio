import type { Abi } from "viem";
import type { Address, Hex, Hex4 } from "./hex";
import type { Json } from "./json";
import type { Recipe } from "./recipe";

/** An init parameter's unit (spec L180): durations in seconds, percentages out of 100, amounts in wei. */
export type Unit = "seconds" | "percent" | "wei";

/** Catalog areas (contracts §3.1). */
export type Area =
  | "access" | "accounts" | "amm" | "crosschain" | "defi" | "diamond" | "ens"
  | "governance" | "oracles" | "privacy" | "security" | "tokens" | "utils";

/** A file in the catalog directory (contracts §3.1). `hash` = keccak256 of the file bytes. */
export type ShardRef = { path: string; bytes: number; hash: Hex };

/** One ABI entry: function, error, event (and constructor, fallback, receive), as viem types it. */
export type AbiItem = Abi[number];

/** One shard per facet, loaded on demand (contracts §3.1, §4 `shards/<Facet>.json`). */
export type FacetDetail = {
  name: string;
  /** Functions, errors, events. */
  abi: AbiItem[];
  natspec: {
    notice?: string;
    dev?: string;
    functions: Record<Hex4, { notice?: string; dev?: string; params?: Record<string, string> }>;
  };
  storageLayout?: unknown;
  /** GitHub URL at the pinned commit. */
  source: { path: string; url: string };
};

/**
 * The generated catalog index, one per Lattice release (spec L139-L148).
 * Addition (contracts §3.1): `provisional`.
 */
export type Catalog = {
  /** "v0.4.0" and the commit that tag points to. */
  lattice: { tag: string; commit: string };
  /** "1.8.1", "0.8.36". */
  /** `solcLong` is solc's full version ("0.8.36+commit.…"), which Sourcify's v2 API wants (S8d); catalogs written before FX20 lack it. */
  toolchain: { foundry: string; solc: string; solcLong?: string };
  /** keccak256 of the canonical index. */
  hash: Hex;
  /** Arachnid's deterministic deployment proxy, 0x4e59…956C. */
  deployer: { address: Address; codehash: Hex };
  /** Versionless salts; constructor arguments are in the creation code. */
  registry: SharedContract;
  factory: SharedContract;
  /**
   * Lattice at this tag. Addition: `detail`, the proxy's ABI shard (its errors, for revert decoding, spec L75),
   * written by catalog-gen.
   */
  proxy: { creationCode: ShardRef; initCodeHash: Hex; standardJson: ShardRef; detail?: ShardRef };
  facets: Facet[];
  inits: InitSpec[];
  recipes: RecipeTemplate[];
  chains: ChainRelease[];
  /** Overlay. */
  seams: Seam[];
  /**
   * Set when the pinned Lattice isn't the release v1 targets: "Lattice 0.2.0 at dev f4a32c8; v1 targets 0.4.0".
   * The About page and the first console line show it (contracts §3.1).
   */
  provisional?: string;
  /**
   * Addition: linked libraries Studio releases as shared contracts (PoseidonT3 for Semaphore and ShieldedPool),
   * each through Arachnid's proxy like any other shared contract.
   */
  libraries?: { name: string; release: SharedContract }[];
  /** Addition: the LatticeRegistry owner the release assumes (decision D6's placeholder while provisional). */
  registryOwner?: Address;
};

/** Deployed once per chain through Arachnid's proxy (spec L149-L155). */
export type SharedContract = {
  /** keccak256("lattice.<Name>.<version>"), passed unhashed. */
  salt: Hex;
  /** Release version; also the registry version a RecipeEntry pins. */
  version: string;
  /** CREATE2(deployer, salt, initCodeHash): the same on every chain. */
  address: Address;
  /** Runtime codehash. */
  codehash: Hex;
  /** The hash the address commits to. */
  initCodeHash: Hex;
  /** Enough for anyone to deploy it byte for byte. */
  creationCode: ShardRef;
  /**
   * Addition: the ABI shard (its errors, for revert decoding, spec L75) of a contract that isn't a facet:
   * LatticeRegistry, LatticeFactory, init contracts. Facets carry theirs in `Facet.detail`.
   */
  detail?: ShardRef;
  /**
   * Addition: shared contracts that must be on the chain first, by name (a linked library such as PoseidonT3,
   * listed in `Catalog.libraries`). Missing-contract deploys order them before this one.
   */
  dependsOn?: string[];
  /** Addition: why this contract's address isn't final yet, e.g. it links a library Lattice doesn't pin. */
  provisional?: string;
};

/** A facet in `FacetInventory` (spec L156-L168). */
export type Facet = {
  /** FacetInventory name, e.g. "ERC20". */
  name: string;
  area: Area;
  source: string;
  summary: string;
  /** exportSelectors() minus 0x0ef22643. */
  selectors: { hex: Hex4; signature: string }[];
  /** Own ERC-7201 namespace. */
  storage?: { id: string; slot: Hex };
  /** Namespaces its libraries write. */
  touches: string[];
  release: SharedContract;
  /** Overlay. */
  requires: { anyOf: string[]; strength: "hard" | "convention"; reason: string }[];
  /** Overlay: one member per diamond. */
  family?: "upgrade" | "access" | "account";
  /** Overlay: wins these by default. */
  defaultOwnerOf?: Hex4[];
  /** InitSpec name. */
  init?: string;
  /** ABI with errors and events, NatSpec, layout. */
  detail: ShardRef;
};

/** Selectors that must stay on a particular version once certain facets are placed (spec L169-L174, R19). */
export type Seam = {
  selector: Hex4;
  /** Active once all of these are placed, e.g. ["ERC20Votes"]. */
  when: string[];
  /** Facets allowed to serve it, preferred first. */
  anyOf: string[];
  /** "moves vote checkpoints with balances". */
  reason: string;
};

/**
 * One parameter of an init function (spec L178-L183).
 * Additions: `components` (contracts §3.1, tuple parameters; paths address them with a dot, `bundle.p.asset`)
 * `role` (contracts §4 overlay: the role an `authority` parameter receives; C4c's authority table reads it) and
 * `exampleSource` (contracts §4: where the example comes from, so Studio-written examples are flagged).
 */
export type InitParam = {
  name: string;
  /**
   * The ABI JSON type, as viem takes it: "address", "uint48", "string", and "tuple" or "tuple[]" when
   * `components` is set (never the "(address,string)" form).
   */
  type: string;
  doc: string;
  unit?: Unit;
  /** Grammar in contracts §4: range(a,b), gt(n), gte(n), nonzero, maxlen(n), code(safe|token|contract), enum(a|b|c), joined with &. */
  rule?: string;
  /** A template's demo value, flagged until changed (INIT-05). */
  example?: Json;
  /** Where `example` comes from: "studio" when Studio wrote it, else `<path>#L<a>-L<b>` in Lattice at the pin. */
  exampleSource?: string;
  /** Receives a role, ownership or upgrade rights. */
  authority?: true;
  /** Overlay: the role it receives, e.g. "DEFAULT_ADMIN_ROLE". */
  role?: string;
  /** Tuple components, in struct order, with the struct's field names at the pin. */
  components?: InitParam[];
};

/** An init contract (spec L175-L191). */
export type InitSpec = {
  /** "ERC20Init". */
  name: string;
  contract: string;
  /** "init(string,string)". */
  fn: string;
  /** A bundle is one call whose order is fixed in Solidity. */
  kind: "step" | "bundle";
  params: InitParam[];
  /**
   * Every `__X_init` it runs, directly or through its libraries (contracts §3.1),
   * e.g. EIP712 with name from "name_", version "1".
   */
  initializes: { module: string; with?: Record<string, string> }[];
  /** Documented order constraints (overlay). */
  after: string[];
  /** Modules that must initialize in the same initialize() call. */
  sameCall: string[];
  /** Bundles: internal order, shown read-only. */
  sequence?: string[];
  /**
   * Sets its own ERC-165 flags, so no introspection step is added. True only when the init itself calls
   * `DiamondLib.registerInterface()` (contracts §3.1).
   */
  registersInterfaces?: true;
  /** Present: deployed per use, not as a shared contract. */
  ctorArgs?: { name: string; type: string }[];
  /** Absent when ctorArgs is present. */
  release?: SharedContract;
};

/** A Lattice deploy script as a loadable recipe (spec L192-L197). */
export type RecipeTemplate = {
  /** "GovernedVault". */
  name: string;
  /** "script/base/defi/DeployGovernedVault.s.sol". */
  script: string;
  proxy: "Lattice" | "AccountDiamond" | "ModularAccount6900";
  /** Facets, owners, exclusions and init, as the script builds them. */
  recipe: Recipe;
  phase: "v1" | "v1.1" | "later";
};

/**
 * Per-chain release data (spec L198-L203).
 * Addition (contracts §3.1): `factory.proxyInitCodeHash`, which a chain-specific LatticeFactory keeps as a
 * private immutable, so it can't be predicted offline without it.
 */
export type ChainRelease = {
  chainId: number;
  /** A chain-specific factory, such as one with ENS reverse records, used instead of the canonical one. */
  factory?: {
    address: Address;
    codehash: Hex;
    buildCommit: string;
    proxyStandardJson: ShardRef;
    proxyInitCodeHash: Hex;
  };
};

/** `catalog/manifest.json` (contracts §4). */
export type CatalogManifest = {
  default: string;
  catalogs: { id: string; tag: string; commit: string; hash: Hex; path: string }[];
};

/** One row of the recipe list (C5a `templateList`, spec L407). */
export type TemplateItem = {
  name: string;
  script: string;
  proxy: RecipeTemplate["proxy"];
  phase: RecipeTemplate["phase"];
  /** Only v1 recipes on the plain Lattice proxy load. */
  loadable: boolean;
  /** Why it doesn't load: "Arrives in v1.1", plus the account recipes' own-factory note (R20). */
  note?: string;
  facets: number;
};
