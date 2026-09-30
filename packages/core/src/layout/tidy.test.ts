import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { layoutSizes } from "../../../tokens/dist/tokens";
import type { Analysis } from "../model/analysis";
import type { Catalog } from "../model/catalog";
import type { Layout, LayoutMetrics, Sizes } from "../model/layout";
import type { Project } from "../model/project";
import { makeCatalog, makeFacet, makeProject, makeRecipe } from "../testing/builders";
import { sel } from "../testing/ids";
import { placeNotes } from "./notes";
import { collisions, contestedByFacet } from "./rows";
import { cardSize } from "./size";
import { contentBounds, freeSlot, pushBelow } from "./slots";
import { analysisWith, buildSheet, facetWith, overlapping, type SheetSpec } from "./testkit";
import { tidy } from "./tidy";

const metrics: LayoutMetrics = layoutSizes;

/** The sizes tidy works with, for checking overlaps the same way. */
function sizesFor(layout: Layout, catalog: Catalog, analysis: Analysis): Sizes {
  const contested = contestedByFacet(collisions(analysis));
  const sizes: Sizes = {};
  for (const [name, entry] of Object.entries(layout)) {
    const facet = catalog.facets.find((f) => f.name === name);
    sizes[name] = facet
      ? cardSize(facet, { metrics, expanded: entry.expanded === true, pins: entry.pins, compact: false, contested: contested.get(name) ?? [] })
      : { width: metrics.cardWidth, height: metrics.headerHeight + metrics.footerHeight };
  }
  return sizes;
}

function projectOn(catalog: Catalog, names: string[], layout: Layout = {}): Project {
  return makeProject({ recipe: makeRecipe({ facets: names }, catalog), layout });
}

describe("tidy", () => {
  // Core ← Token ← Vault, Token ← Votes; Solo stands alone. Catalog order: Vault, Votes, Solo, Token, Core.
  const catalog = makeCatalog({
    facets: [
      facetWith("Vault", 4, 100, [], [["Token"]]),
      facetWith("Votes", 3, 200, [], [["Token"]]),
      facetWith("Solo", 2, 300),
      facetWith("Token", 5, 400, [], [["Core"]]),
      facetWith("Core", 2, 500),
    ],
  });
  const names = ["Vault", "Votes", "Solo", "Token", "Core"];
  const scattered: Layout = {
    Vault: { x: 900, y: 40, pins: "left", expanded: true },
    Votes: { x: 16, y: 800, pins: "right" },
    Solo: { x: 480, y: 480, pins: "right" },
    Token: { x: 0, y: 0, pins: "right" },
    Core: { x: 600, y: 0, pins: "left" },
  };

  test("providers sit in columns left of their dependents; catalog order within a band", () => {
    const out = tidy(projectOn(catalog, names, scattered), catalog, analysisWith(), metrics);
    // Band 0: Solo, Core (catalog order); band 1: Token; band 2: Vault, Votes.
    expect(out["Solo"]).toMatchObject({ x: 96, y: 96 });
    expect(out["Core"]?.x).toBe(96);
    expect((out["Core"]?.y ?? 0) > 96).toBe(true);
    expect(out["Token"]).toMatchObject({ x: 96 + 304, y: 96 });
    expect(out["Vault"]).toMatchObject({ x: 96 + 2 * 304, y: 96 });
    expect(out["Votes"]?.x).toBe(96 + 2 * 304);
    expect((out["Votes"]?.y ?? 0) > (out["Vault"]?.y ?? 0)).toBe(true);
  });

  test("pins and expanded flags are kept", () => {
    const out = tidy(projectOn(catalog, names, scattered), catalog, analysisWith(), metrics);
    expect(out["Vault"]).toMatchObject({ pins: "left", expanded: true });
    expect(out["Core"]?.pins).toBe("left");
  });

  test("placed facets with no layout entry get one, pins on the right", () => {
    const out = tidy(projectOn(catalog, names), catalog, analysisWith(), metrics);
    expect(Object.keys(out).sort()).toEqual([...names].sort());
    expect(out["Token"]).toEqual({ x: 400, y: 96, pins: "right" });
  });

  test("the result doesn't depend on where cards were, or on placement order", () => {
    const a = tidy(projectOn(catalog, names, scattered), catalog, analysisWith(), metrics);
    const moved: Layout = Object.fromEntries(Object.entries(scattered).reverse().map(([n, e]) => [n, { ...e, x: e.x + 333, y: e.y - 71 }]));
    const b = tidy(projectOn(catalog, [...names].reverse(), moved), catalog, analysisWith(), metrics);
    expect(b).toEqual(a);
  });

  test("an empty sheet stays empty", () => {
    const project = projectOn(catalog, []);
    expect(tidy(project, catalog, analysisWith(), metrics)).toBe(project.layout);
  });

  test("the core is never a card: no entry for it, and a stale one goes, whole sheet and selection alike", () => {
    const withCore = makeCatalog({ facets: [...catalog.facets, facetWith("DiamondLoupeFacet", 4, 600), facetWith("ERC165Facet", 1, 700)] });
    const stale: Layout = { ...scattered, DiamondLoupeFacet: { x: 0, y: 0, pins: "right" }, ERC165Facet: { x: 8, y: 8, pins: "left", expanded: true } };
    const project = projectOn(withCore, [...names, "DiamondLoupeFacet", "ERC165Facet"], stale);
    const whole = tidy(project, withCore, analysisWith(), metrics);
    expect(Object.keys(whole).sort()).toEqual([...names].sort());
    expect(whole).toEqual(tidy(projectOn(withCore, names, scattered), withCore, analysisWith(), metrics));
    const some = tidy(project, withCore, analysisWith(), metrics, ["Token", "DiamondLoupeFacet"]);
    expect(Object.keys(some).sort()).toEqual([...names].sort());
    expect(Object.keys(tidy(project, withCore, analysisWith(), metrics, ["ERC165Facet"])).sort()).toEqual([...names].sort());
    // A core-only recipe is an empty sheet.
    const empty = projectOn(withCore, ["DiamondLoupeFacet", "ERC165Facet"]);
    expect(tidy(empty, withCore, analysisWith(), metrics)).toBe(empty.layout);
    // Everything downstream reads a tidied layout, which holds cards only: nothing here sees or emits a core entry.
    const sizes = sizesFor(whole, withCore, analysisWith());
    expect(Object.keys(sizes).sort()).toEqual([...names].sort());
    expect(Object.keys(pushBelow(whole, sizes, "Token", 100, metrics)).sort()).toEqual([...names].sort());
    expect(contentBounds(whole, sizes)).not.toBeNull();
    expect(Number.isFinite(freeSlot(whole, sizes, { x: 96, y: 96 }, { width: metrics.cardWidth, height: 100 }, metrics).x)).toBe(true);
    const notes = placeNotes({ layout: whole, sizes, traces: [], notes: [{ id: "n", size: { width: 160, height: 40 }, facets: ["Token"] }], metrics });
    expect(notes.map((note) => note.id)).toEqual(["n"]);
  });

  test("a convention (DEP-02) doesn't make a provider: only hard requirements set bands", () => {
    const c = makeCatalog({
      facets: [
        makeFacet({ name: "Cut", selectors: ["cut()"], requires: [{ anyOf: ["Stop"], strength: "convention", reason: "usually ships with" }] }),
        makeFacet({ name: "Vault", selectors: ["vault()"], requires: [{ anyOf: ["Stop"], strength: "hard", reason: "needs" }] }),
        facetWith("Stop", 2, 10),
      ],
    });
    const out = tidy(projectOn(c, ["Cut", "Vault", "Stop"]), c, analysisWith(), metrics);
    // Cut and Stop share band 0 (catalog order); Vault, a hard dependent, is band 1.
    expect(out["Cut"]).toMatchObject({ x: 96, y: 96 });
    expect(out["Stop"]?.x).toBe(96);
    expect(out["Vault"]).toMatchObject({ x: 96 + 304, y: 96 });
  });

  test("a dependency cycle still tidies, deterministically", () => {
    const cyclic = makeCatalog({ facets: [facetWith("P", 2, 1, [], [["Q"]]), facetWith("Q", 2, 10, [], [["P"]])] });
    const out = tidy(projectOn(cyclic, ["P", "Q"]), cyclic, analysisWith(), metrics);
    expect(out["P"]?.x).not.toBe(out["Q"]?.x);
    expect(tidy(projectOn(cyclic, ["P", "Q"]), cyclic, analysisWith(), metrics)).toEqual(out);
  });

  test("a tall band wraps into another column", () => {
    const many = makeCatalog({ facets: Array.from({ length: 8 }, (_, i) => facetWith(`T${i}`, 9, 100 * (i + 1))) });
    const out = tidy(projectOn(many, many.facets.map((f) => f.name)), many, analysisWith(), metrics);
    const columns = new Set(Object.values(out).map((e) => e.x));
    expect(columns.size).toBeGreaterThan(1);
    for (const e of Object.values(out)) expect(e.y + 272).toBeLessThanOrEqual(96 + 1040);
  });

  test("contested rows count toward a collapsed card's height", () => {
    const shared = Array.from({ length: 7 }, (_, i) => sel(9000 + i));
    const c = makeCatalog({ facets: [facetWith("A", 12, 1, shared), facetWith("B", 12, 100, shared), facetWith("C", 2, 200)] });
    const analysis = analysisWith(shared.map((selector) => ({ selector, contenders: ["A", "B"] })));
    const out = tidy(projectOn(c, ["A", "B", "C"]), c, analysis, metrics);
    // A draws its 7 contested rows (more than 6) plus "+ n more": 48 + 16 + 8·20 + 28 = 252; gap 40, snapped up.
    expect(out["B"]?.y).toBe(96 + 256 + 40);
    expect(tidy(projectOn(c, ["A", "B", "C"]), c, analysisWith(), metrics)["B"]?.y).toBe(96 + 232 + 40);
  });

  describe("selection", () => {
    test("arranges only the selected cards, around their current center", () => {
      const project = projectOn(catalog, names, scattered);
      const out = tidy(project, catalog, analysisWith(), metrics, ["Token", "Core"]);
      for (const n of ["Vault", "Votes", "Solo"]) expect(out[n]).toEqual(scattered[n]);
      // Core (band 0) left of Token (band 1), same top.
      expect(out["Core"]?.y).toBe(out["Token"]?.y);
      expect((out["Token"]?.x ?? 0) - (out["Core"]?.x ?? 0)).toBe(304);
      expect(overlapping(out, sizesFor(out, catalog, analysisWith()), metrics)).toEqual([]);
    });

    test("centers the block on the selection's old center when that's free", () => {
      const c = makeCatalog({ facets: [facetWith("A", 2, 1), facetWith("B", 2, 10, [], [["A"]])] });
      const layout: Layout = { A: { x: 1000, y: 1000, pins: "right" }, B: { x: 1000, y: 1400, pins: "right" } };
      const out = tidy(projectOn(c, ["A", "B"], layout), c, analysisWith(), metrics, ["A", "B"]);
      // Old box: x 1000..1232, y 1000..1532 → center (1116, 1266). New block: 536 × 132 → top-left (848, 1200).
      expect(out["A"]).toEqual({ x: 848, y: 1200, pins: "right" });
      expect(out["B"]).toEqual({ x: 848 + 304, y: 1200, pins: "right" });
    });

    test("an empty selection changes nothing; unknown names are ignored", () => {
      const project = projectOn(catalog, names, scattered);
      expect(tidy(project, catalog, analysisWith(), metrics, [])).toEqual(scattered);
      expect(tidy(project, catalog, analysisWith(), metrics, ["Nope"])).toEqual(scattered);
    });
  });
});

const sheetArb: fc.Arbitrary<SheetSpec> = fc.integer({ min: 1, max: 60 }).chain((n) =>
  fc.record({
    counts: fc.array(fc.integer({ min: 1, max: 24 }), { minLength: n, maxLength: n }),
    requires: fc.array(fc.array(fc.nat({ max: n - 1 }), { maxLength: 3 }), { minLength: n, maxLength: n }),
    shared: fc.array(fc.array(fc.nat({ max: n - 1 }), { minLength: 2, maxLength: 3 }), { maxLength: 8 }),
  }),
);

describe("tidy properties", () => {
  test("no overlaps and the same output for the same input, for random sheets up to 60 cards", () => {
    fc.assert(
      fc.property(
        sheetArb,
        fc.array(fc.record({ x: fc.integer({ min: -2000, max: 2000 }), y: fc.integer({ min: -2000, max: 2000 }), expanded: fc.boolean() }), { maxLength: 60 }),
        (spec, positions) => {
          const { catalog, names, collisions: list } = buildSheet(spec);
          const layout: Layout = {};
          names.forEach((name, i) => {
            const p = positions[i];
            if (p) layout[name] = p.expanded ? { x: p.x, y: p.y, pins: "right", expanded: true } : { x: p.x, y: p.y, pins: "left" };
          });
          const analysis = analysisWith(list);
          const project = projectOn(catalog, names, layout);
          const out = tidy(project, catalog, analysis, metrics);
          expect(Object.keys(out).sort()).toEqual([...names].sort());
          expect(overlapping(out, sizesFor(out, catalog, analysis), metrics)).toEqual([]);
          expect(tidy(project, catalog, analysis, metrics)).toEqual(out);
        },
      ),
      { numRuns: 80 },
    );
  });

  test("tidy selection never overlaps the cards it leaves alone", () => {
    fc.assert(
      fc.property(sheetArb, fc.array(fc.boolean(), { maxLength: 60 }), (spec, picks) => {
        const { catalog, names, collisions: list } = buildSheet(spec);
        const analysis = analysisWith(list);
        // Start from a tidied (overlap-free) sheet, as the app would have.
        const start = tidy(projectOn(catalog, names), catalog, analysis, metrics);
        const selection = names.filter((_, i) => picks[i] === true);
        const project = projectOn(catalog, names, start);
        const out = tidy(project, catalog, analysis, metrics, selection);
        expect(overlapping(out, sizesFor(out, catalog, analysis), metrics)).toEqual([]);
        for (const n of names) if (!selection.includes(n)) expect(out[n]).toEqual(start[n]);
        expect(tidy(project, catalog, analysis, metrics, selection)).toEqual(out);
      }),
      { numRuns: 80 },
    );
  });
});

describe("tidy performance", () => {
  test("60 cards tidy in under 10 ms", () => {
    const spec: SheetSpec = {
      counts: Array.from({ length: 60 }, (_, i) => 3 + ((i * 7) % 20)),
      requires: Array.from({ length: 60 }, (_, i) => (i === 0 ? [] : [(i * 13) % i, (i * 5) % i])),
      shared: Array.from({ length: 12 }, (_, k) => [k, k + 20, k + 40]),
    };
    const { catalog, names, collisions: list } = buildSheet(spec);
    const analysis = analysisWith(list);
    const project = projectOn(catalog, names);
    tidy(project, catalog, analysis, metrics);
    const runs: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      const out = tidy(project, catalog, analysis, metrics);
      runs.push(performance.now() - t0);
      expect(Object.keys(out)).toHaveLength(60);
    }
    runs.sort((a, b) => a - b);
    expect(runs[3] ?? Number.POSITIVE_INFINITY).toBeLessThan(10);
  });
});
