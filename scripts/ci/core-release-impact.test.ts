import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const check = join(import.meta.dir, "core-release-impact.sh");
const core = "packages/core/src/analysis/check.ts";
const studio = "apps/studio/fix.test.ts";
const cli = "packages/cli/fix.test.ts";

test("shared fixes reach the affected Release Please package paths in the same commit", () => {
  const cwd = mkdtempSync(join(tmpdir(), "studio-release-impact-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const run = (base: string, title = "") => Bun.spawnSync(["bash", check, base, "HEAD"], {
    cwd, env: { ...process.env, PR_TITLE: title },
  });
  let revision = 0;
  function commit(subject: string, files: string[]): void {
    revision++;
    for (const path of files) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), String(revision));
    }
    git("add", ".");
    git("commit", "-qm", subject);
  }

  try {
    git("init", "-q");
    git("config", "user.name", "Release test");
    git("config", "user.email", "test@example.invalid");
    git("config", "commit.gpgSign", "false");
    git("config", "core.hooksPath", "/dev/null");
    commit("chore(test): start history", ["README.md"]);
    const base = git("rev-parse", "HEAD");
    commit("fix(core): explain failed checks", [core, studio, cli]);
    commit("fix(studio): align the sheet", [core, studio]);
    commit("fix(cli)!: correct CLI output", [core, cli]);
    commit("fix(test): repair a fixture", ["packages/core/src/analysis/check.test.ts"]);
    commit("fix(cli): accept standard input", [cli]);
    expect(run(base).exitCode).toBe(0);

    const beforeMissing = git("rev-parse", "HEAD");
    commit("fix(core): explain an unset field", [core, studio]);
    commit("test(cli): cover the unset field", [cli]);
    const missing = run(beforeMissing);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr.toString()).toContain("packages/cli/");

    commit("fix(cli): clarify CLI output", [core]);
    expect(run("HEAD^").exitCode).toBe(1);
    commit("refactor(checks): simplify output", [core, studio]);
    expect(run("HEAD^", "fix(core): explain missing values").exitCode).toBe(1);
    expect(run("HEAD^", "fix(studio): explain missing values").exitCode).toBe(0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
