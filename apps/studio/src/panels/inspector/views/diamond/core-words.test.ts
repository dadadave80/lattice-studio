import { describe, expect, test } from "bun:test";
import type { Catalog, Recipe } from "@lattice-studio/core";
import { analyze, CORE_FACETS, coreStatus, mechanismOptions } from "@lattice-studio/core";
import { loadFixtureCatalog, makeRecipe } from "@lattice-studio/core/testing";
import { cutText, erc165Text, fallbackText, loupeRows, loupeText, mechanismLabel } from "./core-words";

const loaded = loadFixtureCatalog();
if (!loaded.ok) throw new Error(loaded.error);
const catalog: Catalog = loaded.value;

function statusOf(recipe: Recipe) {
  return { status: coreStatus(recipe, catalog, analyze(recipe, catalog)), options: mechanismOptions(recipe, catalog) };
}

describe("the Core section's rows", () => {
  test("a core-only sheet: five routed, the loupe covered, nothing registered, an empty cut", () => {
    const { status, options } = statusOf(makeRecipe({ facets: [...CORE_FACETS] }, catalog));
    expect(fallbackText(status.fallback)).toBe("5 routed · 5 exported · 0 excluded");
    expect(loupeText(status.loupe)).toBe("4/4");
    expect(loupeRows(status.loupe, catalog)).toEqual([
      { hex: "0x7a0ed627", signature: "facets()", covered: true },
      { hex: "0xadfca15e", signature: "facetFunctionSelectors(address)", covered: true },
      { hex: "0x52ef6b2c", signature: "facetAddresses()", covered: true },
      { hex: "0xcdffacc6", signature: "facetAddress(bytes4)", covered: true },
    ]);
    expect(erc165Text(status.erc165)).toBe("None registered");
    expect(cutText(status.cut, options)).toBe("Empty · no upgrade mechanism");
  });

  test("a step init registers the interfaces; a cut facet reads with its mechanism's label", () => {
    const recipe = makeRecipe({ facets: [...CORE_FACETS, "AccessControlDiamondCut"], init: { kind: "steps", steps: [] } }, catalog);
    const { status, options } = statusOf(recipe);
    expect(erc165Text(status.erc165)).toBe("2 interfaces");
    expect(status.erc165.interfaceIds.map((entry) => entry.name)).toEqual(["IDiamondLoupe", "IDiamondCut"]);
    expect(mechanismLabel(options)).toBe("Admin role");
    expect(cutText(status.cut, options)).toBe("AccessControlDiamondCut · Admin role");
  });

  test("an immutable recipe, a conflict, and a loupe selector left out", () => {
    const immutable: Recipe = { ...makeRecipe({ facets: [...CORE_FACETS, "ERC20"] }, catalog), immutable: true };
    const a = statusOf(immutable);
    expect(cutText(a.status.cut, a.options)).toBe("Empty · immutable");

    const rivals = statusOf(makeRecipe({ facets: [...CORE_FACETS, "AccessControlDiamondCut", "SafeDiamondCut"] }, catalog));
    expect(cutText(rivals.status.cut, rivals.options)).toBe("AccessControlDiamondCut · Admin role · conflicts with SafeDiamondCut");

    const excluded = statusOf(makeRecipe({ facets: [...CORE_FACETS], exclude: ["0x7a0ed627", "0x01ffc9a7"] }, catalog));
    expect(loupeText(excluded.status.loupe)).toBe("3/4");
    expect(loupeRows(excluded.status.loupe, catalog)[0]?.covered).toBe(false);
    expect(erc165Text(excluded.status.erc165)).toBe("None registered · supportsInterface not routed");
  });
});
