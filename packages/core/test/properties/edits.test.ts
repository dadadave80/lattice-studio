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
  | { op: "pair"; i: number; j: number }
  | { op: "removeOwner"; i: number }
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
  { weight: 3, arbitrary: fc.record({ op: fc.constant("place" as const), i: fc.nat(), x: fc.integer({ min: -2000, max: 2000 }), y: fc.integer({ min: -2000, max: 2000 }) }) },
  { weight: 3, arbitrary: fc.record({ op: fc.constant("pair" as const), i: fc.nat(), j: fc.nat() }) },
  { weight: 3, arbitrary: fc.record({ op: fc.constant("removeOwner" as const), i: fc.nat() }) },
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

const pairsOf = new WeakMap<Catalog, [string, string][]>();

/** Every pair of catalog facets that export a selector in common, in catalog order. */
function collidingPairs(catalog: Catalog): [string, string][] {
  const known = pairsOf.get(catalog);
  if (known !== undefined) return known;
  const pairs: [string, string][] = [];
  catalog.facets.forEach((a, i) => {
    const mine = new Set(a.selectors.map((s) => s.hex.toLowerCase()));
    for (const b of catalog.facets.slice(i + 1)) if (b.selectors.some((s) => mine.has(s.hex.toLowerCase()))) pairs.push([a.name, b.name]);
  });
  pairsOf.set(catalog, pairs);
  return pairs;
}

function pick<T>(items: readonly T[], i: number): T | undefined {
  return items.length === 0 ? undefined : items[i % items.length];
}

function apply(project: Project, catalog: Catalog, op: Op): EditResult | undefined {
  const placed = project.recipe.facets;
  const contenders = contendersOf(catalog, placed);
  const selectors = [...contenders.keys()];
  const contested = selectors.filter((s) => (contenders.get(s)?.length ?? 0) >= 2);
  switch (op.op) {
    case "pair": {
      // Two facets that export a selector in common, so the sheet gets a collision to route, clear or exclude.
      const pairs = collidingPairs(catalog);
      const pair = pick(pairs, op.i);
      if (pair === undefined) return undefined;
      const first = placeFacet(project, catalog, pair[0], { x: 0, y: (op.j % 20) * 400 });
      const second = placeFacet(first.project, catalog, pair[1], { x: 400, y: (op.j % 20) * 400 });
      return { project: second.project, changed: first.changed || second.changed, summary: `${first.summary} ${second.summary}` };
    }
    case "removeOwner": {
      // The edit that could leave a stale owner (SEL-05) if removal didn't drop owners.
      const owner = pick([...new Set(Object.values(project.recipe.owners))].sort(), op.i);
      return owner === undefined ? undefined : removeFacets(project, catalog, [owner]);
    }
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
      // Not vacuous: edits that changed a contested selector's owner or exclusion, and removals of an owner.
      let contestedEdits = 0;
      let ownersRemoved = 0;
      const outcome = checkProperty(
        `${catalog.lattice.tag}: edit sequences`,
        fc.property(fc.array(opArb, { minLength: 1, maxLength: 25 }), (ops) => {
          let project = makeProject({ recipe: makeRecipe({}, catalog) });
          for (const op of ops) {
            const result = apply(project, catalog, op);
            if (result === undefined) continue;
            // No silent no-ops: every edit says what it did, or why it didn't.
            expect([op.op, result.summary.trim().length > 0]).toEqual([op.op, true]);
            if (!result.changed) expect(result.project.recipe).toEqual(project.recipe);
            const before = project.recipe;
            const after = result.project.recipe;
            const contestedBefore = contendersOf(catalog, before.facets);
            if (result.changed && (op.op === "route" || op.op === "clear" || op.op === "exclude")) {
              const touched = new Set<string>([...Object.keys(before.owners), ...Object.keys(after.owners), ...before.exclude, ...after.exclude]);
              const changed = [...touched].filter(
                (s) => before.owners[s as Hex4] !== after.owners[s as Hex4] || before.exclude.includes(s as Hex4) !== after.exclude.includes(s as Hex4),
              );
              if (changed.some((s) => (contestedBefore.get(s as Hex4)?.length ?? 0) >= 2)) contestedEdits++;
            }
            if ((op.op === "remove" || op.op === "removeOwner") && result.changed) {
              const gone = before.facets.filter((name) => !after.facets.includes(name));
              if (Object.values(before.owners).some((owner) => gone.includes(owner))) ownersRemoved++;
            }
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
      if (catalog.lattice.tag === "fixture") {
        expect(contestedEdits).toBeGreaterThan(outcome.runs / 10);
        expect(ownersRemoved).toBeGreaterThan(outcome.runs / 40);
      }
    });
  });
}
