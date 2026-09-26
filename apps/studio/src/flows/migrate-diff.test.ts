import { describe, expect, test } from "bun:test";
import type { Catalog, Recipe } from "@lattice-studio/core";
import { loadTemplate, recipeHash } from "@lattice-studio/core";
import { loadFixtureCatalog } from "@lattice-studio/core/testing";
import { reviewCounts, reviewMigration } from "./migrate-diff";

function catalog(id: "fixture" | "fixture-next"): Catalog {
  const loaded = loadFixtureCatalog(id);
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

const fixture = catalog("fixture");
const next = catalog("fixture-next");

function template(name: string): Recipe {
  const loaded = loadTemplate(fixture, name);
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

/** GovernedVault plus the two facets fixture-next changes (fixtures/README.md: EmergencyStop, Governor, ERC20). */
function recipe(): Recipe {
  const base = template("GovernedVault");
  const extra = ["EmergencyStop", "Governor", "ERC20"].filter((f) => !base.facets.includes(f));
  return { ...base, facets: [...base.facets, ...extra] };
}

describe("reviewMigration, fixture to fixture-next", () => {
  test("lists every selector added or removed and every codehash that changed, and nothing else", () => {
    const review = reviewMigration(recipe(), fixture, next);
    expect(review.complete).toBe(true);
    expect(review.fromTag).toBe("fixture");
    expect(review.toTag).toBe("fixture-next");
    const byName = Object.fromEntries(review.changes.map((c) => [c.name, c]));
    expect(Object.keys(byName).sort()).toEqual(["ERC20", "EmergencyStop", "Governor"]);
    expect(byName.EmergencyStop?.added.map((s) => s.signature)).toEqual(["guardianCount()"]);
    expect(byName.EmergencyStop?.removed).toEqual([]);
    expect(byName.Governor?.removed.map((s) => s.signature)).toEqual(["version()"]);
    expect(byName.Governor?.added).toEqual([]);
    expect(byName.ERC20?.added).toEqual([]);
    expect(byName.ERC20?.removed).toEqual([]);
    for (const name of ["ERC20", "EmergencyStop", "Governor"]) {
      const code = byName[name]?.code;
      expect(code).not.toBeNull();
      expect(code?.from).not.toBe(code?.to);
    }
    expect(reviewCounts(review)).toEqual({ added: 1, removed: 1, code: 3, missing: 0 });
  });

  test("only what the project uses: a recipe without those facets sees no change", () => {
    const unchanged = fixture.facets.map((f) => f.name).filter((name) => !["ERC20", "EmergencyStop", "Governor"].includes(name));
    const review = reviewMigration({ ...template("ERC20"), facets: unchanged.slice(0, 5) }, fixture, next);
    expect(review.changes.filter((c) => c.kind === "facet")).toEqual([]);
  });

  test("the migrated recipe names the target catalog and keeps its facets", () => {
    const before = recipe();
    const review = reviewMigration(before, fixture, next);
    expect(review.recipe.catalog).toEqual({ tag: "fixture-next", hash: next.hash });
    expect([...review.recipe.facets].sort()).toEqual([...before.facets].sort());
    expect(review.dropped).toEqual({ facets: [], owners: [], exclude: [] });
    expect(recipeHash(review.recipe)).not.toBe(recipeHash(before));
  });

  test("a routing to a selector the owner lost, and an exclusion of it, are dropped", () => {
    const governor = fixture.facets.find((f) => f.name === "Governor");
    const version = governor?.selectors.find((s) => s.signature === "version()");
    if (!version) throw new Error("fixture Governor has no version()");
    const before: Recipe = { ...recipe(), owners: { [version.hex]: "Governor" }, exclude: [version.hex] };
    const review = reviewMigration(before, fixture, next);
    expect(review.dropped.owners).toEqual([version.hex]);
    expect(review.dropped.exclude).toEqual([version.hex]);
    expect(review.recipe.owners).toEqual({});
    expect(review.recipe.exclude).toEqual([]);
  });

  test("without the old catalog: facets the target lacks and routings their owner lost, marked incomplete", () => {
    const governor = fixture.facets.find((f) => f.name === "Governor");
    const version = governor?.selectors.find((s) => s.signature === "version()");
    if (!version) throw new Error("fixture Governor has no version()");
    const before: Recipe = {
      ...recipe(),
      catalog: { tag: "v0.3.0", hash: `0x${"ab".repeat(32)}` },
      facets: [...recipe().facets, "RetiredFacet"],
      owners: { [version.hex]: "Governor" },
    };
    const review = reviewMigration(before, null, next);
    expect(review.complete).toBe(false);
    expect(review.fromTag).toBe("v0.3.0");
    const byName = Object.fromEntries(review.changes.map((c) => [c.name, c]));
    expect(byName.RetiredFacet?.missing).toBe(true);
    expect(byName.Governor?.removed.map((s) => s.hex)).toEqual([version.hex]);
    expect(review.dropped.facets).toEqual(["RetiredFacet"]);
    expect(review.recipe.facets).not.toContain("RetiredFacet");
  });
});
