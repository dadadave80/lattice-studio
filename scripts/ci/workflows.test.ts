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

type StepLike = { run?: unknown; uses?: unknown; if?: unknown; env?: Record<string, unknown>; permissions?: Record<string, unknown> };
type JobLike = {
  "runs-on"?: unknown;
  uses?: unknown;
  steps?: readonly StepLike[];
  on?: unknown;
  permissions?: Record<string, unknown>;
};
type WorkflowLike = { name?: unknown; on?: unknown; permissions?: Record<string, unknown>; env?: Record<string, unknown>; jobs?: Record<string, JobLike> };

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

      // spec L864 "Frozen lockfile" (§16 audit #36): a plain `bun install` inside a workflow step must always be
      // frozen, so a rewritten bun.lock in CI can never quietly widen a dependency's version.
      test("every `bun install` step passes --frozen-lockfile", () => {
        const doc = Bun.YAML.parse(text) as WorkflowLike;
        for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
          for (const [i, step] of (job.steps ?? []).entries()) {
            if (typeof step.run !== "string" || !/\bbun\s+install\b/.test(step.run)) continue;
            expect(step.run, `${jobId} step ${i}: \`${step.run}\``).toMatch(/--frozen-lockfile\b/);
          }
        }
      });
    });
  }
});

describe("frozen lockfile and blocked install scripts (§16 audit #36, #39, spec L864)", () => {
  // spec L892: a plain `bun install` never rewrites bun.lock, here or in an agent's worktree (batch-2 §17 #2).
  test("bunfig.toml's [install] sets frozenLockfile = true", () => {
    const bunfig = Bun.TOML.parse(readFileSync(join(repoRoot, "bunfig.toml"), "utf8")) as { install?: { frozenLockfile?: unknown } };
    expect(bunfig.install?.frozenLockfile).toBe(true);
  });

  test("root package.json's trustedDependencies is empty", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { trustedDependencies?: unknown[] };
    expect(pkg.trustedDependencies).toEqual([]);
  });
});

describe("publish-cli.yml (§16 audit #40, spec L864 npm provenance)", () => {
  const doc = Bun.YAML.parse(readFileSync(join(workflowsDir, "publish-cli.yml"), "utf8")) as WorkflowLike;
  const job = doc.jobs?.["publish"];

  test("has id-token: write, for provenance", () => {
    expect(doc.permissions?.["id-token"]).toBe("write");
  });

  test("publishes with --provenance", () => {
    const publishStep = job?.steps?.find((s) => typeof s.run === "string" && s.run.includes("npm publish"));
    expect(publishStep?.run).toContain("--provenance");
  });
});

describe("nightly.yml (§17 audit #40, spec L914: scheduled, report-only)", () => {
  const doc = Bun.YAML.parse(readFileSync(join(workflowsDir, "nightly.yml"), "utf8")) as WorkflowLike & {
    on?: { schedule?: readonly { cron?: string }[] };
  };

  test("runs on a schedule", () => {
    expect(Array.isArray(doc.on?.schedule) && doc.on.schedule.length > 0).toBe(true);
    expect(typeof doc.on?.schedule?.[0]?.cron).toBe("string");
  });

  test("every step that runs golden or chain tests is report-only (continue-on-error)", () => {
    const job = Object.values(doc.jobs ?? {})[0];
    const reportOnlySteps = (job?.steps ?? []).filter(
      (s) => typeof s.run === "string" && /bun run (golden|test:chain)/.test(s.run),
    );
    expect(reportOnlySteps.length).toBeGreaterThan(0);
    for (const s of reportOnlySteps) expect((s as { "continue-on-error"?: unknown })["continue-on-error"]).toBe(true);
  });
});

describe("fork.yml (§17 audit #76, spec L935, Q7: the fork block is the harness's, and the secret is only a fallback)", () => {
  const text = readFileSync(join(workflowsDir, "fork.yml"), "utf8");
  const doc = Bun.YAML.parse(text) as WorkflowLike;
  const jobs = Object.values(doc.jobs ?? {}) as (JobLike & { if?: unknown; needs?: unknown })[];
  const chainStep = jobs.flatMap((job) => job.steps ?? []).find((s) => typeof s.run === "string" && s.run.includes("bun run test:chain"));

  test("declares no FORK_BLOCK env: the harness picks a recent finalized block and never reads one from the environment", () => {
    expect(doc.env?.["FORK_BLOCK"]).toBeUndefined();
    for (const job of jobs) {
      for (const step of job.steps ?? []) expect((step.env ?? {})["FORK_BLOCK"]).toBeUndefined();
    }
  });

  test("runs without the SEPOLIA_RPC_URL secret: no job is gated on it", () => {
    for (const job of jobs) {
      expect(job.if).toBeUndefined();
      expect(job.needs).toBeUndefined();
    }
  });

  test("opts the fork suite in and passes the secret through for the harness's fallback", () => {
    expect(chainStep?.env?.["SEPOLIA_FORK"]).toBe("1");
    expect(chainStep?.env?.["SEPOLIA_RPC_URL"]).toBe("${{ secrets.SEPOLIA_RPC_URL }}");
  });
});

describe("update-screenshots.yml (§17 audit #79, spec L937: the missing chromium-linux baselines)", () => {
  const doc = Bun.YAML.parse(readFileSync(join(workflowsDir, "update-screenshots.yml"), "utf8")) as WorkflowLike;
  const job = Object.values(doc.jobs ?? {})[0];

  test("is workflow_dispatch only: never runs on a pull request or push", () => {
    expect(doc.on).toEqual({ workflow_dispatch: {} });
  });

  test("passes Vitest's own --update flag, not the frozen scripts/dev/test-browser.ts wrapper", () => {
    const step = job?.steps?.find((s) => typeof s.run === "string" && s.run.includes("vitest"));
    expect(step?.run).toContain("--update");
  });

  test("uploads the regenerated baselines as an artifact instead of committing them", () => {
    const upload = job?.steps?.find((s) => typeof s.uses === "string" && s.uses.startsWith("actions/upload-artifact@"));
    expect(upload).toBeDefined();
    const withOpts = (upload as { with?: { path?: string } } | undefined)?.with;
    expect(withOpts?.path).toContain("chromium-linux");
  });
});

describe("Dependabot (§16 audit #38, spec L864: dependency updates arrive as reviewed, grouped PRs)", () => {
  const doc = Bun.YAML.parse(readFileSync(join(repoRoot, ".github", "dependabot.yml"), "utf8")) as {
    updates?: readonly { "package-ecosystem"?: string; groups?: Record<string, unknown> }[];
  };

  test("covers bun (not npm: an npm-ecosystem PR wouldn't touch bun.lock and would fail --frozen-lockfile) and github-actions, each grouped", () => {
    const ecosystems = (doc.updates ?? []).map((u) => u["package-ecosystem"]);
    expect(ecosystems).toContain("bun");
    expect(ecosystems).not.toContain("npm");
    expect(ecosystems).toContain("github-actions");
    for (const update of doc.updates ?? []) expect(Object.keys(update.groups ?? {}).length, JSON.stringify(update)).toBeGreaterThan(0);
  });
});

describe("release-please config", () => {
  test("release-please-config.json and the manifest parse and agree on packages", () => {
    const configDir = join(import.meta.dir, "..", "..", ".github");
    const config = JSON.parse(readFileSync(join(configDir, "release-please-config.json"), "utf8")) as { packages: Record<string, unknown> };
    const manifest = JSON.parse(readFileSync(join(configDir, "release-please-manifest.json"), "utf8")) as Record<string, string>;
    expect(Object.keys(config.packages).sort()).toEqual(Object.keys(manifest).sort());
  });

  // §17 audit #24, spec L904/L945: without apps/studio in the manifest, release-please never bumps its
  // package.json, and every Foundry script header, brief and Safe batch keeps saying "0.0.0" forever.
  test("apps/studio is a manifest package, so its version bumps and every export stops saying 0.0.0", () => {
    const configDir = join(import.meta.dir, "..", "..", ".github");
    const config = JSON.parse(readFileSync(join(configDir, "release-please-config.json"), "utf8")) as { packages: Record<string, unknown> };
    const manifest = JSON.parse(readFileSync(join(configDir, "release-please-manifest.json"), "utf8")) as Record<string, string>;
    expect(config.packages["apps/studio"]).toBeDefined();
    expect(manifest["apps/studio"]).toBeDefined();
  });
});

describe("release-please.yml appends the catalog hash (§16 audit #7, spec L855)", () => {
  const doc = Bun.YAML.parse(readFileSync(join(workflowsDir, "release-please.yml"), "utf8")) as WorkflowLike;
  const steps = Object.values(doc.jobs ?? {})[0]?.steps ?? [];

  test("a step runs append-catalog-hash-to-release.ts for each manifest package, gated on that package's own release", () => {
    const runs = steps.filter((s) => typeof s.run === "string" && s.run.includes("append-catalog-hash-to-release.ts"));
    expect(runs.length).toBe(2);
    for (const s of runs) {
      expect(typeof s.if).toBe("string");
      expect(s.if as string).toContain("release_created");
    }
  });
});
