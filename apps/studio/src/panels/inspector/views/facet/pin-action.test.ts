import { describe, expect, test } from "bun:test";
import { analyze, loadTemplate, type Catalog, type Hex4, type Recipe } from "@lattice-studio/core";
import { loadFixtureCatalog, makeRecipe } from "@lattice-studio/core/testing";
import { joinNames, pinAction } from "./pin-action";

function catalog(): Catalog {
  const loaded = loadFixtureCatalog();
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

function pin(c: Catalog, recipe: Recipe, facet: string, hex: Hex4) {
  const analysis = analyze(recipe, c);
  const signature = c.facets.find((f) => f.name === facet)?.selectors.find((s) => s.hex === hex)?.signature ?? "";
  return pinAction({
    facet,
    selector: { hex, signature },
    route: analysis.routing[hex],
    exclude: recipe.exclude,
    seams: c.seams,
    placed: recipe.facets,
  });
}

const TRANSFER: Hex4 = "0xa9059cbb";
const DECIMALS: Hex4 = "0x313ce567";
const SEND_MESSAGE: Hex4 = "0xcdfe7f5c";

describe("pinAction", () => {
  test("routed here: leave it out of the diamond", () => {
    const c = catalog();
    const action = pin(c, makeRecipe({ facets: ["ERC20"] }, c), "ERC20", TRANSFER);
    expect(action).toEqual({
      state: "routed",
      label: "routed",
      tooltip: "`transfer(address,uint256)`: routes here. Click to leave it out of the diamond.",
      command: { id: "selector.exclude", args: { selector: TRANSFER } },
    });
  });

  test("excluded: route it here, naming the facet only when contested", () => {
    const c = catalog();
    const only = pin(c, makeRecipe({ facets: ["ERC20"], exclude: [TRANSFER] }, c), "ERC20", TRANSFER);
    expect(only).toEqual({
      state: "excluded",
      label: "not in the diamond",
      tooltip: "Not in the diamond. Click to route here.",
      command: { id: "selector.include", args: { selector: TRANSFER } },
    });
    const shared = pin(c, makeRecipe({ facets: ["ERC20", "ERC4626"], exclude: [DECIMALS] }, c), "ERC20", DECIMALS);
    expect(shared.command).toEqual({ id: "selector.include", args: { selector: DECIMALS, facet: "ERC20" } });
  });

  test("owner by default: change it per selector", () => {
    const c = catalog();
    const action = pin(c, makeRecipe({ facets: ["ERC20", "ERC4626"] }, c), "ERC4626", DECIMALS);
    expect(action).toEqual({
      state: "default",
      label: "owner by default",
      tooltip: "Owner by default. Click to change.",
      command: { id: "collision.choosePerSelector", args: { selectors: [DECIMALS] } },
    });
  });

  test("served by another facet: route it here instead", () => {
    const c = catalog();
    const action = pin(c, makeRecipe({ facets: ["ERC20", "ERC4626"] }, c), "ERC20", DECIMALS);
    expect(action).toEqual({
      state: "served",
      label: "→ ERC4626",
      tooltip: "Served by ERC4626. Click to route here instead.",
      command: { id: "selector.route", args: { selector: DECIMALS, facet: "ERC20" } },
    });
  });

  test("contested with no owner: route it here", () => {
    const c = catalog();
    const recipe = makeRecipe({ facets: ["HyperlaneGatewayAdapter", "AxelarGatewayAdapter"] }, c);
    const action = pin(c, recipe, "HyperlaneGatewayAdapter", SEND_MESSAGE);
    expect(action).toEqual({
      state: "contested",
      label: "contested",
      tooltip: "Contested by AxelarGatewayAdapter and HyperlaneGatewayAdapter. Click to route here.",
      command: { id: "selector.route", args: { selector: SEND_MESSAGE, facet: "HyperlaneGatewayAdapter" } },
    });
  });

  test("a seam offers no route, on the facet that serves it and on the one that doesn't", () => {
    const c = catalog();
    const loaded = loadTemplate(c, "GovernedVault");
    if (!loaded.ok) throw new Error(loaded.error);
    const recipe = loaded.value.facets.includes("ERC20") ? loaded.value : { ...loaded.value, facets: [...loaded.value.facets, "ERC20"] };
    for (const facet of ["GovernedVault", "ERC20"]) {
      const action = pin(c, recipe, facet, TRANSFER);
      expect(action).toEqual({
        state: "seam",
        label: "seam",
        tooltip: "Seam: stays on GovernedVault because its version moves vote checkpoints with balances.",
      });
      expect("command" in action).toBe(false);
    }
  });

  test("a facet that isn't placed (catalog preview) reads routed, with nothing to run", () => {
    const c = catalog();
    const action = pin(c, makeRecipe({}, c), "ERC20", TRANSFER);
    expect(action).toEqual({ state: "routed", label: "routed", tooltip: "`transfer(address,uint256)`: routes here." });
  });

  test("hex case doesn't matter for exclusions", () => {
    const c = catalog();
    const action = pin(c, makeRecipe({ facets: ["ERC20"], exclude: ["0xA9059CBB" as Hex4] }, c), "ERC20", TRANSFER);
    expect(action.state).toBe("excluded");
  });
});

describe("joinNames", () => {
  test("two names with and, three or more with commas and a final and", () => {
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B"])).toBe("A and B");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
  });
});
