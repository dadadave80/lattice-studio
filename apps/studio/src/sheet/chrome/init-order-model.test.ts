import { describe, expect, test } from "bun:test";
import type { Catalog, Recipe } from "@lattice-studio/core";
import { loadTemplate } from "@lattice-studio/core";
import { loadFixtureCatalog, makeRecipe } from "@lattice-studio/core/testing";
import { AUTOMATIC_STEP, badgeText, buildInitOrderModel, initOrderModel } from "./init-order-model";

function fixture(): Catalog {
  const loaded = loadFixtureCatalog();
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

const catalog = fixture();

function template(name: string): Recipe {
  const loaded = loadTemplate(catalog, name);
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

describe("init order model", () => {
  test("step inits: a card carries its own init's step, the automatic step names no card", () => {
    const model = buildInitOrderModel(template("ERC20"), catalog);
    expect(model.kind).toBe("steps");
    expect(model.steps.map((s) => s.label)).toEqual(["ERC20Init", AUTOMATIC_STEP]);
    expect(model.byFacet.get("ERC20")?.number).toBe(1);
    expect(model.byFacet.get("ERC20")?.index).toBe(0);
    for (const plain of ["Receive", "DiamondLoupeFacet", "ERC165Facet"]) expect(model.byFacet.has(plain)).toBe(false);
    expect(model.steps[1]?.index).toBeNull();
    expect(model.movable).toBe(1);
  });

  test("a module an init sets up carries that init's step (SafeDiamondCutInit sets up AccessControl)", () => {
    const model = buildInitOrderModel(template("SafeDiamondCut"), catalog);
    expect(model.byFacet.get("SafeDiamondCut")?.number).toBe(1);
    expect(model.byFacet.get("AccessControl")?.number).toBe(1);
    expect(model.byFacet.get("EmergencyStop")?.number).toBe(1);
    expect(model.byFacet.has("Receive")).toBe(false);
  });

  test("several steps number in call order and every one but the automatic can move", () => {
    const recipe = makeRecipe(
      {
        facets: ["ERC20", "ERC4626", "AccessControl", "VaultCore"],
        init: {
          kind: "steps",
          steps: [
            { spec: "ERC20Init", args: {} },
            { spec: "AccessControlInit", args: {} },
            { spec: "ERC4626Init", args: {} },
            { spec: "VaultCoreInit", args: {} },
          ],
        },
      },
      catalog,
    );
    const model = buildInitOrderModel(recipe, catalog);
    expect(model.steps.map((s) => [s.number, s.label, s.index])).toEqual([
      [1, "ERC20Init", 0], [2, "AccessControlInit", 1], [3, "ERC4626Init", 2], [4, "VaultCoreInit", 3], [5, AUTOMATIC_STEP, null],
    ]);
    expect(model.byFacet.get("VaultCore")?.number).toBe(4);
    expect(model.byFacet.get("AccessControl")?.number).toBe(2);
    expect(model.movable).toBe(4);
  });

  test("a bundle numbers its fixed sequence; facets outside it have no step and nothing moves", () => {
    const model = buildInitOrderModel(template("GovernedVault"), catalog);
    expect(model.kind).toBe("bundle");
    expect(model.bundle).toBe("GovernedVaultInit");
    expect(model.steps[0]?.label).toBe("AccessControl");
    expect(model.byFacet.get("AccessControl")?.number).toBe(1);
    expect(model.byFacet.get("ERC20")?.number).toBe(5);
    expect(model.byFacet.has("Receive")).toBe(false);
    expect(model.steps.every((s) => s.index === null)).toBe(true);
    expect(model.movable).toBe(0);
  });

  test("no init: nothing to draw", () => {
    const model = buildInitOrderModel(makeRecipe({ facets: ["ERC20"] }, catalog), catalog);
    expect(model.kind).toBe("none");
    expect(model.steps).toEqual([]);
  });

  test("cached per recipe object", () => {
    const recipe = template("ERC20");
    expect(initOrderModel(recipe, catalog)).toBe(initOrderModel(recipe, catalog));
    expect(initOrderModel({ ...recipe }, catalog)).not.toBe(initOrderModel(recipe, catalog));
  });

  test("badges read two digits", () => {
    expect(badgeText(3)).toBe("03");
    expect(badgeText(11)).toBe("11");
  });
});
