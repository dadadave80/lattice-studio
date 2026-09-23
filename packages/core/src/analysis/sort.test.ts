import { describe, expect, test } from "bun:test";
import { type Anchor, type Problem, type ProblemCode, problemId, type Severity } from "../model/problems";
import { makeCatalog, makeFacet } from "../testing";
import { sortProblems } from "./sort";

const catalog = makeCatalog({ facets: ["First", "Second", "Third"].map((name) => makeFacet({ name })) });

function p(code: ProblemCode, severity: Severity, where: Anchor[], id = problemId(code, where)): Problem {
  return { id, code, severity, where, params: {}, message: "", fixes: [] };
}

const facet = (name: string): Anchor => ({ kind: "facet", facet: name });

describe("sortProblems", () => {
  test("blockers, then warnings, then info", () => {
    const sorted = sortProblems([p("SEL-02", "info", [facet("First")]), p("SEL-03", "warning", [facet("Third")]), p("SEL-01", "blocker", [facet("Third")])], catalog);
    expect(sorted.map((x) => x.severity)).toEqual(["blocker", "warning", "info"]);
  });

  test("within a severity, the catalog order of the first anchor naming a facet, selector anchors included", () => {
    const sorted = sortProblems(
      [
        p("DEP-01", "blocker", [facet("Third")]),
        p("SEL-01", "blocker", [{ kind: "selector", selector: "0x00000001", facet: "Second" }, facet("First")], "SEL-01:0x00000001"),
        p("CORE-01", "blocker", [{ kind: "selector", selector: "0x7a0ed627" }, facet("First")], "CORE-01:0x7a0ed627"),
      ],
      catalog,
    );
    expect(sorted.map((x) => x.id)).toEqual(["CORE-01:0x7a0ed627", "SEL-01:0x00000001", "DEP-01:Third"]);
  });

  test("problems anchored on no facet come after, then facets the catalog doesn't know sort before them", () => {
    const sorted = sortProblems(
      [p("CORE-02", "blocker", [{ kind: "diamond" }]), p("INIT-01", "blocker", [{ kind: "init", path: "bundle.p.asset" }]), p("SEL-05", "blocker", [facet("Ghost")]), p("SEL-01", "blocker", [facet("Second")])],
      catalog,
    );
    expect(sorted.map((x) => x.id)).toEqual(["SEL-01:Second", "SEL-05:Ghost", "CORE-02:diamond", "INIT-01:bundle.p.asset"]);
  });

  test("then the code in the checks table's order (SEL before CORE), then the id", () => {
    const sorted = sortProblems(
      [
        p("CORE-03", "blocker", [facet("First")]),
        p("SEL-01", "blocker", [facet("First")], "SEL-01:0x00000002"),
        p("SEL-01", "blocker", [facet("First")], "SEL-01:0x00000001"),
        p("SEM-01", "blocker", [facet("First")]),
      ],
      catalog,
    );
    expect(sorted.map((x) => x.id)).toEqual(["SEL-01:0x00000001", "SEL-01:0x00000002", "SEM-01:First", "CORE-03:First"]);
  });

  test("is a total order: every input order gives the same output, and the input isn't touched", () => {
    const problems = [
      p("SEL-02", "info", [facet("Second")]),
      p("CORE-02", "warning", [{ kind: "diamond" }]),
      p("SEL-01", "blocker", [facet("Third")], "SEL-01:0x00000003"),
      p("SEL-01", "blocker", [facet("First")], "SEL-01:0x00000009"),
      p("NET-03", "blocker", [{ kind: "chain", chainId: 1 }]),
    ];
    const frozen = problems.map((x) => x.id);
    const expected = sortProblems(problems, catalog).map((x) => x.id);
    expect(problems.map((x) => x.id)).toEqual(frozen);
    for (let shift = 1; shift < problems.length; shift++) {
      const rotated = [...problems.slice(shift), ...problems.slice(0, shift)];
      expect(sortProblems(rotated, catalog).map((x) => x.id)).toEqual(expected);
      expect(sortProblems([...rotated].reverse(), catalog).map((x) => x.id)).toEqual(expected);
    }
    expect(expected).toEqual(["SEL-01:0x00000009", "SEL-01:0x00000003", "NET-03:1", "CORE-02:diamond", "SEL-02:Second"]);
  });
});
