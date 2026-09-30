import { expect, test } from "bun:test";
import type { Address, Hex, PlanEntry } from "@lattice-studio/core";
import { planIndex, stampText } from "./plan-index";

const address: Address = `0x${"11".repeat(20)}` as Address;
const codehash: Hex = `0x${"22".repeat(32)}`;

function entry(facet: string): PlanEntry {
  return { facet, address, codehash, version: "1.0.0", selectors: ["0x00000001"] };
}

test("the core's entries come first whatever order the plan arrives in, then the rest keep their order", () => {
  const plan = [entry("ERC20"), entry("DiamondLoupeFacet"), entry("VaultCore"), entry("ERC165Facet")];
  expect(planIndex(plan, "DiamondLoupeFacet")).toBe(0);
  expect(planIndex(plan, "ERC165Facet")).toBe(1);
  expect(planIndex(plan, "ERC20")).toBe(2);
  expect(planIndex(plan, "VaultCore")).toBe(3);
});

test("a facet absent from the plan isn't cut", () => {
  expect(planIndex([entry("DiamondLoupeFacet"), entry("ERC165Facet")], "Receive")).toBeNull();
  expect(planIndex([], "ERC20")).toBeNull();
});

test("the stamp prints two digits, or Not cut", () => {
  expect(stampText(2)).toBe("02");
  expect(stampText(12)).toBe("12");
  expect(stampText(null)).toBe("Not cut");
});

test("the lookup is built once per plan array", () => {
  const plan = [entry("ERC20")];
  expect(planIndex(plan, "ERC20")).toBe(0);
  plan.push(entry("VaultCore"));
  // The same array object keeps its first lookup: callers hand over a new array per analysis.
  expect(planIndex(plan, "VaultCore")).toBeNull();
  expect(planIndex([...plan], "VaultCore")).toBe(1);
});
