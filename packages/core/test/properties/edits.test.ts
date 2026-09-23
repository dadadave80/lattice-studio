/**
 * Edit sequences keep the invariants (spec L284, L317, L932): starting from an empty sheet, any sequence of
 * C11 edits leaves at most one owner per selector, owners only on placed facets that export them (so SEL-05
 * never comes from an edit), a recipe that exports and imports back unchanged, and every edit says what it did
 * or why it didn't.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  analyze, clearOwner, excludeSelector, exportRecipeJson, flipPins, importFile, includeSelector, moveCards, placeFacet, recipeHash,
  removeFacets, renameProject, routeSelector, setExpanded, setImmutable, type Catalog, type EditResult, type Hex4, type Project,
} from "../../src";
import { checkProperty, contendersOf, hostileString, makeProject, makeRecipe, propertyCatalogs } from "../../src/testing";

const catalogs = propertyCatalogs();
const ctx = { known: [], unconfirmed: [] };

/** An edit, with indexes resolved against the sheet when it runs, so every step is meaningful. */
type Op =
  | { op: "place"; i: number; x: number; y: number }
  | { op: "remove"; i: number }
  | { op: "route"; i: number; j: number }
  | { op: "clear"; i: number }
  | { op: "exclude"; i: number }
  | { op: "include"; i: number }
  | { op: "immutable"; on: boolean }
  | { op: "rename"; name: string }
  | { op: "move"; i: number; dx: number; dy: number }
  | { op: "flip"; i: number }
  | { op: "expand"; i: number; on: boolean };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ op: fc.constant("place" as const), i: fc.nat(), x: fc.integer({ min: -2000, max: 2000 }), y: fc.integer({ min: -2000, max: 2000 }) }) },
  { weight: 2, arbitrary: fc.record({ op: fc.constant("remove" as const), i: fc.nat() }) },
  { weight: 3, arbitrary: fc.record({ op: fc.constant("route" as const), i: fc.nat(), j: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("clear" as const), i: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("exclude" as const), i: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("include" as const), i: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("immutable" as const), on: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("rename" as const), name: hostileString() }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("move" as const), i: fc.nat(), dx: fc.integer({ min: -500, max: 500 }), dy: fc.integer({ min: -500, max: 500 }) }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("flip" as const), i: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("expand" as const), i: fc.nat(), on: fc.boolean() }) },
);

function pick<T>(items: readonly T[], i: number): T | undefined {
  return items.length === 0 ? undefined : items[i % items.length];
}

function apply(project: Project, catalog: Catalog, op: Op): EditResult | undefined {
  const placed = project.recipe.facets;
  const contenders = contendersOf(catalog, placed);
  const selectors = [...contenders.keys()];
  const contested = selectors.filter((s) => (contenders.get(s)?.length ?? 0) >= 2);
  switch (op.op) {
    case "place": {
      const facet = pick(catalog.facets, op.i);
      return facet === undefined ? undefined : placeFacet(project, catalog, facet.name, { x: op.x, y: op.y });
    }
    case "remove": {
      const name = pick(placed, op.i);
      return name === undefined ? undefined : removeFacets(project, catalog, [name]);
    }
    case "route": {
      const selector = pick(contested, op.i);
      const facet = selector === undefined ? undefined : pick(contenders.get(selector) ?? [], op.j);
      return selector === undefined || facet === undefined ? undefined : routeSelector(project, catalog, selector, facet);
    }
    case "clear": {
      const selector = pick(Object.keys(project.recipe.owners) as Hex4[], op.i);
      return selector === undefined ? undefined : clearOwner(project, catalog, selector);
    }
    case "exclude": {
      const selector = pick(selectors, op.i);
      return selector === undefined ? undefined : excludeSelector(project, catalog, selector);
    }
    case "include": {
      const selector = pick(project.recipe.exclude, op.i);
      return selector === undefined ? undefined : includeSelector(project, catalog, selector);
    }
    case "immutable":
      return setImmutable(project, op.on);
    case "rename":
      return renameProject(project, op.name);
    case "move": {
      const name = pick(placed, op.i);
      return name === undefined ? undefined : moveCards(project, [name], { x: op.dx, y: op.dy });
    }
    case "flip": {
      const name = pick(placed, op.i);
      return name === undefined ? undefined : flipPins(project, [name]);
    }
    case "expand": {
      const name = pick(placed, op.i);
      return name === undefined ? undefined : setExpanded(project, name, op.on);
    }
  }
}

for (const catalog of catalogs) {
  describe(`edits on catalog ${catalog.lattice.tag}`, () => {
    test("any edit sequence keeps one owner per selector, never causes SEL-05, and round-trips through recipe.json", () => {
      checkProperty(
        `${catalog.lattice.tag}: edit sequences`,
        fc.property(fc.array(opArb, { minLength: 1, maxLength: 25 }), (ops) => {
          let project = makeProject({ recipe: makeRecipe({}, catalog) });
          for (const op of ops) {
            const result = apply(project, catalog, op);
            if (result === undefined) continue;
            // No silent no-ops: every edit says what it did, or why it didn't.
            expect([op.op, result.summary.trim().length > 0]).toEqual([op.op, true]);
            if (!result.changed) expect(result.project.recipe).toEqual(project.recipe);
            project = result.project;
            const placed = new Set(project.recipe.facets);
            expect(Object.keys(project.layout).sort()).toEqual([...placed].sort());
            const contenders = contendersOf(catalog, project.recipe.facets);
            for (const [selector, owner] of Object.entries(project.recipe.owners)) {
              expect([selector, contenders.get(selector as Hex4)?.includes(owner)]).toEqual([selector, true]);
            }
          }
          const analysis = analyze(project.recipe, catalog, ctx);
          expect(analysis.problems.filter((p) => p.code === "SEL-05").map((p) => p.id)).toEqual([]);
          const file = exportRecipeJson(project.recipe, catalog);
          const opened = importFile(file.text, file.filename, [catalog]);
          if (!opened.ok || opened.value.kind !== "recipe") throw new Error(JSON.stringify(opened));
          expect(recipeHash(opened.value.recipe, catalog)).toBe(analysis.recipeHash);
        }),
      );
    });
  });
}
