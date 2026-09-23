import { describe, expect, test } from "bun:test";
import type { Check, CheckInput } from "../model/analysis";
import type { Problem } from "../model/problems";
import { problemId } from "../model/problems";
import { makeCatalog, makeRecipe } from "../testing/builders";
import { CHECKS, runChecks } from "./index";

const input: CheckInput = { recipe: makeRecipe(), catalog: makeCatalog(), routing: {}, ctx: { known: [], unconfirmed: [] } };

function problem(facet: string): Problem {
  return {
    id: problemId("DEP-01", facet),
    code: "DEP-01",
    severity: "blocker",
    where: [{ kind: "facet", facet }],
    params: { facet },
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

  test("with no checks there are no problems", () => {
    expect(runChecks(input, [])).toEqual([]);
  });
});
