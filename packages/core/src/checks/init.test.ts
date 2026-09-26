import { describe, expect, test } from "bun:test";
import type { AnalysisContext, CheckInput } from "../model/analysis";
import type { Catalog } from "../model/catalog";
import type { ChainState } from "../model/chain";
import type { Problem, ProblemCode } from "../model/problems";
import type { Arg, Recipe } from "../model/recipe";
import { autoOrder } from "../init/plan/plan";
import { addInitStep } from "../edit/recipe-ops";
import { lintCopy } from "../format/copy-lint";
import { renderProblem } from "../narrate/problem";
import { makeCatalog, makeFacet, makeInit, makeProject, makeRecipe } from "../testing/builders";
import { loadFixtureCatalog } from "../testing/fixtures";
import { checkInit } from "./init";

const fixture = loadFixtureCatalog();
if (!fixture.ok) throw new Error(fixture.error);
const catalog = fixture.value;

const DEPLOYER = { $ref: "deployer" } as const;
const ADMIN_A = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
const ADMIN_B = "0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db";
const TOKEN = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const BLANK_FACETS = ["DiamondLoupeFacet", "ERC165Facet", "Receive", "AccessControl", "AccessControlDiamondCut"];

function template(name: string): Recipe {
  const found = catalog.recipes.find((r) => r.name === name);
  if (!found) throw new Error(`${name} isn't in the fixture catalog`);
  return found.recipe;
}

function run(recipe: Recipe, cat: Catalog = catalog, ctx: Partial<AnalysisContext> = {}): Problem[] {
  const input: CheckInput = { recipe, catalog: cat, routing: {}, ctx: { known: [], unconfirmed: [], ...ctx } };
  return checkInit(input).map((p) => {
    expect(p.message).toBe("");
    return { ...p, message: renderProblem(p.code, p.params) };
  });
}

function only(problems: Problem[], code: ProblemCode): Problem[] {
  return problems.filter((p) => p.code === code);
}

function steps(facets: string[], list: { spec: string; args: Record<string, Arg> }[]): Recipe {
  return makeRecipe({ facets, init: { kind: "steps", steps: list } }, catalog);
}

function vault(p: Record<string, Arg>): Recipe {
  const recipe = template("GovernedVault");
  if (recipe.init.kind !== "bundle") throw new Error("expected a bundle");
  const base = recipe.init.args["p"] as Record<string, Arg>;
  return { ...recipe, init: { ...recipe.init, args: { p: { ...base, ...p } } } };
}

function sepolia(codeAt: Record<string, `0x${string}`>): ChainState {
  return { chainId: 11155111, name: "Sepolia", online: true, probedAt: "2026-09-23T00:00:00Z", deployer: { present: true }, shared: {}, simulate: true, codeAt };
}

describe("GovernedVault", () => {
  const problems = run(template("GovernedVault"));

  test("INIT-01 on bundle.p.asset while it's empty, and nothing else blocks", () => {
    expect(only(problems, "INIT-01")).toEqual([
      {
        id: "INIT-01:bundle.p.asset",
        code: "INIT-01",
        severity: "blocker",
        where: [{ kind: "init", path: "bundle.p.asset" }],
        params: { path: "bundle.p.asset", label: "Asset", missing: true, detail: "Asset is required. Fill it in before deploying." },
        message: "Asset is required. Fill it in before deploying.",
        fixes: [{ id: "init.focusField", args: { path: "bundle.p.asset" } }],
      },
    ]);
    expect(problems.map((p) => p.code).sort()).toEqual(["INIT-01", "INIT-05"]);
  });

  test("INIT-05 lists the example fields, with units, and must be acknowledged", () => {
    const [p] = only(problems, "INIT-05");
    expect(p).toMatchObject({ id: "INIT-05:diamond", severity: "warning", ack: true, where: [{ kind: "diamond" }] });
    expect(p?.params["count"]).toBe(8);
    expect(p?.params["paths"]).toEqual([
      "bundle.p.name",
      "bundle.p.symbol",
      "bundle.p.decimalsOffset",
      "bundle.p.minDelay",
      "bundle.p.votingDelay",
      "bundle.p.votingPeriod",
      "bundle.p.proposalThreshold",
      "bundle.p.quorumNumerator",
    ]);
    expect(p?.params["examples"]).toContainEqual({ path: "bundle.p.votingPeriod", label: "Voting period", value: "600", unit: "seconds" });
    expect(p?.params["examples"]).toContainEqual({ path: "bundle.p.quorumNumerator", label: "Governor quorum", value: "4", unit: "percent" });
    expect(p?.params["examples"]).toContainEqual({ path: "bundle.p.name", label: "Name", value: "Grant vault" });
    expect(p?.fixes).toEqual([
      { id: "init.open", args: { focus: "examples" } },
      { id: "ack.set", args: { problemId: "INIT-05:diamond" } },
    ]);
    expect(((p?.params["examples"] ?? []) as { path: string }[]).map((e) => e.path)).toEqual([
      "bundle.p.votingPeriod",
      "bundle.p.quorumNumerator",
      "bundle.p.minDelay",
      "bundle.p.votingDelay",
      "bundle.p.proposalThreshold",
      "bundle.p.name",
      "bundle.p.symbol",
      "bundle.p.decimalsOffset",
    ]);
    expect(p?.message).toBe("8 fields still use example values, including voting period (600 s) and governor quorum (4%).");
  });

  test("filled in with its own values, it raises nothing", () => {
    const own = vault({ asset: TOKEN, name: "Treasury", symbol: "TRS", decimalsOffset: "1", minDelay: "3600", votingDelay: "120", votingPeriod: "86400", proposalThreshold: "1", quorumNumerator: "10" });
    expect(run(own)).toEqual([]);
  });

  test("quorum 140 → the spec's INIT-01 message (spec L327)", () => {
    const [p] = only(run(vault({ asset: TOKEN, quorumNumerator: "140" })), "INIT-01");
    expect(p?.id).toBe("INIT-01:bundle.p.quorumNumerator");
    expect(p?.params).toEqual({ path: "bundle.p.quorumNumerator", label: "Governor quorum", missing: false, detail: "it must be 0-100 (percent of supply)", value: "140" });
    expect(p?.message).toBe("Governor quorum is 140; it must be 0-100 (percent of supply).");
  });

  test("a bundle's order is fixed in Solidity: no INIT-02, INIT-03 or INIT-04", () => {
    const codes = run(vault({ asset: TOKEN })).map((p) => p.code);
    expect(codes).not.toContain("INIT-02");
    expect(codes).not.toContain("INIT-03");
    expect(codes).not.toContain("INIT-04");
  });
});

describe("INIT-01", () => {
  test("a mixed-case address with a wrong checksum is flagged (spec L462)", () => {
    const wrong = `${ADMIN_A.slice(0, -1)}f`;
    const [p] = only(run(steps(BLANK_FACETS, [{ spec: "AccessControlInit", args: { admin: wrong } }])), "INIT-01");
    expect(p?.params).toEqual({ path: "steps[0].admin", label: "Admin", missing: false, detail: "its checksum doesn't match, so it may have a typo", value: wrong });
    expect(p?.message).toBe(`Admin is ${wrong}; its checksum doesn't match, so it may have a typo.`);
  });

  test("chain rules apply only when ctx.chain.codeAt has the address", () => {
    const recipe = steps(["SafeDiamondCut", "AccessControl", "EmergencyStop"], [{ spec: "SafeDiamondCutInit", args: { admin: DEPLOYER, safe: ADMIN_A, minThreshold: "3" } }]);
    expect(only(run(recipe), "INIT-01")).toEqual([]);
    expect(only(run(recipe, catalog, { chain: sepolia({}) }), "INIT-01")).toEqual([]);
    const [p] = only(run(recipe, catalog, { chain: sepolia({ [ADMIN_A.toLowerCase()]: "0x" }) }), "INIT-01");
    expect(p?.params).toEqual({ path: "steps[0].safe", label: "Safe", missing: false, detail: "No Safe at this address on Sepolia yet. Deploy the Safe first.", chain: "Sepolia" });
    expect(p?.message).toBe("No Safe at this address on Sepolia yet. Deploy the Safe first.");
  });
});

describe("INIT-02", () => {
  const synthetic: Catalog = makeCatalog({
    facets: [makeFacet({ name: "A", init: "AInit" }), makeFacet({ name: "B", init: "BInit" })],
    inits: [makeInit({ name: "AInit", initializes: [{ module: "A" }] }), makeInit({ name: "BInit", initializes: [{ module: "B" }], after: ["A"] })],
  });
  const recipe = (order: string[]): Recipe => makeRecipe({ facets: ["A", "B"], init: { kind: "steps", steps: order.map((spec) => ({ spec, args: {} })) } });

  test("B's after names A and B is placed first: a blocker on B's step", () => {
    expect(run(recipe(["BInit", "AInit"]), synthetic)).toEqual([
      {
        id: "INIT-02:steps[0]",
        code: "INIT-02",
        severity: "blocker",
        where: [{ kind: "init", path: "steps[0]" }],
        params: { path: "steps[0]", spec: "BInit", module: "B", after: "A" },
        message: "B initializes before A; it must come after.",
        fixes: [{ id: "init.reorderAuto" }, { id: "init.open", args: { focus: "steps[0]" } }],
      },
    ]);
  });

  test("autoOrder fixes it", () => {
    const broken = recipe(["BInit", "AInit"]);
    if (broken.init.kind !== "steps") throw new Error("expected steps");
    const fixed: Recipe = { ...broken, init: { kind: "steps", steps: autoOrder(broken.init.steps, synthetic) } };
    expect(run(fixed, synthetic)).toEqual([]);
    expect(run(recipe(["AInit", "BInit"]), synthetic)).toEqual([]);
  });

  test("VaultCoreInit never raises it on its own: it initializes AccessControl and ERC4626 itself", () => {
    const own = steps(["ERC20", "ERC4626", "VaultCore", "AccessControl"], [{ spec: "VaultCoreInit", args: { asset_: TOKEN, name_: "V", symbol_: "V", admin_: DEPLOYER, decimalsOffset_: "0" } }]);
    expect(run(own)).toEqual([]);
  });
});

describe("INIT-03", () => {
  test("VaultCoreInit + ERC4626Init double-initialize ERC20 and ERC4626 (K3's real specs)", () => {
    const args = { asset_: TOKEN, name_: "Vault", symbol_: "VLT", decimalsOffset_: "0" };
    const recipe = steps(["ERC20", "ERC4626", "VaultCore", "AccessControl"], [
      { spec: "ERC4626Init", args },
      { spec: "VaultCoreInit", args: { ...args, admin_: DEPLOYER } },
    ]);
    const problems = run(recipe);
    expect(only(problems, "INIT-02")).toEqual([]);
    const doubles = only(problems, "INIT-03");
    expect(doubles.map((p) => [p.id, p.severity, p.params["case"]])).toEqual([
      ["INIT-03:ERC20", "info", "same"],
      ["INIT-03:ERC4626", "info", "same"],
    ]);
    expect(doubles[0]?.message).toBe("ERC4626Init and VaultCoreInit both set up ERC20, identically.");
    expect(doubles[0]?.fixes).toEqual([
      { id: "init.removeStep", args: { path: "steps[0]" } },
      { id: "init.removeStep", args: { path: "steps[1]" } },
    ]);
    const differ = steps(["ERC20", "ERC4626", "VaultCore", "AccessControl"], [
      { spec: "ERC4626Init", args },
      { spec: "VaultCoreInit", args: { ...args, symbol_: "VLT2", admin_: DEPLOYER } },
    ]);
    const [erc20] = only(run(differ), "INIT-03");
    expect([erc20?.id, erc20?.severity, erc20?.params["case"]]).toEqual(["INIT-03:ERC20", "blocker", "conflict"]);
    expect(erc20?.message).toBe("ERC4626Init and VaultCoreInit both set up ERC20, in ways that conflict.");
  });

  test("ERC20PermitInit + ERC6538RegistryInit with different EIP-712 names: a blocker whose fixes remove either step", () => {
    const recipe = steps(["ERC20", "ERC20Permit", "ERC6538Registry"], [
      { spec: "ERC20Init", args: { name_: "Token", symbol_: "TKN" } },
      { spec: "ERC20PermitInit", args: { name_: "Token" } },
      { spec: "ERC6538RegistryInit", args: {} },
    ]);
    const [p] = only(run(recipe), "INIT-03");
    expect(p).toMatchObject({
      id: "INIT-03:EIP712",
      severity: "blocker",
      where: [
        { kind: "init", path: "steps[1]" },
        { kind: "init", path: "steps[2]" },
      ],
      fixes: [
        { id: "init.removeStep", args: { path: "steps[1]" } },
        { id: "init.removeStep", args: { path: "steps[2]" } },
      ],
    });
    expect(p?.params).toEqual({
      module: "EIP712",
      case: "conflict",
      specs: ["ERC20PermitInit", "ERC6538RegistryInit"],
      paths: ["steps[1]", "steps[2]"],
      detail: "set the diamond's one EIP-712 domain, to different names, so only one standard's signatures would verify",
    });
    expect(p?.message).toBe(
      "ERC20PermitInit and ERC6538RegistryInit both set the diamond's one EIP-712 domain, to different names, so only one standard's signatures would verify.",
    );
  });

  test("EIP-712 domains with one name but different versions", () => {
    const synthetic = makeCatalog({
      inits: [
        makeInit({ name: "OneInit", initializes: [{ module: "EIP712", with: { name: "Shared", version: "1" } }] }),
        makeInit({ name: "TwoInit", initializes: [{ module: "EIP712", with: { name: "Shared", version: "2" } }] }),
      ],
    });
    const [p] = run(makeRecipe({ init: { kind: "steps", steps: [{ spec: "OneInit", args: {} }, { spec: "TwoInit", args: {} }] } }), synthetic);
    expect(p?.message).toBe("OneInit and TwoInit both set the diamond's one EIP-712 domain, to different versions, so only one standard's signatures would verify.");
  });

  test("two AccessControl admins: a warning, with Use one admin", () => {
    const recipe = steps(["AccessControl", "SafeDiamondCut", "EmergencyStop"], [
      { spec: "AccessControlInit", args: { admin: ADMIN_A } },
      { spec: "SafeDiamondCutInit", args: { admin: ADMIN_B, safe: ADMIN_A, minThreshold: "3" } },
    ]);
    const [p] = only(run(recipe), "INIT-03");
    expect(p?.severity).toBe("warning");
    expect(p?.id).toBe("INIT-03:AccessControl");
    expect(p?.params).toEqual({
      module: "AccessControl",
      case: "roles",
      specs: ["AccessControlInit", "SafeDiamondCutInit"],
      paths: ["steps[0]", "steps[1]"],
      argPaths: ["steps[0].admin", "steps[1].admin"],
      admin: ADMIN_A,
    });
    expect(p?.fixes).toEqual([
      { id: "init.removeStep", args: { path: "steps[0]" } },
      { id: "init.removeStep", args: { path: "steps[1]" } },
      { id: "init.setArg", args: { path: "steps[1].admin", value: ADMIN_A } },
    ]);
    expect(p?.message).toBe("AccessControlInit and SafeDiamondCutInit both set up AccessControl, granting its roles to different admins.");
  });

  test("the same admin twice, in any letter case: info", () => {
    const recipe = steps(["AccessControl", "SafeDiamondCut", "EmergencyStop"], [
      { spec: "AccessControlInit", args: { admin: ADMIN_A } },
      { spec: "SafeDiamondCutInit", args: { admin: ADMIN_A.toLowerCase(), safe: ADMIN_A, minThreshold: "3" } },
    ]);
    const [p] = only(run(recipe), "INIT-03");
    expect([p?.severity, p?.params["case"]]).toEqual(["info", "same"]);
    const refs = steps(["AccessControl", "SafeDiamondCut", "EmergencyStop"], [
      { spec: "AccessControlInit", args: { admin: DEPLOYER } },
      { spec: "SafeDiamondCutInit", args: { admin: DEPLOYER, safe: ADMIN_A, minThreshold: "3" } },
    ]);
    expect(only(run(refs), "INIT-03").map((x) => x.severity)).toEqual(["info"]);
  });

  test("address(this) in a spec's `with` is the diamond: it matches an argument set to This diamond", () => {
    const synthetic = makeCatalog({
      inits: [
        makeInit({ name: "SelfAdminInit", initializes: [{ module: "AccessControl", with: { admin: "address(this)" } }] }),
        makeInit({ name: "AdminInit", params: [{ name: "admin", type: "address", doc: "", authority: true }], initializes: [{ module: "AccessControl", with: { admin: "admin" } }] }),
      ],
    });
    const recipe = (admin: Arg): Recipe =>
      makeRecipe({ init: { kind: "steps", steps: [{ spec: "SelfAdminInit", args: {} }, { spec: "AdminInit", args: { admin } }] } });
    expect(only(run(recipe({ $ref: "self" }), synthetic), "INIT-03").map((p) => p.severity)).toEqual(["info"]);
    const [p] = only(run(recipe(ADMIN_B), synthetic), "INIT-03");
    expect(p?.severity).toBe("warning");
    expect(p?.fixes.at(-1)).toEqual({ id: "init.setArg", args: { path: "steps[1].admin", value: { $ref: "self" } } });
  });
});

describe("INIT-04", () => {
  test("a placed facet with an init that nothing initializes (spec L330)", () => {
    const recipe = makeRecipe({ facets: ["ERC20", "Receive", "DiamondLoupeFacet", "ERC165Facet"] }, catalog);
    expect(run(recipe)).toEqual([
      {
        id: "INIT-04:ERC20",
        code: "INIT-04",
        severity: "blocker",
        where: [{ kind: "facet", facet: "ERC20" }],
        params: { module: "ERC20", spec: "ERC20Init", facet: "ERC20", consequence: "`name()` and `symbol()` would be empty" },
        message: "ERC20 has no init step, so `name()` and `symbol()` would be empty.",
        fixes: [{ id: "init.addStep", args: { spec: "ERC20Init" } }],
      },
    ]);
  });

  test("another init that runs the module covers the facet; two facets with one init report once", () => {
    const covered = steps(["AccessControl", "SafeDiamondCut", "EmergencyStop"], [{ spec: "SafeDiamondCutInit", args: { admin: DEPLOYER, safe: ADMIN_A, minThreshold: "3" } }]);
    expect(only(run(covered), "INIT-04")).toEqual([]);
    const owned = makeRecipe({ facets: ["DiamondCutFacet", "OwnableFacet"] }, catalog);
    const problems = only(run(owned), "INIT-04");
    expect(problems.map((p) => [p.id, p.params["facet"]])).toEqual([["INIT-04:Ownable", "DiamondCutFacet"]]);
    expect(problems[0]?.message).toBe("DiamondCutFacet has no init step, so Ownable is never initialized.");
  });

  test("a sameCall module with no init in the plan", () => {
    const synthetic = makeCatalog({
      inits: [makeInit({ name: "ERC20VotesInit", initializes: [{ module: "ERC20Votes" }], sameCall: ["ERC20", "Nonces"] }), makeInit({ name: "ERC20Init", initializes: [{ module: "ERC20" }] })],
    });
    const problems = run(makeRecipe({ init: { kind: "steps", steps: [{ spec: "ERC20VotesInit", args: {} }] } }), synthetic);
    expect(problems.map((p) => [p.id, p.where, p.params, p.fixes])).toEqual([
      ["INIT-04:ERC20", [{ kind: "init", path: "steps[0]" }], { module: "ERC20", spec: "ERC20Init", sameCallWith: "ERC20VotesInit" }, [{ id: "init.addStep", args: { spec: "ERC20Init" } }]],
      ["INIT-04:Nonces", [{ kind: "init", path: "steps[0]" }], { module: "Nonces", spec: "", sameCallWith: "ERC20VotesInit" }, []],
    ]);
    expect(problems[0]?.message).toBe("ERC20 has no init step; it initializes in the same call as ERC20VotesInit, so it needs one too.");
    const both = run(makeRecipe({ init: { kind: "steps", steps: [{ spec: "ERC20Init", args: {} }, { spec: "ERC20VotesInit", args: {} }] } }), synthetic);
    expect(both.map((p) => p.id)).toEqual(["INIT-04:Nonces"]);
  });

  /** Applies every `init.addStep` fix a problem offers, and checks `addInitStep` doesn't refuse it. */
  function applyAddStepFixes(recipe: Recipe, cat: Catalog, problems: Problem[]): void {
    const project = makeProject({ recipe });
    for (const problem of problems) {
      for (const fix of problem.fixes) {
        if (fix.id !== "init.addStep") continue;
        const spec = fix.args?.["spec"];
        const result = addInitStep(project, cat, spec as string);
        expect([problem.id, result.changed, result.summary]).toEqual([problem.id, true, `Added ${spec as string} to the init plan`]);
      }
    }
  }

  test("a facet's own module can come before the init's last module (ERC20VotesInit ends with AccessControl, K3's real shape)", () => {
    const synthetic = makeCatalog({
      facets: [makeFacet({ name: "AccessControl", init: "AccessControlInit" }), makeFacet({ name: "ERC20Votes", init: "ERC20VotesInit" })],
      inits: [
        makeInit({ name: "AccessControlInit", initializes: [{ module: "AccessControl" }] }),
        makeInit({
          name: "ERC20VotesInit",
          initializes: [{ module: "EIP712" }, { module: "Nonces" }, { module: "Votes" }, { module: "ERC20Votes" }, { module: "AccessControl" }],
        }),
      ],
    });
    const recipe = makeRecipe(
      { facets: ["AccessControl", "ERC20Votes"], init: { kind: "steps", steps: [{ spec: "AccessControlInit", args: {} }] } },
      synthetic,
    );
    const problems = only(run(recipe, synthetic), "INIT-04");
    expect(problems).toEqual([
      {
        id: "INIT-04:ERC20Votes",
        code: "INIT-04",
        severity: "blocker",
        where: [{ kind: "facet", facet: "ERC20Votes" }],
        params: { module: "ERC20Votes", spec: "ERC20VotesInit", facet: "ERC20Votes" },
        message: "ERC20Votes has no init step, so ERC20Votes is never initialized.",
        fixes: [{ id: "init.addStep", args: { spec: "ERC20VotesInit" } }],
      },
    ]);
    applyAddStepFixes(recipe, synthetic, problems);
  });

  test("a bundle facet's init can't join a plan that already has steps: no fix `addInitStep` would refuse (K3's GovernedVaultInit shape)", () => {
    const synthetic = makeCatalog({
      facets: [makeFacet({ name: "AccessControl", init: "AccessControlInit" }), makeFacet({ name: "GovernedVault", init: "GovernedVaultInit" })],
      inits: [
        makeInit({ name: "AccessControlInit", initializes: [{ module: "AccessControl" }] }),
        makeInit({ name: "GovernedVaultInit", kind: "bundle", initializes: [{ module: "AccessControl" }, { module: "Governor" }] }),
      ],
    });
    const recipe = makeRecipe(
      { facets: ["AccessControl", "GovernedVault"], init: { kind: "steps", steps: [{ spec: "AccessControlInit", args: {} }] } },
      synthetic,
    );
    const problems = only(run(recipe, synthetic), "INIT-04");
    expect(problems).toEqual([
      {
        id: "INIT-04:Governor",
        code: "INIT-04",
        severity: "blocker",
        where: [{ kind: "facet", facet: "GovernedVault" }],
        params: { module: "Governor", spec: "", facet: "GovernedVault" },
        message: "GovernedVault has no init step, so Governor is never initialized.",
        fixes: [],
      },
    ]);
    applyAddStepFixes(recipe, synthetic, problems);
    // Demonstrates why: offering the bundle itself, as the buggy code did, is a fix `addInitStep` refuses.
    const refused = addInitStep(makeProject({ recipe }), synthetic, "GovernedVaultInit");
    expect([refused.changed, refused.summary]).toEqual([false, "GovernedVaultInit is a bundle, so it can't join other steps. Remove them first."]);
  });

  test("that same bundle facet, with no steps yet, still offers its own init", () => {
    const synthetic = makeCatalog({
      facets: [makeFacet({ name: "GovernedVault", init: "GovernedVaultInit" })],
      inits: [makeInit({ name: "GovernedVaultInit", kind: "bundle", initializes: [{ module: "AccessControl" }, { module: "Governor" }] })],
    });
    const recipe = makeRecipe({ facets: ["GovernedVault"] }, synthetic);
    const problems = only(run(recipe, synthetic), "INIT-04");
    expect(problems.map((p) => [p.id, p.params["spec"], p.fixes])).toEqual([
      ["INIT-04:Governor", "GovernedVaultInit", [{ id: "init.addStep", args: { spec: "GovernedVaultInit" } }]],
    ]);
    applyAddStepFixes(recipe, synthetic, problems);
  });
});

describe("the other recipes", () => {
  test("ERC20: INIT-05 for its two Studio examples, nothing else", () => {
    const problems = run(template("ERC20"));
    expect(problems.map((p) => p.code)).toEqual(["INIT-05"]);
    expect(problems[0]?.message).toBe("2 fields still use example values, including name (Example Token) and symbol (EXT).");
  });

  test("INIT-05 names authority fields first", () => {
    const synthetic = makeCatalog({
      inits: [
        makeInit({
          name: "TierInit",
          params: [
            { name: "label", type: "string", doc: "", example: "x" },
            { name: "delay", type: "uint256", doc: "", unit: "seconds", example: "60" },
            { name: "cap", type: "uint256", doc: "", rule: "gte(1)", example: "5" },
            { name: "owner", type: "address", doc: "", authority: true, example: ADMIN_A },
          ],
        }),
      ],
    });
    const [p] = run(makeRecipe({ init: { kind: "steps", steps: [{ spec: "TierInit", args: { label: "x", delay: "60", cap: "5", owner: ADMIN_A } }] } }), synthetic);
    expect(p?.params["paths"]).toEqual(["steps[0].label", "steps[0].delay", "steps[0].cap", "steps[0].owner"]);
    expect(((p?.params["examples"] ?? []) as { path: string }[]).map((e) => e.path)).toEqual(["steps[0].owner", "steps[0].cap", "steps[0].delay", "steps[0].label"]);
  });

  test("SafeDiamondCut: the Safe is missing, minThreshold is an example", () => {
    const problems = run(template("SafeDiamondCut"));
    expect(problems.map((p) => p.id)).toEqual(["INIT-01:steps[0].safe", "INIT-05:diamond"]);
  });

  test("Blank diamond: AccessControlInit with the deploying account is complete", () => {
    expect(run(steps(BLANK_FACETS, [{ spec: "AccessControlInit", args: { admin: DEPLOYER } }]))).toEqual([]);
  });

  test("an init step the catalog doesn't have is skipped", () => {
    expect(run(makeRecipe({ init: { kind: "steps", steps: [{ spec: "GoneInit", args: {} }] } }, catalog))).toEqual([]);
  });
});

describe("copy", () => {
  test("every message these tests render passes C10's lintCopy", () => {
    const recipes: [Recipe, Catalog?][] = [
      [template("GovernedVault")],
      [vault({ asset: TOKEN, quorumNumerator: "140" })],
      [template("SafeDiamondCut")],
      [makeRecipe({ facets: ["ERC20", "DiamondCutFacet"] }, catalog)],
      [
        steps(["ERC20", "ERC20Permit", "ERC6538Registry"], [
          { spec: "ERC20PermitInit", args: { name_: "Token" } },
          { spec: "ERC6538RegistryInit", args: {} },
          { spec: "AccessControlInit", args: { admin: ADMIN_A } },
          { spec: "SafeDiamondCutInit", args: { admin: ADMIN_B, safe: ADMIN_A, minThreshold: "3" } },
        ]),
      ],
    ];
    const messages = recipes.flatMap(([recipe, cat]) => run(recipe, cat).map((p) => p.message));
    expect(messages.length).toBeGreaterThan(5);
    for (const message of messages) expect([message, lintCopy(message)]).toEqual([message, []]);
  });
});
