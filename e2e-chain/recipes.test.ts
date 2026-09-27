/**
 * The chain matrices run every v1 recipe (spec L957): the Blank diamond (spec L990) first, then the loadable
 * templates. This pins the Blank diamond's row so it can't drop out of the matrices silently. No node or forge.
 */
import { describe, expect, test } from "bun:test";
import { BLANK_DIAMOND_FACETS, templateList } from "@lattice-studio/core";
import { builtCatalog } from "./harness/catalog";
import { neededByV1 } from "./harness/prepare";
import { BLANK, PATHS, entropyFor, fixture, v1Recipes } from "./harness/recipes";

describe("the v1 recipes the chain suites deploy", () => {
  const { catalog } = builtCatalog();

  test("the Blank diamond first, then every loadable template", () => {
    const templates = templateList(catalog).filter((item) => item.loadable).map((item) => item.name);
    expect(templates.length).toBeGreaterThan(0);
    expect(v1Recipes(catalog)).toEqual([BLANK, ...templates]);
  });

  for (const path of PATHS) {
    test(`the Blank diamond through ${path === "factory" ? "LatticeFactory" : "CreateX"}: its five facets, admin "Deploying account", no blocker, one DEP-02 warning`, () => {
      const f = fixture(catalog, BLANK, path, entropyFor(`blank:${path}`));
      expect([...f.recipe.facets].sort()).toEqual([...BLANK_DIAMOND_FACETS].sort());
      expect(f.recipe.init).toEqual({ kind: "steps", steps: [{ spec: "AccessControlInit", args: { admin: { $ref: "deployer" } } }] });
      expect(f.analysis.problems.filter((p) => p.severity === "blocker")).toEqual([]);
      expect(f.analysis.problems.filter((p) => p.severity === "warning").map((p) => p.code)).toEqual(["DEP-02"]);
      expect(f.project.deploy.path).toBe(path);
      expect(new Set(f.analysis.plan.map((entry) => entry.facet))).toEqual(new Set(BLANK_DIAMOND_FACETS));
    });
  }

  test("the shared contracts prepared for the suites include the Blank diamond's facets and AccessControlInit", () => {
    const needed = new Set(neededByV1(catalog));
    for (const name of ["Receive", "AccessControl", "AccessControlDiamondCut", "AccessControlInit"]) expect([name, needed.has(name)]).toEqual([name, true]);
  });
});
