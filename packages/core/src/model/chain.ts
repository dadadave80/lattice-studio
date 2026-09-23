import type { PlanEntry } from "./analysis";
import type { Catalog, FacetDetail } from "./catalog";
import type { Address, Hex, Hex4 } from "./hex";
import type { DecodedInit } from "./init";
import type { Project } from "./project";
import type { Recipe } from "./recipe";

/** `Project["deploy"]["path"]`: LatticeFactory or CreateX CREATE3. */
export type DeployPath = Project["deploy"]["path"];

/** `Project["deploy"]["scope"]`: salt flag 0x00 (every chain) or 0x01 (this chain only). */
export type Scope = Project["deploy"]["scope"];

/** `AnalysisContext["deploy"]`: resolves references and enables the NET checks (spec L269). */
export type DeployContext = { chainId: number; path: DeployPath; from: Address; salt: Hex };

/** What a code probe found at a shared contract's address. */
export type CodeProbe = { present: boolean; codehash?: Hex };

/**
 * Produced by the chain module, read by the NET checks (contracts §3.1).
 * Addition: `name`, the chain's display name ("Sepolia"), which S8a fills and the NET checks and INIT-01's
 * chain rule put into problem params as `chain`.
 */
export type ChainState = {
  chainId: number;
  /** Display name: "Sepolia", "Base Sepolia". */
  name: string;
  online: boolean;
  probedAt: string;
  /** Arachnid's proxy. */
  deployer: { present: boolean; codehash?: Hex };
  /** Probed only on the CreateX path. */
  createx?: { present: boolean; codehash?: Hex };
  multicall3?: { present: boolean; codehash?: Hex };
  /** By shared-contract name (catalog names, e.g. "ERC20", "LatticeFactory"). */
  shared: Record<string, { present: boolean; codehash?: Hex }>;
  /**
   * "ERC20@0.4.0" → LatticeRegistry.get(nameHash, version); null = not listed. Keys are `<Name>@<version>`
   * with the catalog's names; record addresses are EIP-55 and compare case-insensitively.
   */
  registry?: { records: Record<string, { facet: Address; codehash: Hex } | null> };
  /** eth_simulateV1 available. */
  simulate: boolean;
  /**
   * Per-transaction cap, decimal string: a static per-chain table (EIP-7825's 16,777,216 where it applies),
   * else the latest block's gasLimit.
   */
  gasCap?: string;
  /**
   * Addresses Studio asked about: authority holders, Safe addresses. Keys are lowercase addresses;
   * read it with `codeAtFor`, which lowercases before the lookup.
   */
  codeAt: Record<string, Hex | "0x">;
  predictedHasCode?: boolean;
  gasEstimate?: string;
};

/**
 * The code the chain module found at `address`, or undefined when it didn't ask. `codeAt` keys are lowercase,
 * so a checksummed address finds its entry.
 */
export function codeAtFor(chain: Pick<ChainState, "codeAt">, address: string): Hex | "0x" | undefined {
  const key = address.toLowerCase();
  return Object.hasOwn(chain.codeAt, key) ? chain.codeAt[key] : undefined;
}

/** Addresses the two references resolve to for one deploy (spec L285). */
export type Refs = { self?: Address; deployer?: Address };

/** A transaction to send. Money is bigint in memory (contracts §6). */
export type TxRequest = { to: Address; data: Hex; value: bigint };

/** Injected randomness: returns `bytes` random bytes (core has none of its own, spec L102). */
export type Random = (bytes: number) => Uint8Array;

/**
 * Creation code bytes, by shared-contract name, plus "Lattice" for the proxy. The catalog holds only
 * `ShardRef`s (`code/<Name>.creation.hex`, contracts §4) and core can't fetch, so the caller loads the bytes.
 * Every callee checks `keccak256(bytes)` against the catalog's `initCodeHash` (the SharedContract's, or
 * `catalog.proxy.initCodeHash` for "Lattice") and returns an error when bytes are missing or don't match.
 */
export type CreationCode = Record<string, Hex>;

/** C5b `factoryPredict`: CREATE2(factory, keccak256(abi.encode(from, salt)), proxyInitCodeHash). */
export type FactoryPredictArgs = { factory: Address; proxyInitCodeHash: Hex; from: Address; salt: Hex };

/** C5b `createxPredict`: the guarded salt follows the salt's flag byte; `chainId` is used for flag 0x01. */
export type CreatexPredictArgs = { from: Address; salt: Hex; chainId: number };

/** One facet of a diamond's `facets()` (the loupe). Readonly, so viem's decoded result passes straight in. */
export type LoupeFacet = { readonly facetAddress: Address; readonly functionSelectors: readonly Hex4[] };

/** C5c `buildDiamondDeploy`. */
export type DiamondDeployArgs = {
  recipe: Recipe;
  catalog: Catalog;
  plan: readonly PlanEntry[];
  /** The init call from C4b's `encodeInit`. */
  init: { target: Address; data: Hex };
  path: DeployPath;
  from: Address;
  /** The raw sender-prefixed salt `from ‖ flag ‖ entropy`. */
  salt: Hex;
  chainId: number;
  /** Registry records decide which whole facets go as `RecipeEntry`; without them every facet is a custom cut. */
  chain?: ChainState;
  /**
   * The `Lattice` proxy's creation code. Required on the CreateX path (`deployCreate3AndInit`'s initCode);
   * the callee checks `keccak256(bytes) === catalog.proxy.initCodeHash` and returns an error on a mismatch or
   * when it's missing there. The factory path doesn't need it.
   */
  proxyCreationCode?: Hex;
};

/** C5c `buildDiamondDeploy`'s result. */
export type DiamondDeploy = {
  tx: TxRequest;
  /** The predicted diamond address. */
  address: Address;
  /** Facets sent as `RecipeEntry` (the factory checks them against LatticeRegistry). */
  registryEntries: string[];
  /** Facets sent as custom cuts. */
  customCuts: string[];
};

/** C5c `buildMissingDeploys`. */
export type MissingDeploysArgs = {
  catalog: Catalog;
  /** Shared-contract names absent from the chain (facets, init contracts, LatticeRegistry, LatticeFactory). */
  names: string[];
  chain: ChainState;
  /**
   * Creation code for every name in `names` (Arachnid calldata is `salt ‖ creationCode`). The callee checks
   * each against its SharedContract's `initCodeHash` and returns an error when one is missing or differs.
   */
  code: CreationCode;
  /** Batch through Multicall3 only when its codehash is canonical (spec L842). */
  multicall3Canonical: boolean;
  /** The wallet reports EIP-5792 `atomic: supported`. */
  atomicCalls?: boolean;
  /** Per-transaction gas cap that Multicall3 batches split under. */
  gasCap?: bigint;
  /** Estimated gas per contract name. */
  gas?: Record<string, bigint>;
};

/** C5c `buildMissingDeploys`'s result: transactions (or EIP-5792 calls) and the names each deploys. */
export type MissingDeploys = {
  mode: "transactions" | "multicall" | "calls";
  txs: { tx: TxRequest; names: string[] }[];
  /** Names left out because the chain already has them. */
  skipped: string[];
};

/** C5c `gasShare`: the estimate against the chain's per-transaction cap (NET-06 warns from 80%). */
export type GasShare = { share: number; level: "ok" | "warning" | "over" };

/** C6 `decodeRevert`: what the decoder may use. */
export type RevertContext = {
  /**
   * Loaded ABI shards by name: facets, and where the catalog has them (`SharedContract.detail`,
   * `catalog.proxy.detail`) Lattice, LatticeFactory, LatticeRegistry and the init contracts.
   */
  details: Record<string, FacetDetail>;
  /** Placed facets, preferred when several ABIs declare an error. */
  placed?: string[];
  path?: DeployPath;
  /** The decoded init call, so a raw MultiInit bubble can be attributed to a step's target. */
  init?: DecodedInit;
};

/** C6 `decodeRevert`'s result (spec L75, L727). */
export type DecodedRevert = {
  /** The module whose error it is: "LatticeRegistry", "VaultCore"; null when no known ABI declares it. */
  module: string | null;
  /** Every module that declares this error, when several share it (spec L75: say so rather than guess). */
  shared: string[];
  /** "LatticeRegistry__RecordNotFound". */
  error: string;
  signature?: string;
  /** Decoded with catalog knowledge: name hashes read as names, packed versions as "0.4.0". */
  args: { name: string; type: string; value: string }[];
  /** Outer errors unwrapped, outermost first: "FailedContractInitialisation", "InitializeReverted". */
  wrappers: string[];
  /** The contract or MultiInit step target the revert came from, when known. */
  target?: Address;
  /** What to check when the revert carries no reason (FailedContractCreation, Arachnid's proxy). */
  hint?: string;
  raw: Hex;
};
