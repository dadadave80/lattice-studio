import { describe, expect, test } from "bun:test";
import type { Analysis, Routing } from "../model/analysis";
import type { Anchor, Problem, ProblemParams } from "../model/problems";
import { problem } from "../model/problems";
import { renderProblem } from "./problem";
import { narrate } from "./narrate";

function analysis(problems: Problem[], routing: Routing = {}): Analysis {
  return {
    recipeHash: "0x00",
    routing,
    problems,
    plan: [],
    init: null,
    stats: { facets: 0, routed: 0, exported: 0, excluded: 0, namespaces: 0 },
  };
}

function sel01(selector: `0x${string}`, contenders: string[], signature = "transfer(address,uint256)"): Problem {
  const where: Anchor[] = [{ kind: "selector", selector }];
  const params: ProblemParams["SEL-01"] = { selector, signature, contenders };
  return { ...problem("SEL-01", where, params, []), message: renderProblem("SEL-01", params) };
}

function dep01(facet: string, anyOf: string[]): Problem {
  const where: Anchor[] = [{ kind: "facet", facet }];
  const params: ProblemParams["DEP-01"] = { facet, anyOf, reason: "it needs it" };
  return { ...problem("DEP-01", where, params, []), message: renderProblem("DEP-01", params) };
}

const core04Params: ProblemParams["CORE-04"] = { facet: "Receive" };
const core04: Problem = { ...problem("CORE-04", [{ kind: "diamond" }], core04Params, []), message: renderProblem("CORE-04", core04Params) };

describe("narrate", () => {
  test("prev = null narrates nothing", () => {
    expect(narrate(null, analysis([]))).toEqual([]);
  });

  test("no change narrates nothing", () => {
    const a = analysis([core04]);
    expect(narrate(a, a)).toEqual([]);
  });

  test("a new SEL-01 becomes a Collision line, anchored to the problem", () => {
    const p = sel01("0xa9059cbb", ["A20", "V20"]);
    const lines = narrate(analysis([]), analysis([p]));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.tag).toBe("Collision");
    expect(lines[0]?.text).toBe("A20 and V20 both export `transfer · 0xa9059cbb`. Choose an owner.");
    expect(lines[0]?.anchor).toEqual({ kind: "selector", selector: "0xa9059cbb" });
  });

  test("two new SEL-01 problems with the same contender set group into one Collision line", () => {
    const a = sel01("0xa9059cbb", ["A20", "V20"]);
    const b = sel01("0xdd62ed3e", ["A20", "V20"], "allowance(address,address)");
    const lines = narrate(analysis([]), analysis([a, b]));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe("A20 and V20 both export `transfer · 0xa9059cbb` and `allowance · 0xdd62ed3e`. Choose an owner.");
  });

  test("new SEL-01 problems with different contender sets stay in separate lines", () => {
    const a = sel01("0xa9059cbb", ["A20", "V20"]);
    const b = sel01("0xdd62ed3e", ["A20", "V21"]);
    const lines = narrate(analysis([]), analysis([a, b]));
    expect(lines).toHaveLength(2);
  });

  test("a resolved SEL-01 becomes a Resolved line naming the routing's new owner", () => {
    const p = sel01("0xa9059cbb", ["A20", "V20"]);
    const routing: Routing = { "0xa9059cbb": { owner: "V20", contenders: ["A20", "V20"], via: "chosen" } };
    const lines = narrate(analysis([p]), analysis([], routing));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.tag).toBe("Resolved");
    expect(lines[0]?.text).toBe("Resolved: `transfer · 0xa9059cbb` routes to V20.");
  });

  test("a resolved SEL-01 with no owner in the new routing falls back to the rendered message", () => {
    const p = sel01("0xa9059cbb", ["A20", "V20"]);
    const lines = narrate(analysis([p]), analysis([]));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.tag).toBe("Resolved");
    expect(lines[0]?.text).toBe(`Resolved: ${p.message}`);
  });

  test("a new DEP-01 becomes a Missing line", () => {
    const p = dep01("VaultCore", ["ERC4626"]);
    const lines = narrate(analysis([]), analysis([p]));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.tag).toBe("Missing");
    expect(lines[0]?.text).toBe("VaultCore requires ERC4626: it needs it.");
    expect(lines[0]?.anchor).toEqual({ kind: "facet", facet: "VaultCore" });
  });

  test("a resolved DEP-01 becomes a 'Dependency met' line", () => {
    const p = dep01("VaultCore", ["ERC4626"]);
    const lines = narrate(analysis([p]), analysis([]));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.tag).toBe("Resolved");
    expect(lines[0]?.text).toBe("Dependency met: VaultCore.");
  });

  test("every other code narrates generically: Note when new, Resolved when gone", () => {
    const added = narrate(analysis([]), analysis([core04]));
    expect(added).toEqual([{ tag: "Note", text: core04.message, anchor: { kind: "diamond" } }]);
    const resolved = narrate(analysis([core04]), analysis([]));
    expect(resolved).toEqual([{ tag: "Resolved", text: `Resolved: ${core04.message}`, anchor: { kind: "diamond" } }]);
  });

  test("undo and redo dim every narrated line", () => {
    const [line] = narrate(analysis([]), analysis([core04]), { kind: "undo" });
    expect(line?.dim).toBe(true);
    const [redone] = narrate(analysis([]), analysis([core04]), { kind: "redo" });
    expect(redone?.dim).toBe(true);
    const [edited] = narrate(analysis([]), analysis([core04]), { kind: "edit" });
    expect(edited?.dim).toBeUndefined();
  });

  test("problems unchanged between prev and next narrate nothing, even with unrelated other problems", () => {
    const p = dep01("VaultCore", ["ERC4626"]);
    const lines = narrate(analysis([p, core04]), analysis([p, core04]));
    expect(lines).toEqual([]);
  });
});
