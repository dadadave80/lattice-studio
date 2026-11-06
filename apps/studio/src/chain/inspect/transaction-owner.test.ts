import { describe, expect, test } from "bun:test";
import { makeCatalog, makeFacet } from "@lattice-studio/core/testing";
import type { Address, Hex } from "@lattice-studio/core";
import { ALICE, BOB, fakePort, manualClock } from "../deploy/testing";
import { createTransactionController } from "./transaction";
import { authorizeKnownOwner } from "./transaction-owner";
import type { DiamondSnapshot } from "./snapshot";

const DIAMOND: Address = "0x00000000000000000000000000000000000000AA";
const FOREIGN: Address = "0x00000000000000000000000000000000000000cc";
const ownable = makeFacet({ name: "OwnableFacet", selectors: ["owner()", "transferOwnership(address)", "renounceOwnership()", "completeOwnershipHandover(address)", "requestOwnershipHandover()"] });
const cut = makeFacet({ name: "DiamondCutFacet", selectors: ["diamondCut((address,uint8,bytes4[])[],address,bytes)"] });
const token = makeFacet({ name: "ERC20", selectors: ["approve(address,uint256)"] });
const catalog = makeCatalog({ facets: [ownable, cut, token] });
const snapshot = (): DiamondSnapshot => ({ block: 1, blockHash: `0x${"ab".repeat(32)}`, code: "0x6000", facets: catalog.facets.map((facet) => ({ facetAddress: facet.release.address, functionSelectors: facet.selectors.map((selector) => selector.hex) })), codehashes: Object.fromEntries(catalog.facets.map((facet) => [facet.release.address.toLowerCase(), facet.release.codehash])), ownerRouted: true, owner: BOB });
const data = (signature: string): Hex => `${catalog.facets.flatMap((facet) => facet.selectors).find((selector) => selector.signature === signature)!.hex}${"00".repeat(128)}` as Hex;

describe("verified owner write policy", () => {
  test.each(["transferOwnership(address)", "renounceOwnership()", "completeOwnershipHandover(address)", "diamondCut((address,uint8,bytes4[])[],address,bytes)"])("%s rejects a non-owner before simulation", async (signature) => {
    const port = fakePort({ catalog: () => catalog });
    const observed = snapshot();
    const controller = createTransactionController({
      chains: [{ id: 11155111, testnet: true }], chain: async () => port,
      inspect: async () => ({ ok: true, value: observed }),
      context: () => ({ key: "review", online: true, readOnly: null }), subscribe: () => () => {},
      clock: manualClock(), receiptTimeout: () => 10,
      authorize: async (review, fresh) => authorizeKnownOwner(review, fresh, [catalog]),
    });
    await controller.review({ chainId: 11155111, tx: { to: DIAMOND, data: data(signature), value: 0n }, snapshot: observed });
    expect(controller.get().phase).toBe("failed");
    expect(controller.get().error).toBe("Connected account is not the owner");
    expect(port.methods()).not.toContain("simulate");
    expect(port.sent).toHaveLength(0);
    controller.dispose();
  });

  test("an actual owner passes; unrelated public writes and ownership requests stay callable", () => {
    const observed = snapshot();
    const review = (signature: string, from = ALICE) => ({ chainId: 11155111, from, tx: { to: DIAMOND, data: data(signature), value: 0n } });
    expect(authorizeKnownOwner(review("transferOwnership(address)", BOB), observed, [catalog]).ok).toBe(true);
    expect(authorizeKnownOwner(review("approve(address,uint256)"), observed, [catalog]).ok).toBe(true);
    expect(authorizeKnownOwner(review("requestOwnershipHandover()"), observed, [catalog]).ok).toBe(true);
  });

  test("a non-owner's public ERC20 approval still reaches simulation and signing", async () => {
    const port = fakePort({ catalog: () => catalog }); const observed = snapshot();
    const controller = createTransactionController({ chains: [{ id: 11155111, testnet: true }], chain: async () => port,
      inspect: async () => ({ ok: true, value: observed }), context: () => ({ key: "review", online: true, readOnly: null }), subscribe: () => () => {},
      clock: manualClock(), receiptTimeout: () => 10, authorize: async (review, fresh) => authorizeKnownOwner(review, fresh, [catalog]),
    });
    await controller.review({ chainId: 11155111, tx: { to: DIAMOND, data: data("approve(address,uint256)"), value: 0n }, snapshot: observed });
    expect(controller.get().phase).toBe("ready");
    expect(port.methods()).toContain("simulate");
    await controller.sign();
    expect(port.sent).toHaveLength(1);
    expect(port.sent[0]?.from).toBe(ALICE);
    controller.dispose();
  });

  test("unknown implementation or owner getter policies defer to simulation", () => {
    const observed = snapshot();
    const review = { chainId: 11155111, from: ALICE, tx: { to: DIAMOND, data: data("diamondCut((address,uint8,bytes4[])[],address,bytes)"), value: 0n } };
    const unknown = { ...observed, codehashes: { ...observed.codehashes, [cut.release.address.toLowerCase()]: `0x${"99".repeat(32)}` as Hex } };
    expect(authorizeKnownOwner(review, unknown, [catalog]).ok).toBe(true);
    const ownerSelector = ownable.selectors.find((selector) => selector.signature === "owner()")!.hex;
    const untrustedGetter = { ...observed, facets: [...observed.facets!.map((row) => ({ ...row, functionSelectors: row.functionSelectors.filter((selector) => selector !== ownerSelector) })), { facetAddress: FOREIGN, functionSelectors: [ownerSelector] }], codehashes: { ...observed.codehashes, [FOREIGN.toLowerCase()]: `0x${"99".repeat(32)}` as Hex } };
    expect(authorizeKnownOwner(review, untrustedGetter, [catalog]).ok).toBe(true);
    expect(authorizeKnownOwner(review, { ...observed, owner: null }, [catalog]).ok).toBe(true);
    const other = { ...ownable, release: { ...ownable.release, codehash: `0x${"88".repeat(32)}` as Hex } };
    const mixed = { ...observed, codehashes: { ...observed.codehashes, [ownable.release.address.toLowerCase()]: other.release.codehash } };
    expect(authorizeKnownOwner(review, mixed, [catalog, makeCatalog({ facets: [other] })]).ok).toBe(true);
  });
});
