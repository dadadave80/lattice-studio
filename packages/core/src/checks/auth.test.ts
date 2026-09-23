import { describe, expect, test } from "bun:test";
import { blankDiamond, context, DEPLOYER, fixture, OLD_PREDICTION, PREDICTED, SAFE, template } from "../authority/test-support";
import type { AnalysisContext, CheckInput } from "../model/analysis";
import type { Catalog } from "../model/catalog";
import type { ChainState } from "../model/chain";
import type { Hex } from "../model/hex";
import type { Recipe } from "../model/recipe";
import { formatAddress } from "../format/format";
import { checkAuth } from "./auth";
import { runChecks } from "./index";

const skip = fixture === null;
const catalog = fixture as Catalog;

function chain(codeAt: Record<string, Hex | "0x">): ChainState {
  return {
    chainId: 11155111,
    name: "Sepolia",
    online: true,
    probedAt: "2026-09-23T00:00:00.000Z",
    deployer: { present: true },
    shared: {},
    simulate: true,
    codeAt: Object.fromEntries(Object.entries(codeAt).map(([k, v]) => [k.toLowerCase(), v])),
  };
}

function input(recipe: Recipe, ctx: AnalysisContext): CheckInput {
  return { recipe, catalog, routing: {}, ctx };
}

function withAdmin(recipe: Recipe, admin: string): Recipe {
  return { ...recipe, init: { kind: "steps", steps: [{ spec: "AccessControlInit", args: { admin } }] } };
}

const refs = { self: PREDICTED, deployer: DEPLOYER };
const DELEGATION: Hex = `0xef0100${"11".repeat(20)}`;

describe.skipIf(skip)("AUTH-01", () => {
  test("Blank diamond deployed from a plain account: diamondCut and DEFAULT_ADMIN_ROLE rest with one key", () => {
    const problems = checkAuth(input(blankDiamond(catalog), context({ refs, chain: chain({ [DEPLOYER]: "0x" }) })));
    const id = `AUTH-01:${DEPLOYER.toLowerCase()}`;
    expect(problems).toEqual([
      {
        id,
        code: "AUTH-01",
        severity: "warning",
        ack: true,
        where: [{ kind: "init", path: "steps[0].admin" }],
        params: { holder: DEPLOYER, roles: ["diamondCut", "DEFAULT_ADMIN_ROLE"], paths: ["steps[0].admin"], delegated: false, chain: "Sepolia" },
        message: "",
        fixes: [
          { id: "authority.chooseMechanism", args: { preset: "safe" } },
          { id: "authority.chooseMechanism", args: { preset: "governance" } },
          { id: "ack.set", args: { problemId: id } },
        ],
      },
    ]);
    const [rendered] = runChecks(input(blankDiamond(catalog), context({ refs, chain: chain({ [DEPLOYER]: "0x" }) })), [checkAuth]);
    expect(rendered?.message).toBe(
      `\`diamondCut\` and \`DEFAULT_ADMIN_ROLE\` rest with ${formatAddress(DEPLOYER)}, a single key. If it's a Safe that isn't deployed yet, deploy it first.`,
    );
  });

  test("an EIP-7702 delegated account is still one key", () => {
    const [p] = checkAuth(input(withAdmin(blankDiamond(catalog), SAFE), context({ chain: chain({ [SAFE]: DELEGATION }) })));
    expect(p?.params).toMatchObject({ holder: SAFE, delegated: true });
  });

  test("silent until the chain says: no chain, or no probe of the holder", () => {
    expect(checkAuth(input(blankDiamond(catalog), context({ refs })))).toEqual([]);
    expect(checkAuth(input(blankDiamond(catalog), context({ refs, chain: chain({}) })))).toEqual([]);
    // The deployer reference can't be checked before a deploy context resolves it.
    expect(checkAuth(input(blankDiamond(catalog), context({ chain: chain({ [DEPLOYER]: "0x" }) })))).toEqual([]);
  });

  test("a holder with contract code (a deployed Safe) is fine", () => {
    expect(checkAuth(input(withAdmin(blankDiamond(catalog), SAFE), context({ chain: chain({ [SAFE]: "0x6080" }) })))).toEqual([]);
  });

  test("a Safe mechanism names what cuts: the pinned Safe with no code yet", () => {
    const recipe = template(catalog, "SafeDiamondCut");
    recipe.init = { kind: "steps", steps: [{ spec: "SafeDiamondCutInit", args: { admin: { $ref: "deployer" }, safe: SAFE, minThreshold: "2" } }] };
    const problems = checkAuth(input(recipe, context({ refs, chain: chain({ [SAFE]: "0x", [DEPLOYER]: "0x6080" }) })));
    expect(problems.map((p) => p.params)).toEqual([
      { holder: SAFE, roles: ["diamondCut"], paths: ["steps[0].safe"], delegated: false, chain: "Sepolia" },
    ]);
  });

  test("never for the GovernedVault template's self-held roles, even when the predicted address has no code", () => {
    const ctx = context({ refs, chain: chain({ [PREDICTED]: "0x", [DEPLOYER]: "0x" }) });
    expect(checkAuth(input(template(catalog, "GovernedVault"), ctx))).toEqual([]);
  });

  test("never for a literal that is this diamond's predicted address, now or under an earlier salt", () => {
    const ctx = context({
      refs,
      known: [OLD_PREDICTION],
      knownFrom: { [OLD_PREDICTION.toLowerCase()]: { source: "prediction", chainId: 11155111, chain: "Sepolia" } },
      chain: chain({ [PREDICTED]: "0x", [OLD_PREDICTION]: "0x" }),
    });
    expect(checkAuth(input(withAdmin(blankDiamond(catalog), PREDICTED), ctx))).toEqual([]);
    const stale = checkAuth(input(withAdmin(blankDiamond(catalog), OLD_PREDICTION), ctx));
    expect(stale.map((p) => p.code)).toEqual(["AUTH-02"]);
  });
});

describe.skipIf(skip)("AUTH-02", () => {
  test("a predicted address in known blocks, worded from knownFrom", () => {
    const ctx = context({
      known: [OLD_PREDICTION.toLowerCase() as Hex],
      knownFrom: { [OLD_PREDICTION.toLowerCase()]: { source: "prediction", chainId: 11155111, chain: "Sepolia" } },
    });
    const problems = checkAuth(input(withAdmin(blankDiamond(catalog), OLD_PREDICTION), ctx));
    expect(problems).toEqual([
      {
        id: "AUTH-02:steps[0].admin",
        code: "AUTH-02",
        severity: "blocker",
        where: [{ kind: "init", path: "steps[0].admin" }],
        params: { path: "steps[0].admin", role: "DEFAULT_ADMIN_ROLE", address: OLD_PREDICTION, source: "prediction", chainId: 11155111, chain: "Sepolia" },
        message: "",
        fixes: [
          { id: "init.setArg", args: { path: "steps[0].admin", value: { $ref: "self" } } },
          { id: "init.focusField", args: { path: "steps[0].admin" } },
        ],
      },
    ]);
    const [rendered] = runChecks(input(withAdmin(blankDiamond(catalog), OLD_PREDICTION), ctx), [checkAuth]);
    expect(rendered?.message).toBe(`The admin is ${formatAddress(OLD_PREDICTION)}, where this diamond would have been before the salt changed.`);
  });

  test("without knownFrom the params carry no source; references never match", () => {
    const ctx = context({ known: [OLD_PREDICTION] });
    const [p] = checkAuth(input(withAdmin(blankDiamond(catalog), OLD_PREDICTION.toLowerCase()), ctx));
    expect(p?.params).toEqual({ path: "steps[0].admin", role: "DEFAULT_ADMIN_ROLE", address: OLD_PREDICTION });
    expect(checkAuth(input(blankDiamond(catalog), context({ known: [DEPLOYER], refs })))).toEqual([]);
  });

  test("never for the current prediction, even when recordPrediction put it in known", () => {
    const ctx = context({
      refs,
      known: [PREDICTED, OLD_PREDICTION],
      knownFrom: { [PREDICTED.toLowerCase()]: { source: "prediction", chainId: 11155111, chain: "Sepolia" } },
    });
    expect(checkAuth(input(withAdmin(blankDiamond(catalog), PREDICTED.toLowerCase()), ctx))).toEqual([]);
    expect(checkAuth(input(withAdmin(blankDiamond(catalog), OLD_PREDICTION), ctx)).map((p) => p.id)).toEqual(["AUTH-02:steps[0].admin"]);
  });

  test("the pinned Safe counts too, and an address nothing knows passes", () => {
    const recipe = template(catalog, "SafeDiamondCut");
    recipe.init = { kind: "steps", steps: [{ spec: "SafeDiamondCutInit", args: { admin: SAFE, safe: OLD_PREDICTION, minThreshold: "2" } }] };
    const problems = checkAuth(input(recipe, context({ known: [OLD_PREDICTION] })));
    expect(problems.map((p) => [p.id, p.params.role])).toEqual([["AUTH-02:steps[0].safe", "diamondCut"]]);
  });
});
