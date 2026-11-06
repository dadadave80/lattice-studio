import { describe, expect, test } from "bun:test";
import { clearOwner, excludeSelector, includeSelector, loadRecipe, placeFacet, removeFacets, routeSelector } from "../edit/recipe-ops";
import type { Address, Hex } from "../model/hex";
import type { UpgradeOrigin } from "../model/project";
import { makeCatalog, makeFacet, makeProject, makeRecipe } from "../testing/builders";
import { planUpgrade } from "./analyze";
import { reconstructUpgrade } from "./reconstruct";

const a: Address = "0x0000000000000000000000000000000000000011";
const b: Address = "0x0000000000000000000000000000000000000022";
const diamond: Address = "0x0000000000000000000000000000000000000033";
const hash: Hex = `0x${"ab".repeat(32)}`;
const foreign: Hex = "0x12345678";
const self: Hex = "0x87654321";
const known = makeFacet({ name: "Known", selectors: ["one()", "two()"] });
const selector = known.selectors[0]!.hex;
const id = (address: Address) => `onchain:${address}`;
const catalog = makeCatalog({ facets: [known] });
const origin: UpgradeOrigin = { chainId: 1, address: diamond, owner: null, block: 1, blockHash: hash,
  facets: [{ facetAddress: a, functionSelectors: [foreign] }, { facetAddress: b, functionSelectors: [selector] }, { facetAddress: diamond, functionSelectors: [self] }],
  codehashes: { [a]: hash, [b]: known.release.codehash, [diamond]: hash } };
const project = () => {
  const result = reconstructUpgrade(origin, catalog);
  if (!result.ok) throw new Error(result.error);
  return makeProject({ recipe: result.value, upgrade: origin, layout: { [id(a)]: { x: 0, y: 0, pins: "right" } } });
};

describe("upgrade selector edit guards", () => {
  test("foreign and self selectors cannot be individually routed, cleared, excluded or included", () => {
    for (const selector of [foreign, self]) {
      const before = project();
      for (const edit of [routeSelector(before, catalog, selector, known.name), clearOwner(before, catalog, selector), excludeSelector(before, catalog, selector), includeSelector(before, catalog, selector, known.name)]) {
        expect(edit.changed).toBe(false);
        expect(edit.project).toBe(before);
      }
    }
  });

  test("whole foreign removal drops descriptors and routing atomically and the original is undoable", () => {
    const before = project();
    const removed = removeFacets(before, catalog, [id(a)]);
    expect(removed.changed).toBe(true);
    expect(removed.project.recipe.facetInstances).not.toHaveProperty(id(a));
    expect(removed.project.layout).not.toHaveProperty(id(a));
    const plan = planUpgrade(removed.project.recipe, catalog, origin);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.value.cuts).toEqual([{ facetAddress: "0x0000000000000000000000000000000000000000", action: 2, functionSelectors: [foreign] }]);
    expect(planUpgrade(before.recipe, catalog, origin)).toEqual(expect.objectContaining({ ok: true, value: expect.objectContaining({ cuts: [] }) }));
  });

  test("foreign removal cannot silently transfer its selector to a known contender", () => {
    const contender = makeFacet({ name: "Contender", selectors: [{ hex: foreign, signature: "rawKnown()" }] });
    const cat = { ...catalog, facets: [...catalog.facets, contender] };
    const before = project();
    before.recipe = { ...before.recipe, facets: [...before.recipe.facets, contender.name] };
    const removed = removeFacets(before, cat, [id(a)]);
    expect(removed.project.recipe.exclude).toContain(foreign);
    expect(routeSelector(removed.project, cat, foreign, contender.name).changed).toBe(false);
    const plan = planUpgrade(removed.project.recipe, cat, origin);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.value.cuts).toEqual([{ facetAddress: "0x0000000000000000000000000000000000000000", action: 2, functionSelectors: [foreign] }]);
  });

  test("self instances cannot be removed while known instance selectors remain editable", () => {
    const before = project();
    expect(removeFacets(before, catalog, [id(diamond)]).changed).toBe(false);
    const excluded = excludeSelector(before, catalog, selector);
    expect(excluded.changed).toBe(true);
    expect(planUpgrade(excluded.project.recipe, catalog, origin).ok).toBe(true);
    const restored = includeSelector(excluded.project, catalog, selector, id(b));
    expect(restored.changed).toBe(true);
    expect(planUpgrade(restored.project.recipe, catalog, origin)).toEqual(expect.objectContaining({ ok: true, value: expect.objectContaining({ cuts: [] }) }));
  });

  test("missing catalog core facets can be deliberately placed in upgrade mode", () => {
    const loupe = makeFacet({ name: "DiamondLoupeFacet", selectors: ["facets()"] });
    const cat = { ...catalog, facets: [...catalog.facets, loupe] };
    expect(placeFacet(project(), cat, loupe.name, { x: 1, y: 1 }).changed).toBe(true);
    expect(placeFacet(makeProject(), cat, loupe.name, { x: 1, y: 1 }).changed).toBe(false);
  });

  test("ordinary recipe loading cannot discard or fabricate an upgrade origin", () => {
    expect(loadRecipe(project(), catalog, makeRecipe(), {}).changed).toBe(false);
    expect(loadRecipe(makeProject(), catalog, project().recipe, {}).changed).toBe(false);
  });
});
