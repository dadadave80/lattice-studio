// scripts/ci/changes.sh decides which CI jobs a pull request runs (#45). Feeds it fixed path lists and reads the
// groups back; spawns bash, touches nothing else.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const script = join(import.meta.dir, "changes.sh");
const GROUPS = ["code", "app", "size", "golden", "chain", "catalog"] as const;
type Group = (typeof GROUPS)[number];

function groupsFor(paths: readonly string[], args: readonly string[] = []): Group[] {
  const p = Bun.spawnSync(["bash", script, ...args], { stdin: new TextEncoder().encode(paths.map((x) => `${x}\n`).join("")) });
  expect(p.exitCode).toBe(0);
  const lines = p.stdout.toString().trim().split("\n");
  expect(lines.map((l) => l.split("=")[0])).toEqual([...GROUPS]);
  return lines.filter((l) => l.endsWith("=true")).map((l) => l.split("=")[0] as Group);
}

describe("changes.sh", () => {
  test("Markdown at the root, docs/, skills/ and issue templates run nothing", () => {
    expect(groupsFor(["README.md", "SECURITY.md", "docs/release.md", "skills/lattice-studio/SKILL.md", ".github/PULL_REQUEST_TEMPLATE.md", "LICENSE"])).toEqual([]);
    expect(groupsFor([])).toEqual([]);
  });

  test("a pitch deck runs check, bun test and the size budgets, which measure every .js in dist", () => {
    expect(groupsFor(["apps/studio/public/pitch/metropolis/index.html"])).toEqual(["code", "size"]);
  });

  test("app source runs the app jobs but no Foundry job", () => {
    expect(groupsFor(["apps/studio/src/shell/SearchField.tsx"])).toEqual(["code", "app", "size"]);
    expect(groupsFor(["packages/tokens/README.md"])).toEqual(["code", "app", "size"]);
    expect(groupsFor(["scripts/perf/run.ts"])).toEqual(["code", "app", "size"]);
  });

  test("a lattice pin move runs every Foundry job", () => {
    expect(groupsFor(["lattice"])).toEqual(["code", "golden", "chain", "catalog"]);
  });

  test("core and the committed catalog run everything that reads them", () => {
    expect(groupsFor(["packages/core/src/index.ts"])).toEqual([...GROUPS]);
    expect(groupsFor(["catalog/manifest.json"])).toEqual([...GROUPS]);
  });

  test("each Foundry job's own folder runs only that job", () => {
    expect(groupsFor(["golden/run.ts"])).toEqual(["code", "golden"]);
    expect(groupsFor(["e2e-chain/deploy.chain.test.ts"])).toEqual(["code", "chain"]);
    expect(groupsFor(["overlay/seams.yaml"])).toEqual(["code", "catalog"]);
    expect(groupsFor(["packages/catalog-gen/src/main.ts"])).toEqual(["code", "catalog"]);
  });

  test("the CLI and unmapped paths run check and bun test only", () => {
    expect(groupsFor(["packages/cli/src/main.ts"])).toEqual(["code"]);
    expect(groupsFor(["scripts/wp/merge.ts"])).toEqual(["code"]);
  });

  test("workflows, the lockfile, root configs and the script itself run everything, as does --all", () => {
    for (const path of [".github/workflows/ci.yml", ".github/actions/setup/action.yml", "bun.lock", "package.json", "bunfig.toml", "tsconfig.base.json", ".oxlintrc.json", ".gitmodules", "scripts/ci/changes.sh"]) {
      expect(groupsFor(["README.md", path])).toEqual([...GROUPS]);
    }
    expect(groupsFor([], ["--all"])).toEqual([...GROUPS]);
  });
});
