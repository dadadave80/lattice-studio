import { expect, test } from "bun:test";
import type { Address, Hex, Hex4 } from "../model/hex";
import type { UpgradeOrigin } from "../model/project";
import { makeCatalog, makeFacet, makeProject, makeRecipe } from "../testing/builders";
import { upgradeSelectorRefusal } from "./guards";

const diamond: Address = "0x0000000000000000000000000000000000000011";
const actual: Address = "0x0000000000000000000000000000000000000022";
const foreign: Address = "0x0000000000000000000000000000000000000033";
const hash: Hex = `0x${"ab".repeat(32)}`;
const raw: Hex4 = "0xabcdef12";
const known = makeFacet({ name: "Known", selectors: ["one()"] });
const selector = known.selectors[0]!.hex;
const catalog = makeCatalog({ facets: [known] });
const origin: UpgradeOrigin = { chainId: 1, block: 2, blockHash: hash, address: diamond, owner: null,
  facets: [{ facetAddress: actual, functionSelectors: [selector, raw] }],
  codehashes: { [diamond]: hash, [actual]: known.release.codehash } };
const project = (upgrade: UpgradeOrigin = origin) => makeProject({ recipe: makeRecipe({ mode: "upgrade", facets: [], facetInstances: {}, init: { kind: "none" } }, catalog), upgrade });

test("ordinary compositions need no imported baseline", () => {
  expect(upgradeSelectorRefusal(makeProject(), catalog, raw)).toBeNull();
  const { upgrade: _upgrade, ...missing } = project();
  expect(upgradeSelectorRefusal(missing, catalog, raw)).toContain("missing its pinned origin");
});

test("known runtime exports stay editable at their actual instance address", () => {
  expect(actual).not.toBe(known.release.address);
  expect(upgradeSelectorRefusal(project(), catalog, selector)).toBeNull();
  expect(upgradeSelectorRefusal(project(), catalog, "0x12345678")).toBeNull();
});

test("raw extras stay locked after their desired descriptor and card were removed", () => {
  expect(upgradeSelectorRefusal(project(), catalog, raw)).toContain("whole facet instance");
  expect(upgradeSelectorRefusal(project(), catalog, "0xABCDEF12")).toContain("whole facet instance");
});

test("foreign runtime functions stay opaque even when a bundled facet exports the selector", () => {
  const upgraded = { ...origin, facets: [{ facetAddress: foreign, functionSelectors: [selector] }], codehashes: { [diamond]: hash, [foreign]: hash } };
  expect(upgradeSelectorRefusal(project(upgraded), catalog, selector)).toContain("whole facet instance");
});

test("self selectors are immutable even when the diamond hash matches a catalog runtime", () => {
  const upgraded = { ...origin, facets: [{ facetAddress: diamond, functionSelectors: [selector] }], codehashes: { [diamond]: known.release.codehash } };
  expect(upgradeSelectorRefusal(project(upgraded), catalog, selector)).toContain("immutable");
});

test("missing runtime evidence fails closed instead of granting catalog metadata", () => {
  expect(upgradeSelectorRefusal(project({ ...origin, codehashes: { [diamond]: hash } }), catalog, selector)).not.toBeNull();
});
