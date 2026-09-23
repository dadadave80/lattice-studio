// Every workflow file must parse as YAML and have the shape a workflow needs (brief Q6 "Done when": "every
// workflow file parses (a test loads each with Bun.YAML)"). Never runs a workflow, never touches the network:
// this only reads the committed files and parses them.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const workflowsDir = join(import.meta.dir, "..", "..", ".github", "workflows");
const files = readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

type JobLike = { "runs-on"?: unknown; uses?: unknown; steps?: unknown };
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
