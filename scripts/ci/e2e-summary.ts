import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type Outcome = "expected" | "unexpected" | "flaky" | "skipped";
type Attempt = { status: string; retry: number; durationMs: number };
type TestEvidence = {
  id: string; file: string; line: number; title: string; project: string; outcome: Outcome;
  durationMs: number; attempts: Attempt[];
};
export type E2eSummary = {
  version: 1; durationMs: number; errors: number;
  counts: { total: number; passed: number; firstPass: number; flaky: number; failed: number; skipped: number; interrupted: number; retries: number };
  tests: TestEvidence[];
};

function invalid(field: string): never { throw new Error(`Invalid Playwright report: ${field}.`); }
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(field);
  return value as Record<string, unknown>;
}
function list(value: unknown, field: string): unknown[] { return Array.isArray(value) ? value : invalid(field); }
function text(value: unknown, field: string): string { return typeof value === "string" ? value : invalid(field); }
function number(value: unknown, field: string): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : invalid(field);
}
function clean(value: string): string {
  return value.replace(/\b(?:https?|wss?):\/\/\S+/gi, "<url>").replace(/[\r\n]/g, " ");
}

/** Retains timing and outcome evidence, never report config, errors, stdout, attachments or provider URLs. */
export function summarizeE2eReport(input: unknown): E2eSummary {
  const report = object(input, "root");
  const summary: E2eSummary = {
    version: 1, durationMs: number(object(report.stats, "stats").duration, "stats.duration"),
    errors: list(report.errors, "errors").length,
    counts: { total: 0, passed: 0, firstPass: 0, flaky: 0, failed: 0, skipped: 0, interrupted: 0, retries: 0 }, tests: [],
  };
  const visit = (raw: unknown, parents: string[]) => {
    const suite = object(raw, "suite");
    const titles = [...parents, text(suite.title, "suite.title")].filter(Boolean);
    for (const rawSpec of list(suite.specs, "suite.specs")) {
      const spec = object(rawSpec, "spec");
      for (const rawTest of list(spec.tests, "spec.tests")) {
        const test = object(rawTest, "test");
        const outcome = test.status;
        if (outcome !== "expected" && outcome !== "unexpected" && outcome !== "flaky" && outcome !== "skipped") invalid("test.status");
        const attempts = list(test.results, "test.results").map((rawResult): Attempt => {
          const result = object(rawResult, "result");
          const status = result.status === undefined ? "notRun" : result.status;
          if (!["passed", "failed", "timedOut", "skipped", "interrupted", "notRun"].includes(text(status, "result.status"))) invalid("result.status");
          const retry = number(result.retry, "result.retry");
          if (!Number.isSafeInteger(retry)) invalid("result.retry");
          return { status: text(status, "result.status"), retry, durationMs: number(result.duration, "result.duration") };
        });
        if ((outcome === "expected" && attempts.length === 0) || (outcome === "flaky" && attempts.length < 2)) invalid("test.results");
        const entry: TestEvidence = {
          id: clean(text(spec.id, "spec.id")), file: clean(text(spec.file, "spec.file")), line: number(spec.line, "spec.line"),
          title: clean([...titles, text(spec.title, "spec.title")].join(" › ")), project: clean(text(test.projectName, "test.projectName")),
          outcome, durationMs: attempts.reduce((sum, result) => sum + result.durationMs, 0), attempts,
        };
        summary.tests.push(entry);
        summary.counts.total += 1;
        summary.counts.retries += attempts.filter((result) => result.retry > 0).length;
        if (outcome === "expected") {
          summary.counts.passed += 1;
          if (attempts.every((result) => result.retry === 0)) summary.counts.firstPass += 1;
        } else if (outcome === "flaky") summary.counts.flaky += 1;
        else if (outcome === "skipped") summary.counts.skipped += 1;
        else {
          summary.counts.failed += 1;
          if (attempts.length === 0 || attempts.at(-1)?.status === "interrupted") summary.counts.interrupted += 1;
        }
      }
    }
    for (const child of list(suite.suites === undefined ? [] : suite.suites, "suite.suites")) visit(child, titles);
  };
  for (const suite of list(report.suites, "suites")) visit(suite, []);
  return summary;
}

export function renderE2eSummary(summary: E2eSummary): string {
  const counts = summary.counts;
  const lines = [
    "### E2E results", "",
    `${counts.firstPass} first pass · ${counts.flaky} flaky · ${counts.failed} failed (${counts.interrupted} interrupted) · ${counts.skipped} skipped · ${counts.retries} retries · ${summary.errors} global error${summary.errors === 1 ? "" : "s"}.`,
  ];
  for (const test of summary.tests.filter((entry) => entry.outcome === "flaky" || entry.outcome === "unexpected")) {
    const label = `[${test.project}] ${test.file}:${test.line} · ${test.title}`.replace(/[|`]/g, "'");
    lines.push(`- ${test.outcome === "flaky" ? "Recovered" : "Failed"}: ${label} (${test.attempts.length} attempts, ${test.durationMs} ms).`);
  }
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("Usage: bun scripts/ci/e2e-summary.ts <report.json> <summary.json>");
    process.exit(1);
  }
  try {
    const report: unknown = JSON.parse(readFileSync(input, "utf8"));
    const summary = summarizeE2eReport(report);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
    const rendered = renderE2eSummary(summary);
    console.log(rendered);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, rendered);
    process.exit(summary.counts.failed > 0 || summary.errors > 0 ? 1 : 0);
  } catch {
    console.error("E2E summary failed: the report is invalid or an evidence file could not be read or written.");
    process.exit(1);
  }
}
