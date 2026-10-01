import { describe, expect, test } from "bun:test";
import { analyze } from "../analysis";
import { API_OWNERS } from "../model/api";
import type { Catalog } from "../model/catalog";
import { CORE_FACETS, type CoreStatus } from "../model/diamond";
import type { Recipe } from "../model/recipe";
import { NotImplemented } from "../model/wp";
import { loadTemplate } from "../plan";
import { loadFixtureCatalog, makeCatalog, makeRecipe } from "../testing";
import * as mod from "./index";

test("the barrel exports isCoreFacet, isCoreOnly and coreStatus, C2's", () => {
  expect([API_OWNERS.isCoreFacet, API_OWNERS.isCoreOnly, API_OWNERS.coreStatus]).toEqual(["C2", "C2", "C2"]);
  expect([typeof mod.isCoreFacet, typeof mod.isCoreOnly, typeof mod.coreStatus]).toEqual(["function", "function", "function"]);
});

test("isCoreOnly is true for an empty recipe and for the core alone", () => {
  expect(mod.isCoreOnly({ facets: [] })).toBe(true);
  expect(mod.isCoreOnly({ facets: ["DiamondLoupeFacet", "ERC165Facet"] })).toBe(true);
  expect(mod.isCoreOnly({ facets: ["DiamondLoupeFacet", "ERC165Facet", "Receive"] })).toBe(false);
});

test("isCoreFacet names the loupe and ERC-165 facets only", () => {
  expect(mod.isCoreFacet("DiamondLoupeFacet")).toBe(true);
  expect(mod.isCoreFacet("ERC165Facet")).toBe(true);
  expect(mod.isCoreFacet("Receive")).toBe(false);
});

test("coreStatus reads an empty analysis", () => {
  const catalog = makeCatalog();
  const analysis = {
    recipeHash: catalog.hash, routing: {}, problems: [], plan: [], init: null,
    stats: { facets: 0, routed: 0, exported: 0, excluded: 0, namespaces: 0 },
  };
  let caught: unknown;
  let status: ReturnType<typeof mod.coreStatus> | undefined;
  try {
    status = mod.coreStatus(makeRecipe(), catalog, analysis);
  } catch (error) {
    caught = error;
  }
  expect(caught).not.toBeInstanceOf(NotImplemented);
  expect(caught).toBeUndefined();
  expect(status?.loupe.selectors).toEqual(["0x7a0ed627", "0xadfca15e", "0x52ef6b2c", "0xcdffacc6"]);
  expect(status?.cut).toEqual({ facet: null, rivals: [], conflict: false, immutable: false });
});

describe("coreStatus on the fixture catalog", () => {
  const fixture = loadFixtureCatalog();
  const on: Catalog = fixture.ok ? fixture.value : makeCatalog();
  const IERC165: CoreStatus["erc165"]["interfaceIds"][number] = { id: "0x01ffc9a7", name: "IERC165" };
  const LOUPE: CoreStatus["erc165"]["interfaceIds"][number] = { id: "0x48e2b093", name: "IDiamondLoupe" };
  const CUT: CoreStatus["erc165"]["interfaceIds"][number] = { id: "0x1f931c1c", name: "IDiamondCut" };

  function statusOf(recipe: Recipe): CoreStatus {
    return mod.coreStatus(recipe, on, analyze(recipe, on));
  }

  /** A recipe on the fixture: the core plus `facets`, with the empty step plan unless `init` says otherwise. */
  function recipe(facets: string[], init: Recipe["init"] = { kind: "steps", steps: [] }): Recipe {
    return makeRecipe({ facets: [...facets, ...CORE_FACETS], init }, on);
  }

  function templateOf(name: string): Recipe {
    const loaded = loadTemplate(on, name);
    if (!loaded.ok) throw new Error(loaded.error);
    return loaded.value;
  }

  test.skipIf(!fixture.ok)("an empty sheet: 5 routed and 0 facets, the loupe and ERC-165 covered, the core's two plan entries, IDiamondLoupe", () => {
    const status = statusOf(recipe([]));
    // 0 facets (cards), yet the core's five selectors route and export; the core owns whatever namespaces it owns.
    expect(status.fallback).toMatchObject({ facets: 0, routed: 5, exported: 5, excluded: 0 });
    expect(status.loupe.covered).toEqual(status.loupe.selectors);
    expect(status.erc165.covered).toBe(true);
    expect(status.erc165.interfaceIds).toEqual([LOUPE]);
    expect(status.cut).toEqual({ facet: null, rivals: [], conflict: false, immutable: false });
    expect(status.init).toEqual(["DiamondIntrospectionInit.initImmutable"]);
    expect(status.plan.fixed.map((entry) => entry.facet)).toEqual(["DiamondLoupeFacet", "ERC165Facet"]);
    expect(status.plan.rest).toEqual([]);
  });

  test.skipIf(!fixture.ok)("the ERC20 template: immutable, no cut facet, IDiamondLoupe alone", () => {
    const status = statusOf(templateOf("ERC20"));
    expect(status.erc165.interfaceIds).toEqual([LOUPE]);
    expect(status.cut).toEqual({ facet: null, rivals: [], conflict: false, immutable: true });
    expect(status.init).toEqual(["ERC20Init", "DiamondIntrospectionInit.initImmutable"]);
    expect(status.plan.fixed.map((entry) => entry.facet)).toEqual(["DiamondLoupeFacet", "ERC165Facet"]);
    expect(status.plan.rest.map((entry) => entry.facet)).toEqual(["ERC20", "Receive"]);
    expect(status.fallback.facets).toBe(2);
  });

  test.skipIf(!fixture.ok)("a cut facet whose init registers the interfaces itself: IDiamondLoupe and IDiamondCut, no automatic step", () => {
    const status = statusOf(templateOf("SafeDiamondCut"));
    expect(status.erc165.interfaceIds).toEqual([LOUPE, CUT]);
    expect(status.cut).toEqual({ facet: "SafeDiamondCut", rivals: [], conflict: false, immutable: false });
    expect(status.init).toEqual(["SafeDiamondCutInit"]);
  });

  test.skipIf(!fixture.ok)("a cut facet with the automatic step: initUpgradeable registers both", () => {
    const status = statusOf(recipe(["AccessControlDiamondCut"]));
    expect(status.erc165.interfaceIds).toEqual([LOUPE, CUT]);
    expect(status.init).toEqual(["DiamondIntrospectionInit.initUpgradeable"]);
    expect(status.cut.facet).toBe("AccessControlDiamondCut");
  });

  test.skipIf(!fixture.ok)("a bundle that registers the interfaces, with a cut facet placed: both, from the bundle alone", () => {
    const status = statusOf(templateOf("GovernedVault"));
    expect(status.erc165.interfaceIds).toEqual([LOUPE, CUT]);
    expect(status.init).toEqual(["GovernedVaultInit"]);
    expect(status.cut.facet).toBe("GovernedDiamondCut");
  });

  test.skipIf(!fixture.ok)("an init that calls DiamondLib.registerInterface() registers both, with or without a cut facet", () => {
    // SafeDiamondCutInit's recipe carries its cut facet; here the step stands alone on a core-only sheet.
    const status = statusOf(recipe([], { kind: "steps", steps: [{ spec: "SafeDiamondCutInit", args: {} }] }));
    expect(status.cut.facet).toBeNull();
    expect(status.erc165.interfaceIds).toEqual([LOUPE, CUT]);
    expect(status.init).toEqual(["SafeDiamondCutInit"]);
  });

  test.skipIf(!fixture.ok)("a hand-added initImmutable beside a cut facet registers IDiamondLoupe alone, as the Solidity does", () => {
    const steps = [{ spec: "DiamondIntrospectionInit.initImmutable", args: {} }];
    const status = statusOf(recipe(["AccessControlDiamondCut"], { kind: "steps", steps }));
    expect(status.erc165.interfaceIds).toEqual([LOUPE]);
  });

  test.skipIf(!fixture.ok)("an ERC165Init step adds IERC165 first", () => {
    const status = statusOf(recipe([], { kind: "steps", steps: [{ spec: "ERC165Init", args: {} }] }));
    expect(status.erc165.interfaceIds).toEqual([IERC165, LOUPE]);
    expect(status.init).toEqual(["ERC165Init", "DiamondIntrospectionInit.initImmutable"]);
  });

  test.skipIf(!fixture.ok)("init none registers nothing", () => {
    const status = statusOf(recipe(["ERC20"], { kind: "none" }));
    expect(status.erc165.interfaceIds).toEqual([]);
    expect(status.init).toEqual([]);
    // The core's selectors still route: registration is the init's job, coverage the facets'.
    expect(status.loupe.covered).toHaveLength(4);
    expect(status.erc165.covered).toBe(true);
  });

  test.skipIf(!fixture.ok)("two cut facets: the first in catalog order, the other a rival, whatever the placement order", () => {
    const status = statusOf(recipe(["SafeDiamondCut", "AccessControlDiamondCut"]));
    expect(status.cut).toEqual({ facet: "AccessControlDiamondCut", rivals: ["SafeDiamondCut"], conflict: true, immutable: false });
    expect(statusOf(recipe(["AccessControlDiamondCut", "SafeDiamondCut"])).cut).toEqual(status.cut);
    expect(status.erc165.interfaceIds).toEqual([LOUPE, CUT]);
  });

  test.skipIf(!fixture.ok)("fallback is a copy of the analysis stats, and the plan halves cover the whole plan", () => {
    const template = templateOf("GovernedVault");
    const analysis = analyze(template, on);
    const status = mod.coreStatus(template, on, analysis);
    expect(status.fallback).toEqual(analysis.stats);
    expect(status.fallback).not.toBe(analysis.stats);
    expect([...status.plan.fixed, ...status.plan.rest]).toEqual([...analysis.plan]);
  });
});
