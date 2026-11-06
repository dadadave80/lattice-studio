import { pathToFileURL } from "node:url";

const GROUPS = ["code", "app", "size", "golden", "chain", "catalog"] as const;
const JOB_GROUPS = {
  static: ["code", "size"],
  browser: ["app"],
  e2e: ["app"],
  perf: ["app"],
  foundry: ["golden", "chain", "catalog"],
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function gateFailures(needs: unknown): string[] {
  if (!record(needs)) return ["CI job results are missing or malformed."];
  const changes = needs.changes;
  if (!record(changes) || changes.result !== "success") return ["Changed paths did not succeed."];
  const outputs = changes.outputs;
  if (!record(outputs)) return ["Changed paths outputs are missing or malformed."];
  const invalid = GROUPS.filter((group) => outputs[group] !== "true" && outputs[group] !== "false");
  if (invalid.length > 0) return invalid.map((group) => `Changed paths output ${group} must be true or false.`);

  const failures: string[] = [];
  for (const job of Object.keys(needs)) {
    if (job !== "changes" && job !== "browser-diagnostics" && !Object.hasOwn(JOB_GROUPS, job)) failures.push(`${job} has no required-job selection mapping.`);
  }
  for (const [job, groups] of Object.entries(JOB_GROUPS)) {
    const selected = groups.some((group) => outputs[group] === "true");
    const detail = needs[job];
    const result = record(detail) ? detail.result : undefined;
    if (result === "success" || (!selected && result === "skipped")) continue;
    const outcome = result === "failure" || result === "cancelled" || result === "skipped" ? result : "missing or malformed result";
    failures.push(`${job} did not succeed: ${outcome}.`);
  }
  return failures;
}

function main(): number {
  const raw = process.env.CI_NEEDS;
  if (!raw) {
    console.error("CI gate failed: CI_NEEDS is missing.");
    return 1;
  }
  let needs: unknown;
  try {
    needs = JSON.parse(raw);
  } catch {
    console.error("CI gate failed: CI_NEEDS is not valid JSON.");
    return 1;
  }
  const failures = gateFailures(needs);
  if (failures.length > 0) {
    console.error(`CI gate failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
    return 1;
  }
  console.log("CI gate passed: every selected job succeeded.");
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
