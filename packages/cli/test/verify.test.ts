/**
 * `verify-catalog`: CG8's verifier with its generator injected (the real rebuild takes Foundry and ~100 s; CG8's
 * own tests run it), so exit 0, 2 and 3 and both outputs are checked here; spawned for the argument errors.
 */
import { describe, expect, test } from "bun:test";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GenerateOptions, Generated } from "@lattice-studio/catalog-gen";
import { readCatalogFiles } from "@lattice-studio/catalog-gen/verify";
import { type Catalog, err, ok } from "@lattice-studio/core";
import { BUILT, BUILT_DEFAULT_ID, REPO_ROOT, runCli, spawnCli, tempDir } from "./support";

const CATALOG = join(REPO_ROOT, "catalog");

/** The committed catalog, as if the generator had just rebuilt it. */
async function committedAsGenerated(): Promise<Generated> {
  const files = await readCatalogFiles(join(CATALOG, BUILT_DEFAULT_ID));
  return {
    id: BUILT_DEFAULT_ID,
    identity: { commit: BUILT.lattice.commit, version: "0.2.0", submodules: [] },
    input: {} as Generated["input"],
    assembled: { catalog: BUILT, files: [...files].map(([path, bytes]) => ({ path, bytes })) },
    summary: [],
  };
}

const latticeDir = tempDir("lattice-checkout-");

describe("verify-catalog", () => {
  test("the rebuild matches byte for byte, and so does the bundled catalog: exit 0", async () => {
    const generated = await committedAsGenerated();
    const seen: GenerateOptions[] = [];
    const { code, stdout } = await runCli(["verify-catalog", "--lattice", latticeDir], {
      generate: async (options) => (seen.push(options), ok(generated)),
    });
    expect(code).toBe(0);
    expect(stdout).toBe(
      `Catalog ${BUILT_DEFAULT_ID} matches the rebuild byte for byte · hash ${BUILT.hash}.\nThis CLI's bundled catalog ${BUILT_DEFAULT_ID} has the rebuilt hash.\n`,
    );
    // A clean rebuild in a fresh copy of the checkout, never in place.
    expect(seen[0]).toMatchObject({ latticeDir, copy: true, clean: true });
  });

  test("--json: the verifier's report and the bundled catalog's verdict", async () => {
    const generated = await committedAsGenerated();
    const { code, stdout } = await runCli(["verify-catalog", "--lattice", latticeDir, "--json"], { generate: async () => ok(generated) });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      report: { id: BUILT_DEFAULT_ID, hash: BUILT.hash, committedHash: BUILT.hash, differences: [], matches: true },
      bundled: { id: BUILT_DEFAULT_ID, hash: BUILT.hash, matches: true },
    });
  });

  test("one changed byte: exit 3 naming the file", async () => {
    const generated = await committedAsGenerated();
    const files = generated.assembled.files.map((f) => (f.path === "shards/ERC20.json" ? { path: f.path, bytes: new Uint8Array([...f.bytes, 0x0a]) } : f));
    const { code, stdout, stderr } = await runCli(["verify-catalog", "--lattice", latticeDir], {
      generate: async () => ok({ ...generated, assembled: { ...generated.assembled, files } }),
    });
    expect(code).toBe(3);
    expect(stdout).toBe("");
    expect(stderr).toContain(`Catalog ${BUILT_DEFAULT_ID} doesn't match the rebuild: 1 difference.`);
    expect(stderr).toContain("shards/ERC20.json: differs (committed 0x");
  });

  test("a manifest that can't be read: unreadable, exit 3", async () => {
    const catalogDir = tempDir();
    cpSync(join(CATALOG, BUILT_DEFAULT_ID), join(catalogDir, BUILT_DEFAULT_ID), { recursive: true });
    writeFileSync(join(catalogDir, "manifest.json"), "{ broken");
    const generated = await committedAsGenerated();
    const { code, stdout } = await runCli(["verify-catalog", "--lattice", latticeDir, "--catalog", catalogDir, "--json"], { generate: async () => ok(generated) });
    expect(code).toBe(3);
    const { report } = JSON.parse(stdout) as { report: { differences: { path: string; problem: string; reason?: string }[] } };
    expect(report.differences).toEqual([expect.objectContaining({ path: "manifest.json", problem: "unreadable", reason: "it isn't JSON." })]);
  });

  test("the committed catalog matches the rebuild but the CLI's bundled one doesn't: exit 3", async () => {
    const generated = await committedAsGenerated();
    const hash = `0x${"cd".repeat(32)}` as const;
    const catalogDir = tempDir();
    cpSync(join(CATALOG, BUILT_DEFAULT_ID), join(catalogDir, BUILT_DEFAULT_ID), { recursive: true });
    writeFileSync(
      join(catalogDir, "manifest.json"),
      JSON.stringify({ default: BUILT_DEFAULT_ID, catalogs: [{ id: BUILT_DEFAULT_ID, tag: BUILT.lattice.tag, commit: BUILT.lattice.commit, hash, path: `${BUILT_DEFAULT_ID}/index.json` }] }),
    );
    const catalog: Catalog = { ...BUILT, hash };
    const { code, stderr } = await runCli(["verify-catalog", "--lattice", latticeDir, "--catalog", catalogDir], {
      generate: async () => ok({ ...generated, assembled: { ...generated.assembled, catalog } }),
    });
    expect(code).toBe(3);
    expect(stderr).toContain(`This CLI's bundled catalog ${BUILT_DEFAULT_ID} has hash ${BUILT.hash}, not the rebuilt ${hash}.`);
  });

  test("the rebuild can't run: exit 2 with the reason", async () => {
    const { code, stderr } = await runCli(["verify-catalog", "--lattice", latticeDir], { generate: async () => err("forge is 1.8.1; the catalog needs Foundry 1.8.3 exactly") });
    expect(code).toBe(2);
    expect(stderr).toBe("Couldn't rebuild the catalog to verify it. forge is 1.8.1; the catalog needs Foundry 1.8.3 exactly\n");
  });

  test("under Node, without Bun: exit 2 saying where it runs", async () => {
    const { code, stderr } = await runCli(["verify-catalog", "--lattice", latticeDir], { hasBun: false });
    expect(code).toBe(2);
    expect(stderr).toContain("verify-catalog runs under Bun from a Lattice Studio checkout");
  });

  test("spawned: no --lattice, or one that isn't a folder, or a catalog folder that isn't there: exit 2", async () => {
    const none = await spawnCli(["verify-catalog"]);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain("verify-catalog needs --lattice <dir>");
    const missing = await spawnCli(["verify-catalog", "--lattice", join(latticeDir, "nope")]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("isn't a directory.");
    const noCatalog = await spawnCli(["verify-catalog", "--lattice", latticeDir], { cwd: tempDir() });
    expect(noCatalog.code).toBe(2);
    expect(noCatalog.stderr).toContain("Run verify-catalog from the Lattice Studio checkout, or pass --catalog <dir>.");
  });
});
