import { describe, expect, test } from "bun:test";
import { dropProvenance, isUnder, parseInitPath, remapStepProvenance, stepPath } from "./paths";

describe("parseInitPath", () => {
  test("reads bundle and step paths, with and without fields", () => {
    expect(parseInitPath("bundle")).toEqual({ root: "bundle", fields: [] });
    expect(parseInitPath("bundle.p.asset")).toEqual({ root: "bundle", fields: ["p", "asset"] });
    expect(parseInitPath("steps[0]")).toEqual({ root: "steps", index: 0, fields: [] });
    expect(parseInitPath("steps[12].admin")).toEqual({ root: "steps", index: 12, fields: ["admin"] });
  });

  test("rejects anything else", () => {
    for (const path of ["", "steps", "steps[]", "steps[01]", "steps[-1]", "steps[1].", "bundle..p", "bundle.1p", "args.name", "steps[1][2]"]) {
      expect(parseInitPath(path)).toBeNull();
    }
  });

  test("stepPath names the step a path lives in", () => {
    const path = parseInitPath("steps[3].admin");
    expect(path && stepPath(path)).toBe("steps[3]");
  });
});

describe("provenance paths", () => {
  test("isUnder matches the path and paths below it, never a longer index", () => {
    expect(isUnder("steps[2]", "steps[2]")).toBe(true);
    expect(isUnder("steps[2].admin", "steps[2]")).toBe(true);
    expect(isUnder("steps[20].admin", "steps[2]")).toBe(false);
    expect(isUnder("bundle.p.asset", "bundle.p")).toBe(true);
    expect(isUnder("bundle.pa", "bundle.p")).toBe(false);
  });

  test("dropProvenance removes a path and its children, and returns the input when nothing matches", () => {
    const provenance = { "bundle.p.asset": "link", "bundle.p.name": "file", "steps[0].admin": "confirmed" } as const;
    expect(dropProvenance(provenance, "bundle.p.asset")).toEqual({ "bundle.p.name": "file", "steps[0].admin": "confirmed" });
    expect(dropProvenance(provenance, "bundle")).toEqual({ "steps[0].admin": "confirmed" });
    expect(dropProvenance(provenance, "steps[1]")).toBe(provenance);
  });

  test("remapStepProvenance moves step keys and leaves bundle keys", () => {
    const provenance = { "steps[0].a": "link", "steps[1].b.c": "file", "bundle.x": "link" } as const;
    expect(remapStepProvenance(provenance, (i) => (i === 0 ? null : i - 1))).toEqual({ "steps[0].b.c": "file", "bundle.x": "link" });
  });
});
