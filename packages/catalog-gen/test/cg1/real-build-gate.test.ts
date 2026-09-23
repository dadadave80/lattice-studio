import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realBuildGate } from "./real-build-gate";

describe("realBuildGate", () => {
  let tmp = "";
  let main = "";
  let worktree = "";
  const tools = (bin: string) => `/bin/${bin}`;

  async function lattice(dir: string): Promise<void> {
    await mkdir(join(dir, "lattice", "lib", "diamond-lib", "src"), { recursive: true });
    await writeFile(join(dir, "lattice", "foundry.toml"), "");
  }

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "cg1-gate-"));
    main = join(tmp, "main");
    worktree = join(tmp, "main", ".claude", "worktrees", "wp");
    await lattice(main);
    await lattice(worktree);
    await symlink(join(main, "lattice"), join(tmp, "alias"));
  });
  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  const env = (vars: Record<string, string>) => (name: string) => vars[name];

  test("never builds in the main checkout's lattice/, which WPs without their own get as LATTICE_DIR", () => {
    const gate = realBuildGate(env({ LATTICE_DIR: join(main, "lattice"), STUDIO_MAIN: main }), worktree, tools);
    expect(gate).toEqual({
      run: false,
      latticeDir: join(main, "lattice"),
      reason: `${join(main, "lattice")} is the main checkout's read-only lattice/`,
    });
  });

  test("sees through a symlink or a trailing slash to the main checkout", () => {
    expect(realBuildGate(env({ LATTICE_DIR: join(tmp, "alias"), STUDIO_MAIN: main }), worktree, tools).run).toBe(false);
    expect(realBuildGate(env({ LATTICE_DIR: `${join(main, "lattice")}/`, STUDIO_MAIN: main }), worktree, tools).run).toBe(
      false,
    );
  });

  test("with nothing set (the orchestrator's own bun test, or CI), the default lattice/ is the main one", () => {
    expect(realBuildGate(env({}), main, tools).run).toBe(false);
  });

  test("builds in a WP's own checkout and in the merge gate's .integration/lattice", async () => {
    expect(realBuildGate(env({ LATTICE_DIR: join(worktree, "lattice"), STUDIO_MAIN: main }), worktree, tools)).toEqual({
      run: true,
      latticeDir: join(worktree, "lattice"),
    });
    const integration = join(main, ".integration");
    await lattice(integration);
    expect(realBuildGate(env({ LATTICE_DIR: join(integration, "lattice"), STUDIO_MAIN: main }), integration, tools).run).toBe(
      true,
    );
  });

  test("skips, saying why, without forge or anvil or a checkout with its submodules", async () => {
    const own = env({ LATTICE_DIR: join(worktree, "lattice"), STUDIO_MAIN: main });
    expect(realBuildGate(own, worktree, (bin) => (bin === "forge" ? null : "/bin/anvil"))).toMatchObject({
      run: false,
      reason: "forge isn't installed",
    });
    expect(realBuildGate(own, worktree, (bin) => (bin === "anvil" ? null : "/bin/forge"))).toMatchObject({
      run: false,
      reason: "anvil isn't installed",
    });
    const bare = join(tmp, "bare", "lattice");
    await mkdir(bare, { recursive: true });
    await writeFile(join(bare, "foundry.toml"), "");
    expect(realBuildGate(env({ LATTICE_DIR: bare, STUDIO_MAIN: main }), worktree, tools)).toEqual({
      run: false,
      latticeDir: bare,
      reason: `${bare} isn't a Lattice checkout with its submodules`,
    });
  });
});
