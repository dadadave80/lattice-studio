import { describe, expect, test } from "bun:test";
import type { Catalog, Project } from "@lattice-studio/core";
import { loadTemplate } from "@lattice-studio/core";
import { loadFixtureCatalog, makeProject } from "@lattice-studio/core/testing";
import { removalBlocker, requiredFacets } from "./remove-facets";

const loaded = loadFixtureCatalog();
if (!loaded.ok) throw new Error(loaded.error);
const catalog: Catalog = loaded.value;

function template(name: string): Project {
  const recipe = loadTemplate(catalog, name);
  if (!recipe.ok) throw new Error(recipe.error);
  return makeProject({ recipe: recipe.value });
}

const VAULT_CORE = "`totalAssets()` must be served by a version that counts the assets strategies hold: place VaultCore.";

describe("requiredFacets", () => {
  test("the core's facets add no blocker: removing them is refused before any check runs (the dialog locks them itself)", () => {
    const locked = requiredFacets(template("ERC20"), catalog, ["ERC20", "Receive", "DiamondLoupeFacet", "ERC165Facet"]);
    expect([...locked.keys()]).toEqual([]);
  });

  test("leaves a facet whose removal adds no blocker unlocked", () => {
    const locked = requiredFacets(template("GovernedVault"), catalog, ["Receive", "VaultCore"]);
    expect([...locked.keys()]).toEqual(["VaultCore"]);
  });

  test("ignores blockers the recipe already has", () => {
    // GovernedVault starts with an INIT-01 blocker (the asset isn't set); removing Receive keeps it and adds nothing.
    const locked = requiredFacets(template("GovernedVault"), catalog, ["Receive", "ERC4626", "VaultCore"]);
    expect(locked.has("Receive")).toBe(false);
    expect(locked.get("VaultCore")).toBe(VAULT_CORE);
    expect(locked.has("ERC4626")).toBe(true);
  });

  test("a facet that isn't placed is never locked", () => {
    expect(requiredFacets(template("ERC20"), catalog, ["Governor"]).size).toBe(0);
  });
});

describe("removalBlocker", () => {
  test("names the first blocker the combination adds", () => {
    expect(removalBlocker(template("GovernedVault"), catalog, ["VaultCore", "Receive"])).toBe(VAULT_CORE);
  });

  test("is null when the combination adds none, or nothing is ticked", () => {
    expect(removalBlocker(template("ERC20"), catalog, ["Receive", "ERC165Facet"])).toBeNull();
    expect(removalBlocker(template("ERC20"), catalog, [])).toBeNull();
  });
});
