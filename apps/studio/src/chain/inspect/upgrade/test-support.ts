import { reconstructUpgrade, type Catalog, type Project, type UpgradeOrigin } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";

export const UPGRADE_DIAMOND = "0x00000000000000000000000000000000000000aa";
export const KNOWN_INSTANCE = "0x00000000000000000000000000000000000000bb";
export const FOREIGN_INSTANCE = "0x00000000000000000000000000000000000000cc";
export const KNOWN_ID = `onchain:${KNOWN_INSTANCE}`;
export const FOREIGN_ID = `onchain:${FOREIGN_INSTANCE}`;
export const SELF_ID = `onchain:${UPGRADE_DIAMOND}`;

export function upgradeFixture(catalog: Catalog): Project {
  const token = catalog.facets.find((facet) => facet.name === "ERC20");
  if (!token) throw new Error("Missing token fixture.");
  const origin: UpgradeOrigin = {
    chainId: 11155111, address: UPGRADE_DIAMOND, owner: null, block: 123, blockHash: `0x${"12".repeat(32)}`,
    facets: [
      { facetAddress: KNOWN_INSTANCE, functionSelectors: [token.selectors[0]!.hex, "0xdeadbeef"] },
      { facetAddress: FOREIGN_INSTANCE, functionSelectors: ["0x12345678", "0x87654321"] },
      { facetAddress: UPGRADE_DIAMOND, functionSelectors: ["0xffffffff"] },
    ],
    codehashes: { [KNOWN_INSTANCE]: token.release.codehash, [FOREIGN_INSTANCE]: `0x${"34".repeat(32)}`, [UPGRADE_DIAMOND]: `0x${"56".repeat(32)}` },
  };
  const reconstructed = reconstructUpgrade(origin, catalog);
  if (!reconstructed.ok) throw new Error(reconstructed.error);
  return makeProject({ id: "upgrade-ui", name: "Existing diamond upgrade", recipe: reconstructed.value, upgrade: origin,
    layout: Object.fromEntries(reconstructed.value.facets.map((name, index) => [name, { x: index * 360 + 48, y: 48, pins: "left" as const }])),
  });
}
