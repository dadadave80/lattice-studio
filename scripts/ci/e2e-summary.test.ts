import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderE2eSummary, summarizeE2eReport } from "./e2e-summary.ts";

const result = (status: string, retry = 0, duration = 10) => ({ status, retry, duration });
const spec = (id: string, status: string, results: readonly unknown[]) => ({
  id, title: `case ${id}`, file: "flows/example.spec.ts", line: 12,
  tests: [{ projectName: "chromium", status, results }],
});
const report = (specs: unknown[] = [], suites: unknown[] = []) => ({ stats: { duration: 1234 }, errors: [], suites: [{ title: "flow", specs, suites }] });

describe("E2E result evidence", () => {
  test("counts outcomes, retries and nested tests without hiding recovered failures", () => {
    const input = report([
      spec("first", "expected", [result("passed", 0, 15)]),
      spec("recovered", "flaky", [result("failed", 0, 10), result("passed", 1, 20)]),
      spec("failed", "unexpected", [result("timedOut", 0, 5), result("failed", 1, 7)]),
      spec("skipped", "skipped", []),
      spec("canceled", "unexpected", [result("interrupted", 0, 6)]),
    ], [{ title: "nested", specs: [spec("expected failure", "expected", [result("failed", 0, 7)])] }]);
    const summary = summarizeE2eReport(input);
    expect(summary.counts).toEqual({ total: 6, passed: 2, firstPass: 2, flaky: 1, failed: 2, skipped: 1, interrupted: 1, retries: 2 });
    expect(summary.durationMs).toBe(1234);
    expect(summary.tests.find((entry) => entry.id === "recovered")).toMatchObject({
      project: "chromium", file: "flows/example.spec.ts", title: "flow › case recovered", outcome: "flaky", durationMs: 30,
      attempts: [{ status: "failed", retry: 0, durationMs: 10 }, { status: "passed", retry: 1, durationMs: 20 }],
    });
    expect(renderE2eSummary(summary)).toContain("1 flaky");
    expect(renderE2eSummary(summary)).toContain("case recovered");
    expect(renderE2eSummary(summary)).not.toContain("case first");
  });

  test("keeps global errors visible without retaining their contents or other raw payloads", () => {
    const secret = "https://alice:password@rpc.example/private-key?token=secret";
    const input = {
      ...report([{ ...spec("safe", "expected", [{ ...result("passed"), stdout: [{ text: secret }], error: { message: secret } }]), title: `checks ${secret}` }]),
      config: { metadata: { rpc: secret } }, errors: [{ message: secret }],
    };
    const summary = summarizeE2eReport(input);
    expect(summary.errors).toBe(1);
    expect(summary.tests[0]?.title).toBe("flow › checks <url>");
    expect(JSON.stringify(summary)).not.toContain("password");
    expect(JSON.stringify(summary)).not.toContain("private-key");
    expect(JSON.stringify(summary)).not.toContain("secret");
    expect(renderE2eSummary(summary)).toContain("1 global error");
  });

  test.each([
    null,
    { ...report(), suites: null },
    { ...report(), errors: null },
    { ...report(), stats: { duration: -1 } },
    { ...report(), suites: [{ title: "flow", specs: [], suites: null }] },
    report([spec("bad status", "unknown", [])]),
    report([spec("bad result status", "expected", [result("unknown")])]),
    report([spec("bad retry", "expected", [result("passed", -1)])]),
    report([spec("fractional retry", "expected", [result("passed", 1.5)])]),
    report([spec("unsafe retry", "expected", [result("passed", Number.MAX_SAFE_INTEGER + 1)])]),
    report([spec("bad duration", "expected", [result("passed", 0, -1)])]),
    report([spec("missing attempt", "expected", [])]),
  ])("rejects malformed/incomplete reports instead of producing success counts", (input) => {
    expect(() => summarizeE2eReport(input)).toThrow("Invalid Playwright report");
  });

  test.each([
    { outcome: "expected", attempts: [result("passed")], exitCode: 0 },
    { outcome: "flaky", attempts: [result("failed"), result("passed", 1)], exitCode: 0 },
    { outcome: "unexpected", attempts: [result("failed")], exitCode: 1 },
  ])("writes compact artifacts and preserves the $outcome result", ({ outcome, attempts, exitCode }) => {
    const dir = mkdtempSync(join(tmpdir(), "studio-e2e-summary-"));
    try {
      const input = join(dir, "report.json");
      const output = join(dir, "summary.json");
      const step = join(dir, "step.md");
      writeFileSync(input, JSON.stringify(report([spec("cli", outcome, attempts)])));
      const child = Bun.spawnSync(["bun", join(import.meta.dir, "e2e-summary.ts"), input, output], {
        env: { ...process.env, GITHUB_STEP_SUMMARY: step }, stdout: "pipe", stderr: "pipe",
      });
      expect(child.exitCode).toBe(exitCode);
      expect(JSON.parse(readFileSync(output, "utf8")).counts.failed).toBe(exitCode);
      expect(readFileSync(step, "utf8")).toContain("E2E results");
      expect(child.stdout.toString()).toContain(`${exitCode} failed`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports unreadable JSON without echoing a secret from the parser error", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-e2e-summary-"));
    try {
      const input = join(dir, "report.json");
      writeFileSync(input, '{"https://rpc.example/private-key?token=secret"');
      const child = Bun.spawnSync(["bun", join(import.meta.dir, "e2e-summary.ts"), input, join(dir, "summary.json")], { stdout: "pipe", stderr: "pipe" });
      expect(child.exitCode).toBe(1);
      expect(child.stderr.toString()).toContain("report is invalid");
      expect(child.stderr.toString()).not.toContain("private-key");
      expect(child.stderr.toString()).not.toContain("secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
