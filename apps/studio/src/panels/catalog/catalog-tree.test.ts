import { describe, expect, test } from "bun:test";
import type { Hex } from "@lattice-studio/core";
import { makeCatalog, makeFacet } from "@lattice-studio/core/testing";
import {
  AREA_LABELS, areaNodeId, buildCatalogNodes, chainAvailability, facetMatchesQuery, isAreaNodeId, placedCountByArea,
} from "./catalog-tree";

const erc20 = makeFacet({
  name: "ERC20",
  area: "tokens",
  storage: { id: "lattice.storage.ERC20", slot: "0x00" },
  selectors: ["transfer(address,uint256)", "balanceOf(address)"],
});
const erc4626 = makeFacet({
  name: "ERC4626",
  area: "tokens",
  storage: { id: "lattice.storage.ERC4626", slot: "0x01" },
  selectors: ["deposit(uint256,address)"],
});
const accessControl = makeFacet({
  name: "AccessControl",
  area: "access",
  storage: { id: "lattice.storage.AccessControl", slot: "0x02" },
  selectors: ["hasRole(bytes32,address)"],
});
const diamondCut = makeFacet({
  name: "DiamondCutFacet",
  area: "diamond",
  selectors: ["diamondCut((address,uint8,bytes4[])[],address,bytes)"],
});

const catalog = makeCatalog({ facets: [erc20, erc4626, accessControl, diamondCut] });

describe("facetMatchesQuery", () => {
  test("an empty query matches everything", () => {
    expect(facetMatchesQuery(erc20, "")).toBe(true);
    expect(facetMatchesQuery(erc20, "   ")).toBe(true);
  });

  test("matches by name, case-insensitively, substring", () => {
    expect(facetMatchesQuery(erc20, "erc20")).toBe(true);
    expect(facetMatchesQuery(erc20, "RC2")).toBe(true);
    expect(facetMatchesQuery(erc20, "erc4626")).toBe(false);
  });

  test("matches by area id and its display label", () => {
    expect(facetMatchesQuery(erc20, "tokens")).toBe(true);
    expect(facetMatchesQuery(accessControl, "access")).toBe(true);
    expect(facetMatchesQuery(diamondCut, "amm")).toBe(false);
  });

  test("matches by namespace", () => {
    expect(facetMatchesQuery(erc20, "lattice.storage.erc20")).toBe(true);
    expect(facetMatchesQuery(diamondCut, "lattice.storage")).toBe(false);
  });

  test("matches by function name, not by the whole signature", () => {
    expect(facetMatchesQuery(erc20, "transfer")).toBe(true);
    expect(facetMatchesQuery(erc20, "address,uint256")).toBe(false);
  });

  test("matches selector hex by prefix only", () => {
    const [selector] = erc20.selectors;
    if (!selector) throw new Error("fixture has no selector");
    expect(facetMatchesQuery(erc20, selector.hex.slice(0, 6))).toBe(true);
    expect(facetMatchesQuery(erc20, selector.hex.slice(2, 6))).toBe(false);
    expect(facetMatchesQuery(accessControl, "0xdeadbeef")).toBe(false);
  });
});

describe("buildCatalogNodes", () => {
  test("groups matches into area folders, sorted, with facets sorted inside them", () => {
    const { nodes, matchCount, matchedAreaIds } = buildCatalogNodes(catalog, "");
    expect(matchCount).toBe(4);
    expect(nodes.map((n) => n.id)).toEqual([areaNodeId("access"), areaNodeId("diamond"), areaNodeId("tokens")]);
    expect(nodes.map((n) => n.label)).toEqual([AREA_LABELS.access, AREA_LABELS.diamond, AREA_LABELS.tokens]);
    const tokens = nodes.find((n) => n.id === areaNodeId("tokens"));
    expect(tokens?.children?.map((c) => c.id)).toEqual(["ERC20", "ERC4626"]);
    expect(matchedAreaIds.sort()).toEqual([areaNodeId("access"), areaNodeId("diamond"), areaNodeId("tokens")].sort());
  });

  test("a query narrows the tree to matching facets and their areas only", () => {
    const { nodes, matchCount } = buildCatalogNodes(catalog, "erc4626");
    expect(matchCount).toBe(1);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.children?.map((c) => c.id)).toEqual(["ERC4626"]);
  });

  test("no match: an empty tree, zero matches", () => {
    const { nodes, matchCount, matchedAreaIds } = buildCatalogNodes(catalog, "notreal");
    expect(nodes).toEqual([]);
    expect(matchCount).toBe(0);
    expect(matchedAreaIds).toEqual([]);
  });

  test("an include predicate (the availability filter) narrows independently of the query", () => {
    const { nodes, matchCount } = buildCatalogNodes(catalog, "", (facet) => facet.name === "ERC20");
    expect(matchCount).toBe(1);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.children?.map((c) => c.id)).toEqual(["ERC20"]);
  });
});

describe("isAreaNodeId", () => {
  test("tells an area folder id from a facet name, which can never collide with it", () => {
    expect(isAreaNodeId(areaNodeId("tokens"))).toBe(true);
    expect(isAreaNodeId("ERC20")).toBe(false);
  });
});

describe("placedCountByArea", () => {
  test("counts placed facets per area across the whole catalog, not just what's visible", () => {
    const counts = placedCountByArea(catalog, new Set(["ERC20", "AccessControl"]));
    expect(counts.get("tokens")).toBe(1);
    expect(counts.get("access")).toBe(1);
    expect(counts.get("diamond")).toBeUndefined();
  });
});

describe("chainAvailability", () => {
  test("null readiness or anything but ready: unknown, not unavailable", () => {
    expect(chainAvailability(catalog, null)).toBeNull();
    expect(chainAvailability(catalog, { status: "unknown" })).toBeNull();
    expect(chainAvailability(catalog, { status: "checking" })).toBeNull();
    expect(chainAvailability(catalog, { status: "error", reason: "down" })).toBeNull();
  });

  test("ready: present and codehash-matching facets are available and verified; missing ones are neither", () => {
    const map = chainAvailability(catalog, {
      status: "ready",
      state: {
        chainId: 1,
        name: "Sepolia",
        online: true,
        probedAt: "2026-01-01T00:00:00.000Z",
        deployer: { present: true },
        shared: {
          ERC20: { present: true, codehash: erc20.release.codehash },
          ERC4626: { present: true, codehash: `0x${"11".repeat(32)}` as Hex },
        },
        simulate: true,
        codeAt: {},
      },
    });
    expect(map?.get("ERC20")).toEqual({ available: true, verified: true });
    expect(map?.get("ERC4626")).toEqual({ available: true, verified: false });
    expect(map?.get("AccessControl")).toEqual({ available: false, verified: false });
  });
});
