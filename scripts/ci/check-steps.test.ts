import { describe, expect, test } from "bun:test";
import { CHECK_STEPS } from "./check-steps.ts";

describe("CHECK_STEPS", () => {
  test("every spec L897 check is present once", () => {
    const names = CHECK_STEPS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const must of ["typecheck", "lint", "size", "schema drift", "token drift", "raw-color", "copy lint"]) {
      expect(names.some((n) => n.toLowerCase().includes(must))).toBe(true);
    }
  });

  test("every step has a non-empty command", () => {
    for (const step of CHECK_STEPS) expect(step.cmd.length).toBeGreaterThan(0);
  });
});
