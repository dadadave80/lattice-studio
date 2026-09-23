import { describe, expect, test } from "bun:test";
import type { Check, CheckInput } from "../model/analysis";
import type { Problem } from "../model/problems";
import { problem as build, problemId } from "../model/problems";
import { renderProblem } from "../narrate/problem";
import { makeCatalog, makeRecipe } from "../testing/builders";
import { CHECKS, runChecks } from "./index";

const input: CheckInput = { recipe: makeRecipe(), catalog: makeCatalog(), routing: {}, ctx: { known: [], unconfirmed: [] } };

function problem(facet: string): Problem {
  return {
    id: problemId("DEP-01", facet),
    code: "DEP-01",
    severity: "blocker",
    where: [{ kind: "facet", facet }],
    params: { facet, anyOf: ["ERC4626"], reason: "it runs the assets behind ERC4626's shares" },
    message: `${facet} needs something.`,
    fixes: [],
  };
}

describe("runChecks", () => {
  test("the registry runs sel, sem, core, dep, sto, init, auth, link, net in that order", () => {
    expect(CHECKS.map((check) => check.name)).toEqual(["sel", "sem", "core", "dep", "sto", "init", "auth", "link", "net"]);
  });

  test("injected checks run in the order given, each with the same input, and their problems concatenate", () => {
    const seen: CheckInput[] = [];
    const fake = (name: string): Check => (received) => {
      seen.push(received);
      return [problem(name)];
    };
    const problems = runChecks(input, [fake("A"), () => [], fake("B")]);
    expect(problems.map((p) => p.id)).toEqual(["DEP-01:A", "DEP-01:B"]);
    expect(seen).toEqual([input, input]);
  });

  test("runChecks renders every message from code and params, whatever the check left there", () => {
    const [p] = runChecks(input, [() => [problem("VaultCore")]]);
    expect(p?.message).toBe(renderProblem("DEP-01", p?.params ?? {}));
    expect(p?.message.length).toBeGreaterThan(0);
    expect(p?.message).not.toBe("VaultCore needs something.");
  });

  test("the typed builder fills severity, ack and id from the registry and leaves the message empty", () => {
    const built = build("DEP-01", [{ kind: "facet", facet: "VaultCore" }], { facet: "VaultCore", anyOf: ["ERC4626"], reason: "r" }, [
      { id: "facet.place", args: { facet: "ERC4626" } },
    ]);
    expect(built).toEqual({
      id: "DEP-01:VaultCore",
      code: "DEP-01",
      severity: "blocker",
      where: [{ kind: "facet", facet: "VaultCore" }],
      params: { facet: "VaultCore", anyOf: ["ERC4626"], reason: "r" },
      message: "",
      fixes: [{ id: "facet.place", args: { facet: "ERC4626" } }],
    });
    expect(build("CORE-02", [{ kind: "diamond" }], {}, []).ack).toBe(true);
    const variable = build("NET-06", [{ kind: "chain", chainId: 11155111 }], { chain: "Sepolia", gas: "17200000", cap: "16777216", share: 1.025 }, [], {
      severity: "warning",
    });
    expect([variable.id, variable.severity]).toEqual(["NET-06:11155111", "warning"]);
  });

  test("with no checks there are no problems", () => {
    expect(runChecks(input, [])).toEqual([]);
  });
});
