import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { gateFailures } from "./gate.ts";

const GROUPS = ["code", "app", "size", "golden", "chain", "catalog"] as const;
const JOBS = ["static", "browser", "e2e", "perf", "foundry"] as const;

function needsFor(groups: readonly string[] = GROUPS) {
  const has = (names: readonly string[]) => names.some((name) => groups.includes(name));
  const result = (selected: boolean) => ({ result: selected ? "success" : "skipped" });
  return {
    changes: { result: "success", outputs: Object.fromEntries(GROUPS.map((group) => [group, String(groups.includes(group))] as const)) },
    static: result(has(["code", "size"])),
    browser: result(has(["app"])),
    e2e: result(has(["app"])),
    perf: result(has(["app"])),
    foundry: result(has(["golden", "chain", "catalog"])),
  };
}

describe("CI gate", () => {
  test("passes when every selected job succeeded, including docs-only skips", () => {
    expect(gateFailures(needsFor())).toEqual([]);
    expect(gateFailures(needsFor([]))).toEqual([]);
    const extraSuccess = needsFor([]);
    extraSuccess.static.result = "success";
    expect(gateFailures(extraSuccess)).toEqual([]);
  });

  test.each([...JOBS])("fails a selected %s job that did not succeed", (job) => {
    for (const result of ["failure", "cancelled", "skipped"]) {
      const needs = needsFor();
      needs[job].result = result;
      expect(gateFailures(needs).join("\n")).toContain(job);
    }
  });

  test.each(["code", "size", "app", "golden", "chain", "catalog"])("requires the job selected by %s", (group) => {
    const needs = needsFor([group]);
    expect(gateFailures(needs)).toEqual([]);
    const job = group === "app" ? "browser" : group === "code" || group === "size" ? "static" : "foundry";
    needs[job].result = "skipped";
    expect(gateFailures(needs).join("\n")).toContain(job);
  });

  test.each(["failure", "cancelled", "skipped", ""])("fails when changed-path detection is %s", (result) => {
    const needs = needsFor([]);
    needs.changes.result = result;
    expect(gateFailures(needs).join("\n")).toContain("Changed paths");
  });

  test("fails closed for missing/malformed results and group outputs", () => {
    for (const malformed of [null, undefined, [], {}, 4]) expect(gateFailures(malformed).length).toBeGreaterThan(0);
    for (const job of JOBS) {
      const needs: Record<string, unknown> = needsFor([]);
      delete needs[job];
      expect(gateFailures(needs).join("\n")).toContain(job);
    }
    for (const group of GROUPS) {
      const needs = needsFor([]);
      delete needs.changes.outputs[group];
      expect(gateFailures(needs).join("\n")).toContain(group);
    }
    const base = needsFor();
    for (const value of [true, false, "yes", 0, null]) {
      expect(gateFailures({ ...base, changes: { ...base.changes, outputs: { ...base.changes.outputs, code: value } } }).length).toBeGreaterThan(0);
    }
    expect(gateFailures({ ...base, changes: { result: "success" } }).length).toBeGreaterThan(0);
    expect(gateFailures({ ...base, browser: { result: "neutral" } }).join("\n")).toContain("browser");
  });

  test("does not let a successful optional diagnostic replace a missing normal result", () => {
    const needs = { ...needsFor(["app"]), "browser-diagnostics": { result: "success" } };
    needs.browser.result = "skipped";
    expect(gateFailures(needs).join("\n")).toContain("browser");
    expect(gateFailures({ ...needsFor([]), "browser-diagnostics": { result: "failure" } })).toEqual([]);
  });

  test("does not hide a failed job merely because its group was unselected", () => {
    const needs = needsFor([]);
    needs.e2e.result = "failure";
    expect(gateFailures(needs).join("\n")).toContain("e2e");
  });

  test("fails closed if an additional normal dependency has no selection mapping", () => {
    expect(gateFailures({ ...needsFor([]), security: { result: "skipped" } }).join("\n")).toContain("security");
  });

  test("the dependency-free Node CLI reports success and fails malformed input", () => {
    const node = Bun.which("node");
    if (!node) throw new Error("The CI gate CLI test requires Node.");
    const run = (input: string | undefined) => {
      const env = { ...process.env };
      if (input === undefined) delete env.CI_NEEDS;
      else env.CI_NEEDS = input;
      return Bun.spawnSync([node, "--experimental-strip-types", join(import.meta.dir, "gate.ts")], { env });
    };
    expect(run(JSON.stringify(needsFor())).exitCode).toBe(0);
    const failed = needsFor(["app"]);
    failed.browser.result = "failure";
    for (const input of [undefined, "not JSON", JSON.stringify(failed)]) {
      const p = run(input);
      expect(p.exitCode).toBe(1);
      expect(p.stderr.toString()).toContain("CI gate");
    }
  });
});
