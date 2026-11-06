import { err, isAddress, ok, sameAddress, toChecksum, type Address, type Catalog, type Facet, type Hex, type Result } from "@lattice-studio/core";
import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, stringToHex, toFunctionSelector } from "viem";
import type { ChainCallOptions, ChainCallError } from "@/contracts/chain";
import type { DiamondSnapshot } from "./snapshot";
import type { InspectionTarget } from "./engine";

export const UPGRADE_CUT_SIGNATURE = "diamondCut((address,uint8,bytes4[])[],address,bytes)";
export const UPGRADE_CUT_SELECTOR = toFunctionSelector(UPGRADE_CUT_SIGNATURE);
const OWNER = toFunctionSelector("owner()");
const SAFE = toFunctionSelector("safe()");
const HAS_ROLE = toFunctionSelector("hasRole(bytes32,address)");
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const ADMIN = `0x${"00".repeat(32)}` as Hex;
const EXECUTOR = keccak256(stringToHex("UPGRADE_EXECUTOR_ROLE"));
const ABI = parseAbi(["function owner() view returns(address)", "function safe() view returns(address)", "function hasRole(bytes32,address) view returns(bool)"]);

export type UpgradeAuthorityCall = (target: InspectionTarget, data: Hex, options: ChainCallOptions) => Promise<Result<Hex, ChainCallError>>;
export type UpgradeAuthority = {
  kind: "owner" | "role" | "safe" | "custom";
  mechanism: string;
  explanation: string;
  canSign: boolean;
  authenticated: boolean;
  identity: string;
  holder?: Address;
  role?: Hex;
};

export function verifiedUpgradeFacet(snapshot: Pick<DiamondSnapshot, "facets" | "codehashes">, catalogs: readonly Catalog[], selector: Hex): Facet | undefined {
  const owner = snapshot.facets?.find((row) => row.functionSelectors.some((entry) => entry.toLowerCase() === selector));
  const hash = owner && snapshot.codehashes[owner.facetAddress.toLowerCase()];
  return hash ? catalogs.flatMap((catalog) => catalog.facets).find((facet) => facet.release.codehash.toLowerCase() === hash.toLowerCase()
    && facet.selectors.some((entry) => entry.hex.toLowerCase() === selector)) : undefined;
}
const trusted = verifiedUpgradeFacet;

function unverified(kind: "owner" | "role", mechanism: string): Result<UpgradeAuthority, string> {
  return ok({ kind, mechanism, canSign: false, authenticated: false, identity: `${mechanism}:unverified`,
    explanation: "The upgrade mechanism is known, but its current authority getter can't be authenticated. Its authority must be readable before Studio can sign or export this cut." });
}

/** Source policies at the pinned Lattice: owner, DEFAULT_ADMIN_ROLE, pinned Safe, or UPGRADE_EXECUTOR_ROLE.
 * A recognized name without its runtime hash never earns this policy. Every live answer is hash-pinned. */
export async function readUpgradeAuthority(target: InspectionTarget, snapshot: DiamondSnapshot, catalogs: readonly Catalog[], candidate: Address, call: UpgradeAuthorityCall): Promise<Result<UpgradeAuthority, string>> {
  if (!isAddress(candidate) || sameAddress(candidate, ZERO)) return err("Choose a valid upgrade sender.");
  const routed = snapshot.facets?.some((row) => row.functionSelectors.some((selector) => selector.toLowerCase() === UPGRADE_CUT_SELECTOR));
  if (!routed) {
    const scheduling = toFunctionSelector("scheduleCut((address,uint8,bytes4[])[],address,bytes,bytes32)");
    return err(trusted(snapshot, catalogs, scheduling)?.name === "GovernedSafeDiamondCut"
      ? "This diamond requires its Safe timelock scheduling and execution workflow. A synchronous diamondCut would bypass that workflow."
      : "This diamond has no synchronous diamondCut selector. Use its actual upgrade workflow.");
  }
  const mechanism = trusted(snapshot, catalogs, UPGRADE_CUT_SELECTOR)?.name;
  if (mechanism !== "DiamondCutFacet" && mechanism !== "AccessControlDiamondCut" && mechanism !== "SafeDiamondCut" && mechanism !== "GovernedDiamondCut") {
    return ok({ kind: "custom", mechanism: mechanism ?? "Unidentified diamondCut", authenticated: false, canSign: true, identity: "custom-simulation",
      explanation: "This cut's authority is custom or unidentified. Studio will require successful simulation from the exact connected account; it cannot authenticate a Safe export policy." });
  }
  const mechanismHash = trusted(snapshot, catalogs, UPGRADE_CUT_SELECTOR)!.release.codehash.toLowerCase();
  // One verified bundle must establish compatible authority storage, rather than combining versions.
  const compatible = catalogs.filter((catalog) => catalog.facets.some((facet) => facet.name === mechanism && facet.release.codehash.toLowerCase() === mechanismHash
    && facet.selectors.some((selector) => selector.hex.toLowerCase() === UPGRADE_CUT_SELECTOR)));
  try {
    if (mechanism === "DiamondCutFacet") {
      const getter = trusted(snapshot, compatible, OWNER);
      if (getter?.name !== "OwnableFacet" && getter?.name !== "Ownable") return unverified("owner", mechanism);
      const read = await call(target, encodeFunctionData({ abi: ABI, functionName: "owner" }), { blockHash: snapshot.blockHash });
      if (!read.ok) return err("The current owner couldn't be read at the observed block. Retry the upgrade review.");
      const holder = toChecksum(decodeFunctionResult({ abi: ABI, functionName: "owner", data: read.value }));
      return ok({ kind: "owner", mechanism, holder, authenticated: true, canSign: sameAddress(holder, candidate), identity: `${mechanism}:${holder.toLowerCase()}`,
        explanation: sameAddress(holder, candidate) ? "The connected account is the currently observed owner." : "Only the currently observed owner can execute this cut. An owner that is a Safe can export the exact call as a proposal." });
    }
    if (mechanism === "SafeDiamondCut") {
      if (trusted(snapshot, catalogs, SAFE)?.release.codehash.toLowerCase() !== trusted(snapshot, catalogs, UPGRADE_CUT_SELECTOR)?.release.codehash.toLowerCase()) {
        return err("The pinned Safe getter isn't served by the authenticated Safe upgrade mechanism.");
      }
      const read = await call(target, encodeFunctionData({ abi: ABI, functionName: "safe" }), { blockHash: snapshot.blockHash });
      if (!read.ok) return err("The pinned Safe couldn't be read at the observed block. Retry the upgrade review.");
      const holder = toChecksum(decodeFunctionResult({ abi: ABI, functionName: "safe", data: read.value }));
      if (sameAddress(holder, ZERO)) return err("This upgrade mechanism has no nonzero pinned Safe.");
      return ok({ kind: "safe", mechanism, holder, authenticated: true, canSign: sameAddress(holder, candidate), identity: `${mechanism}:${holder.toLowerCase()}`,
        explanation: "Only the currently pinned Safe can execute this cut. The Safe must call the diamond with operation Call." });
    }
    const getter = trusted(snapshot, compatible, HAS_ROLE);
    if (!getter || !["AccessControl", "AccessControlEnumerable", "AccessControlTimed"].includes(getter.name)) return unverified("role", mechanism);
    const role = mechanism === "GovernedDiamondCut" ? EXECUTOR : ADMIN;
    const read = await call(target, encodeFunctionData({ abi: ABI, functionName: "hasRole", args: [role, candidate] }), { blockHash: snapshot.blockHash });
    if (!read.ok) return err("The current upgrade role couldn't be read at the observed block. Retry the upgrade review.");
    const granted = decodeFunctionResult({ abi: ABI, functionName: "hasRole", data: read.value });
    return ok({ kind: "role", mechanism, role, authenticated: true, canSign: granted, identity: `${mechanism}:${role}:${candidate.toLowerCase()}:${String(granted)}`,
      explanation: granted ? `The proposed sender currently holds ${mechanism === "GovernedDiamondCut" ? "UPGRADE_EXECUTOR_ROLE" : "DEFAULT_ADMIN_ROLE"}.`
        : mechanism === "GovernedDiamondCut" ? "This account doesn't hold UPGRADE_EXECUTOR_ROLE. Use the diamond's governance execution workflow or a legitimately granted executor."
          : "This account doesn't hold DEFAULT_ADMIN_ROLE. An unrelated owner has no upgrade authority here." });
  } catch { return err("The upgrade authority returned unavailable or malformed data. Retry the review."); }
}
