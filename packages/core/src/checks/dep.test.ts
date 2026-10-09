import { describe, expect, test } from "bun:test";
import type { CheckInput } from "../model/analysis";
import type { Catalog } from "../model/catalog";
import type { Problem } from "../model/problems";
import type { Recipe } from "../model/recipe";
import { renderProblem } from "../narrate/problem";
import { blankDiamond } from "../plan";
import { loadFixtureCatalog, makeCatalog, makeFacet, makeInit, makeRecipe, recipeOf } from "../testing";
import { checkDep } from "./dep";

function input(catalog: Catalog, recipe: Partial<Recipe>): CheckInput {
  return { recipe: makeRecipe(recipe, catalog), catalog, routing: {}, ctx: { known: [], unconfirmed: [] } };
}

function slot(n: number): `0x${string}` {
  return `0x${n.toString(16).padStart(62, "0")}00`;
}

const own = (id: string, n: number) => ({ id: `lattice.storage.${id}`, slot: slot(n) });

const catalog = makeCatalog({
  facets: [
    makeFacet({ name: "ERC20", storage: own("ERC20", 1) }),
    makeFacet({ name: "ERC4626", storage: own("ERC4626", 2), touches: ["lattice.storage.ERC20"] }),
    makeFacet({
      name: "VaultCore",
      storage: own("VaultCore", 3),
      touches: ["lattice.storage.ERC4626", "lattice.storage.ERC20"],
      requires: [{ anyOf: ["ERC4626"], strength: "hard", reason: "it runs the assets behind ERC4626's shares and initializes after it" }],
    }),
    makeFacet({
      name: "Bridge",
      requires: [
        { anyOf: ["AxelarAdapter", "HyperlaneAdapter"], strength: "hard", reason: "it sends messages through a gateway" },
        { anyOf: ["ERC20"], strength: "hard", reason: "it moves ERC20 balances" },
      ],
    }),
    makeFacet({ name: "AxelarAdapter", storage: own("AxelarAdapter", 4) }),
    makeFacet({ name: "HyperlaneAdapter", storage: own("HyperlaneAdapter", 5) }),
    makeFacet({
      name: "GovernedDiamondCut",
      family: "upgrade",
      touches: ["lattice.storage.AccessControl", "lattice.storage.EmergencyStop"],
      requires: [{ anyOf: ["EmergencyStop"], strength: "convention", reason: "a guardian can halt upgrades" }],
    }),
    makeFacet({ name: "EmergencyStop", storage: own("EmergencyStop", 6), touches: ["lattice.storage.AccessControl"] }),
    makeFacet({ name: "ERC20Pausable", touches: ["lattice.storage.Pausable", "lattice.storage.ERC20"] }),
    makeFacet({ name: "Pausable", storage: own("Pausable", 7), touches: ["lattice.storage.AccessControl"] }),
    makeFacet({ name: "ERC20Permit", touches: ["lattice.storage.Nonces", "lattice.storage.ERC20"] }),
    makeFacet({ name: "AccessControl", family: "access", storage: own("AccessControl", 8) }),
    makeFacet({ name: "AccessControlEnumerable", family: "access", storage: own("AccessControlEnumerable", 9), touches: ["lattice.storage.AccessControl"] }),
    makeFacet({ name: "AccessControlTimed", family: "access", storage: own("AccessControlTimed", 10), touches: ["lattice.storage.AccessControl"] }),
    makeFacet({ name: "AccountSigner", family: "account", storage: own("AccountSigner", 11) }),
    makeFacet({ name: "ERC6900Validation", family: "account" }),
    makeFacet({ name: "DiamondLoupeFacet", touches: ["diamond.lib.storage"] }),
    makeFacet({
      name: "RoleUser",
      touches: ["lattice.storage.AccessControl"],
      requires: [{ anyOf: ["AccessControl"], strength: "convention", reason: "an admin can grant its roles" }],
    }),
  ],
  inits: [
    makeInit({ name: "AccessControlInit", initializes: [{ module: "AccessControl" }] }),
    makeInit({ name: "PausableInit", initializes: [{ module: "Pausable" }, { module: "Nonces" }] }),
    makeInit({ name: "EnumerableInit", initializes: [{ module: "AccessControlEnumerable" }] }),
  ],
});

function ids(recipe: Partial<Recipe>): string[] {
  return checkDep(input(catalog, recipe)).map((p) => p.id);
}

describe("DEP-01 · hard requirements", () => {
  test("VaultCore without ERC4626: a blocker with the spec's reason and Place ERC4626", () => {
    const problems = checkDep(input(catalog, { facets: ["ERC20", "VaultCore"] }));
    expect(problems).toEqual([
      {
        id: "DEP-01:VaultCore+ERC4626",
        code: "DEP-01",
        severity: "blocker",
        where: [{ kind: "facet", facet: "VaultCore" }],
        params: { facet: "VaultCore", anyOf: ["ERC4626"], reason: "it runs the assets behind ERC4626's shares and initializes after it" },
        message: "",
        fixes: [{ id: "facet.place", args: { facet: "ERC4626" } }],
      },
    ]);
    // Flow 5 step 1 (spec L445), and no second report for the ERC4626 namespace VaultCore touches.
    expect(renderProblem("DEP-01", problems[0]?.params ?? {})).toBe(
      "VaultCore requires ERC4626: it runs the assets behind ERC4626's shares and initializes after it.",
    );
  });

  test("placing the provider clears it", () => {
    expect(ids({ facets: ["ERC20", "ERC4626", "VaultCore"] })).toEqual([]);
  });

  test("two options: Place each, then Compare options…; two unmet requirements on one facet get distinct ids", () => {
    const problems = checkDep(input(catalog, { facets: ["Bridge"] }));
    expect(problems.map((p) => [p.id, p.fixes])).toEqual([
      [
        "DEP-01:Bridge+AxelarAdapter",
        [
          { id: "facet.place", args: { facet: "AxelarAdapter" } },
          { id: "facet.place", args: { facet: "HyperlaneAdapter" } },
          { id: "dependency.compare", args: { options: ["AxelarAdapter", "HyperlaneAdapter"] } },
        ],
      ],
      ["DEP-01:Bridge+ERC20", [{ id: "facet.place", args: { facet: "ERC20" } }]],
    ]);
    expect(ids({ facets: ["Bridge", "HyperlaneAdapter", "ERC20"] })).toEqual([]);
  });
});

describe("DEP-02 · conventions", () => {
  test("companion: GovernedDiamondCut without EmergencyStop, a warning worded as the spec's", () => {
    const problems = checkDep(input(catalog, { facets: ["GovernedDiamondCut", "AccessControl"] }));
    expect(problems).toEqual([
      {
        id: "DEP-02:GovernedDiamondCut+EmergencyStop",
        code: "DEP-02",
        severity: "warning",
        where: [{ kind: "facet", facet: "GovernedDiamondCut" }],
        params: { kind: "companion", facet: "GovernedDiamondCut", anyOf: ["EmergencyStop"], reason: "a guardian can halt upgrades" },
        message: "",
        fixes: [{ id: "facet.place", args: { facet: "EmergencyStop" } }],
      },
    ]);
    expect(renderProblem("DEP-02", problems[0]?.params ?? {})).toBe(
      "GovernedDiamondCut usually ships with EmergencyStop, so a guardian can halt upgrades.",
    );
    expect(ids({ facets: ["GovernedDiamondCut", "AccessControl", "EmergencyStop"] })).toEqual([]);
  });

  test("namespace written at init with no manager: the spec's roles sentence for AccessControl", () => {
    const problems = checkDep(input(catalog, { facets: ["ERC20"], init: { kind: "steps", steps: [{ spec: "AccessControlInit", args: {} }] } }));
    expect(problems).toEqual([
      {
        id: "DEP-02:diamond+lattice.storage.AccessControl",
        code: "DEP-02",
        severity: "warning",
        where: [{ kind: "diamond" }],
        params: {
          kind: "namespace",
          namespace: "lattice.storage.AccessControl",
          anyOf: ["AccessControl"],
          reason: "Roles are written at init, but without AccessControl nobody can manage them later.",
        },
        message: "",
        fixes: [{ id: "facet.place", args: { facet: "AccessControl" } }],
      },
    ]);
    expect(renderProblem("DEP-02", problems[0]?.params ?? {})).toBe(
      "Roles are written at init, but without AccessControl nobody can manage them later.",
    );
  });

  test("namespace written by a facet and an init: anchored on the facets, with the roles sentence", () => {
    const problems = checkDep(
      input(catalog, { facets: ["ERC20", "EmergencyStop"], init: { kind: "steps", steps: [{ spec: "AccessControlInit", args: {} }] } }),
    );
    expect(problems).toEqual([
      {
        id: "DEP-02:diamond+lattice.storage.AccessControl",
        code: "DEP-02",
        severity: "warning",
        where: [{ kind: "facet", facet: "EmergencyStop" }],
        params: {
          kind: "namespace",
          namespace: "lattice.storage.AccessControl",
          anyOf: ["AccessControl"],
          facet: "EmergencyStop",
          reason: "Roles are written at init, but without AccessControl nobody can manage them later.",
        },
        message: "",
        fixes: [{ id: "facet.place", args: { facet: "AccessControl" } }],
      },
    ]);
  });

  test("namespace written only by facets: the reason says which facet writes it, not 'at init'", () => {
    const [p, ...rest] = checkDep(input(catalog, { facets: ["ERC20", "EmergencyStop"] }));
    expect(rest).toEqual([]);
    expect(p?.params).toEqual({
      kind: "namespace",
      namespace: "lattice.storage.AccessControl",
      anyOf: ["AccessControl"],
      facet: "EmergencyStop",
      reason: "EmergencyStop writes `lattice.storage.AccessControl`, but without AccessControl nobody can manage it later.",
    });
    expect(renderProblem("DEP-02", p?.params ?? {})).toBe(
      "EmergencyStop writes `lattice.storage.AccessControl`, but without AccessControl nobody can manage it later.",
    );
  });

  test("another access-family namespace written at init: C10's generic wording (no reason)", () => {
    const problems = checkDep(
      input(catalog, { facets: ["AccessControl"], init: { kind: "steps", steps: [{ spec: "EnumerableInit", args: {} }] } }),
    );
    expect(problems.map((p) => [p.id, p.where, p.params])).toEqual([
      [
        "DEP-02:diamond+lattice.storage.AccessControlEnumerable",
        [{ kind: "diamond" }],
        { kind: "namespace", namespace: "lattice.storage.AccessControlEnumerable", anyOf: ["AccessControlEnumerable"] },
      ],
    ]);
    expect(renderProblem("DEP-02", problems[0]?.params ?? {})).toBe(
      "`lattice.storage.AccessControlEnumerable` is written at init, but without AccessControlEnumerable nobody can manage it later.",
    );
  });

  test("several writers: one problem per namespace, anchored on each writer in catalog order", () => {
    const problems = checkDep(input(catalog, { facets: ["ERC20", "EmergencyStop", "Pausable"] }));
    expect(problems.map((p) => [p.id, p.where, p.params.facet])).toEqual([
      [
        "DEP-02:diamond+lattice.storage.AccessControl",
        [
          { kind: "facet", facet: "EmergencyStop" },
          { kind: "facet", facet: "Pausable" },
        ],
        "EmergencyStop",
      ],
    ]);
  });

  test("a namespace whose owner isn't in the access family raises nothing, by facet or by init", () => {
    // lattice.storage.Pausable is owned by Pausable, which has no family: nothing to manage after deploy.
    expect(ids({ facets: ["ERC20", "ERC20Pausable"] })).toEqual([]);
    expect(ids({ facets: ["ERC20", "ERC20Pausable"], init: { kind: "steps", steps: [{ spec: "PausableInit", args: {} }] } })).toEqual([]);
    // Nor does VaultCore's lattice.storage.ERC4626, beyond its DEP-01.
    expect(ids({ facets: ["ERC20", "VaultCore"] })).toEqual(["DEP-01:VaultCore+ERC4626"]);
  });

  test("no report for a namespace no catalog facet owns, or one a placed facet owns", () => {
    // diamond.lib.storage (a shared library's) and lattice.storage.Nonces have no owner to place.
    expect(ids({ facets: ["DiamondLoupeFacet", "ERC20", "ERC20Permit"] })).toEqual([]);
    expect(ids({ facets: ["ERC20", "EmergencyStop", "Pausable", "AccessControl"] })).toEqual([]);
  });

  test("a gap a companion already asks for is reported once", () => {
    // RoleUser touches lattice.storage.AccessControl and carries an AccessControl convention.
    expect(ids({ facets: ["RoleUser"] })).toEqual(["DEP-02:RoleUser+AccessControl"]);
    expect(ids({ facets: ["GovernedDiamondCut", "AccessControl"] })).toEqual(["DEP-02:GovernedDiamondCut+EmergencyStop"]);
  });
});

describe("DEP-03 · one access model, one account model", () => {
  test("two account models: a blocker worded as the spec's, with one Remove per side", () => {
    const problems = checkDep(input(catalog, { facets: ["AccessControl", "AccountSigner", "ERC6900Validation"] }));
    const dep03 = problems.filter((p) => p.code === "DEP-03");
    expect(dep03).toEqual([
      {
        id: "DEP-03:AccountSigner+ERC6900Validation",
        code: "DEP-03",
        severity: "blocker",
        where: [
          { kind: "facet", facet: "AccountSigner" },
          { kind: "facet", facet: "ERC6900Validation" },
        ],
        params: { facets: ["AccountSigner", "ERC6900Validation"], family: "account" },
        message: "",
        fixes: [
          { id: "facet.remove", args: { facets: ["AccountSigner"] } },
          { id: "facet.remove", args: { facets: ["ERC6900Validation"] } },
        ],
      },
    ]);
    expect(renderProblem("DEP-03", dep03[0]?.params ?? {})).toBe(
      "AccountSigner and ERC6900Validation are different account models; one diamond holds one.",
    );
  });

  test("three access models: one blocker per pair; one member alone: nothing", () => {
    const problems: Problem[] = checkDep(input(catalog, { facets: ["AccessControl", "AccessControlEnumerable", "AccessControlTimed"] }));
    expect(problems.map((p) => [p.id, p.params.family])).toEqual([
      ["DEP-03:AccessControl+AccessControlEnumerable", "access"],
      ["DEP-03:AccessControl+AccessControlTimed", "access"],
      ["DEP-03:AccessControlEnumerable+AccessControlTimed", "access"],
    ]);
    expect(ids({ facets: ["AccessControl", "AccountSigner"] })).toEqual([]);
  });
});

describe("the fixture catalog's templates and the Blank diamond", () => {
  const fixture = loadFixtureCatalog();

  test.skipIf(!fixture.ok)("VaultCore without ERC4626 gives DEP-01 with the spec's reason", () => {
    if (!fixture.ok) return;
    const problems = checkDep(input(fixture.value, { facets: ["ERC20", "VaultCore", "AccessControl"] }));
    expect(problems.map((p) => [p.id, p.params])).toEqual([
      ["DEP-01:VaultCore+ERC4626", { facet: "VaultCore", anyOf: ["ERC4626"], reason: "it runs the assets behind ERC4626's shares and initializes after it" }],
    ]);
  });

  test.skipIf(!fixture.ok)("v1 templates and the Blank diamond raise no DEP-01 or DEP-03; the templates no DEP-02", () => {
    if (!fixture.ok) return;
    const cat = fixture.value;
    const v1 = cat.recipes.filter((r) => r.phase === "v1");
    expect(v1.map((r) => r.name).sort()).toEqual(["ERC20", "GovernedVault", "SafeDiamondCut"]);
    // GovernedVault loads with only INIT-01 for `asset` (spec Flow 2): no DEP problem of any kind.
    for (const template of v1) {
      expect({ name: template.name, found: checkDep(input(cat, recipeOf(template))).map((p) => p.id) }).toEqual({ name: template.name, found: [] });
    }
  });

  test.skipIf(!fixture.ok)("the Blank diamond shows exactly one DEP-02: AccessControlDiamondCut usually ships with EmergencyStop", () => {
    if (!fixture.ok) return;
    const blank = blankDiamond(fixture.value);
    expect(blank.init).toEqual({ kind: "steps", steps: [{ spec: "AccessControlInit", args: { admin: { $ref: "deployer" } } }] });
    const problems = checkDep({ recipe: blank, catalog: fixture.value, routing: {}, ctx: { known: [], unconfirmed: [] } });
    expect(problems.map((p) => [p.id, p.params.kind])).toEqual([["DEP-02:AccessControlDiamondCut+EmergencyStop", "companion"]]);
    expect(renderProblem("DEP-02", problems[0]?.params ?? {})).toBe(
      "AccessControlDiamondCut usually ships with EmergencyStop, so a guardian can halt upgrades.",
    );
  });
});
