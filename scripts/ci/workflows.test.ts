// Every workflow file must parse as YAML and have the shape a workflow needs (brief Q6 "Done when": "every
// workflow file parses (a test loads each with Bun.YAML)"). Never runs a workflow, never touches the network:
// this only reads the committed files and parses them.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { findPinnedRunners, isLockfilePinned } from "./workflow-lockfile-check.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const workflowsDir = join(repoRoot, ".github", "workflows");
const files = readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

type StepLike = { name?: unknown; id?: unknown; run?: unknown; shell?: unknown; uses?: unknown; if?: unknown; env?: Record<string, unknown>; permissions?: Record<string, unknown>; with?: Record<string, unknown> };
type JobLike = {
  name?: unknown;
  if?: unknown;
  needs?: unknown;
  "runs-on"?: unknown;
  "timeout-minutes"?: unknown;
  uses?: unknown;
  steps?: readonly StepLike[];
  on?: unknown;
  permissions?: Record<string, unknown>;
};
type WorkflowLike = { name?: unknown; on?: unknown; permissions?: Record<string, unknown>; env?: Record<string, unknown>; jobs?: Record<string, JobLike>; concurrency?: { group?: unknown; "cancel-in-progress"?: unknown } };

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
          if (typeof job.uses === "string") {
            expect(job.uses, `${id} calls a local reviewed workflow`).toMatch(/^\.\/\.github\/workflows\/[\w.-]+\.ya?ml$/);
            expect(existsSync(join(repoRoot, job.uses)), `${id} reusable workflow exists`).toBe(true);
            continue;
          }
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

      // Q14: a tag can be moved to other code; a commit SHA can't. The trailing tag comment is what Dependabot's
      // github-actions ecosystem reads to bump the SHA and the comment together.
      test("every third-party Action is pinned to a full commit SHA, with its tag in a trailing comment", () => {
        const uses = [...text.matchAll(/^\s*(?:-\s+)?uses:\s*(.+)$/gm)].map((m) => (m[1] ?? "").trim());
        for (const line of uses) {
          if (line.startsWith("./")) continue;
          expect(line, file).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
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

describe("CI reliability and evidence", () => {
  const doc = Bun.YAML.parse(readFileSync(join(workflowsDir, "ci.yml"), "utf8")) as WorkflowLike;

  test("the stable aggregate gate waits for every ordinary job and always checks their results", () => {
    const gate = doc.jobs?.gate;
    expect(gate?.name).toBe("${{ github.event_name == 'workflow_dispatch' && inputs.browser_diagnostics && 'Diagnostic selection check' || 'CI gate' }}");
    expect(gate?.if).toBe("always()");
    expect(gate?.needs).toEqual(["changes", "static", "browser", "e2e", "perf", "foundry"]);
    const optional = new Set(["gate", "browser-diagnostics", "browser-setup-benchmark", "e2e-evidence-probe", "e2e-balance-benchmark"]);
    expect([...((gate?.needs as string[] | undefined) ?? [])].sort()).toEqual(Object.keys(doc.jobs ?? {}).filter((id) => !optional.has(id)).sort());
    const run = gate?.steps?.find((step) => typeof step.run === "string" && step.run.includes("scripts/ci/gate.ts"));
    expect(run?.env?.CI_NEEDS).toBe("${{ toJSON(needs) }}");
    expect(run?.run).toContain("node --experimental-strip-types");
    expect(gate?.steps?.some((step) => step.uses === "./.github/actions/setup")).toBe(false);
  });

  test("units finish before the one authoritative production check, with a size-only fallback", () => {
    const steps = doc.jobs?.static?.steps ?? [];
    const units = steps.findIndex((step) => step.run === "bun test");
    const check = steps.findIndex((step) => step.run === "bun run check");
    expect(units).toBeGreaterThanOrEqual(0);
    expect(check).toBeGreaterThan(units);
    expect(steps[check]?.if).toContain("success() || failure()");
    for (const command of ["bun scripts/ci/size.ts --build", "bun scripts/ci/react-compiler-dist-check.ts"]) {
      const step = steps.find((entry) => entry.run === command);
      expect(step?.if).toContain("needs.changes.outputs.size == 'true'");
      expect(step?.if).toContain("needs.changes.outputs.code != 'true'");
    }
    expect(steps.some((step) => step.run === "bun scripts/ci/deployment-output-check.ts")).toBe(true);
  });

  test("every completed E2E shard retains compact results and failed attempts, including recovered flakes", () => {
    const job = doc.jobs?.e2e as (JobLike & { strategy?: { matrix?: { include?: { id?: string }[] } } }) | undefined;
    const summary = job?.steps?.find((step) => typeof step.run === "string" && step.run.includes("scripts/ci/e2e-summary.ts"));
    expect(summary?.if).toBe("always()");
    const artifact = job?.steps?.find((step) => typeof step.uses === "string" && step.uses.startsWith("actions/upload-artifact@"));
    expect(artifact?.if).toBe("always()");
    expect(artifact?.with?.name).toBe("e2e-${{ matrix.id }}");
    expect(artifact?.with?.path).toContain("test-results/4173/summary.json");
    expect(artifact?.with?.path).toContain("playwright-report/");
    expect(artifact?.with?.path).toContain("test-results/4173/");
    expect(artifact?.with?.path).toContain("!apps/studio/test-results/4173/report.json");
    expect(summary?.run).toContain("test-results/$PLAYWRIGHT_PORT/report.json");
    expect(artifact?.with?.["retention-days"]).toBe(14);
    const ids = job?.strategy?.matrix?.include?.map((entry) => entry.id) ?? [];
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  test("normal jobs have bounded timeouts and transport diagnostics cannot cancel ordinary CI", () => {
    for (const [id, job] of Object.entries(doc.jobs ?? {})) {
      if (job.uses) continue;
      expect(typeof job["timeout-minutes"], id).toBe("number");
      expect(Number(job["timeout-minutes"]), id).toBeGreaterThan(0);
      expect(Number(job["timeout-minutes"]), id).toBeLessThanOrEqual(30);
    }
    expect(doc.concurrency?.group).toContain("inputs.browser_diagnostics");
    expect(doc.concurrency?.group).toContain("transport");
    expect(doc.concurrency?.group).toContain("full");
    expect(doc.concurrency?.["cancel-in-progress"]).toBe(true);
  });
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

describe("ci.yml's Foundry job runs the Sepolia fork suite (§17 audit #76, spec L935, Q7: the fork block is the harness's, and the secret is only a fallback)", () => {
  const doc = Bun.YAML.parse(readFileSync(join(workflowsDir, "ci.yml"), "utf8")) as WorkflowLike;
  const job = doc.jobs?.["foundry"] as (JobLike & { if?: unknown; needs?: unknown }) | undefined;
  const forkStep = job?.steps?.find((s) => typeof s.run === "string" && s.run.includes("bun run test:chain") && s.env?.["SEPOLIA_FORK"] !== undefined);

  test("declares no FORK_BLOCK env: the harness picks a recent finalized block and never reads one from the environment", () => {
    expect(doc.env?.["FORK_BLOCK"]).toBeUndefined();
    for (const step of job?.steps ?? []) expect((step.env ?? {})["FORK_BLOCK"]).toBeUndefined();
  });

  // The only gate is the changed-paths one (#45): the job waits on nothing but `changes`, and no `if` reads a secret.
  test("runs without the SEPOLIA_RPC_URL secret: nothing is gated on it", () => {
    expect(job?.needs).toBe("changes");
    expect(String(job?.if ?? "")).not.toContain("secrets");
    for (const step of job?.steps ?? []) expect(String(step.if ?? "")).not.toContain("secrets");
  });

  test("opts the fork suite in and passes the secret through for the harness's fallback", () => {
    expect(forkStep?.env?.["SEPOLIA_FORK"]).toBe("1");
    expect(forkStep?.env?.["SEPOLIA_RPC_URL"]).toBe("${{ secrets.SEPOLIA_RPC_URL }}");
  });
});

// One setup for every job (.github/actions/setup), so its caches and the frozen install can't drift between jobs.
describe("ci.yml's jobs share one setup", () => {
  const doc = Bun.YAML.parse(readFileSync(join(workflowsDir, "ci.yml"), "utf8")) as WorkflowLike;
  for (const [id, job] of Object.entries(doc.jobs ?? {})) {
    if (id === "changes" || id === "gate" || job.uses) continue;
    test(`${id} sets up through .github/actions/setup and installs nothing itself`, () => {
      const steps = job.steps ?? [];
      expect(steps.some((s) => s.uses === "./.github/actions/setup")).toBe(true);
      for (const step of steps) {
        expect(String(step.uses ?? "")).not.toMatch(/^(oven-sh\/setup-bun|actions\/setup-node|foundry-rs\/foundry-toolchain)@/);
        expect(String(step.run ?? "")).not.toMatch(/\bbun\s+install\b|\bplaywright\s+install\b/);
      }
    });
  }
});

// The composite actions under .github/actions hold the same rules as a workflow's steps.
describe("composite actions", () => {
  const actionsDir = join(repoRoot, ".github", "actions");
  const bunLock = readFileSync(join(repoRoot, "bun.lock"), "utf8");
  for (const name of readdirSync(actionsDir)) {
    const text = readFileSync(join(actionsDir, name, "action.yml"), "utf8");
    const doc = Bun.YAML.parse(text) as { name?: unknown; runs?: { using?: unknown; steps?: readonly StepLike[] } };
    const steps = doc.runs?.steps ?? [];
    test(`${name}: a named composite action with steps`, () => {
      expect(typeof doc.name).toBe("string");
      expect(doc.runs?.using).toBe("composite");
      expect(steps.length).toBeGreaterThan(0);
    });
    test(`${name}: every Action pinned to a full commit SHA, every install frozen, no runner pinned outside bun.lock`, () => {
      for (const step of steps) {
        if (typeof step.uses === "string") expect(`${step.uses}`, name).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
        if (typeof step.run !== "string") continue;
        if (/\bbun\s+install\b/.test(step.run)) expect(step.run).toMatch(/--frozen-lockfile\b/);
        for (const runner of findPinnedRunners(step.run)) expect(isLockfilePinned(runner, bunLock), `${runner.pkg}@${runner.version}`).toBe(true);
      }
      for (const m of text.matchAll(/^\s*(?:-\s+)?uses:\s*(.+)$/gm)) expect((m[1] ?? "").trim(), name).toMatch(/@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    });
  }
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

// #60's transport investigation is opt-in: regular gates keep the known runner and all assertions.
describe("browser transport diagnostics", () => {
  const doc = Bun.YAML.parse(readFileSync(join(workflowsDir, "ci.yml"), "utf8")) as WorkflowLike & {
    on?: { workflow_dispatch?: { inputs?: { browser_diagnostics?: { type?: unknown; default?: unknown } } } };
  };
  const diagnostic = doc.jobs?.["browser-diagnostics"] as (JobLike & {
    if?: unknown; strategy?: { matrix?: { os?: unknown; sample?: unknown } };
  }) | undefined;

  test("is manual-only and preserves the Ubuntu 24.04 gate by default", () => {
    expect(doc.on?.workflow_dispatch?.inputs?.browser_diagnostics).toMatchObject({ type: "boolean", default: false });
    expect(diagnostic?.if).toBe("github.event_name == 'workflow_dispatch' && inputs.browser_diagnostics");
    for (const [id, job] of Object.entries(doc.jobs ?? {})) {
      if (id !== "browser-diagnostics" && !job.uses) expect(job["runs-on"]).toBe("ubuntu-24.04");
    }
  });

  test("compares fresh runners, retains failures and never updates references", () => {
    expect(diagnostic?.strategy?.matrix).toEqual({ os: ["ubuntu-24.04", "ubuntu-26.04"], sample: [1, 2, 3] });
    const run = diagnostic?.steps?.find((step) => typeof step.run === "string" && step.run.includes("bun run test:browser"));
    expect(run?.shell).toBe("bash"); // GitHub's explicit bash shell enables pipefail for the tee pipeline.
    expect(run?.run).not.toMatch(/--(?:update|passWithNoTests|retry)/);
    const artifact = diagnostic?.steps?.find((step) => typeof step.uses === "string" && step.uses.startsWith("actions/upload-artifact@"));
    expect(artifact?.if).toBe("always()");
  });

  test("the explicit GitHub bash shell propagates a failed producer through tee", () => {
    const result = Bun.spawnSync(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", "(exit 23) | tee /dev/null"], {
      stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode).toBe(23);
  });
});

describe("exact merged revision verification", () => {
  test("checks only protected-branch pushes with separate cancellation and read-only permissions", () => {
    const doc = Bun.YAML.parse(readFileSync(join(workflowsDir, "post-merge.yml"), "utf8")) as WorkflowLike;
    expect(doc.on).toEqual({ push: { branches: ["dev", "main"] } });
    expect(doc.permissions).toEqual({ contents: "read" });
    expect(doc.concurrency?.group).toBe("post-merge-${{ github.ref }}");
    expect(doc.concurrency?.["cancel-in-progress"]).toBe(true);
    const steps = doc.jobs?.artifact?.steps ?? [];
    const commands = steps.map((step) => String(step.run ?? ""));
    expect(commands.filter((run) => run === "bun scripts/ci/size.ts --build")).toHaveLength(1);
    expect(commands).toContain("bun scripts/ci/react-compiler-dist-check.ts");
    expect(commands).toContain("bun scripts/ci/deployment-output-check.ts");
    expect(commands).toContain("bun test apps/studio/build/headers.test.ts");
    expect(commands.some((run) => /bun run (?:e2e|test:chain|golden|test:browser)/.test(run))).toBe(false);
    expect(commands.some((run) => run.includes("GITHUB_STEP_SUMMARY") && run.includes("GITHUB_SHA"))).toBe(true);
  });
});
