import { encodeFunctionData, keccak256, stringToHex } from "viem";
import { CREATEX, createxPredict, factoryPredict, assertSaltSender } from "../address";
import type { PlanEntry } from "../model/analysis";
import type { BuildDiamondDeployFn } from "../model/api";
import type { Catalog } from "../model/catalog";
import type { ChainState, DiamondDeployArgs } from "../model/chain";
import { isAddress, isHexAnyCase, sameAddress, toChecksum, type Address, type Hex, type Hex4 } from "../model/hex";
import { err, ok, type Result } from "../model/result";
import { CREATEX_ABI, LATTICE_FACTORY_ABI, LATTICE_INITIALIZE_ABI } from "./abi";

/** ERC-8153 `exportSelectors()`: LatticeFactory reverts `ExportSelectorForbidden` for it in a custom cut. */
const EXPORT_SELECTOR: Hex4 = "0x0ef22643";

/** `FacetCutAction.Add` (diamond-lib DiamondLib.sol L92-L96). */
const ADD = 0;

type Cut = { facetAddress: Address; action: number; functionSelectors: Hex4[] };
type Entry = { nameHash: Hex; version: bigint };

/** The registry name hash a `RecipeEntry` names: `keccak256("lattice.<Name>")` (LatticeRegistry.sol L124-L127). */
export function registryNameHash(name: string): Hex {
  return keccak256(stringToHex(`lattice.${name}`));
}

/**
 * A semver release version packed as LatticeRegistry keys it: `major << 48 | minor << 24 | patch`
 * (ILatticeRegistry.sol L27-L30), so "0.4.0" is 67108864. Null for anything that isn't `x.y.z` within the
 * 16/24/24-bit fields, and for 0.0.0: version 0 means "latest" to the factory, which Studio never sends (spec L855).
 */
export function packVersion(version: string): bigint | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match === null) return null;
  const [major, minor, patch] = [BigInt(match[1] ?? ""), BigInt(match[2] ?? ""), BigInt(match[3] ?? "")];
  if (major >= 1n << 16n || minor >= 1n << 24n || patch >= 1n << 24n) return null;
  const packed = (major << 48n) | (minor << 24n) | patch;
  return packed === 0n ? null : packed;
}

/**
 * The registry version a whole facet can go as, or null when it must be a custom cut. `getCut` returns the
 * registry's recorded address with the selectors it verified at registration, so a `RecipeEntry` is sent only when
 * that record exists for the pinned version and its facet address and codehash equal the catalog's, and the plan
 * routes every one of the facet's selectors (spec L853: partial facets can't be registry entries).
 */
function registryVersion(entry: PlanEntry, catalog: Catalog, chain: ChainState | undefined): bigint | null {
  const record = chain?.registry?.records[`${entry.facet}@${entry.version}`];
  if (record === undefined || record === null) return null;
  if (!sameAddress(record.facet, entry.address) || record.codehash.toLowerCase() !== entry.codehash.toLowerCase()) return null;
  const facet = catalog.facets.find((candidate) => candidate.name === entry.facet);
  if (facet === undefined) return null;
  const all = new Set(facet.selectors.map((selector) => selector.hex.toLowerCase()));
  const routed = new Set(entry.selectors.map((selector) => selector.toLowerCase()));
  if (all.size !== routed.size || [...all].some((selector) => !routed.has(selector))) return null;
  return packVersion(entry.version);
}

/**
 * Every plan entry must be a catalog facet with the catalog's release address, codehash and version, and must
 * route at least one selector other than `exportSelectors()`. The plan is built from the catalog (C5a), so a
 * difference here means a stale or tampered plan, not something a person can fix on the sheet.
 */
function checkPlan(args: DiamondDeployArgs): Result<null, string> {
  if (args.plan.length === 0) return err("The diamond has no facets to cut; LatticeFactory reverts EmptyRecipe. Place facets first.");
  for (const entry of args.plan) {
    const facet = args.catalog.facets.find((candidate) => candidate.name === entry.facet);
    if (facet === undefined) return err(`${entry.facet} isn't in catalog ${args.catalog.lattice.tag}. Rebuild the plan.`);
    if (!args.recipe.facets.includes(entry.facet)) return err(`${entry.facet} is in the plan but not on the sheet. Rebuild the plan.`);
    const release = facet.release;
    if (!sameAddress(release.address, entry.address) || release.codehash.toLowerCase() !== entry.codehash.toLowerCase() || release.version !== entry.version) {
      return err(`${entry.facet} in the plan differs from its ${args.catalog.lattice.tag} release. Rebuild the plan.`);
    }
    if (entry.selectors.length === 0) return err(`${entry.facet} routes no selectors; an empty Add reverts. Rebuild the plan.`);
    if (entry.selectors.some((selector) => selector.toLowerCase() === EXPORT_SELECTOR)) {
      return err(`${entry.facet} carries exportSelectors() (0x0ef22643), which LatticeFactory refuses in a cut. Rebuild the plan.`);
    }
    const exported = new Set(facet.selectors.map((selector) => selector.hex.toLowerCase()));
    const foreign = entry.selectors.find((selector) => !exported.has(selector.toLowerCase()));
    if (foreign !== undefined) {
      return err(`${entry.facet} doesn't export ${foreign.toLowerCase()} in catalog ${args.catalog.lattice.tag}, so it can't be cut to it. Rebuild the plan.`);
    }
  }
  return ok(null);
}

function customCut(entry: PlanEntry): Cut {
  return {
    facetAddress: toChecksum(entry.address),
    action: ADD,
    functionSelectors: entry.selectors.map((selector) => selector.toLowerCase() as Hex4),
  };
}

function checkInit(init: DiamondDeployArgs["init"]): Result<null, string> {
  if (!isAddress(init.target)) return err(`The init target ${init.target} isn't an address.`);
  if (!isHexAnyCase(init.data)) return err("The init calldata isn't hex bytes.");
  return ok(null);
}

/**
 * The one transaction that creates and initializes the diamond (spec decision 6, R6, Flow 12 step 5).
 *
 * **Factory path** (default): `LatticeFactory.deploy(entries, customCuts, init, initCalldata, salt)` (0x533677de)
 * to the chain's own factory when `catalog.chains` lists one, else the release factory. Whole facets that the
 * chain's LatticeRegistry lists at the pinned version with the catalog's address and codehash go as `RecipeEntry`
 * `{ keccak256("lattice.<Name>"), major<<48 | minor<<24 | patch }`, never version 0; everything else goes as an
 * `Add` custom cut. The factory applies registry cuts first, then custom cuts, so `facets()` order differs from the
 * plan's (C5a `comparePlan` compares per facet). The salt is the raw `from ‖ flag ‖ entropy`; the factory folds
 * `msg.sender` in, and the address comes from C5b `factoryPredict`.
 *
 * **CreateX path**: `CreateX.deployCreate3AndInit(salt, initCode, data, (0, 0))` (0x00d84acb) with the raw
 * sender-prefixed salt, never a guarded hash: CreateX guards the salt itself, and a pre-hashed salt no longer
 * starts with the sender, so CreateX would hash it as an unprotected salt anyone can take first. `initCode` is the
 * `Lattice` creation code (checked against `catalog.proxy.initCodeHash`); `data` is `initialize(cuts, init, data)`
 * with every facet as a custom cut (no registry on this path). The address comes from C5b `createxPredict`.
 *
 * **Repeat `(sender, salt)` at LatticeFactory** (R8, for S8c): the factory returns the existing diamond, ignores
 * this call's entries, cuts and init, and emits nothing: `DiamondDeployed(diamond indexed, deployer indexed, salt)`
 * fires only for a new diamond. A receipt without that event is therefore not proof of a new deploy; S8c reads
 * `facets()` at the predicted address and `comparePlan` reports the Mismatch. On the CreateX path a used salt
 * reverts instead.
 *
 * `chain` counts only when `chain.chainId === chainId`: a probe of another chain is ignored, so every facet then
 * goes as a custom cut (spec L302).
 *
 * Errors (never throws for these): a salt that doesn't start with `from` or has a bad scope byte, an empty or
 * stale plan (a facet that differs from its release, isn't on the sheet, or is given a selector it doesn't
 * export), a bad init, and on the CreateX path missing or wrong `Lattice` creation code.
 */
export const buildDiamondDeploy: BuildDiamondDeployFn = (args) => {
  const { catalog, plan, init, path, from, salt, chainId } = args;
  const saltCheck = assertSaltSender(salt, from);
  if (!saltCheck.ok) return saltCheck;
  const raw = saltCheck.value;
  const planCheck = checkPlan(args);
  if (!planCheck.ok) return planCheck;
  const initCheck = checkInit(init);
  if (!initCheck.ok) return initCheck;
  const initTarget = toChecksum(init.target);
  const initData = init.data.toLowerCase() as Hex;

  if (path === "createx") {
    const code = args.proxyCreationCode;
    if (code === undefined) return err("The Lattice proxy's creation code isn't loaded; the CreateX path needs it. Reload the catalog.");
    if (!isHexAnyCase(code) || keccak256(code) !== catalog.proxy.initCodeHash.toLowerCase()) {
      return err(`The Lattice proxy's creation code doesn't match catalog ${catalog.lattice.tag}'s init code hash. Reload the catalog.`);
    }
    let address: Address;
    try {
      address = createxPredict({ from, salt: raw, chainId });
    } catch (error) {
      return err(error instanceof Error ? error.message : String(error));
    }
    const cuts = plan.map(customCut);
    const initialize = encodeFunctionData({ abi: LATTICE_INITIALIZE_ABI, functionName: "initialize", args: [cuts, initTarget, initData] });
    const data = encodeFunctionData({
      abi: CREATEX_ABI,
      functionName: "deployCreate3AndInit",
      args: [raw, code.toLowerCase() as Hex, initialize, { constructorAmount: 0n, initCallAmount: 0n }],
    });
    return ok({ tx: { to: CREATEX, data, value: 0n }, address, registryEntries: [], customCuts: plan.map((entry) => entry.facet) });
  }

  const own = catalog.chains.find((release) => release.chainId === chainId)?.factory;
  const factory = toChecksum(own?.address ?? catalog.factory.address);
  const proxyInitCodeHash = own?.proxyInitCodeHash ?? catalog.proxy.initCodeHash;
  const address = factoryPredict({ factory, proxyInitCodeHash, from, salt: raw });
  // A probe of another chain (a stale one after a chain switch) must never decide RecipeEntries.
  const probed = args.chain?.chainId === chainId ? args.chain : undefined;
  const entries: Entry[] = [];
  const cuts: Cut[] = [];
  const registryEntries: string[] = [];
  const customCuts: string[] = [];
  for (const entry of plan) {
    const version = registryVersion(entry, catalog, probed);
    if (version === null) {
      cuts.push(customCut(entry));
      customCuts.push(entry.facet);
    } else {
      entries.push({ nameHash: registryNameHash(entry.facet), version });
      registryEntries.push(entry.facet);
    }
  }
  const data = encodeFunctionData({ abi: LATTICE_FACTORY_ABI, functionName: "deploy", args: [entries, cuts, initTarget, initData, raw] });
  return ok({ tx: { to: factory, data, value: 0n }, address, registryEntries, customCuts });
};
