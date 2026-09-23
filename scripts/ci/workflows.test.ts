// Every workflow file must parse as YAML and have the shape a workflow needs (brief Q6 "Done when": "every
// workflow file parses (a test loads each with Bun.YAML)"). Never runs a workflow, never touches the network:
// this only reads the committed files and parses them.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { findPinnedRunners, isLockfilePinned } from "./workflow-lockfile-check.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const workflowsDir = join(repoRoot, ".github", "workflows");
const files = readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

type StepLike = { run?: unknown };
type JobLike = { "runs-on"?: unknown; uses?: unknown; steps?: readonly StepLike[] };
type WorkflowLike = { name?: unknown; jobs?: Record<string, JobLike> };

describe("GitHub Actions workflows", () => {
  test("at least one workflow file exists", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    describe(file, () => {
      const text = readFileSync(join(workflowsDir, file), "utf8");

      test("parses as YAML", () => {
        expect(() => Bun.YAML.parse(text)).not.toThrow();
      });

      test("has a name and at least one job, each with runs-on and steps", () => {
        const doc = Bun.YAML.parse(text) as WorkflowLike;
        expect(typeof doc.name).toBe("string");
        expect(doc.jobs).toBeDefined();
        const jobs = Object.entries(doc.jobs ?? {});
        expect(jobs.length).toBeGreaterThan(0);
        for (const [id, job] of jobs) {
          expect(typeof job["runs-on"], `${id} needs runs-on`).toBe("string");
          expect(Array.isArray(job.steps), `${id} needs steps`).toBe(true);
        }
      });

      // spec "Compromised npm dependency": a frozen lockfile, reviewed dependencies. `bun x lhci` or
      // `bun x playwright` (no `@version`) resolve whatever bun.lock already pins; a step is never allowed to
      // pin its own, unreviewed `pkg@version` and fetch it straight from the registry at run time.
      test("no `bunx`/`bun x`/`npx` step pins a package@version outside bun.lock", () => {
        const bunLock = readFileSync(join(repoRoot, "bun.lock"), "utf8");
        const doc = Bun.YAML.parse(text) as WorkflowLike;
        for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
          for (const [i, step] of (job.steps ?? []).entries()) {
            if (typeof step.run !== "string") continue;
            for (const runner of findPinnedRunners(step.run)) {
              expect(
                isLockfilePinned(runner, bunLock),
                `${jobId} step ${i} runs ${runner.pkg}@${runner.version}, not in bun.lock`,
              ).toBe(true);
            }
          }
        }
      });
    });
  }
});

describe("release-please config", () => {
  test("release-please-config.json and the manifest parse and agree on packages", () => {
    const configDir = join(import.meta.dir, "..", "..", ".github");
    const config = JSON.parse(readFileSync(join(configDir, "release-please-config.json"), "utf8")) as { packages: Record<string, unknown> };
    const manifest = JSON.parse(readFileSync(join(configDir, "release-please-manifest.json"), "utf8")) as Record<string, string>;
    expect(Object.keys(config.packages).sort()).toEqual(Object.keys(manifest).sort());
  });
});
