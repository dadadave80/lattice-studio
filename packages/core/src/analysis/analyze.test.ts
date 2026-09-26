import { describe, expect, test } from "bun:test";
import { canonicalJson } from "../canonical";
import { collectRefs, encodeInit } from "../init/encode";
import { planInit } from "../init/plan";
import type { AnalysisContext, Check } from "../model/analysis";
import type { Catalog } from "../model/catalog";
import type { Hex4 } from "../model/hex";
import { type Problem, problem } from "../model/problems";
import type { Recipe } from "../model/recipe";
import { isNotImplemented, NotImplemented, notImplemented } from "../model/wp";
import { blankDiamond } from "../plan";
import { addr, hex } from "../testing";
import { analyze } from "./analyze";
import { catalog, fixture, S, sheet, template } from "./test-support";

const ADAPTERS = ["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"];
/** A structural copy of the catalog: a different object, so the memo can't answer. */
const fresh = (): Catalog => structuredClone(catalog());
/** A template with its init left out, for tests about routing and problems that must run before C4a and C4b land. */
const withoutInit = (name: string): Recipe => ({ ...template(name), init: { kind: "none" } });

/**
 * Whether C4a's `planInit` and C4b's `collectRefs` and `encodeInit` are built. Until they are, `analyze` throws
 * `NotImplemented` for any recipe with an init (it never degrades), so those tests wait for them.
 */
function initBuilt(): boolean {
  if (fixture === null) return false;
  try {
    const recipe = template("ERC20");
    planInit(recipe, fixture);
    collectRefs(recipe);
    encodeInit({ kind: "none", steps: [] }, fixture, {});
    return true;
  } catch (error) {
    if (isNotImplemented(error)) return false;
    throw error;
  }
}
const noInit = !initBuilt();

/** Paths of every object reachable from `value` for which `pick(frozen)` holds. */
function objectsWhere(value: unknown, pick: (isFrozen: boolean) => boolean, path = "$", seen = new Set<object>()): string[] {
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const here = pick(Object.isFrozen(value)) ? [path] : [];
  return here.concat(Object.entries(value).flatMap(([key, member]) => objectsWhere(member, pick, `${path}.${key}`, seen)));
}
const unfrozen = (value: unknown): string[] => objectsWhere(value, (isFrozen) => !isFrozen);
const frozen = (value: unknown): string[] => objectsWhere(value, (isFrozen) => isFrozen);

describe("analyze", () => {
  test.skipIf(fixture === null)("Axelar + Hyperlane: SEL-01 on 0xcdfe7f5c and 0xdc680a0f; owners resolve both via chosen", () => {
    const open = analyze(sheet(ADAPTERS), catalog());
    expect(open.problems.filter((p) => p.code === "SEL-01").map((p) => p.id)).toEqual(["SEL-01:0xcdfe7f5c", "SEL-01:0xdc680a0f"]);
    expect(open.problems[0]?.message).toBe(
      "`sendMessage(bytes,bytes,bytes[])` 0xcdfe7f5c is exported by AxelarGatewayAdapter and HyperlaneGatewayAdapter. Choose one owner.",
    );
    const owners = { [S.sendMessage]: "AxelarGatewayAdapter", [S.supportsAttribute]: "HyperlaneGatewayAdapter" };
    const resolved = analyze(sheet(ADAPTERS, { owners }), catalog());
    expect(resolved.problems.filter((p) => p.code === "SEL-01")).toEqual([]);
    expect(resolved.routing[S.sendMessage]).toEqual({ owner: "AxelarGatewayAdapter", contenders: ADAPTERS, via: "chosen" });
    expect(resolved.routing[S.supportsAttribute]).toEqual({ owner: "HyperlaneGatewayAdapter", contenders: ADAPTERS, via: "chosen" });
  });

  test.skipIf(noInit)("GovernedVault template: no SEL-01, the script's routing, a 14-facet plan and its stats", () => {
    const analysis = analyze(template("GovernedVault"), catalog());
    expect(analysis.problems.filter((p) => p.code === "SEL-01" || p.code === "SEM-01")).toEqual([]);
    for (const s of [S.transfer, S.transferFrom, S.deposit, S.mint, S.withdraw, S.redeem, S.castVoteBySig]) {
      expect([s, analysis.routing[s]?.owner, analysis.routing[s]?.via]).toEqual([s, "GovernedVault", "seam"]);
    }
    expect([analysis.routing[S.totalAssets]?.owner, analysis.routing[S.decimals]?.owner]).toEqual(["VaultCore", "ERC4626"]);
    expect([analysis.routing[S.delegate]?.owner, analysis.routing[S.delegateBySig]?.owner]).toEqual(["ERC20Votes", "ERC20Votes"]);
    for (const s of [S.name, S.clock, S.CLOCK_MODE]) {
      expect([s, analysis.routing[s]?.owner, analysis.routing[s]?.via]).toEqual([s, "GovernedVault", "chosen"]);
    }
    expect(analysis.stats).toEqual({ facets: 14, routed: 120, exported: 143, excluded: 0, namespaces: 11 });
    expect(analysis.plan.length).toBe(14);
    expect(analysis.plan.reduce((sum, entry) => sum + entry.selectors.length, 0)).toBe(120);
    expect(analysis.plan.find((entry) => entry.facet === "ERC20")?.selectors).not.toContain(S.transfer);
  });

  test.skipIf(fixture === null)("GovernedVault + ERC20Pausable: no choice for transfer or transferFrom, SEL-03, and no empty Add", () => {
    const recipe = withoutInit("GovernedVault");
    recipe.facets = [...recipe.facets, "ERC20Pausable"];
    const analysis = analyze(recipe, catalog());
    expect(analysis.problems.filter((p) => p.code === "SEL-01")).toEqual([]);
    expect(analysis.problems.filter((p) => p.code === "SEL-03").map((p) => p.id)).toEqual(["SEL-03:ERC20Pausable"]);
    expect(analysis.plan.map((entry) => entry.facet)).not.toContain("ERC20Pausable");
    expect(analysis.stats.facets).toBe(15);
  });

  test.skipIf(fixture === null)("an imported owner outside a seam's anyOf: SEM-01 on that owner while the selector routes via the seam", () => {
    const recipe = withoutInit("GovernedVault");
    recipe.facets = [...recipe.facets, "ERC20Pausable"];
    recipe.owners = { ...recipe.owners, [S.transfer]: "ERC20Pausable" };
    const analysis = analyze(recipe, catalog());
    const sem = analysis.problems.find((p) => p.code === "SEM-01");
    expect(sem?.id).toBe("SEM-01:0xa9059cbb");
    expect(sem?.severity).toBe("blocker");
    expect(sem?.where).toEqual([{ kind: "selector", selector: S.transfer, facet: "ERC20Pausable" }]);
    expect(sem?.fixes).toEqual([
      { id: "selector.route", args: { selector: S.transfer, facet: "GovernedVault" } },
      { id: "facet.remove", args: { facets: ["ERC20Pausable"] } },
    ]);
    expect(analysis.routing[S.transfer]).toMatchObject({ owner: "GovernedVault", via: "seam" });
    expect(analysis.plan.find((entry) => entry.facet === "GovernedVault")?.selectors).toContain(S.transfer);
  });

  test.skipIf(noInit)("the three v1 templates and the Blank diamond raise no selector problem beyond SEL-02 info", () => {
    for (const recipe of [template("GovernedVault"), template("ERC20"), template("SafeDiamondCut"), blankDiamond(catalog())]) {
      const selectorProblems = analyze(recipe, catalog()).problems.filter((p) => p.code.startsWith("SEL-") || p.code === "SEM-01");
      expect(selectorProblems.filter((p) => p.code !== "SEL-02")).toEqual([]);
    }
  });

  test.skipIf(fixture === null)("stats count excluded exported selectors", () => {
    const analysis = analyze(sheet(ADAPTERS, { exclude: [S.sendMessage, S.supportsAttribute, "0x12345678"] }), catalog());
    expect(analysis.stats.excluded).toBe(2);
    expect(analysis.stats.exported).toBe(21);
    expect(analysis.stats.routed).toBe(17);
    expect(analysis.routing[S.sendMessage]).toEqual({ contenders: ADAPTERS, via: "chosen" });
  });
});

describe("determinism and stable ids", () => {
  function shuffles(base: Recipe): Recipe[] {
    const out: Recipe[] = [];
    for (let shift = 1; shift < base.facets.length; shift += 3) {
      const facets = [...base.facets.slice(shift), ...base.facets.slice(0, shift)];
      const owners = Object.fromEntries(Object.entries(base.owners).reverse()) as Recipe["owners"];
      out.push({ ...base, facets: shift % 2 === 0 ? facets : facets.reverse(), owners, exclude: [...base.exclude].reverse() });
    }
    return out;
  }

  test.skipIf(fixture === null)("shuffling placement, owners and exclusions changes nothing in the analysis JSON", () => {
    const base = withoutInit("GovernedVault");
    base.facets = [...base.facets, "ERC20Pausable", "AxelarGatewayAdapter", "HyperlaneGatewayAdapter"];
    base.exclude = [S.receive, S.name];
    const expected = canonicalJson(analyze(base, fresh()));
    for (const shuffled of shuffles(base)) expect(canonicalJson(analyze(shuffled, fresh()))).toBe(expected);
  });

  test.skipIf(noInit)("the same holds with the template's init", () => {
    const base = template("GovernedVault");
    base.facets = [...base.facets, "ERC20Pausable"];
    const expected = canonicalJson(analyze(base, fresh()));
    for (const shuffled of shuffles(base)) expect(canonicalJson(analyze(shuffled, fresh()))).toBe(expected);
  });

  test.skipIf(fixture === null)("problem ids stay the same across unrelated edits", () => {
    const before = analyze(sheet(ADAPTERS), fresh()).problems.filter((p) => p.code === "SEL-01");
    const after = analyze(sheet([...ADAPTERS, "ERC20", "Receive", "Pausable"]), fresh()).problems.filter((p) => p.code === "SEL-01");
    expect(after.map((p) => p.id)).toEqual(before.map((p) => p.id));
    expect(after).toEqual(before);
    const excluded = analyze(sheet(ADAPTERS, { exclude: [S.supportsAttribute] }), fresh()).problems.filter((p) => p.code === "SEL-01");
    expect(excluded).toEqual(before.filter((p) => p.id === "SEL-01:0xcdfe7f5c"));
  });

  test.skipIf(fixture === null)("the recipe is analyzed normalized: uppercase hex and duplicates don't change the result", () => {
    const recipe = sheet(ADAPTERS);
    const messy: Recipe = { ...recipe, facets: [...ADAPTERS].reverse().concat(ADAPTERS), exclude: ["0xDC680A0F" as Hex4] };
    expect(canonicalJson(analyze(messy, fresh()))).toBe(canonicalJson(analyze({ ...recipe, exclude: [S.supportsAttribute] }, fresh())));
  });
});

describe("memo and injected checks", () => {
  const recipe = () => sheet(ADAPTERS);

  test.skipIf(fixture === null)("the same recipe, catalog and context return the memoized analysis", () => {
    const on = fresh();
    const ctx: AnalysisContext = { known: [addr(1)], unconfirmed: [] };
    const first = analyze(recipe(), on, ctx);
    expect(analyze(recipe(), on, { known: [addr(1)], unconfirmed: [] })).toBe(first);
    expect(analyze(recipe(), on, { known: [addr(2)], unconfirmed: [] })).not.toBe(first);
    expect(analyze({ ...recipe(), name: "Renamed" }, on, ctx)).toBe(first);
    expect(analyze({ ...recipe(), facets: [...ADAPTERS, "ERC20"] }, on, ctx)).not.toBe(first);
  });

  test.skipIf(fixture === null)("results are deep-frozen: sorting problems in place throws and can't corrupt a later call", () => {
    const on = fresh();
    const first = analyze(recipe(), on);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.problems)).toBe(true);
    expect(Object.isFrozen(first.problems[0]?.params["contenders"])).toBe(true);
    expect(Object.isFrozen(first.routing[S.sendMessage]?.contenders)).toBe(true);
    const ids = first.problems.map((p) => p.id);
    expect(() => first.problems.sort((a, b) => (a.id < b.id ? 1 : -1))).toThrow(TypeError);
    expect(() => {
      (first.routing[S.sendMessage]?.contenders ?? []).push("Mallory");
    }).toThrow(TypeError);
    expect(analyze(recipe(), on).problems.map((p) => p.id)).toEqual(ids);
    expect(Object.isFrozen(on.facets)).toBe(false);
    expect(Object.isFrozen(on.seams)).toBe(false);
  });

  test.skipIf(fixture === null)("every object in the result is frozen, and nothing it was built from is", () => {
    const on = fresh();
    const input = noInit ? withoutInit("GovernedVault") : template("GovernedVault");
    input.facets.push("ERC20Pausable");
    const ctx: AnalysisContext = { known: [addr(1)], unconfirmed: [] };
    const result = analyze(input, on, ctx);
    expect(result.problems.length).toBeGreaterThan(0);
    expect(result.plan.length).toBeGreaterThan(0);
    expect(unfrozen(result)).toEqual([]);
    expect(frozen(on)).toEqual([]);
    expect(frozen(input)).toEqual([]);
    expect(frozen(ctx)).toEqual([]);
  });

  test.skipIf(fixture === null)("a check's params that hold catalog, recipe or context arrays are copied as they're frozen", () => {
    const on = fresh();
    const ctx: AnalysisContext = { known: [addr(1)], unconfirmed: [] };
    const borrowing: Check = (input) => [
      problem("CORE-02", [{ kind: "diamond" }], {}, []),
      {
        ...problem("DEP-01", [{ kind: "facet", facet: "AxelarGatewayAdapter" }], { facet: "AxelarGatewayAdapter", anyOf: ["X"], reason: "r" }, []),
        params: { facet: "AxelarGatewayAdapter", anyOf: input.catalog.facets[0]?.selectors ?? [], placed: input.recipe.facets, known: input.ctx.known, reason: "r" },
      } as Problem,
    ];
    const result = analyze(recipe(), on, ctx, { checks: [borrowing] });
    const params = result.problems.find((p) => p.code === "DEP-01")?.params as Record<string, unknown> | undefined;
    expect(params?.["anyOf"]).toEqual(on.facets[0]?.selectors);
    expect(params?.["anyOf"]).not.toBe(on.facets[0]?.selectors);
    expect(params?.["placed"]).toEqual(ADAPTERS);
    expect(params?.["known"]).toEqual(ctx.known);
    expect(unfrozen(result)).toEqual([]);
    expect(frozen(on)).toEqual([]);
    expect(frozen(ctx)).toEqual([]);
  });

  test.skipIf(fixture === null)("injected checks replace the registry's, bypass the memo, and their problems come back sorted", () => {
    const seen: string[] = [];
    const fake: Check = (input) => {
      seen.push(input.recipe.facets.join(","));
      return [
        problem("CORE-02", [{ kind: "diamond" }], {}, []),
        problem("DEP-01", [{ kind: "facet", facet: "HyperlaneGatewayAdapter" }], { facet: "HyperlaneGatewayAdapter", anyOf: ["X"], reason: "r" }, [], {
          id: "DEP-01:HyperlaneGatewayAdapter+X",
        }),
        problem("DEP-01", [{ kind: "facet", facet: "AxelarGatewayAdapter" }], { facet: "AxelarGatewayAdapter", anyOf: ["X"], reason: "r" }, [], {
          id: "DEP-01:AxelarGatewayAdapter+X",
        }),
      ];
    };
    const on = fresh();
    const a = analyze(recipe(), on, undefined, { checks: [fake] });
    const b = analyze(recipe(), on, undefined, { checks: [fake] });
    expect(a).not.toBe(b);
    expect(seen).toEqual([ADAPTERS.join(","), ADAPTERS.join(",")]);
    expect(a.problems.map((p) => p.id)).toEqual(["DEP-01:AxelarGatewayAdapter+X", "DEP-01:HyperlaneGatewayAdapter+X", "CORE-02:diamond"]);
    expect(a.problems.every((p) => p.message.length > 0)).toBe(true);
  });

  test.skipIf(fixture === null)("a check that isn't built throws NotImplemented to the caller; it never drops problems silently", () => {
    const stub: Check = () => notImplemented("C3", "checkCore");
    const real: Check = () => [problem("CORE-02", [{ kind: "diamond" }], {}, [])];
    let caught: unknown;
    try {
      analyze(recipe(), fresh(), undefined, { checks: [real, stub] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NotImplemented);
    expect((caught as NotImplemented).message).toBe("Not built yet · WP-C3");
    const broken: Check = () => {
      throw new TypeError("boom");
    };
    expect(() => analyze(recipe(), fresh(), undefined, { checks: [broken] })).toThrow("boom");
  });

  test.skipIf(fixture === null || !noInit)("until C4a and C4b land, a recipe with an init throws NotImplemented instead of a partial analysis", () => {
    expect(() => analyze(template("ERC20"), fresh())).toThrow(NotImplemented);
  });
});

describe("init summary (contracts §3.1, Init encoding ruling)", () => {
  const address = (name: string) => catalog().inits.find((i) => i.name === name)?.release?.address;
  const deploy: AnalysisContext = {
    deploy: { chainId: 31337, path: "factory", from: addr(7), salt: hex(1) },
    known: [],
    unconfirmed: [],
    refs: { self: addr(8), deployer: addr(7) },
  };

  test.skipIf(fixture === null)("none → null", () => {
    expect(analyze(sheet(ADAPTERS), catalog()).init).toBeNull();
  });

  test.skipIf(noInit).each([
    ["GovernedVault", "GovernedVaultInit"],
    ["ERC20", "MultiInit"],
    ["SafeDiamondCut", "SafeDiamondCutInit"],
  ])("%s targets %s, with or without a deploy context", (name, init) => {
    const recipe = template(name);
    const target = address(init);
    expect(target).toBeDefined();
    const plain = analyze(recipe, fresh());
    expect(plain.init).toEqual({ target: target ?? "0x", refs: collectRefs(recipe) });
    const deploying = analyze(recipe, fresh(), deploy);
    expect(deploying.init?.target).toBe(target ?? "0x");
    expect(deploying.init?.refs).toEqual(collectRefs(recipe));
    const call = encodeInit(planInit(recipe, catalog()), catalog(), deploy.refs ?? {});
    if (call.ok) {
      expect(call.value.target).toBe(target ?? "0x");
      expect(deploying.init?.data).toBe(call.value.data);
    } else {
      expect(deploying.init?.data).toBeUndefined();
    }
  });

  test.skipIf(noInit)("SafeDiamondCut's one call is direct (golden kind \"direct\"); ERC20's two calls go through MultiInit", () => {
    expect(planInit(template("SafeDiamondCut"), catalog()).steps).toHaveLength(1);
    expect(planInit(template("ERC20"), catalog()).steps).toHaveLength(2);
  });
});

describe("bench", () => {
  test.skipIf(fixture === null)("analyze on a 30-facet recipe (Q4 enforces the 5 ms budget, throttled)", () => {
    const facets = catalog()
      .facets.filter((f) => f.family === undefined)
      .slice(0, 30)
      .map((f) => f.name);
    expect(facets.length).toBe(30);
    const recipe = sheet(facets);
    const runs = 40;
    const catalogs = Array.from({ length: runs + 5 }, fresh);
    for (const on of catalogs.slice(0, 5)) analyze(recipe, on);
    const times: number[] = [];
    for (const on of catalogs.slice(5)) {
      const start = performance.now();
      analyze(recipe, on);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] ?? 0;
    const analysis = analyze(recipe, catalogs[0] ?? catalog());
    console.log(
      `analyze · 30 facets · ${analysis.stats.exported} exported selectors · ${analysis.problems.length} problems: median ${median.toFixed(3)} ms, min ${(times[0] ?? 0).toFixed(3)} ms over ${runs} runs (unthrottled, checks as merged, no init)`,
    );
    expect(median).toBeGreaterThan(0);
  });
});
