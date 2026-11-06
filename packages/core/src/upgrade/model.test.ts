import { describe, expect, test } from "bun:test";
import { parseProjectFile, parseRecipe } from "../canonical/parse";
import { recipeHash } from "../canonical/hash";
import { canonicalJson } from "../canonical/json";
import { normalizeRecipe } from "../canonical/normalize";
import { makeCatalog, makeFacet, makeProject, makeRecipe } from "../testing/builders";
import { validateDeployment, validateRecipe } from "../model/schema";

const address = "0x0000000000000000000000000000000000000011";
const id = `onchain:${address}`;
const hash = `0x${"ab".repeat(32)}` as const;
const selector = "0x12345678";
const catalog = makeCatalog({ facets: [makeFacet({ name: "Known", selectors: ["read()"] })] });
const imported = {
  kind: "foreign", address, codehash: hash, selectors: [selector],
} as const;
const recipe = () => ({ ...makeRecipe({ facets: [id] }, catalog), mode: "upgrade", facetInstances: { [id]: imported } });
const opts = { source: "file", catalogs: [catalog] } as const;

describe("portable upgrade plans", () => {
  test("file and storage reopen keep added canonical core cards in upgrade plans", () => {
    const catalog = makeCatalog({ facets: [makeFacet({ name: "ERC165Facet", selectors: ["supportsInterface(bytes4)"] })] });
    const layout = { ERC165Facet: { x: 120, y: 240, pins: "right" as const } };
    const project = makeProject({ recipe: makeRecipe({ mode: "upgrade", facets: ["ERC165Facet"] }, catalog), layout,
      upgrade: { chainId: 11155111, address, block: 100, blockHash: hash, facets: [], codehashes: { [address]: hash }, owner: null } });
    for (const source of ["file", "db"] as const) {
      const reopened = parseProjectFile({ project, deployments: [] }, { source, catalogs: [catalog] });
      if (!reopened.ok) throw new Error(JSON.stringify(reopened.error));
      expect(reopened.value.value.project.layout).toEqual(layout);
    }
  });

  test("upgrade instances parse without inventing core facets or unknown fields", () => {
    const result = parseRecipe(recipe(), opts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value.facets).toEqual([id]);
    expect(result.value.unknownFields).toEqual([]);
    expect(result.value.value.init).toEqual({ kind: "none" });
  });

  test("instances require upgrade mode and stable address identity", () => {
    expect(validateRecipe({ ...recipe(), mode: undefined }).ok).toBe(false);
    expect(validateRecipe({ ...recipe(), facetInstances: { "onchain:wrong": imported } }).ok).toBe(false);
    expect(validateRecipe({ ...recipe(), facetInstances: { [id]: { ...imported, address: "0x0000000000000000000000000000000000000022" } } }).ok).toBe(false);
  });

  test("invalid runtime hashes and duplicate selectors are refused", () => {
    for (const patch of [{ codehash: "0x" }, { selectors: [selector, selector.toUpperCase().replace("0X", "0x")] }]) {
      expect(validateRecipe({ ...recipe(), facetInstances: { [id]: { ...imported, ...patch } } }).ok).toBe(false);
    }
  });

  test("on-chain IDs need descriptors and descriptors need placement", () => {
    expect(validateRecipe({ ...recipe(), facetInstances: {} }).ok).toBe(false);
    expect(validateRecipe({ ...recipe(), facets: [] }).ok).toBe(false);
    expect(validateRecipe({ ...makeRecipe(), facets: [id] }).ok).toBe(false);
  });

  test("known instances are checked against the actual pinned catalog", () => {
    const known = { kind: "known", address, codehash: hash, catalogFacet: "Missing", extraSelectors: [] };
    expect(parseRecipe({ ...recipe(), facetInstances: { [id]: known } }, opts).ok).toBe(false);
    known.catalogFacet = "Known";
    expect(parseRecipe({ ...recipe(), facetInstances: { [id]: known } }, opts).ok).toBe(false);
    const trusted = catalog.facets[0];
    if (!trusted) throw new Error("fixture");
    known.codehash = trusted.release.codehash as typeof hash;
    expect(parseRecipe({ ...recipe(), facetInstances: { [id]: known } }, opts).ok).toBe(true);
  });

  test("legacy hashes and normalized bytes stay unchanged", () => {
    const legacy = makeRecipe({ facets: ["Known"] }, catalog);
    expect(canonicalJson(normalizeRecipe(legacy, catalog))).toBe(canonicalJson(legacy));
    expect(recipeHash(legacy, catalog)).toBe(recipeHash(normalizeRecipe(legacy, catalog)));
    const parsed = parseRecipe(legacy, opts);
    expect(parsed.ok && Object.hasOwn(parsed.value.value, "mode")).toBe(false);
    expect(parsed.ok && Object.hasOwn(parsed.value.value, "facetInstances")).toBe(false);
  });

  test("instance runtime identity and locked selectors are covered by recipe hash", () => {
    const base = parseRecipe(recipe(), opts);
    const changed = parseRecipe({ ...recipe(), facetInstances: { [id]: { ...imported, selectors: ["0x87654321"] } } }, opts);
    if (!base.ok || !changed.ok) throw new Error("fixture parse");
    expect(recipeHash(base.value.value)).not.toBe(recipeHash(changed.value.value));
  });

  test("imported deployment records never need invented creation data", () => {
    const record = { kind: "imported", projectId: "test-project", chainId: 11155111, address, status: "confirmed", block: 100,
      recipeHash: hash, catalogHash: hash, at: "2026-11-06T00:00:00Z", verification: "pending", revision: 1 };
    expect(validateDeployment(record).ok).toBe(true);
    expect(validateDeployment({ ...record, path: "factory", salt: hash, deployer: address }).ok).toBe(false);
    const project = { ...makeProject(), recipe: recipe(), upgrade: { chainId: 11155111, address, block: 100, blockHash: hash,
      facets: [{ facetAddress: address, functionSelectors: [selector] }], codehashes: { [address]: hash }, owner: null } };
    const result = parseProjectFile({ project, deployments: [record] }, opts);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.unknownFields).toEqual([]);
      expect(result.value.value.project.upgrade).toEqual(expect.objectContaining({ address, block: 100, blockHash: hash }));
      expect(result.value.value.deployments[0]).not.toHaveProperty("salt");
    }
  });

  test("saved recovery intent preserves exact calldata and canonical uint256 wei", () => {
    const baseline = { block: 100, blockHash: hash, facets: [{ facetAddress: address, functionSelectors: [selector] }], codehashes: { [address]: hash } };
    const record = { kind: "imported", projectId: "test-project", chainId: 11155111, address, status: "confirmed",
      recipeHash: hash, catalogHash: hash, at: "2026-11-06T00:00:00Z", verification: "failed", revision: 1,
      pendingUpgrade: { phase: "signing", reviewId: "review-1", desiredRecipeHash: hash, catalogHash: hash,
        baseline, expectedFacets: baseline.facets, expectedCodehashes: baseline.codehashes, from: address,
        since: "2026-11-06T00:00:00Z", call: { data: "0x12345678", value: "0" } } };
    const withValue = (value: string) => ({ ...record, pendingUpgrade: { ...record.pendingUpgrade, call: { ...record.pendingUpgrade.call, value } } });
    expect(validateDeployment(record).ok).toBe(true);
    expect(validateDeployment(withValue(((1n << 256n) - 1n).toString())).ok).toBe(true);
    for (const value of ["-1", "01", "1e18", "1.0", (1n << 256n).toString(), "9".repeat(1000)]) {
      expect(validateDeployment(withValue(value)).ok).toBe(false);
    }
    expect(validateDeployment({ ...record, pendingUpgrade: { ...record.pendingUpgrade, call: { data: "0x123", value: "0" } } }).ok).toBe(false);
  });
});
