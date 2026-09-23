import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { checkProperty, MIN_RUNS, propertyRun, seedFor } from "./property";

/** The message a property throws, or "" when it passes. */
function failureOf(run: () => void): string {
  try {
    run();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("propertyRun", () => {
  test("each property has its own fixed seed and at least MIN_RUNS runs", () => {
    expect(MIN_RUNS).toBe(200);
    expect(propertyRun("a", undefined, {})).toEqual({ seed: seedFor("a"), numRuns: 200 });
    expect(propertyRun("a", undefined, {}).seed).not.toBe(propertyRun("b", undefined, {}).seed);
    expect(propertyRun("a", 50, {}).numRuns).toBe(200);
    expect(propertyRun("a", 500, {}).numRuns).toBe(500);
    expect(seedFor("a")).toBe(seedFor("a"));
    expect(seedFor("a")).toBeGreaterThanOrEqual(0);
  });

  test("the environment replays one property: seed and path apply only to the property it names", () => {
    const env = { LATTICE_FC_PROPERTY: "a", LATTICE_FC_SEED: "42", LATTICE_FC_PATH: "3:1" };
    expect(propertyRun("a", undefined, env)).toEqual({ seed: 42, numRuns: 200, path: "3:1" });
    expect(propertyRun("b", undefined, env)).toEqual({ seed: seedFor("b"), numRuns: 200 });
    // A seed without a property name reseeds every property; a path without one applies to none.
    expect(propertyRun("b", undefined, { LATTICE_FC_SEED: "7", LATTICE_FC_PATH: "1" })).toEqual({ seed: 7, numRuns: 200 });
    expect(propertyRun("a", undefined, { LATTICE_FC_RUNS: "1000" }).numRuns).toBe(1000);
    expect(propertyRun("a", undefined, { LATTICE_FC_RUNS: "10" }).numRuns).toBe(200);
    expect(propertyRun("a", undefined, { LATTICE_FC_SEED: "x" }).seed).toBe(seedFor("a"));
  });
});

describe("checkProperty", () => {
  test("a passing property reports its seed and runs", () => {
    const outcome = checkProperty("always", fc.property(fc.nat(), () => true), undefined, {});
    expect(outcome).toEqual({ seed: seedFor("always"), runs: 200, skipped: 0 });
  });

  test("a failure prints the seed, the path, the replay command and the cause", () => {
    const property = fc.property(fc.integer({ min: 0, max: 1000 }), (n) => {
      if (n > 500) throw new Error(`too big: ${n}`);
    });
    const message = failureOf(() => checkProperty("small numbers", property, undefined, {}));
    const seed = /failed with seed (-?\d+) at path ([\d:]+)/.exec(message);
    expect(seed).not.toBeNull();
    expect(message).toContain(`Replay: LATTICE_FC_PROPERTY="small numbers" LATTICE_FC_SEED=${seed?.[1]} LATTICE_FC_PATH=${seed?.[2]} bun test packages/core/test/properties`);
    expect(message).toContain("Cause: too big: 501");
    expect(message).toContain("Counterexample: [501]");
  });

  test("the printed seed and path replay the same shrunk counterexample", () => {
    const property = fc.property(fc.array(fc.integer()), (xs) => {
      if (xs.length > 2 && xs.some((x) => x > 100)) throw new Error(`bad: ${JSON.stringify(xs)}`);
    });
    const first = failureOf(() => checkProperty("arrays", property, undefined, {}));
    const [, seed, path] = /failed with seed (-?\d+) at path ([\d:]+)/.exec(first) ?? [];
    const replay = failureOf(() =>
      checkProperty("arrays", property, undefined, { LATTICE_FC_PROPERTY: "arrays", LATTICE_FC_SEED: seed ?? "", LATTICE_FC_PATH: path ?? "" }),
    );
    expect(/Cause: (.*)/.exec(replay)?.[1]).toBe(/Cause: (.*)/.exec(first)?.[1] ?? "missing");
  });
});
