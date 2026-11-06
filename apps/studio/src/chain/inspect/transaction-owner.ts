import { sameAddress, type Catalog, type Hex, type Result } from "@lattice-studio/core";
import { keccak256 } from "viem";
import type { DiamondSnapshot } from "./snapshot";
import type { TransactionReview } from "./transaction";

const OWNER = "0x8da5cb5b";
const OWNABLE_WRITES = new Set(["transferOwnership(address)", "renounceOwnership()", "completeOwnershipHandover(address)"]);
const DIAMOND_CUT = "diamondCut((address,uint8,bytes4[])[],address,bytes)";
const OK: Result<void, string> = { ok: true, value: undefined };

/** Only audited bundled implementations establish this owner policy. Unknown policy still uses simulation. */
export function authorizeKnownOwner(
  review: Pick<TransactionReview, "from" | "tx">, snapshot: DiamondSnapshot, catalogs: readonly Catalog[],
): Result<void, string> {
  const selector = review.tx.data.slice(0, 10).toLowerCase();
  const implementationHash = (selected: string): Hex | undefined => {
    const row = snapshot.facets?.find((facet) => facet.functionSelectors.some((value) => value.toLowerCase() === selected));
    if (!row) return undefined;
    return sameAddress(row.facetAddress, review.tx.to) ? keccak256(snapshot.code) : snapshot.codehashes[row.facetAddress.toLowerCase()];
  };
  const implementation = implementationHash(selector); const getter = implementationHash(OWNER);
  if (implementation === undefined || getter === undefined || !snapshot.ownerRouted || snapshot.owner === null || snapshot.ownerError !== undefined) return OK;
  // A common bundle establishes compatible OwnableLib storage; unrelated historical versions stay unknown.
  const gated = catalogs.some((catalog) => catalog.facets.some((facet) => facet.release.codehash.toLowerCase() === implementation.toLowerCase()
    && facet.selectors.some((entry) => entry.hex.toLowerCase() === selector
      && ((facet.name === "OwnableFacet" && OWNABLE_WRITES.has(entry.signature)) || (facet.name === "DiamondCutFacet" && entry.signature === DIAMOND_CUT))))
    && catalog.facets.some((facet) => facet.release.codehash.toLowerCase() === getter.toLowerCase() && facet.name === "OwnableFacet"
      && facet.selectors.some((entry) => entry.hex.toLowerCase() === OWNER && entry.signature === "owner()")));
  if (!gated) return OK;
  return sameAddress(snapshot.owner, review.from) ? OK : { ok: false, error: "Connected account is not the owner" };
}
