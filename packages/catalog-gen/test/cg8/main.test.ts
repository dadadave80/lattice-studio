/**
 * `bun run catalog`'s parts that need neither a build nor an Anvil: the Foundry check (fails with the fix before
 * anything is built), the checkout's identity and the provisional mark, areas and source URLs, the overlay and
 * release projections, the temporary copy, and the command line.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type Address, type Hex, type Hex4, validateCatalog } from "@lattice-studio/core";
import type { Overlay } from "../../src/overlay";
import type { ReleaseEntry } from "../../src/release";
import { assembleCatalog } from "../../src/write";
import {
  allSelectors,
  areaOf,
  catalogId,
  checkFoundry,
  copyCheckout,
  type FacetParts,
  facetInput,
  FOUNDRY_VERSION,
  generateCatalog,
  initModules,
  initOverlayInput,
  isMainCheckout,
  LATTICE_REPO_URL,
  parseCatalogArgs,
  parseGitmodules,
  parseToolVersion,
  provisionalNote,
  readIdentity,
  releaseTags,
  type RunResult,
  type Runner,
  runCatalog,
  sharedInput,
  sourceUrl,
  TARGET_VERSION,
} from "../../src/main";

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cg8-main-"));
  temps.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const COMMIT = "f4a32c8330934d39bcfdffff87d35a04b7fa6a79";
const DIAMOND_LIB = "393435fbd01a85f9626cd62f436cdebf90ecdfdf";
const FORGE_183 = "forge Version: 1.8.3\nCommit SHA: cae51ad458f6abb64852b7709eb784352429825d\nBuild Profile: dist\n";
const ANVIL_183 = "anvil Version: 1.8.3\nCommit SHA: cae51ad458f6abb64852b7709eb784352429825d\n";

/** A runner that answers from a table keyed by the command's words; anything else fails. */
function fakeRunner(table: Record<string, Partial<RunResult>>, calls: string[][] = []): Runner {
  return async (cmd) => {
    calls.push(cmd);
    const key = cmd.join(" ");
    const hit = Object.entries(table).find(([k]) => key === k || key.endsWith(k));
    if (hit === undefined) return { code: 1, stdout: "", stderr: `unexpected command: ${key}` };
    return { code: 0, stdout: "", stderr: "", ...hit[1] };
  };
}

describe("the Foundry check", () => {
  test("reads the version forge and anvil print", () => {
    expect(parseToolVersion(FORGE_183, "forge")).toBe("1.8.3");
    expect(parseToolVersion(ANVIL_183, "anvil")).toBe("1.8.3");
    expect(parseToolVersion("forge 0.2.0 (e0a4c9c 2024-01-01T00:00:00.000Z)", "forge")).toBe("0.2.0");
    expect(parseToolVersion("something else", "forge")).toBeUndefined();
    expect(parseToolVersion(FORGE_183, "anvil")).toBeUndefined();
  });

  test("passes at exactly 1.8.3", async () => {
    expect(FOUNDRY_VERSION).toBe("1.8.3");
    const run = fakeRunner({ "forge --version": { stdout: FORGE_183 }, "anvil --version": { stdout: ANVIL_183 } });
    expect(await checkFoundry(run)).toEqual({ ok: true, value: "1.8.3" });
  });

  test("fails on any other version, naming it and the fix", async () => {
    const run = fakeRunner({ "forge --version": { stdout: "forge Version: 1.8.1\n" }, "anvil --version": { stdout: ANVIL_183 } });
    const res = await checkFoundry(run);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("forge is 1.8.1");
    expect(res.error).toContain("Foundry 1.8.3 exactly");
    expect(res.error).toContain("foundryup --install 1.8.3");
  });

  test("fails when anvil differs from forge, or when forge isn't installed", async () => {
    const anvilOld = await checkFoundry(fakeRunner({ "forge --version": { stdout: FORGE_183 }, "anvil --version": { stdout: "anvil Version: 1.9.0" } }));
    expect(anvilOld.ok ? "" : anvilOld.error).toContain("anvil is 1.9.0");
    const missing = await checkFoundry(fakeRunner({ "forge --version": { code: -1, stderr: "ENOENT" } }));
    expect(missing.ok ? "" : missing.error).toContain("forge isn't installed");
  });

  test("the generator stops at the check, before reading or building anything", async () => {
    const calls: string[][] = [];
    const run = fakeRunner({ "forge --version": { stdout: "forge Version: 1.8.1\n" } }, calls);
    const res = await generateCatalog({ latticeDir: tempDir(), run });
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.error).toContain("foundryup --install 1.8.3");
    expect(calls).toEqual([["forge", "--version"]]);
  });
});

describe("the checkout's identity", () => {
  const GITMODULES = `[submodule "lib/forge-std"]\n\tpath = lib/forge-std\n\turl = https://github.com/foundry-rs/forge-std\n[submodule "lib/diamond-lib"]\n\tpath = lib/diamond-lib\n\turl = https://github.com/dadadave80/diamond-lib.git\n`;
  const VERSION_SOL = 'library LatticeVersion {\n    string internal constant VERSION = "0.2.0"; // x-release-please-version\n}\n';

  function checkout(): string {
    const dir = tempDir();
    write(dir, "src/LatticeVersion.sol", VERSION_SOL);
    write(dir, ".gitmodules", GITMODULES);
    return dir;
  }
  const clean = (extra: Record<string, Partial<RunResult>> = {}) =>
    fakeRunner({
      "rev-parse HEAD": { stdout: `${COMMIT}\n` },
      "status --porcelain": { stdout: "" },
      "tag --points-at HEAD": { stdout: "storage-guard-v1.0.0\n" },
      "ls-tree HEAD lib/forge-std": { stdout: `160000 commit ${"ab".repeat(20)}\tlib/forge-std\n` },
      "ls-tree HEAD lib/diamond-lib": { stdout: `160000 commit ${DIAMOND_LIB}\tlib/diamond-lib\n` },
      ...extra,
    });

  test("commit, VERSION and the submodules Lattice's tree pins; a non-release tag is ignored", async () => {
    const res = await readIdentity(checkout(), clean());
    expect(res).toEqual({
      ok: true,
      value: {
        commit: COMMIT,
        version: "0.2.0",
        submodules: [
          { path: "lib/forge-std", url: "https://github.com/foundry-rs/forge-std", commit: "ab".repeat(20) },
          { path: "lib/diamond-lib", url: "https://github.com/dadadave80/diamond-lib", commit: DIAMOND_LIB },
        ],
      },
    });
  });

  test("a release tag on the commit becomes the tag", async () => {
    const res = await readIdentity(checkout(), clean({ "tag --points-at HEAD": { stdout: "v0.4.0\nstorage-guard-v1.0.0\n" } }));
    expect(res.ok && res.value.tag).toBe("v0.4.0");
    expect(res.ok && res.value.otherTags).toBeUndefined();
  });

  test("several release tags: the highest by version, not by string order, and the rest are kept", async () => {
    expect(releaseTags("v0.4.0\nv0.10.0\nv0.9.12\nstorage-guard-v1.0.0\nv1.0\n")).toEqual(["v0.10.0", "v0.9.12", "v0.4.0"]);
    expect(releaseTags("v1.2.3\nv1.10.0\nv2.0.0\n")).toEqual(["v2.0.0", "v1.10.0", "v1.2.3"]);
    expect(releaseTags("")).toEqual([]);
    const res = await readIdentity(checkout(), clean({ "tag --points-at HEAD": { stdout: "v0.4.0\nv0.10.0\n" } }));
    expect(res.ok && res.value.tag).toBe("v0.10.0");
    expect(res.ok && res.value.otherTags).toEqual(["v0.4.0"]);
  });

  test("the generator logs which release tag it picked", async () => {
    const lines: string[] = [];
    const run = fakeRunner({
      "forge --version": { stdout: FORGE_183 },
      "anvil --version": { stdout: ANVIL_183 },
      "rev-parse HEAD": { stdout: `${COMMIT}\n` },
      "status --porcelain": { stdout: "" },
      "tag --points-at HEAD": { stdout: "v0.4.0\nv0.10.0\n" },
      "ls-tree HEAD lib/forge-std": { stdout: `160000 commit ${"ab".repeat(20)}\tlib/forge-std\n` },
      "ls-tree HEAD lib/diamond-lib": { stdout: `160000 commit ${DIAMOND_LIB}\tlib/diamond-lib\n` },
    });
    // The build that follows fails on this empty checkout; the tag line comes first.
    const res = await generateCatalog({ latticeDir: checkout(), run, log: (l) => lines.push(l) });
    expect(res.ok).toBe(false);
    expect(lines).toContain("Using release tag v0.10.0 (the highest of v0.10.0, v0.4.0), which points at f4a32c8.");
    expect(lines).toContain("Lattice 0.2.0 at v0.10.0 → catalog/v0.10.0");
  }, 60_000);

  test("a checkout with uncommitted changes is refused", async () => {
    const res = await readIdentity(checkout(), clean({ "status --porcelain": { stdout: " M src/tokens/ERC20/ERC20.sol\n?? scratch.sol\n" } }));
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.error).toContain("uncommitted changes (M src/tokens/ERC20/ERC20.sol; ?? scratch.sol)");
  });

  test("a directory that isn't a git checkout is refused", async () => {
    const res = await readIdentity(checkout(), fakeRunner({ "rev-parse HEAD": { code: 128, stderr: "fatal: not a git repository" } }));
    expect(res.ok ? "" : res.error).toContain("isn't a git checkout of Lattice");
  });

  test("parses .gitmodules", () => {
    expect(parseGitmodules(GITMODULES)).toEqual([
      { path: "lib/forge-std", url: "https://github.com/foundry-rs/forge-std" },
      { path: "lib/diamond-lib", url: "https://github.com/dadadave80/diamond-lib.git" },
    ]);
    expect(parseGitmodules("")).toEqual([]);
  });

  test("catalog id: the release tag, else dev-<commit7>", () => {
    expect(catalogId({ commit: COMMIT })).toBe("dev-f4a32c8");
    expect(catalogId({ commit: COMMIT, tag: "v0.4.0" })).toBe("v0.4.0");
  });

  test("provisional whenever the pinned version isn't 0.4.0, in the contracts' words", () => {
    expect(TARGET_VERSION).toBe("0.4.0");
    expect(provisionalNote({ commit: COMMIT, version: "0.2.0" })).toBe("Lattice 0.2.0 at dev f4a32c8; v1 targets 0.4.0");
    expect(provisionalNote({ commit: COMMIT, tag: "v0.3.0", version: "0.3.0" })).toBe("Lattice 0.3.0 at v0.3.0; v1 targets 0.4.0");
    expect(provisionalNote({ commit: COMMIT, tag: "v0.4.0", version: "0.4.0" })).toBeUndefined();
  });
});

describe("areas and source URLs", () => {
  test("area from the source path; diamond-lib and src/*.sol are diamond", () => {
    expect(areaOf("src/tokens/ERC20/ERC20.sol")).toEqual({ ok: true, value: "tokens" });
    expect(areaOf("src/access/AccessControl.sol")).toEqual({ ok: true, value: "access" });
    expect(areaOf("lib/diamond-lib/src/facets/DiamondCutFacet.sol")).toEqual({ ok: true, value: "diamond" });
    expect(areaOf("src/Lattice.sol")).toEqual({ ok: true, value: "diamond" });
    expect(areaOf("src/widgets/Widget.sol").ok).toBe(false);
    expect(areaOf("script/base/DeployERC20.s.sol").ok).toBe(false);
  });

  test("Lattice's files at its commit; a submodule's at its own repo and pinned commit", () => {
    const identity = { commit: COMMIT, submodules: [{ path: "lib/diamond-lib", url: "https://github.com/dadadave80/diamond-lib", commit: DIAMOND_LIB }] };
    expect(sourceUrl("src/tokens/ERC20/ERC20.sol", identity)).toBe(`${LATTICE_REPO_URL}/blob/${COMMIT}/src/tokens/ERC20/ERC20.sol`);
    expect(sourceUrl("lib/diamond-lib/src/facets/DiamondCutFacet.sol", identity)).toBe(
      `https://github.com/dadadave80/diamond-lib/blob/${DIAMOND_LIB}/src/facets/DiamondCutFacet.sol`,
    );
  });
});

describe("projections", () => {
  test("CG5's init overlay loses its citations in CG4's shape", () => {
    const inits = {
      GovernedVaultInit: {
        kind: "bundle",
        source: "src/defi/GovernedVaultInit.sol#L40-L60",
        area: "defi",
        file: "overlay/inits/defi.yaml",
        params: {
          p: {
            doc: "Governance parameters.",
            components: { minDelay: { unit: "seconds", rule: "gt(0)", source: "src/defi/GovernedVaultInit.sol#L25-L25" } },
          },
        },
        after: [{ module: "AccessControl", source: "src/defi/GovernedVaultInit.sol#L40-L41" }],
        sameCall: [{ module: "ERC20", source: "src/defi/GovernedVaultInit.sol#L42-L43" }],
        sequence: { modules: ["ERC20", "Votes"], source: "src/defi/GovernedVaultInit.sol#L44-L50" },
        registersInterfaces: true,
      },
      ERC20Init: { kind: "step", source: "src/tokens/ERC20/ERC20Init.sol#L13-L15", area: "tokens", file: "overlay/inits/tokens.yaml" },
    } as unknown as Overlay["inits"];
    expect(initOverlayInput(inits)).toEqual({
      GovernedVaultInit: {
        kind: "bundle",
        params: { p: { doc: "Governance parameters.", components: { minDelay: { unit: "seconds", rule: "gt(0)" } } } },
        after: ["AccessControl"],
        sameCall: ["ERC20"],
        sequence: ["ERC20", "Votes"],
        registersInterfaces: true,
      },
      ERC20Init: { kind: "step" },
    });
  });

  const entry: ReleaseEntry = {
    name: "Semaphore",
    salt: `0x${"11".repeat(32)}` as Hex,
    version: "0.2.0",
    initCodeHash: `0x${"22".repeat(32)}` as Hex,
    address: `0x${"33".repeat(20)}` as Address,
    creationCode: "0x6080" as Hex,
    source: "src/privacy/Semaphore.sol",
    codehash: `0x${"44".repeat(32)}` as Hex,
    constructorArgs: "0x" as Hex,
    links: { "lib/poseidon-solidity/PoseidonT3.sol:PoseidonT3": `0x${"55".repeat(20)}` as Address },
    dependsOn: ["PoseidonT3"],
    provisional: "Links PoseidonT3.",
  };

  test("a release entry keeps only the catalog's SharedContract fields", () => {
    expect(sharedInput(entry)).toEqual({
      salt: entry.salt,
      version: "0.2.0",
      address: entry.address,
      codehash: entry.codehash,
      initCodeHash: entry.initCodeHash,
      creationCode: "0x6080",
      dependsOn: ["PoseidonT3"],
      provisional: "Links PoseidonT3.",
    });
    const { dependsOn: _d, provisional: _p, links: _l, ...plain } = entry;
    const detail = { name: "X", abi: [], natspec: { functions: {} }, source: { path: "src/X.sol", url: "https://example.test" } };
    expect(Object.keys(sharedInput({ ...plain, dependsOn: [] }, detail)).sort()).toEqual(
      ["address", "codehash", "creationCode", "detail", "initCodeHash", "salt", "version"],
    );
  });

  describe("facet inputs", () => {
    const parts: FacetParts = {
      name: "Widget",
      area: "utils",
      source: "src/utils/Widget.sol",
      selectors: [{ hex: "0x12345678" as Hex4, signature: "poke()" }],
      overlay: { requires: [] },
      natspecSummary: undefined,
      storage: { touches: [] },
      release: sharedInput(entry),
      detail: { name: "Widget", abi: [], natspec: { functions: {} }, source: { path: "src/utils/Widget.sol", url: "https://example.test" } },
    };

    test("a facet with no overlay summary and no NatSpec notice is still built, with an empty summary", () => {
      const built = facetInput(parts);
      expect(built.summary).toBe("");
      expect(built.name).toBe("Widget");
      // It still assembles and validates: the overlay lint's summary-missing warning is where it shows up.
      const catalogInput = {
        lattice: { tag: "dev-f4a32c8", commit: COMMIT },
        toolchain: { foundry: "1.8.3", solc: "0.8.36" },
        deployer: { address: "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address, codehash: `0x${"11".repeat(32)}` as Hex },
        registry: sharedInput(entry),
        factory: sharedInput(entry),
        proxy: { creationCode: "0x6080", initCodeHash: `0x${"22".repeat(32)}` as Hex, standardJson: {} },
        facets: [built],
        inits: [],
        recipes: [],
        chains: [],
        seams: [],
      };
      const assembled = assembleCatalog(catalogInput);
      const valid = validateCatalog(assembled.catalog);
      expect(valid.ok ? [] : valid.error).toEqual([]);
      expect(assembled.catalog.facets[0]?.summary).toBe("");
    });

    test("the overlay's summary wins over NatSpec, which wins over nothing", () => {
      expect(facetInput({ ...parts, natspecSummary: "Pokes things." }).summary).toBe("Pokes things.");
      expect(facetInput({ ...parts, natspecSummary: "Pokes things.", overlay: { requires: [], summary: "Pokes widgets." } }).summary).toBe("Pokes widgets.");
    });

    test("overlay fields and storage carry through; absent ones stay absent", () => {
      const built = facetInput({
        ...parts,
        overlay: { requires: [{ anyOf: ["AccessControl"], strength: "hard", reason: "checks roles" }], family: "access", init: "WidgetInit" },
        storage: { storage: { id: "lattice.widget", slot: `0x${"33".repeat(32)}` as Hex }, touches: ["lattice.access"] },
      });
      expect(built.family).toBe("access");
      expect(built.init).toBe("WidgetInit");
      expect(built.storage?.id).toBe("lattice.widget");
      expect(built.touches).toEqual(["lattice.access"]);
      expect("defaultOwnerOf" in built).toBe(false);
      expect("storage" in facetInput(parts)).toBe(false);
    });
  });

  test("a non-facet shard names every function the ABI lists", () => {
    expect(allSelectors({ methodIdentifiers: { "owner()": "0x8da5cb5b" as Hex4, "transferOwnership(address)": "0xf2fde38b" as Hex4 } })).toEqual([
      { hex: "0x8da5cb5b", signature: "owner()" },
      { hex: "0xf2fde38b", signature: "transferOwnership(address)" },
    ]);
  });

  test("modules: every __X_init in Lattice and diamond-lib, plus Ownable", async () => {
    const dir = tempDir();
    write(dir, "src/tokens/ERC20/libraries/ERC20Lib.sol", "function __ERC20_init(string memory n) internal {}\nfunction __ERC20Permit_init() internal {}\n");
    write(dir, "lib/diamond-lib/src/libraries/ERC165Lib.sol", "function __ERC165_init() internal {}\n");
    write(dir, "lib/forge-std/src/Test.sol", "function __Ignored_init() internal {}\n");
    expect(await initModules(dir)).toEqual(["ERC165", "ERC20", "ERC20Permit", "Ownable"]);
  });
});

describe("the temporary copy", () => {
  test("copies exactly the tracked files, never build output, and removes itself", async () => {
    const src = tempDir();
    write(src, "foundry.toml", "[profile.ci]\n");
    write(src, "src/Lattice.sol", "contract Lattice {}\n");
    write(src, "lib/diamond-lib/src/Diamond.sol", "contract Diamond {}\n");
    write(src, "out/Lattice.sol/Lattice.json", "{}");
    const tracked = ["foundry.toml", "src/Lattice.sol", "lib/diamond-lib/src/Diamond.sol"];
    const copied = await copyCheckout(src, fakeRunner({ "ls-files -z --recurse-submodules": { stdout: `${tracked.join("\0")}\0` } }));
    if (!copied.ok) throw new Error(copied.error);
    for (const f of tracked) expect(readFileSync(join(copied.value.dir, f), "utf8")).toBe(readFileSync(join(src, f), "utf8"));
    expect(existsSync(join(copied.value.dir, "out"))).toBe(false);
    await copied.value.remove();
    expect(existsSync(copied.value.dir)).toBe(false);
  });

  test("the main checkout is recognized, so it's never built in place", () => {
    const main = tempDir();
    expect(isMainCheckout(main, main)).toBe(true);
    expect(isMainCheckout(join(main, "."), main)).toBe(true);
    expect(isMainCheckout(tempDir(), main)).toBe(false);
  });
});

describe("the command line", () => {
  const root = "/repo";
  test("defaults, flags and paths", () => {
    const defaults = parseCatalogArgs([], root);
    expect(defaults.ok && defaults.value.outDir).toBe("/repo/catalog");
    expect(defaults.ok && defaults.value.clean).toBe(false);
    const all = parseCatalogArgs(["--lattice", "/tmp/lattice", "--out", "/tmp/out", "--clean", "--copy", "--allow-main-checkout"], root);
    expect(all).toEqual({
      ok: true,
      value: { latticeDir: "/tmp/lattice", outDir: "/tmp/out", clean: true, copy: true, allowMainCheckout: true, help: false },
    });
  });

  test("a missing value or an unknown argument is an error, and the command exits 2 with its usage", async () => {
    expect(parseCatalogArgs(["--lattice"], root)).toEqual({ ok: false, error: "--lattice needs a directory." });
    expect(parseCatalogArgs(["--fast"], root)).toEqual({ ok: false, error: "Unknown argument --fast." });
    const errors: string[] = [];
    expect(await runCatalog(["--fast"], () => {}, (l) => errors.push(l))).toBe(2);
    expect(errors.join("\n")).toContain("Usage: bun run catalog");
    const out: string[] = [];
    expect(await runCatalog(["--help"], (l) => out.push(l))).toBe(0);
    expect(out.join("\n")).toContain("--allow-main-checkout");
  });
});
