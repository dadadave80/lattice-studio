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

  test("two unmet requirements on one facet get distinct ids from facet + requirement", () => {
    const where = [{ kind: "facet", facet: "VaultCore" }] as const;
    const first = build("DEP-01", [...where], { facet: "VaultCore", anyOf: ["ERC4626"], reason: "a" }, [], {
      id: problemId("DEP-01", ["VaultCore", "ERC4626"]),
    });
    const second = build("DEP-01", [...where], { facet: "VaultCore", anyOf: ["AccessControl"], reason: "b" }, [], {
      id: problemId("DEP-01", ["VaultCore", "AccessControl"]),
    });
    expect([first.id, second.id]).toEqual(["DEP-01:VaultCore+ERC4626", "DEP-01:VaultCore+AccessControl"]);
    expect(first.id).not.toBe(second.id);
  });

  test("generic wordings: optional params may be left out where the context has no source", () => {
    const link = build("LINK-01", [{ kind: "init", path: "bundle.p.asset" }], { path: "bundle.p.asset", role: "DEFAULT_ADMIN_ROLE", address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" }, []);
    const auth = build("AUTH-02", [{ kind: "init", path: "steps[0].admin" }], { path: "steps[0].admin", role: "DEFAULT_ADMIN_ROLE", address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" }, []);
    const sel = build("SEL-05", [{ kind: "selector", selector: "0x12345678" }], { selector: "0x12345678", facet: "GovernedVault", reason: "not-exported" }, []);
    const ns = build("DEP-02", [{ kind: "diamond" }], { kind: "namespace", namespace: "lattice.storage.AccessControl", anyOf: ["AccessControl"] }, [], {
      id: problemId("DEP-02", ["diamond", "lattice.storage.AccessControl"]),
    });
    const examples = build("INIT-05", [{ kind: "diamond" }], { count: 1, paths: ["bundle.p.votingPeriod"], examples: [{ path: "bundle.p.votingPeriod", label: "Voting period", value: "600", unit: "seconds" }] }, []);
    expect([link.id, auth.id, sel.id, ns.id, examples.ack]).toEqual([
      "LINK-01:bundle.p.asset", "AUTH-02:steps[0].admin", "SEL-05:0x12345678", "DEP-02:diamond+lattice.storage.AccessControl", true,
    ]);
  });

  test("with no checks there are no problems", () => {
    expect(runChecks(input, [])).toEqual([]);
  });
});
