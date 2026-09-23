import type { Catalog, CommandRef, Problem } from "@lattice-studio/core";
import { loadFixtureCatalog } from "@lattice-studio/core/testing";
import { describe, expect, test } from "bun:test";
import type { PaletteRow } from "@/contracts";
import {
  filterGroups, ON_SHEET, paletteGroups, SUGGESTED_FIXES, type Describe, type PaletteSources,
} from "./palette-items";

const loaded = loadFixtureCatalog();
if (!loaded.ok) throw new Error(loaded.error);
const catalog: Catalog = loaded.value;

/** Every command is real; titles as their owners write them. */
const describeFake: Describe = (ref) => {
  const args = ref.args ?? {};
  switch (ref.id) {
    case "facet.place":
      return { title: `Place ${String(args.facet)}`, category: "Build", syntax: "place <facet>" };
    case "recipe.load":
      return { title: `Recipe: ${String(args.name)}`, category: "Build", syntax: "recipe <name>" };
    case "recipe.replace":
      return { title: `Replace this sheet with ${String(args.name)}`, category: "Build" };
    case "selector.route":
      return { title: `Route to ${String(args.facet)}`, category: "Build", syntax: "route <facet> <selector>" };
    case "problem.next":
      return { title: "Next problem", category: "Build", binding: "problem.next" };
    case "init.open":
      return { title: "Fill in", category: "Build" };
    case "facet.remove":
      return { title: "Remove", category: "Build" };
    case "history.undo":
      return { title: "Undo", category: "Session", binding: "history.undo", syntax: "undo" };
    default:
      // Placeholders: not built yet, so no row.
      return null;
  }
};

const rows: PaletteRow[] = [
  { ref: { id: "history.undo" }, title: "Undo", category: "Session", binding: "history.undo", syntax: "undo" },
  { ref: { id: "deploy.open" }, title: "Deploy…", category: "Deploy", binding: "deploy.open" },
  { ref: { id: "layout.tidy" }, title: "Tidy", category: "Sheet", binding: "layout.tidy", syntax: "tidy" },
  { ref: { id: "problem.next" }, title: "Next problem", category: "Build", binding: "problem.next" },
  { ref: { id: "layout.flipPins" }, title: "Flip pins", category: "Sheet", binding: "layout.flipPins" },
];

function problem(id: string, code: Problem["code"], fixes: CommandRef[]): Problem {
  return { id, code, severity: "blocker", where: [], params: {}, message: "", fixes };
}

function sources(over: Partial<PaletteSources> = {}): PaletteSources {
  return {
    mode: "all", at: null, rows, recent: [], problems: [], catalog, placed: new Set(), describe: describeFake, ...over,
  };
}

describe("palette groups (IR L164, PA bug 15)", () => {
  test("groups come Suggested, Recent, Commands, Place facet, Recipes; empty ones are left out", () => {
    const all = paletteGroups(sources({
      problems: [problem("CORE-01", "CORE-01", [{ id: "facet.place", args: { facet: "DiamondLoupeFacet" } }])],
      recent: [{ id: "history.undo" }],
    }));
    expect(all.map((g) => g.label)).toEqual(["Suggested", "Recent", "Commands", "Place facet", "Recipes"]);
    expect(paletteGroups(sources()).map((g) => g.label)).toEqual(["Commands", "Place facet", "Recipes"]);
  });

  test("commands sort Sheet, Build, Session, then the rest; by title within a category", () => {
    const commands = paletteGroups(sources()).find((g) => g.id === "commands");
    expect(commands?.items.map((i) => i.title)).toEqual(["Flip pins", "Tidy", "Next problem", "Undo", "Deploy…"]);
  });

  test("Suggested: the first fix of the first problems, Fill in for INIT-01, then Next problem", () => {
    const suggested = paletteGroups(sources({
      problems: [
        problem("a", "SEL-01", [{ id: "selector.route", args: { selector: "0xa9059cbb", facet: "ERC20" } }]),
        // A placeholder fix is passed over for the next one.
        problem("b", "SEL-03", [{ id: "inspector.focusSelectors", args: { facet: "X" } }, { id: "facet.remove", args: { facets: ["X"] } }]),
        // The same fix twice is one row.
        problem("c", "SEL-01", [{ id: "selector.route", args: { selector: "0xa9059cbb", facet: "ERC20" } }]),
        problem("d", "INIT-01", [{ id: "init.focusField", args: { path: "bundle.p.asset" } }]),
        problem("e", "CORE-01", [{ id: "facet.place", args: { facet: "DiamondLoupeFacet" } }]),
        problem("f", "CORE-01", [{ id: "facet.place", args: { facet: "ERC165Facet" } }]),
      ],
    }))[0];
    expect(suggested?.label).toBe("Suggested");
    expect(suggested?.items.map((i) => i.title)).toEqual([
      "Route to ERC20", "Remove", "Place DiamondLoupeFacet", "Fill in", "Next problem",
    ]);
    expect(SUGGESTED_FIXES).toBe(3);
    // A fix that places a facet teaches the filled-in console line.
    expect(suggested?.items[2]?.syntax).toBe("place diamondloupefacet");
  });

  test("Recent keeps its order and drops commands that aren't built", () => {
    const recent = paletteGroups(sources({ recent: [{ id: "history.undo" }, { id: "settings.open" }, { id: "init.open" }] }))
      .find((g) => g.id === "recent");
    expect(recent?.items.map((i) => i.title)).toEqual(["Undo", "Fill in"]);
  });

  test("Place facet: every facet in catalog order, teaching place <facet>; placed ones say On sheet", () => {
    const facets = paletteGroups(sources({ placed: new Set(["ERC20"]) })).find((g) => g.id === "facets");
    expect(facets?.items.map((i) => i.ref.args?.facet)).toEqual(catalog.facets.map((f) => f.name));
    const erc20 = facets?.items.find((i) => i.ref.args?.facet === "ERC20");
    expect(erc20).toMatchObject({ title: "Place ERC20", syntax: "place erc20", note: ON_SHEET, category: "Build" });
    expect(facets?.items.find((i) => i.ref.args?.facet === "ERC20Permit")?.note).toBeUndefined();
  });

  test("Recipes: every recipe as Recipe: <name>; on a sheet with facets the v1 ones also replace it", () => {
    const empty = paletteGroups(sources()).find((g) => g.id === "recipes");
    expect(empty?.items.map((i) => i.title)).toEqual(catalog.recipes.map((r) => `Recipe: ${r.name}`));
    expect(empty?.items[0]?.syntax).toBe(`recipe ${catalog.recipes[0]?.name.toLowerCase()}`);
    const busy = paletteGroups(sources({ placed: new Set(["ERC20"]) })).find((g) => g.id === "recipes");
    expect(busy?.items.filter((i) => i.ref.id === "recipe.replace").map((i) => i.title)).toEqual([
      "Replace this sheet with GovernedVault", "Replace this sheet with ERC20", "Replace this sheet with SafeDiamondCut",
    ]);
  });

  test("Add facet here… shows only facets, each placing at the stored position", () => {
    const groups = paletteGroups(sources({
      mode: "facets", at: { x: 40, y: 80 }, recent: [{ id: "history.undo" }],
      problems: [problem("a", "CORE-01", [{ id: "facet.place", args: { facet: "Receive" } }])],
    }));
    expect(groups.map((g) => g.label)).toEqual(["Place facet"]);
    expect(groups[0]?.items[0]?.ref).toEqual({ id: "facet.place", args: { facet: catalog.facets[0]?.name ?? "", at: { x: 40, y: 80 } } });
  });

  test("no catalog yet: no facets and no recipes, commands still listed", () => {
    expect(paletteGroups(sources({ catalog: null })).map((g) => g.label)).toEqual(["Commands"]);
  });
});

describe("filtering", () => {
  test("every word must match title, category, syntax, note, facet name or area; group order holds", () => {
    const groups = paletteGroups(sources({ recent: [{ id: "history.undo" }], placed: new Set(["Pausable"]) }));
    const paus = filterGroups(groups, "paus");
    expect(paus.map((g) => g.label)).toEqual(["Place facet"]);
    expect(paus[0]?.items.map((i) => i.ref.args?.facet)).toEqual(["ERC20Pausable", "Pausable"]);
    expect(filterGroups(groups, "  UNDO ").map((g) => [g.label, g.items.map((i) => i.title)])).toEqual([
      ["Recent", ["Undo"]], ["Commands", ["Undo"]],
    ]);
    expect(filterGroups(groups, "on sheet")[0]?.items.map((i) => i.title)).toEqual(["Place Pausable"]);
    expect(filterGroups(groups, "place erc20per").flatMap((g) => g.items.map((i) => i.title))).toEqual(["Place ERC20Permit"]);
    expect(filterGroups(groups, "zzzz")).toEqual([]);
    expect(filterGroups(groups, "")).toEqual(groups);
  });
});
