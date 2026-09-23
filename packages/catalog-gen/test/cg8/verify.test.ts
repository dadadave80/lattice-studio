/**
 * The verifier's comparison and exit codes, with the generator injected: the committed catalog read back as the
 * "rebuild" matches (exit 0), one changed byte doesn't (exit 3), and a rebuild that can't run is exit 2. The real
 * rebuild runs in `real-build.test.ts`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Catalog, type CatalogManifest, err, ok } from "@lattice-studio/core";
import { keccak256 } from "viem";
import type { GenerateOptions, Generated } from "../../src/main";
import {
  compareCatalogFiles,
  EXIT_INVALID,
  EXIT_MATCH,
  EXIT_MISMATCH,
  formatVerifyReport,
  parseVerifyArgs,
  readCatalogFiles,
  runVerify,
  verifyCatalog,
  verifyExitCode,
} from "../../src/verify";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const CATALOG = join(REPO_ROOT, "catalog");
const manifest = (await Bun.file(join(CATALOG, "manifest.json")).json()) as CatalogManifest;
const ID = manifest.default;

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
const bytes = (s: string) => new TextEncoder().encode(s);

/** The committed catalog, as if the generator had just rebuilt it. */
async function committedAsGenerated(): Promise<Generated> {
  const files = await readCatalogFiles(join(CATALOG, ID));
  const index = files.get("index.json");
  if (index === undefined) throw new Error("no index.json");
  const catalog = JSON.parse(new TextDecoder().decode(index)) as Catalog;
  return {
    id: ID,
    identity: { commit: catalog.lattice.commit, version: "0.2.0", submodules: [] },
    input: {} as Generated["input"],
    assembled: { catalog, files: [...files].map(([path, b]) => ({ path, bytes: b })) },
    summary: [],
  };
}

describe("comparing catalogs", () => {
  test("identical files: no differences", () => {
    const committed = new Map([["index.json", bytes("{}\n")], ["shards/A.json", bytes("[]")]]);
    expect(compareCatalogFiles(committed, [{ path: "shards/A.json", bytes: bytes("[]") }, { path: "index.json", bytes: bytes("{}\n") }])).toEqual([]);
  });

  test("changed, missing and extra files, sorted by path, with both hashes", () => {
    const committed = new Map([["index.json", bytes("{}\n")], ["shards/Gone.json", bytes("1")], ["code/A.creation.hex", bytes("0x60")]]);
    const rebuilt = [
      { path: "index.json", bytes: bytes("{ }\n") },
      { path: "code/A.creation.hex", bytes: bytes("0x60") },
      { path: "shards/New.json", bytes: bytes("2") },
    ];
    expect(compareCatalogFiles(committed, rebuilt)).toEqual([
      { path: "index.json", problem: "changed", committed: keccak256(bytes("{}\n")), rebuilt: keccak256(bytes("{ }\n")) },
      { path: "shards/Gone.json", problem: "missing", committed: keccak256(bytes("1")) },
      { path: "shards/New.json", problem: "extra", rebuilt: keccak256(bytes("2")) },
    ]);
  });

  test("reads a catalog folder recursively; an absent one is empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cg8-verify-"));
    temps.push(dir);
    mkdirSync(join(dir, "shards"), { recursive: true });
    writeFileSync(join(dir, "index.json"), "{}");
    writeFileSync(join(dir, "shards", "A.json"), "[]");
    expect([...(await readCatalogFiles(dir)).keys()]).toEqual(["index.json", "shards/A.json"]);
    expect((await readCatalogFiles(join(dir, "nope"))).size).toBe(0);
  });
});

describe("verifyCatalog", () => {
  test("the committed catalog rebuilt byte for byte: match, exit 0", async () => {
    const generated = await committedAsGenerated();
    const seen: GenerateOptions[] = [];
    const res = await verifyCatalog({
      latticeDir: "/lattice",
      catalogDir: CATALOG,
      generate: async (options) => {
        seen.push(options);
        return ok(generated);
      },
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.value.differences).toEqual([]);
    expect(res.value.committedHash).toBe(res.value.hash);
    expect(verifyExitCode(res)).toBe(EXIT_MATCH);
    expect(formatVerifyReport(res.value)).toBe(`Catalog ${ID} matches the rebuild byte for byte · hash ${res.value.hash}.`);
    // A clean rebuild in a temporary copy, never the checkout itself, unless asked.
    expect(seen[0]).toMatchObject({ latticeDir: "/lattice", copy: true, clean: true });
  });

  test("--in-place builds the checkout itself", async () => {
    const generated = await committedAsGenerated();
    const seen: GenerateOptions[] = [];
    await verifyCatalog({ latticeDir: "/lattice", catalogDir: CATALOG, inPlace: true, generate: async (o) => (seen.push(o), ok(generated)) });
    expect(seen[0]?.copy).toBeUndefined();
    expect(seen[0]?.clean).toBeUndefined();
  });

  test("one changed byte in a shard: mismatch, exit 3, the path named", async () => {
    const generated = await committedAsGenerated();
    const files = generated.assembled.files.map((f) => {
      if (f.path !== "shards/ERC20.json") return f;
      const changed = new Uint8Array(f.bytes);
      changed[10] = (changed[10] ?? 0) ^ 1;
      return { path: f.path, bytes: changed };
    });
    const res = await verifyCatalog({
      latticeDir: "/lattice",
      catalogDir: CATALOG,
      generate: async () => ok({ ...generated, assembled: { ...generated.assembled, files } }),
    });
    expect(verifyExitCode(res)).toBe(EXIT_MISMATCH);
    if (!res.ok) throw new Error(res.error);
    expect(res.value.differences.map((d) => [d.path, d.problem])).toEqual([["shards/ERC20.json", "changed"]]);
    expect(formatVerifyReport(res.value)).toContain("shards/ERC20.json: differs (committed 0x");
  });

  test("a rebuilt hash the manifest doesn't list is a mismatch too", async () => {
    const generated = await committedAsGenerated();
    const catalog = { ...generated.assembled.catalog, hash: keccak256(bytes("other")) };
    const res = await verifyCatalog({
      latticeDir: "/lattice",
      catalogDir: CATALOG,
      generate: async () => ok({ ...generated, assembled: { ...generated.assembled, catalog } }),
    });
    expect(verifyExitCode(res)).toBe(EXIT_MISMATCH);
    expect(res.ok && res.value.differences.map((d) => d.path)).toEqual(["manifest.json"]);
  });

  test("differences stay sorted by path with manifest.json among them", async () => {
    const generated = await committedAsGenerated();
    const flip = (f: { path: string; bytes: Uint8Array }) => {
      const changed = new Uint8Array(f.bytes);
      changed[0] = (changed[0] ?? 0) ^ 1;
      return { path: f.path, bytes: changed };
    };
    const files = generated.assembled.files.map((f) => (f.path === "code/ERC20.creation.hex" || f.path === "shards/ERC20.json" ? flip(f) : f));
    const catalog = { ...generated.assembled.catalog, hash: keccak256(bytes("other")) };
    const res = await verifyCatalog({
      latticeDir: "/lattice",
      catalogDir: CATALOG,
      generate: async () => ok({ ...generated, assembled: { catalog, files } }),
    });
    expect(res.ok && res.value.differences.map((d) => d.path)).toEqual(["code/ERC20.creation.hex", "manifest.json", "shards/ERC20.json"]);
  });

  test("a checkout at a commit no committed catalog has: every file is extra, exit 3", async () => {
    const generated = await committedAsGenerated();
    const res = await verifyCatalog({ latticeDir: "/lattice", catalogDir: CATALOG, generate: async () => ok({ ...generated, id: "dev-0000000" }) });
    expect(verifyExitCode(res)).toBe(EXIT_MISMATCH);
    expect(res.ok && res.value.differences.every((d) => d.problem === "extra" || d.path === "manifest.json")).toBe(true);
  });

  test("a rebuild that can't run: exit 2, with the reason", async () => {
    const res = await verifyCatalog({ latticeDir: "/lattice", generate: async () => err("forge is 1.8.1; the catalog needs Foundry 1.8.3 exactly") });
    expect(res).toEqual({ ok: false, error: "forge is 1.8.1; the catalog needs Foundry 1.8.3 exactly" });
    expect(verifyExitCode(res)).toBe(EXIT_INVALID);
  });
});

describe("the command line", () => {
  test("defaults and flags", () => {
    const res = parseVerifyArgs(["--lattice", "/tmp/l", "--catalog", "/tmp/c", "--in-place"], "/repo");
    expect(res).toEqual({ ok: true, value: { latticeDir: "/tmp/l", catalogDir: "/tmp/c", inPlace: true, help: false } });
    const defaults = parseVerifyArgs([], "/repo");
    expect(defaults.ok && defaults.value.catalogDir).toBe("/repo/catalog");
  });

  test("bad arguments exit 2 with the usage", async () => {
    const errors: string[] = [];
    expect(await runVerify(["--catalog"], () => {}, (l) => errors.push(l))).toBe(EXIT_INVALID);
    expect(errors.join("\n")).toContain("--catalog needs a directory.");
    expect(errors.join("\n")).toContain("Exit codes: 0 match, 2 the rebuild couldn't run, 3 catalog mismatch.");
  });
});
