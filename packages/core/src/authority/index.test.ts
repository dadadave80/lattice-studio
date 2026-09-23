import { describe, expect, test } from "bun:test";
import type { Catalog } from "../model/catalog";
import type { MechanismChange } from "../model/init";
import type { Recipe } from "../model/recipe";
import type { Result } from "../model/result";
import { authorityTable, mechanismOptions, planMechanismChange } from "./index";
import { blankDiamond, context, DEPLOYER, fixture, PREDICTED, SAFE, template } from "./test-support";

const skip = fixture === null;
const catalog = fixture as Catalog;

function change(result: Result<MechanismChange, string>): MechanismChange {
  if (!result.ok) throw new Error(`Expected a change, got: ${result.error}`);
  return result.value;
}

function error(result: Result<MechanismChange, string>): string {
  if (result.ok) throw new Error(`Expected an error, got ${JSON.stringify(result.value.changes)}`);
  return result.error;
}

const GOVERNANCE_SENTENCE =
  "Governance needs GovernedVault's Governor, Votes and TimelockController; Lattice has no standalone Governor init.";

describe.skipIf(skip)("authorityTable", () => {
  test("Blank diamond: admin and upgrade go to the Deploying account", () => {
    expect(authorityTable(blankDiamond(catalog), catalog)).toEqual([
      { role: "DEFAULT_ADMIN_ROLE", holder: { $ref: "deployer" }, via: "AccessControlInit(admin)", path: "steps[0].admin" },
      {
        role: "Upgrade",
        holder: { $ref: "deployer" },
        via: "AccessControlDiamondCut (DEFAULT_ADMIN_ROLE)",
        path: "steps[0].admin",
        upgrade: true,
      },
    ]);
  });

  test("references resolve for a deploy context; literals show checksummed", () => {
    const rows = authorityTable(blankDiamond(catalog), catalog, context({ refs: { self: PREDICTED, deployer: DEPLOYER } }));
    expect(rows.map((r) => r.resolved)).toEqual([DEPLOYER, DEPLOYER]);
    const literal = blankDiamond(catalog);
    literal.init = { kind: "steps", steps: [{ spec: "AccessControlInit", args: { admin: SAFE.toLowerCase() } }] };
    expect(authorityTable(literal, catalog).map((r) => r.resolved)).toEqual([SAFE, SAFE]);
  });

  test("GovernedVault: the diamond holds admin, upgrade and proposer; execution is open; no guardian at init", () => {
    const rows = authorityTable(template(catalog, "GovernedVault"), catalog);
    expect(rows).toEqual([
      { role: "DEFAULT_ADMIN_ROLE", holder: { $ref: "self" }, via: "GovernedVaultInit (the diamond itself)" },
      { role: "Upgrade", holder: { $ref: "self" }, via: "GovernedDiamondCut (governance through the timelock)", upgrade: true },
      { role: "Guardian", holder: null, via: "EmergencyStop (no guardian at init)" },
      { role: "Proposer", holder: { $ref: "self" }, via: "GovernedVaultInit (the diamond's Governor)" },
      { role: "Executor", holder: null, anyone: true, via: "GovernedVaultInit (open execution)" },
    ]);
  });

  test("SafeDiamondCut: the pinned Safe is the Upgrade row, anchored at its argument", () => {
    const recipe = template(catalog, "SafeDiamondCut");
    const [first, ...rest] = recipe.init.kind === "steps" ? recipe.init.steps : [];
    if (first) first.args = { ...first.args, safe: SAFE };
    recipe.init = { kind: "steps", steps: [...(first ? [first] : []), ...rest] };
    expect(authorityTable(recipe, catalog)).toEqual([
      { role: "DEFAULT_ADMIN_ROLE", holder: { $ref: "deployer" }, via: "SafeDiamondCutInit(admin)", path: "steps[0].admin" },
      { role: "Upgrade", holder: SAFE, resolved: SAFE, via: "SafeDiamondCut (pinned Safe)", path: "steps[0].safe", upgrade: true },
      { role: "Guardian", holder: null, via: "EmergencyStop (no guardian at init)" },
    ]);
  });

  test("an unset Safe shows as nobody, not as a missing row", () => {
    const rows = authorityTable(template(catalog, "SafeDiamondCut"), catalog);
    expect(rows.find((r) => r.upgrade)).toEqual({ role: "Upgrade", holder: null, via: "SafeDiamondCut (pinned Safe)", path: "steps[0].safe", upgrade: true });
  });

  test("an immutable diamond has an Upgrade row that says so", () => {
    expect(authorityTable(template(catalog, "ERC20"), catalog)).toEqual([
      { role: "Upgrade", holder: null, via: "Immutable: no upgrade mechanism", upgrade: true },
    ]);
  });
});

describe.skipIf(skip)("mechanismOptions", () => {
  test("five options, each saying who can upgrade and how fast; Governance disabled outside GovernedVault", () => {
    const options = mechanismOptions(blankDiamond(catalog), catalog);
    expect(options.current).toBe("admin");
    expect(options.bundle).toBeUndefined();
    expect(options.options).toEqual([
      { id: "admin", label: "Admin role", facet: "AccessControlDiamondCut", summary: "holders of `DEFAULT_ADMIN_ROLE` cut at once", enabled: true },
      { id: "safe", label: "Safe", facet: "SafeDiamondCut", summary: "only the pinned Safe cuts, at its threshold", enabled: true },
      {
        id: "safe-delay",
        label: "Safe with delay",
        facet: "GovernedSafeDiamondCut",
        summary: "the Safe schedules a cut, which waits out `minDelay`",
        enabled: true,
      },
      {
        id: "governance",
        label: "Governance",
        facet: "GovernedDiamondCut",
        summary: "only a passed proposal, executed through the diamond's own timelock, cuts",
        enabled: false,
        reason: GOVERNANCE_SENTENCE,
      },
      { id: "immutable", label: "Immutable", summary: "no mechanism, which is the same as Keep immutable", enabled: true },
    ]);
  });

  test("current: the placed member, Immutable when acknowledged, null with neither", () => {
    expect(mechanismOptions(template(catalog, "SafeDiamondCut"), catalog).current).toBe("safe");
    expect(mechanismOptions(template(catalog, "ERC20"), catalog).current).toBe("immutable");
    const open = template(catalog, "ERC20");
    delete open.immutable;
    expect(mechanismOptions(open, catalog).current).toBeNull();
  });

  test("GovernedVault: the bundle decides, and no other choice is offered", () => {
    const options = mechanismOptions(template(catalog, "GovernedVault"), catalog);
    expect(options.bundle).toBe("GovernedVaultInit");
    expect(options.current).toBe("governance");
    expect(options.options.filter((o) => o.enabled).map((o) => o.id)).toEqual(["governance"]);
    for (const o of options.options.filter((x) => !x.enabled)) {
      expect(o.reason).toBe("GovernedVaultInit sets up the upgrade mechanism itself, so the bundle decides it.");
    }
  });
});

describe.skipIf(skip)("planMechanismChange", () => {
  test("AccessControlDiamondCut → SafeDiamondCut lists spec L651's items, in order", () => {
    const before = blankDiamond(catalog);
    const snapshot = structuredClone(before);
    const { changes, next } = change(planMechanismChange(before, catalog, "safe", { safe: SAFE, minThreshold: "2" }));
    expect(changes).toEqual([
      { kind: "remove", text: "Remove AccessControlDiamondCut", facet: "AccessControlDiamondCut" },
      { kind: "place", text: "Place SafeDiamondCut", facet: "SafeDiamondCut" },
      { kind: "place", text: "Place EmergencyStop", facet: "EmergencyStop" },
      {
        kind: "init",
        text: "Init: SafeDiamondCutInit(admin, safe, minThreshold) replaces AccessControlInit(admin) and the automatic ERC-165 step, since it sets up AccessControl, EmergencyStop and the flags itself",
      },
      { kind: "authority", text: "Upgrade → Safe 0x71C7…976F, at least 2 signatures" },
    ]);
    expect(next.facets).toEqual(["SafeDiamondCut", "EmergencyStop", "AccessControl", "Receive", "DiamondLoupeFacet", "ERC165Facet"]);
    expect(next.init).toEqual({
      kind: "steps",
      steps: [{ spec: "SafeDiamondCutInit", args: { admin: { $ref: "deployer" }, safe: SAFE, minThreshold: "2" } }],
    });
    expect(before).toEqual(snapshot);
    // The Authority table follows: upgrade → the Safe.
    expect(authorityTable(next, catalog).find((r) => r.upgrade)?.holder).toBe(SAFE);
  });

  test("Admin role's Use a Safe… keeps AccessControlDiamondCut and hands DEFAULT_ADMIN_ROLE to the Safe, as one change list", () => {
    const before = blankDiamond(catalog);
    const { changes, next } = change(planMechanismChange(before, catalog, "admin", { safe: SAFE, keepMechanism: true }));
    expect(next.facets).toEqual(before.facets);
    expect(next.init).toEqual({ kind: "steps", steps: [{ spec: "AccessControlInit", args: { admin: SAFE } }] });
    expect(changes).toEqual([
      { kind: "init", text: "Init: AccessControlInit(admin) → Safe 0x71C7…976F" },
      { kind: "authority", text: "Upgrade → Safe 0x71C7…976F, through `DEFAULT_ADMIN_ROLE`" },
    ]);
    const rows = authorityTable(next, catalog);
    expect(rows.map((r) => [r.role, r.holder])).toEqual([
      ["DEFAULT_ADMIN_ROLE", SAFE],
      ["Upgrade", SAFE],
    ]);
  });

  test("Use a Safe… says why when it can't keep the mechanism or nothing changes", () => {
    expect(error(planMechanismChange(template(catalog, "SafeDiamondCut"), catalog, "admin", { safe: SAFE, keepMechanism: true }))).toBe(
      "Keeping the mechanism needs AccessControlDiamondCut on the sheet.",
    );
    const handed = change(planMechanismChange(blankDiamond(catalog), catalog, "admin", { safe: SAFE, keepMechanism: true })).next;
    expect(error(planMechanismChange(handed, catalog, "admin", { safe: SAFE, keepMechanism: true }))).toBe(
      "`DEFAULT_ADMIN_ROLE` already goes to that address.",
    );
    expect(error(planMechanismChange(blankDiamond(catalog), catalog, "admin", { keepMechanism: true }))).toBe("Enter the Safe's address.");
  });

  test("Safe → Admin role puts AccessControlInit back with the same admin, and the automatic ERC-165 step returns", () => {
    const safe = change(planMechanismChange(blankDiamond(catalog), catalog, "safe", { safe: SAFE, minThreshold: "2" })).next;
    const { changes, next } = change(planMechanismChange(safe, catalog, "admin", {}));
    expect(changes).toEqual([
      { kind: "remove", text: "Remove SafeDiamondCut", facet: "SafeDiamondCut" },
      { kind: "place", text: "Place AccessControlDiamondCut", facet: "AccessControlDiamondCut" },
      {
        kind: "init",
        text: "Init: AccessControlInit(admin) and the automatic ERC-165 step replace SafeDiamondCutInit(admin, safe, minThreshold)",
      },
      { kind: "authority", text: "Upgrade → Deploying account, through `DEFAULT_ADMIN_ROLE`" },
    ]);
    // EmergencyStop stays: AccessControlDiamondCut carries the same convention.
    expect(next.facets).toEqual(["AccessControlDiamondCut", "EmergencyStop", "AccessControl", "Receive", "DiamondLoupeFacet", "ERC165Facet"]);
    expect(next.init).toEqual({ kind: "steps", steps: [{ spec: "AccessControlInit", args: { admin: { $ref: "deployer" } } }] });
  });

  test("Safe with delay uses GovernedSafeDiamondCutInit and routes the Safe, threshold and delay", () => {
    const { changes, next } = change(
      planMechanismChange(blankDiamond(catalog), catalog, "safe-delay", { safe: SAFE, minThreshold: "2", delay: "86400" }),
    );
    expect(next.init).toEqual({
      kind: "steps",
      steps: [{ spec: "GovernedSafeDiamondCutInit", args: { admin: { $ref: "deployer" }, safe: SAFE, minThreshold: "2", minDelay: "86400" } }],
    });
    expect(changes.map((c) => c.text)).toEqual([
      "Remove AccessControlDiamondCut",
      "Place GovernedSafeDiamondCut",
      "Place EmergencyStop",
      "Init: GovernedSafeDiamondCutInit(admin, safe, minThreshold, minDelay) replaces AccessControlInit(admin) and the automatic ERC-165 step, since it sets up AccessControl, EmergencyStop and the flags itself",
      "Upgrade → Safe 0x71C7…976F, at least 2 signatures, after 1 day (86400 s)",
    ]);
  });

  test("Immutable removes the mechanism, its exclusive companions and their init, and acknowledges it", () => {
    const { changes, next } = change(planMechanismChange(blankDiamond(catalog), catalog, "immutable", {}));
    expect(changes).toEqual([
      { kind: "remove", text: "Remove AccessControlDiamondCut", facet: "AccessControlDiamondCut" },
      { kind: "remove", text: "Remove AccessControl", facet: "AccessControl" },
      { kind: "init", text: "Init: remove AccessControlInit(admin) and the automatic ERC-165 step" },
      { kind: "immutable", text: "Keep immutable: nothing can change this diamond after deploy" },
    ]);
    expect(next).toMatchObject({ facets: ["Receive", "DiamondLoupeFacet", "ERC165Facet"], init: { kind: "none" }, immutable: true });
  });

  test("a companion another facet still needs stays", () => {
    const vault = blankDiamond(catalog);
    vault.facets = ["ERC4626", "VaultCore", ...vault.facets];
    const { next } = change(planMechanismChange(vault, catalog, "immutable", {}));
    expect(next.facets).toContain("AccessControl");
    expect(next.init).toEqual({ kind: "steps", steps: [{ spec: "AccessControlInit", args: { admin: { $ref: "deployer" } } }] });
  });

  test("choosing a mechanism clears Keep immutable and places the init first", () => {
    const erc20 = template(catalog, "ERC20");
    const { changes, next } = change(planMechanismChange(erc20, catalog, "safe", { safe: SAFE, minThreshold: "1" }));
    expect(next.immutable).toBeUndefined();
    expect("immutable" in next).toBe(false);
    expect(next.init.kind === "steps" && next.init.steps.map((s) => s.spec)).toEqual(["SafeDiamondCutInit", "ERC20Init"]);
    expect(changes.map((c) => c.text)).toEqual([
      "Place SafeDiamondCut",
      "Place EmergencyStop",
      "Place AccessControl",
      "Init: SafeDiamondCutInit(admin, safe, minThreshold) replaces the automatic ERC-165 step, since it sets up AccessControl, EmergencyStop and the flags itself",
      "Upgrade → Safe 0x71C7…976F, at least 1 signature",
      "Clear Keep immutable",
    ]);
  });

  test("re-choosing the current mechanism with a new Safe only routes the arguments", () => {
    const safe = change(planMechanismChange(blankDiamond(catalog), catalog, "safe", { safe: SAFE, minThreshold: "2" })).next;
    const { changes, next } = change(planMechanismChange(safe, catalog, "safe", { safe: DEPLOYER, minThreshold: "2" }));
    expect(next.facets).toEqual(safe.facets);
    expect(changes).toEqual([
      { kind: "init", text: "Init: SafeDiamondCutInit(safe) → Safe 0xAb58…eC9B" },
      { kind: "authority", text: "Upgrade → Safe 0xAb58…eC9B, at least 2 signatures" },
    ]);
  });

  test("every refusal says why", () => {
    const blank = blankDiamond(catalog);
    expect(error(planMechanismChange(blank, catalog, "governance", {}))).toBe(GOVERNANCE_SENTENCE);
    expect(error(planMechanismChange(template(catalog, "GovernedVault"), catalog, "safe", { safe: SAFE, minThreshold: "2" }))).toBe(
      "GovernedVaultInit sets up the upgrade mechanism itself, so the bundle decides it.",
    );
    expect(error(planMechanismChange(blank, catalog, "safe", {}))).toBe("Enter the Safe's address.");
    expect(error(planMechanismChange(blank, catalog, "safe", { safe: SAFE }))).toBe("Enter the Safe's minimum threshold.");
    expect(error(planMechanismChange(blank, catalog, "safe-delay", { safe: SAFE, minThreshold: "2" }))).toBe("Enter the delay.");
    expect(error(planMechanismChange(blank, catalog, "admin", {}))).toBe("AccessControlDiamondCut is already the upgrade mechanism.");
    expect(error(planMechanismChange(template(catalog, "ERC20"), catalog, "immutable", {}))).toBe("This diamond is already immutable.");
  });

  test("removing a facet drops its owner entries and exclusions nothing else exports", () => {
    const blank: Recipe = blankDiamond(catalog);
    const cut = catalog.facets.find((f) => f.name === "AccessControlDiamondCut")?.selectors[0]?.hex;
    if (!cut) throw new Error("fixture lacks diamondCut");
    blank.exclude = [cut];
    const { next } = change(planMechanismChange(blank, catalog, "immutable", {}));
    expect(next.exclude).toEqual([]);
    const toSafe = change(planMechanismChange(blank, catalog, "safe", { safe: SAFE, minThreshold: "2" })).next;
    expect(toSafe.exclude).toEqual([cut]);
  });
});
