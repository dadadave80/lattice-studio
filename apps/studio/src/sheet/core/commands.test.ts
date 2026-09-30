import { expect, test } from "bun:test";
import type { CoreStatus } from "@lattice-studio/core";
import { coreLine } from "./commands";

const status: CoreStatus = {
  fallback: { facets: 3, routed: 14, exported: 16, excluded: 0, namespaces: 1 },
  loupe: { selectors: ["0x7a0ed627", "0xadfca15e", "0x52ef6b2c", "0xcdffacc6"], covered: ["0x7a0ed627", "0xadfca15e", "0x52ef6b2c", "0xcdffacc6"] },
  erc165: { covered: true, interfaceIds: [{ id: "0x01ffc9a7", name: "IERC165" }, { id: "0x48e2b093", name: "IDiamondLoupe" }] },
  cut: { facet: null, rivals: [], conflict: false, immutable: false },
  init: [],
  plan: { fixed: [], rest: [] },
};

test("the core verb's line names the fallback count, loupe coverage, interface ids and the cut", () => {
  expect(coreLine(status)).toBe("Core: fallback 14 routed · loupe 4/4 · ERC-165 IERC165, IDiamondLoupe · cut none");
  expect(coreLine({ ...status, cut: { ...status.cut, immutable: true } })).toContain("· cut none, immutable");
  expect(coreLine({ ...status, cut: { ...status.cut, facet: "AccessControlDiamondCut" } })).toContain("· cut AccessControlDiamondCut");
  expect(coreLine({ ...status, erc165: { covered: false, interfaceIds: [] } })).toContain("· ERC-165 none ·");
});
