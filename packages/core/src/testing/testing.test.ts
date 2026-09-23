import { describe, expect, test } from "bun:test";
import { validateCatalog, validateProject, validateRecipe } from "../model/schema";
import { makeCatalog, makeFacet, makeInit, makeProject, makeRecipe, makeTemplate } from "./builders";
import { loadFixtureCatalog, loadFixtureShard } from "./fixtures";
import { addr, hex, sel } from "./ids";

describe("ids", () => {
  test("hex, addr and sel are deterministic and well formed", () => {
    expect(hex(1)).toBe(`0x${"0".repeat(63)}1`);
    expect(hex(255, 2)).toBe("0x00ff");
    expect(sel(1)).toBe("0x00000001");
    expect(addr(1)).toBe("0x0000000000000000000000000000000000000001");
    expect(addr(0xabcdef)).toBe(addr(0xabcdef));
    expect(() => hex(256, 1)).toThrow(RangeError);
  });
});

describe("builders", () => {
  test("a built catalog, recipe and project pass the schemas", () => {
    const erc20 = makeFacet({
      name: "ERC20",
      area: "tokens",
      selectors: ["transfer(address,uint256)", { hex: "0x00000000", signature: "receive()" }],
      init: "ERC20Init",
    });
    const catalog = makeCatalog({
      facets: [erc20],
      inits: [makeInit({ name: "ERC20Init", fn: "init(string,string)" })],
      recipes: [makeTemplate({ name: "Token" })],
    });
    expect(erc20.selectors[0]).toEqual({ hex: "0xa9059cbb", signature: "transfer(address,uint256)" });
    expect(erc20.release.salt).toBe(`0x${erc20.release.salt.slice(2).toLowerCase()}`);
    expect(validateCatalog(catalog).ok).toBe(true);
    const recipe = makeRecipe({ facets: ["ERC20"] }, catalog);
    expect(recipe.catalog).toEqual({ tag: "test", hash: catalog.hash });
    expect(validateRecipe(recipe).ok).toBe(true);
    expect(validateProject(makeProject({ recipe })).ok).toBe(true);
  });

  test("builders are deterministic", () => {
    expect(makeCatalog()).toEqual(makeCatalog());
    expect(makeFacet({ name: "X" })).toEqual(makeFacet({ name: "X" }));
  });
});

describe("fixture loaders", () => {
  test("load the fixture catalog, or say why they can't", () => {
    const catalog = loadFixtureCatalog();
    if (catalog.ok) expect(catalog.value.lattice.tag).toBe("fixture");
    else expect(catalog.error).toContain("fixture");
    const missing = loadFixtureCatalog("no-such-catalog");
    expect(missing.ok).toBe(false);
    expect(loadFixtureShard("NoSuchFacet").ok).toBe(false);
  });
});
