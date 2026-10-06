import { expect, test } from "bun:test";
import type { CoreStatus } from "@lattice-studio/core";
import { cutName, cutRow, diamondName, erc165Name, fallbackName, fallbackText, loupeName, loupeText } from "./model";

const status: CoreStatus = {
  fallback: { facets: 3, routed: 14, exported: 16, excluded: 0, namespaces: 1 },
  loupe: { selectors: ["0x7a0ed627", "0xadfca15e", "0x52ef6b2c", "0xcdffacc6"], covered: ["0x7a0ed627", "0xadfca15e", "0x52ef6b2c", "0xcdffacc6"] },
  erc165: { covered: true, interfaceIds: [{ id: "0x01ffc9a7", name: "IERC165" }] },
  cut: { facet: null, rivals: [], conflict: false, immutable: false },
  init: [],
  plan: { fixed: [], rest: [] },
};

test("the fallback row counts what routes; the loupe row counts covered over four", () => {
  expect(fallbackText(status)).toBe("14 routed");
  expect(loupeText(status)).toBe("4/4");
  expect(loupeText({ ...status, loupe: { ...status.loupe, covered: ["0x7a0ed627"] } })).toBe("1/4");
});

test("the cut row names the placed variant and its mode, a conflict, or the empty socket", () => {
  expect(cutRow(status)).toEqual({ state: "empty", text: "Empty · no upgrade mechanism", facet: null });
  expect(cutRow({ ...status, cut: { ...status.cut, immutable: true } })).toEqual({ state: "empty", text: "Empty · immutable", facet: null });
  expect(cutRow({ ...status, cut: { facet: "AccessControlDiamondCut", rivals: [], conflict: false, immutable: false } })).toEqual({
    state: "one", text: "AccessControlDiamondCut · upgradeable", facet: "AccessControlDiamondCut",
  });
  expect(cutRow({ ...status, cut: { facet: "SafeDiamondCut", rivals: ["GovernedDiamondCut"], conflict: true, immutable: false } })).toEqual({
    state: "conflict", text: "SafeDiamondCut · conflicts with GovernedDiamondCut", facet: "SafeDiamondCut", rivals: ["GovernedDiamondCut"],
  });
});

test("the toolbar's names start with each row's visible words (WCAG 2.5.3), then carry the state", () => {
  expect(diamondName()).toBe("Core The diamond's fixed part");
  expect(fallbackName(status)).toBe("Fallback 14 routed");
  expect(loupeName(status)).toBe("Loupe 4/4, 4 of 4 covered");
  expect(erc165Name(status)).toBe("ERC-165, covered");
  expect(erc165Name({ ...status, erc165: { covered: false, interfaceIds: [] } })).toBe("ERC-165, not covered");
  expect(cutName(status)).toBe("Cut Empty · no upgrade mechanism");
  expect(cutName({ ...status, cut: { ...status.cut, immutable: true } })).toBe("Cut Empty · immutable");
  const one = { ...status, cut: { facet: "SafeDiamondCut", rivals: [], conflict: false, immutable: false } };
  expect(cutName(one, "Safe")).toBe("Cut SafeDiamondCut · Safe");
  expect(cutName(one)).toBe("Cut SafeDiamondCut · upgradeable");
  expect(cutName({ ...status, cut: { facet: "SafeDiamondCut", rivals: ["GovernedDiamondCut"], conflict: true, immutable: false } })).toBe(
    "Cut SafeDiamondCut · conflicts with GovernedDiamondCut",
  );
});
