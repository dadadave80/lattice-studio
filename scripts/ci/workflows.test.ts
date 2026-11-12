// Checks workflow YAML, action pinning, and local guard behavior. The staging-shell check substitutes
// a fixture CLI and token, so it exercises the shell without registry requests.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPinnedRunners, isLockfilePinned } from "./workflow-lockfile-check.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const workflowsDir = join(repoRoot, ".github", "workflows");
const files = readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

type StepLike = { name?: unknown; id?: unknown; run?: unknown; shell?: unknown; uses?: unknown; if?: unknown; "working-directory"?: unknown; env?: Record<string, unknown>; permissions?: Record<string, unknown>; with?: Record<string, unknown> };
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
  secrets?: Record<string, unknown>;
  concurrency?: { group?: unknown; "cancel-in-progress"?: unknown };
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

      test("has a name and at least one runner job or reusable workflow call", () => {
        const doc = Bun.YAML.parse(text) as WorkflowLike;
        expect(typeof doc.name).toBe("string");
        expect(doc.jobs).toBeDefined();
        const jobs = Object.entries(doc.jobs ?? {});
        expect(jobs.length).toBeGreaterThan(0);
        for (const [id, job] of jobs) {
          if (typeof job.uses === "string") {
            expect(job.uses, id).toMatch(/^\.\/\.github\/workflows\/[\w.-]+\.ya?ml$/);
            expect(job["runs-on"], id).toBeUndefined();
            expect(job.steps, id).toBeUndefined();
          } else {
            expect(typeof job["runs-on"], `${id} needs runs-on`).toBe("string");
            expect(Array.isArray(job.steps), `${id} needs steps`).toBe(true);
          }
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

  test("PR title edits and individual commits go through the release-impact check", () => {
    const events = doc.on as { pull_request: { types: string[] } };
    expect(events.pull_request.types).toContain("edited");
    const steps = doc.jobs?.changes?.steps ?? [];
    expect(steps.find((s) => s.uses?.toString().startsWith("actions/checkout@"))?.with?.["fetch-depth"]).toBe(0);
    const guard = steps.find((s) => s.run === "bash scripts/ci/core-release-impact.sh HEAD^1 HEAD^2");
    expect(guard?.env?.PR_TITLE).toBe("${{ github.event.pull_request.title }}");
    expect(guard?.if).toBe("github.event_name == 'pull_request'");
  });

  test("the stable aggregate gate waits for every ordinary job and always checks their results", () => {
    const gate = doc.jobs?.gate;
    expect(gate?.name).toBe("${{ github.event_name == 'workflow_dispatch' && inputs.browser_diagnostics && 'Diagnostic selection check' || 'CI gate' }}");
    expect(gate?.if).toBe("always()");
    expect(gate?.needs).toEqual(["changes", "static", "browser", "e2e", "perf", "foundry"]);
    const optional = new Set(["gate", "browser-diagnostics", "dev-nightly"]);
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

  test("component reports survive infrastructure errors as well as assertion failures", () => {
    const job = doc.jobs?.browser;
    const run = job?.steps?.find((step) => typeof step.run === "string" && step.run.includes("bun run test:browser"));
    expect(run?.run).toContain("--reporter=json");
    expect(run?.run).toContain("--outputFile.json=test-results/63315/vitest.json");
    const artifact = job?.steps?.find((step) => typeof step.uses === "string" && step.uses.startsWith("actions/upload-artifact@"));
    expect(artifact?.if).toBe("always()");
    expect(artifact?.with?.path).toBe("apps/studio/test-results/63315/");
  });

  test("manual transport diagnosis records lifecycle and resource evidence without changing assertions", () => {
    const diagnostic = doc.jobs?.["browser-diagnostics"] as (JobLike & { env?: Record<string, unknown> }) | undefined;
    expect(diagnostic?.env?.DEBUG).toContain("vitest:browser:*");
    expect(diagnostic?.env?.DEBUG).toContain("pw:browser");
    expect(diagnostic?.env?.VITEST_BROWSER_DEBUG).toBe("1");
    const run = diagnostic?.steps?.find((step) => typeof step.run === "string" && step.run.includes("bun run test:browser"));
    expect(run?.run).toContain("resources.log");
    expect(run?.run).toContain("df -Pk");
    expect(run?.run).toContain("/proc/meminfo");
    expect(run?.run).not.toMatch(/--(?:update|passWithNoTests|retry)/);
  });

  test("normal jobs have bounded timeouts and transport diagnostics cannot cancel ordinary CI", () => {
    for (const [id, job] of Object.entries(doc.jobs ?? {})) {
      if (job.uses) continue; // The called workflow bounds its runner job.
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

  test("stages the public CLI with provenance and token authentication", () => {
    const steps = job?.steps ?? [];
    const stage = steps.find((s) => s.name === "Stage CLI package");
    expect(stage?.["working-directory"]).toBe("packages/cli");
    expect(stage?.env?.NODE_AUTH_TOKEN).toBe("${{ secrets.NPM_TOKEN }}");
    expect(stage?.env?.NPM_CONFIG_USERCONFIG).toBe("${{ runner.temp }}/npm-cli.npmrc");
    expect(steps.some((s) => typeof s.run === "string" && /\bnpm publish\b/.test(s.run))).toBe(false);
  });

  test("manual staging installs npm for Bun after the release guard and before the build", () => {
    expect(Object.keys(doc.on as object)).toEqual(["workflow_dispatch"]);
    expect(job?.if).toBe("github.event.inputs.confirm == 'publish' && github.event.inputs.destination != 'github'");
    const steps = job?.steps ?? [];
    const bun = steps.findIndex((s) => typeof s.uses === "string" && s.uses.startsWith("oven-sh/setup-bun@"));
    const guard = steps.findIndex((s) => s.name === "Verify CLI release tag");
    expect(bun).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(bun);
    expect(steps.some((s) => typeof s.uses === "string" && s.uses.startsWith("actions/setup-node@"))).toBe(false);
    const npm = steps.findIndex((s) => s.name === "Install npm for staged publishing");
    expect(steps[npm]?.run).toContain('bun add --cwd "$RUNNER_TEMP/npm-cli" --no-save --ignore-scripts npm@11.15.0');
    const dependencies = steps.findIndex((s) => s.run === "bun install --frozen-lockfile");
    const build = steps.findIndex((s) => s.run === "bun run --cwd packages/cli build");
    const stage = steps.findIndex((s) => s.name === "Stage CLI package");
    expect(npm).toBeGreaterThan(guard);
    expect(dependencies).toBeGreaterThan(npm);
    expect(build).toBeGreaterThan(dependencies);
    expect(stage).toBeGreaterThan(build);
  });

  test("the staging shell runs npm under Bun and keeps the token as an npmrc placeholder", () => {
    const run = job?.steps?.find((s) => s.name === "Stage CLI package")?.run;
    if (typeof run !== "string") throw new Error("Missing staging shell");
    const directory = mkdtempSync(join(tmpdir(), "studio-stage-shell-"));
    const npmDirectory = join(directory, "npm-cli/node_modules/npm/bin");
    const npmrc = join(directory, "npm-cli.npmrc");
    try {
      mkdirSync(npmDirectory, { recursive: true });
      writeFileSync(join(npmDirectory, "npm-cli.js"), `
        import { readFileSync } from "node:fs";
        console.log(JSON.stringify({
          bun: Boolean(process.versions.bun),
          args: process.argv.slice(2),
          npmrc: readFileSync(process.env.NPM_CONFIG_USERCONFIG, "utf8"),
        }));
      `);
      const result = Bun.spawnSync(["bash", "-e", "-c", run], {
        cwd: repoRoot,
        env: { ...process.env, RUNNER_TEMP: directory, NPM_CONFIG_USERCONFIG: npmrc, NODE_AUTH_TOKEN: "fixture-token" },
      });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toEqual({
        bun: true,
        args: ["stage", "publish", "--provenance", "--access", "public"],
        npmrc: "registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("only the matching CLI release tag can build the dispatched commit for publication", () => {
    const steps = job?.steps ?? [];
    expect(steps[0]?.with?.ref).toBe("${{ github.sha }}");
    const guard = steps.find((s) => s.name === "Verify CLI release tag")?.run;
    if (typeof guard !== "string") throw new Error("Missing release tag check after checkout");
    const { version } = JSON.parse(readFileSync(join(repoRoot, "packages/cli/package.json"), "utf8")) as { version: string };
    const tag = `lattice-studio-v${version}`;
    for (const [ref, expected] of [
      [`refs/tags/${tag}`, 0],
      [`refs/heads/${tag}`, 1],
      ["refs/heads/main", 1],
      [`refs/tags/lattice-studio-app-v${version}`, 1],
      [`refs/tags/${tag}-wrong-version`, 1],
    ] as const) {
      const result = Bun.spawnSync(["bash", "-e", "-c", guard], { cwd: repoRoot, env: { ...process.env, GITHUB_REF: ref } });
      expect(result.exitCode, ref).toBe(expected);
    }
  });
});

describe("manual GitHub Packages mirror", () => {
  const doc = Bun.YAML.parse(readFileSync(join(workflowsDir, "publish-cli.yml"), "utf8")) as WorkflowLike & {
    on?: { workflow_dispatch?: { inputs?: Record<string, unknown> } };
  };
  const job = doc.jobs?.["publish-github"];
  const step = (name: string) => job?.steps?.find((entry) => entry.name === name);

  test("npm remains the default and GitHub publication requires an explicit manual choice", () => {
    expect(doc.on?.workflow_dispatch?.inputs?.destination).toEqual({
      description: "Publication destination",
      type: "choice",
      options: ["npm", "github"],
      default: "npm",
      required: true,
    });
    expect(doc.on?.workflow_dispatch?.inputs?.source_version).toMatchObject({ type: "string", required: false });
    expect(doc.on?.workflow_dispatch?.inputs?.confirm).toMatchObject({ required: true });
    expect(job?.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(job?.if).toContain("github.event.inputs.confirm == 'publish'");
    expect(job?.if).toContain("github.event.inputs.destination == 'github'");
    expect(job?.if).toContain("github.repository == 'dadadave80/lattice-studio'");
  });

  test("only the mirror job gains package publication permissions and serializes its runs", () => {
    expect(doc.permissions).toEqual({ contents: "read", "id-token": "write" });
    expect(job?.permissions).toEqual({ contents: "read", packages: "write" });
    expect(job?.concurrency).toEqual({ group: "github-cli-package", "cancel-in-progress": false });
    expect(doc.concurrency).toBeUndefined();
    expect(job?.["runs-on"]).toBe("ubuntu-24.04");
    expect(job?.["timeout-minutes"]).toBe(20);
  });

  test("the mirror uses Bun and isolated npm while preserving the approved artifact instead of rebuilding it", () => {
    const steps = job?.steps ?? [];
    expect(steps[0]?.with?.ref).toBe("${{ github.sha }}");
    expect(doc.env?.BUN_VERSION).toBe("1.4.2");
    expect(steps[1]?.uses).toMatch(/^oven-sh\/setup-bun@/);
    expect(steps[1]?.with?.["bun-version"]).toBe("${{ env.BUN_VERSION }}");
    expect(step("Install npm for the GitHub mirror")?.run).toContain('bun add --cwd "$RUNNER_TEMP/npm-cli" --no-save --ignore-scripts npm@11.15.0');
    expect(steps.some((entry) => typeof entry.uses === "string" && entry.uses.startsWith("actions/setup-node@"))).toBe(false);
    expect(steps.some((entry) => typeof entry.run === "string" && /bun install --frozen-lockfile|--cwd packages\/cli build/.test(entry.run))).toBe(false);
    const prepare = step("Prepare the approved npm package for GitHub");
    const publish = step("Publish the GitHub CLI package");
    expect(prepare?.id).toBe("mirror");
    expect(prepare?.run).toBe("bun scripts/ci/mirror-cli-package.ts prepare");
    expect(prepare?.env?.SOURCE_VERSION).toBe("${{ github.event.inputs.source_version }}");
    expect(publish?.run).toBe("bun scripts/ci/mirror-cli-package.ts publish");
    expect(publish?.env?.SOURCE_VERSION).toBe("${{ github.event.inputs.source_version }}");
    expect(publish?.env?.TARBALL).toBe("${{ steps.mirror.outputs.tarball }}");
    expect(steps.indexOf(prepare!)).toBeLessThan(steps.indexOf(publish!));
  });

  test("GitHub credentials stay out of package preparation and npm authentication stays separate", () => {
    const steps = job?.steps ?? [];
    expect(steps.filter((entry) => entry.env?.NODE_AUTH_TOKEN !== undefined).map((entry) => entry.name)).toEqual(["Publish the GitHub CLI package"]);
    expect(step("Publish the GitHub CLI package")?.env?.NODE_AUTH_TOKEN).toBe("${{ github.token }}");
    expect(step("Publish the GitHub CLI package")?.env?.NPM_CONFIG_USERCONFIG).toBe("${{ runner.temp }}/github-cli.npmrc");
    expect(steps.filter((entry) => entry.env?.GH_TOKEN !== undefined).map((entry) => entry.name)).toEqual(["Verify the linked GitHub package"]);
    expect(JSON.stringify(job)).not.toContain("secrets.NPM_TOKEN");
    expect(JSON.stringify(step("Prepare the approved npm package for GitHub")?.env)).not.toContain("github.token");
    const run = step("Prepare GitHub Packages authentication")?.run;
    if (typeof run !== "string") throw new Error("Missing GitHub npmrc shell");
    const directory = mkdtempSync(join(tmpdir(), "studio-github-npmrc-"));
    try {
      const npmrc = join(directory, "github-cli.npmrc");
      const result = Bun.spawnSync(["bash", "-e", "-c", run], { env: { ...process.env, NPM_CONFIG_USERCONFIG: npmrc, NODE_AUTH_TOKEN: "fixture-secret" } });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(readFileSync(npmrc, "utf8")).toBe("registry=https://npm.pkg.github.com/\n@dadadave80:registry=https://npm.pkg.github.com/\n//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("publication verifies repository linkage and reports actual package visibility", () => {
    const run = step("Verify the linked GitHub package")?.run;
    if (typeof run !== "string") throw new Error("Missing GitHub package verification shell");
    const directory = mkdtempSync(join(tmpdir(), "studio-github-package-"));
    try {
      writeFileSync(join(directory, "gh"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$FIXTURE_ARGS"\nprintf "%s" "$FIXTURE_PACKAGE"\nexit "$FIXTURE_EXIT"\n', { mode: 0o755 });
      for (const [repository, apiExit, expected] of [["dadadave80/lattice-studio", "0", 0], ["other/repository", "0", 1], ["dadadave80/lattice-studio", "23", 23]] as const) {
        const summary = join(directory, "summary");
        writeFileSync(summary, "");
        const result = Bun.spawnSync(["bash", "-e", "-c", run], { env: {
          ...process.env, PATH: `${directory}:${process.env.PATH}`, GITHUB_REPOSITORY: "dadadave80/lattice-studio", GITHUB_STEP_SUMMARY: summary,
          SOURCE_VERSION: "0.2.0-dev.1.gabc", SOURCE_SHA: "a".repeat(40), FIXTURE_ARGS: join(directory, "args"), FIXTURE_EXIT: apiExit,
          FIXTURE_PACKAGE: JSON.stringify({ name: "lattice-studio", package_type: "npm", html_url: "https://github.com/users/dadadave80/packages/npm/package/lattice-studio", visibility: "private", repository: { full_name: repository } }),
        } });
        expect(result.exitCode, result.stderr.toString()).toBe(expected);
        expect(readFileSync(join(directory, "args"), "utf8")).toContain("users/dadadave80/packages/npm/lattice-studio");
        if (expected === 0) {
          expect(readFileSync(summary, "utf8")).toContain("private");
          expect(readFileSync(summary, "utf8")).toContain("0.2.0-dev.1.gabc");
          expect(result.stdout.toString()).toContain("dadadave80/lattice-studio");
        } else expect(readFileSync(summary, "utf8")).toBe("");
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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

  test("the nightly opts full CI on dev into staging after its gate", () => {
    const dispatch = doc.jobs?.["full-suite-on-dev"]?.steps?.find((step) => typeof step.run === "string");
    expect(dispatch?.run).toContain("gh workflow run ci.yml --ref dev -f stage_dev_nightly=true");
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

describe("dev nightly staging", () => {
  const ci = Bun.YAML.parse(readFileSync(join(workflowsDir, "ci.yml"), "utf8")) as WorkflowLike & {
    on?: { workflow_dispatch?: { inputs?: { stage_dev_nightly?: unknown } } };
  };
  // Load lazily so a missing workflow is reported by the contract tests.
  const nightly = () => Bun.YAML.parse(readFileSync(join(workflowsDir, "dev-nightly.yml"), "utf8")) as WorkflowLike;
  const step = (name: string) => nightly().jobs?.stage?.steps?.find((entry) => entry.name === name);
  const shell = (name: string) => {
    const run = step(name)?.run;
    if (typeof run !== "string") throw new Error(`Missing nightly shell ${name}`);
    return run;
  };

  test("only opted-in full CI on dev can call staging after its successful gate", () => {
    expect(ci.on?.workflow_dispatch?.inputs?.stage_dev_nightly).toMatchObject({ type: "boolean", default: false });
    const caller = ci.jobs?.["dev-nightly"];
    expect(caller?.needs).toBe("gate");
    expect(caller?.uses).toBe("./.github/workflows/dev-nightly.yml");
    expect(caller?.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(caller?.if).toContain("github.ref == 'refs/heads/dev'");
    expect(caller?.if).toContain("inputs.stage_dev_nightly");
    expect(caller?.if).toContain("!inputs.browser_diagnostics");
    expect(caller?.if).toContain("needs.gate.result == 'success'");
    expect(caller?.permissions).toEqual({ contents: "read", "id-token": "write", statuses: "write" });
    expect(caller?.secrets).toEqual({ NPM_TOKEN: "${{ secrets.NPM_TOKEN }}" });
  });

  test("the called workflow keeps the CI SHA for checkout and provenance and serializes staging", () => {
    const doc = nightly();
    expect(doc.on).toEqual({ workflow_call: { secrets: { NPM_TOKEN: { required: true } } } });
    expect(doc.permissions).toEqual({ contents: "read", "id-token": "write", statuses: "write" });
    expect(doc.concurrency).toEqual({ group: "dev-nightly", "cancel-in-progress": false });
    expect(doc.jobs?.stage?.["timeout-minutes"]).toBe(20);
    expect(doc.jobs?.stage?.steps?.[0]?.with?.ref).toBe("${{ github.sha }}");
    expect(doc.env?.BUN_VERSION).toBe("1.4.2");
    expect(doc.jobs?.stage?.steps?.some((entry) => entry.uses?.toString().startsWith("actions/setup-node@"))).toBe(false);
  });

  test("the source guard rejects a different branch, event, malformed SHA or checkout", () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-nightly-source-"));
    const sha = "a".repeat(40);
    try {
      writeFileSync(join(directory, "git"), '#!/bin/sh\nprintf "%s\\n" "$FIXTURE_HEAD"\n', { mode: 0o755 });
      for (const [event, ref, revision, head, expected] of [
        ["workflow_dispatch", "refs/heads/dev", sha, sha, 0],
        ["pull_request", "refs/heads/dev", sha, sha, 1],
        ["workflow_dispatch", "refs/heads/main", sha, sha, 1],
        ["workflow_dispatch", "refs/tags/dev", sha, sha, 1],
        ["workflow_dispatch", "refs/heads/dev", "bad", sha, 1],
        ["workflow_dispatch", "refs/heads/dev", sha, "b".repeat(40), 1],
      ] as const) {
        const result = Bun.spawnSync(["bash", "-e", "-c", shell("Verify tested dev commit")], {
          cwd: repoRoot,
          env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, GITHUB_EVENT_NAME: event, GITHUB_REF: ref, GITHUB_SHA: revision, FIXTURE_HEAD: head },
        });
        expect(result.exitCode, `${event} ${ref} ${revision} ${head}`).toBe(expected);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("staging history uses paginated successful commit statuses and fails closed", () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-nightly-marker-"));
    try {
      writeFileSync(join(directory, "gh"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$FIXTURE_ARGS"\nprintf "%s" "$FIXTURE_STATUS"\nexit "$FIXTURE_EXIT"\n', { mode: 0o755 });
      for (const [status, exit, expected] of [["123\n", "0", "staged=true\n"], ["", "0", "staged=false\n"], ["", "23", ""]] as const) {
        const output = join(directory, "output");
        writeFileSync(output, "");
        const result = Bun.spawnSync(["bash", "-e", "-c", shell("Check staging history")], {
          cwd: repoRoot,
          env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, GH_REPO: "owner/repo", GITHUB_SHA: "a".repeat(40), GITHUB_OUTPUT: output, FIXTURE_STATUS: status, FIXTURE_EXIT: exit, FIXTURE_ARGS: join(directory, "args") },
        });
        expect(result.exitCode).toBe(Number(exit));
        expect(readFileSync(output, "utf8")).toBe(expected);
        const args = readFileSync(join(directory, "args"), "utf8");
        expect(args).toContain("--paginate");
        expect(args).toContain(`repos/owner/repo/commits/${"a".repeat(40)}/statuses?per_page=100`);
        expect(args).toContain('.context == "npm/dev-nightly" and .state == "success"');
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a recorded commit skips package work while registry presence skips rebuilding and repairs history", () => {
    const steps = nightly().jobs?.stage?.steps ?? [];
    const guard = steps.findIndex((entry) => entry.name === "Verify tested dev commit");
    const history = steps.findIndex((entry) => entry.name === "Check staging history");
    const npm = steps.findIndex((entry) => entry.name === "Install npm for staged publishing");
    const check = steps.findIndex((entry) => entry.name === "Check npm for this commit");
    const dependencies = steps.findIndex((entry) => entry.run === "bun install --frozen-lockfile");
    const version = steps.findIndex((entry) => entry.name === "Set nightly CLI version");
    const build = steps.findIndex((entry) => entry.run === "bun run --cwd packages/cli build");
    const prepare = steps.findIndex((entry) => entry.run === "bun scripts/ci/prepare-cli-package.ts");
    const stage = steps.findIndex((entry) => entry.run === "bun scripts/ci/dev-nightly.ts stage");
    const record = steps.findIndex((entry) => entry.name === "Record staged commit");
    expect(guard).toBeGreaterThan(0);
    expect(history).toBeGreaterThan(guard);
    expect(npm).toBeGreaterThan(history);
    expect(steps[npm]?.run).toContain('bun add --cwd "$RUNNER_TEMP/npm-cli" --no-save --ignore-scripts npm@11.15.0');
    expect(check).toBeGreaterThan(npm);
    expect(dependencies).toBeGreaterThan(check);
    expect(version).toBeGreaterThan(dependencies);
    expect(build).toBeGreaterThan(version);
    expect(prepare).toBeGreaterThan(build);
    expect(stage).toBeGreaterThan(prepare);
    expect(record).toBeGreaterThan(stage);
    for (const entry of steps.slice(history + 1)) expect(entry.if).toContain("steps.marker.outputs.staged != 'true'");
    for (const index of [dependencies, version, build, prepare, stage]) expect(steps[index]?.if).toContain("steps.package.outputs.exists != 'true'");
    expect(steps[record]?.if).not.toContain("steps.package.outputs.exists");
    expect(steps[version]?.env?.NIGHTLY_VERSION).toBe("${{ steps.package.outputs.version }}");
    expect(steps[stage]?.env?.NIGHTLY_VERSION).toBe("${{ steps.package.outputs.version }}");
    expect(steps[record]?.env?.NIGHTLY_VERSION).toBe("${{ steps.package.outputs.version }}");
  });

  test("npm credentials are scoped to lookup and staging and npmrc keeps a literal placeholder", () => {
    const steps = nightly().jobs?.stage?.steps ?? [];
    expect(steps.filter((entry) => entry.env?.NODE_AUTH_TOKEN !== undefined).map((entry) => entry.name)).toEqual(["Check npm for this commit", "Stage dev CLI package"]);
    for (const name of ["Check npm for this commit", "Stage dev CLI package"]) {
      expect(step(name)?.env?.NODE_AUTH_TOKEN).toBe("${{ secrets.NPM_TOKEN }}");
      expect(step(name)?.env?.NPM_CONFIG_USERCONFIG).toBe("${{ runner.temp }}/npm-cli.npmrc");
    }
    const directory = mkdtempSync(join(tmpdir(), "studio-nightly-npmrc-"));
    try {
      const npmrc = join(directory, "npmrc");
      const result = Bun.spawnSync(["bash", "-e", "-c", shell("Prepare npm authentication")], { env: { ...process.env, NPM_CONFIG_USERCONFIG: npmrc, NODE_AUTH_TOKEN: "fixture-secret" } });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(readFileSync(npmrc, "utf8")).toBe("registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a failed history write fails the job and records only the tested commit", () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-nightly-record-"));
    try {
      writeFileSync(join(directory, "gh"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$FIXTURE_ARGS"\nexit "$FIXTURE_EXIT"\n', { mode: 0o755 });
      for (const exit of [0, 23]) {
        const result = Bun.spawnSync(["bash", "-e", "-c", shell("Record staged commit")], {
          env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, GH_REPO: "owner/repo", GITHUB_SHA: "a".repeat(40), GITHUB_SERVER_URL: "https://github.com", GITHUB_RUN_ID: "123", NIGHTLY_VERSION: "0.2.0-dev.1.gabc", FIXTURE_EXIT: String(exit), FIXTURE_ARGS: join(directory, "args") },
        });
        expect(result.exitCode).toBe(exit);
        const args = readFileSync(join(directory, "args"), "utf8");
        expect(args).toContain(`repos/owner/repo/statuses/${"a".repeat(40)}`);
        expect(args).toContain("state=success");
        expect(args).toContain("context=npm/dev-nightly");
        expect(args).toContain("target_url=https://github.com/owner/repo/actions/runs/123");
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
