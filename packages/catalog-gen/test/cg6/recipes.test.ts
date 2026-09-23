/**
 * recipes.ts on hand-built facts and files: parsing, applying cuts, owners and exclusions, the init and
 * `immutable` checks, seams, routing verification, citations and the script drift check. No checkout needed.
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Catalog, Hex4 } from "@lattice-studio/core";
import {
  buildSeams,
  buildTemplates,
  checkRecipeSources,
  checkScriptFacets,
  duplicateKeys,
  loadRecipeOverlay,
  overloadMatches,
  parseRecipeFile,
  parseSeamsFile,
  type RecipeDef,
  type RecipeFacts,
  type RecipeOverlay,
  resolveSelector,
  type SeamDef,
  scriptFacetNames,
  selectorOf,
  type SourceReader,
  verifyTemplateRouting,
  ZERO_HASH,
} from "../../src/recipes";
import { fixtureCatalog } from "./support";

// ── a small world ──────────────────────────────────────────────────────────────────────────────────

const sig = (signature: string) => ({ hex: selectorOf(signature), signature });
const TRANSFER = "transfer(address,uint256)";
const NAME = "name()";
const DECIMALS = "decimals()";
const PAUSE = "pause()";

const FACTS: RecipeFacts = {
  tag: "test",
  facets: [
    { name: "Loupe", selectors: [sig("facets()")] },
    { name: "Token", selectors: [sig(NAME), sig(DECIMALS), sig(TRANSFER)] },
    { name: "Pausable", selectors: [sig(PAUSE), sig(TRANSFER)] },
    { name: "Vault", selectors: [sig(DECIMALS), sig("asset()")] },
    { name: "Cut", selectors: [sig("diamondCut((address,uint8,bytes4[])[],address,bytes)")], family: "upgrade" },
  ],
  inits: [
    { name: "TokenInit", params: [{ name: "name_" }, { name: "p", components: [{ name: "a" }, { name: "b" }] }] },
    { name: "PausableInit", params: [] },
    { name: "LooseInit" },
    { name: "DiamondIntrospectionInit.initImmutable", params: [] },
  ],
};

const SRC = "script/base/tokens/DeployToken.s.sol";
const cite = (a: number, b = a) => `${SRC}#L${a}-L${b}`;

function def(overrides: Partial<RecipeDef> = {}): RecipeDef & { file: string } {
  return {
    name: "Token",
    script: SRC,
    buildCuts: "buildCuts(string)",
    source: cite(1, 20),
    proxy: "Lattice",
    phase: "v1",
    immutable: true,
    cuts: [
      { add: "Loupe", source: cite(3) },
      { add: "Token", source: cite(4) },
    ],
    init: { kind: "steps", steps: [{ spec: "TokenInit", args: { name_: "Example" } }], source: cite(6) },
    file: `overlay/recipes/${overrides.name ?? "Token"}.yaml`,
    ...overrides,
  };
}

function build(...defs: (RecipeDef & { file: string })[]) {
  return buildTemplates({ recipes: defs }, FACTS);
}

function messages(result: { ok: boolean; error?: { path: string; message: string }[] }): string[] {
  return result.ok ? [] : (result.error ?? []).map((i) => `${i.path}: ${i.message}`);
}

// ── selectors and overloads ────────────────────────────────────────────────────────────────────────

describe("selectors", () => {
  test("a signature hashes to its selector; hex passes through", () => {
    expect(selectorOf(TRANSFER)).toBe("0xa9059cbb");
    expect(resolveSelector("CLOCK_MODE()")).toBe("0x4bf5d7e9");
    expect(resolveSelector("0x91ddadf4")).toBe("0x91ddadf4");
  });

  test("overloadMatches compares elementary types and lets a struct stand for a tuple", () => {
    expect(overloadMatches("string memory name_, string memory symbol_", "buildCuts(string,string)")).toBe(true);
    expect(overloadMatches("string memory name_, string memory symbol_", "buildCuts(string,string,address)")).toBe(false);
    expect(overloadMatches("GovernedVaultParams memory p", "buildCuts((address,string,string,uint8,uint256,uint48,uint32,uint256,uint256))")).toBe(true);
    expect(overloadMatches("GovernedVaultParams memory p", "buildCuts(address)")).toBe(false);
    expect(overloadMatches("uint cap_", "buildCuts(uint256)")).toBe(true);
    expect(overloadMatches("", "buildCuts()")).toBe(true);
    expect(overloadMatches("address admin", "buildCutsWithENS(address)")).toBe(true);
  });
});

// ── parsing ────────────────────────────────────────────────────────────────────────────────────────

const GOOD = `name: Token
script: ${SRC}
buildCuts: buildCuts(string)
source: ${cite(1, 20)}
proxy: Lattice
phase: v1
immutable: true
cuts:
  - add: Loupe
    source: ${cite(3)}
  - add: Token
    except: ["name()"]
    source: ${cite(4)}
init:
  kind: steps
  steps:
    - spec: TokenInit
      args:
        name_: "Example"
  source: ${cite(6)}
`;

describe("parseRecipeFile", () => {
  test("reads a recipe file", () => {
    const parsed = parseRecipeFile(GOOD, "overlay/recipes/Token.yaml");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.cuts[1]).toEqual({ add: "Token", except: ["name()"], source: cite(4) });
      expect(parsed.value.init).toEqual({ kind: "steps", steps: [{ spec: "TokenInit", args: { name_: "Example" } }], source: cite(6) });
    }
  });

  test("the name must be the file's and the source must cite the script", () => {
    expect(messages(parseRecipeFile(GOOD, "overlay/recipes/Other.yaml"))).toEqual(["name: is Token; expected Other, the file's name."]);
    const moved = GOOD.replace(`source: ${cite(1, 20)}`, "source: script/base/Other.s.sol#L1-L2");
    expect(messages(parseRecipeFile(moved, "overlay/recipes/Token.yaml"))).toEqual([`source: cites script/base/Other.s.sol; expected the script, ${SRC}.`]);
  });

  test("schema issues come back with their paths", () => {
    const both = GOOD.replace("  - add: Loupe\n", "  - add: Loupe\n    replace: Token\n");
    expect(messages(parseRecipeFile(both, "overlay/recipes/Token.yaml"))).toContain("cuts[0]: a cut has either add or replace.");
    const number = GOOD.replace('name_: "Example"', "name_: 18");
    expect(messages(parseRecipeFile(number, "overlay/recipes/Token.yaml")).some((m) => m.startsWith("init.steps[0].args.name_:"))).toBe(true);
    const badSelector = GOOD.replace('except: ["name()"]', "except: [0x06fdde03]");
    expect(messages(parseRecipeFile(badSelector, "overlay/recipes/Token.yaml")).some((m) => m.startsWith("cuts[1].except[0]:"))).toBe(true);
    const badCite = GOOD.replace(`source: ${cite(3)}`, `source: ${SRC}#L9-L3`);
    expect(messages(parseRecipeFile(badCite, "overlay/recipes/Token.yaml")).some((m) => m.startsWith("cuts[0].source:"))).toBe(true);
    const listOnly = GOOD.replace(`    source: ${cite(3)}`, `    source: ${cite(3)}\n    listSource: ${cite(5)}`);
    expect(messages(parseRecipeFile(listOnly, "overlay/recipes/Token.yaml"))).toContain("cuts[0].listSource: listSource goes with selectors or except.");
  });

  test("a key written twice fails instead of silently keeping the last", () => {
    const twice = `${GOOD}gaps: one\ngaps: two\n`;
    expect(messages(parseRecipeFile(twice, "overlay/recipes/Token.yaml"))).toEqual(["gaps: is written twice (line 22); YAML would keep only the last."]);
    expect(duplicateKeys("a:\n  - x: 1\n    y: 2\n  - x: 3\n    x: 4\n")).toEqual([{ key: "x", line: 5 }]);
    expect(duplicateKeys("a:\n  b: 1\nc:\n  b: 2\n")).toEqual([]);
  });

  test("invalid YAML is one issue", () => {
    expect(messages(parseRecipeFile("name: [", "overlay/recipes/Token.yaml"))[0]).toStartWith(": isn't valid YAML");
  });
});

// ── templates ──────────────────────────────────────────────────────────────────────────────────────

describe("buildTemplates", () => {
  test("a plain recipe: facets in catalog order, no owners, the zero hash, the init as written", () => {
    const built = build(def({ cuts: [{ add: "Token", source: cite(4) }, { add: "Loupe", source: cite(3) }] }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const [template] = built.value.templates;
    expect(template).toEqual({
      name: "Token",
      script: SRC,
      proxy: "Lattice",
      phase: "v1",
      recipe: {
        schemaVersion: 1,
        catalog: { tag: "test", hash: ZERO_HASH },
        facets: ["Loupe", "Token"],
        owners: {},
        exclude: [],
        init: { kind: "steps", steps: [{ spec: "TokenInit", args: { name_: "Example" } }] },
        immutable: true,
      },
    });
    expect(Object.keys(built.value.routing["Token"] ?? {})).toHaveLength(4);
  });

  test("Add-then-Replace becomes an owner; an excluded selector someone else serves too becomes an owner", () => {
    const built = build(
      def({
        cuts: [
          { add: "Token", except: [DECIMALS], source: cite(4) },
          { add: "Pausable", selectors: [PAUSE], source: cite(5) },
          { replace: "Pausable", selectors: [TRANSFER], source: cite(6) },
          { add: "Vault", source: cite(7) },
        ],
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const recipe = built.value.templates[0]?.recipe;
    expect(recipe?.owners).toEqual({ [selectorOf(DECIMALS)]: "Vault", [selectorOf(TRANSFER)]: "Pausable" });
    expect(recipe?.exclude).toEqual([]);
    expect(built.value.routing["Token"]?.[selectorOf(TRANSFER)]).toBe("Pausable");
  });

  test("a selector no cut serves is excluded", () => {
    const built = build(def({ cuts: [{ add: "Token", except: [NAME], source: cite(4) }] }));
    expect(built.ok && built.value.templates[0]?.recipe.exclude).toEqual([selectorOf(NAME)]);
  });

  test("cuts the diamond would reject are issues", () => {
    expect(messages(build(def({ cuts: [{ add: "Token", source: cite(4) }, { add: "Vault", source: cite(5) }] })))).toEqual([
      `cuts[1]: adds ${selectorOf(DECIMALS)}, which Token already serves; the script would revert.`,
    ]);
    expect(messages(build(def({ cuts: [{ replace: "Pausable", source: cite(4) }] })))).toEqual([
      `cuts[0]: replaces ${selectorOf(PAUSE)}, which nothing serves yet; the script would revert.`,
      `cuts[0]: replaces ${selectorOf(TRANSFER)}, which nothing serves yet; the script would revert.`,
    ]);
    expect(messages(build(def({ cuts: [{ add: "Token", source: cite(4) }, { replace: "Token", selectors: [NAME], source: cite(5) }] })))).toEqual([
      `cuts[1]: replaces ${selectorOf(NAME)}, which Token already serves; the script would revert.`,
    ]);
  });

  test("unknown facets, unexported selectors, unknown inits and bad argument paths are issues", () => {
    expect(messages(build(def({ cuts: [{ add: "Nope", source: cite(4) }] })))).toContain("cuts[0]: Nope isn't a catalog facet.");
    expect(messages(build(def({ cuts: [{ add: "Loupe", except: [PAUSE], source: cite(4) }] })))).toContain(
      `cuts[0].except[0]: Loupe doesn't export ${PAUSE} (${selectorOf(PAUSE)}).`,
    );
    const unknownInit = def({ init: { kind: "steps", steps: [{ spec: "NopeInit", args: {} }], source: cite(6) } });
    expect(messages(build(unknownInit))).toEqual(["init.steps[0]: NopeInit isn't a catalog init."]);
    const badArgs = def({ init: { kind: "bundle", spec: "TokenInit", args: { symbol_: "X", p: { a: "1", c: "2" } }, source: cite(6) } });
    expect(messages(build(badArgs))).toEqual(["init.args.symbol_: isn't a parameter (name_, p).", "init.args.p.c: isn't a parameter (a, b)."]);
    const flatTuple = def({ init: { kind: "bundle", spec: "TokenInit", args: { p: "1" }, source: cite(6) } });
    expect(messages(build(flatTuple))).toEqual(["init.args.p: is a tuple; write its fields by name."]);
  });

  test("the automatic ERC-165 step never goes in a template (R11)", () => {
    const withStep = def({
      init: {
        kind: "steps",
        steps: [{ spec: "TokenInit", args: {} }, { spec: "DiamondIntrospectionInit.initImmutable", args: {} }],
        source: cite(6),
      },
    });
    expect(messages(build(withStep))).toEqual(["init.steps[1]: the automatic ERC-165 step is the planner's (R11); leave it out of the template."]);
  });

  test("immutable holds exactly when no upgrade mechanism is cut", () => {
    expect(messages(build(def({ cuts: [{ add: "Loupe", source: cite(3) }, { add: "Cut", source: cite(4) }] })))).toEqual([
      "immutable: is set, but the script cuts Cut.",
    ]);
    const { immutable: _drop, ...mutable } = def();
    expect(messages(build(mutable as RecipeDef & { file: string }))).toEqual(["immutable: the script cuts no upgrade mechanism; set immutable: true."]);
  });

  test("a v1.1 template that leaves an argument empty must say so in gaps; v1 may leave one for INIT-01", () => {
    const empty = def({ phase: "v1.1", init: { kind: "steps", steps: [{ spec: "TokenInit", args: {} }], source: cite(6) } });
    expect(messages(build(empty))).toEqual(["init.steps[0].args: leaves name_, p empty; say so in gaps."]);
    expect(build({ ...empty, gaps: "No example arguments yet." }).ok).toBe(true);
    expect(build(def({ init: { kind: "steps", steps: [{ spec: "TokenInit", args: {} }], source: cite(6) } })).ok).toBe(true);
    const loose = def({ phase: "v1.1", init: { kind: "steps", steps: [{ spec: "LooseInit", args: {} }], source: cite(6) } });
    expect(build(loose).ok).toBe(true);
  });

  test("order: v1 by `order`, then later phases by name; gaps are reported", () => {
    const built = build(
      def({ name: "Zed", phase: "v1.1", gaps: "Partial." }),
      def({ name: "Second", order: 2 }),
      def({ name: "Alpha", phase: "v1.1", gaps: "Partial." }),
      def({ name: "First", order: 1 }),
      def({ name: "Later", phase: "later", gaps: "Partial." }),
    );
    expect(built.ok && built.value.templates.map((t) => t.name)).toEqual(["First", "Second", "Alpha", "Zed", "Later"]);
    expect(built.ok && built.value.gaps.map((g) => g.name)).toEqual(["Alpha", "Zed", "Later"]);
  });

  test("a name written twice is an issue", () => {
    expect(messages(build(def(), def()))).toEqual(["name: Token is written twice."]);
  });
});

// ── seams ──────────────────────────────────────────────────────────────────────────────────────────

function seamDef(overrides: Partial<SeamDef> = {}): SeamDef & { file: string } {
  return {
    selectors: [TRANSFER],
    when: ["Pausable"],
    anyOf: ["Pausable"],
    reason: "checks the pause first",
    source: cite(2),
    file: "overlay/seams.yaml",
    ...overrides,
  };
}

describe("buildSeams", () => {
  test("one seam per selector, in file order", () => {
    const built = buildSeams({ seams: [seamDef({ selectors: [TRANSFER, "0x313ce567"], anyOf: ["Token"] }), seamDef({ when: ["Pausable", "Token"] })] }, FACTS);
    expect(built.ok && built.value).toEqual([
      { selector: "0xa9059cbb", when: ["Pausable"], anyOf: ["Token"], reason: "checks the pause first" },
      { selector: "0x313ce567", when: ["Pausable"], anyOf: ["Token"], reason: "checks the pause first" },
      { selector: "0xa9059cbb", when: ["Pausable", "Token"], anyOf: ["Pausable"], reason: "checks the pause first" },
    ]);
  });

  test("unknown facets, facets that don't export the selector, repeats and copy are issues", () => {
    expect(messages(buildSeams({ seams: [seamDef({ when: ["Nope"] })] }, FACTS))).toEqual(["seams[0]: Nope isn't a catalog facet."]);
    expect(messages(buildSeams({ seams: [seamDef({ anyOf: ["Vault"] })] }, FACTS))).toEqual([
      `seams[0]: Vault doesn't export ${TRANSFER} (0xa9059cbb).`,
    ]);
    expect(messages(buildSeams({ seams: [seamDef(), seamDef()] }, FACTS))).toEqual([
      `seams[1]: ${TRANSFER} already has a seam for when [Pausable].`,
    ]);
    expect(messages(buildSeams({ seams: [seamDef({ reason: "Checks the pause." })] }, FACTS))).toEqual([
      'seams[0].reason: is a lowercase clause with no final period; it reads after "must be served by a version that ".',
    ]);
    expect(messages(buildSeams({ seams: [seamDef({ reason: "please checks the colour" })] }, FACTS))).toHaveLength(2);
  });

  test("a seam that can't decide anything is an issue: nothing outside anyOf and no when facet exports it", () => {
    const idle = seamDef({ selectors: ["facets()"], when: ["Pausable"], anyOf: ["Loupe"] });
    expect(messages(buildSeams({ seams: [idle] }, FACTS))).toEqual([
      "seams[0]: nothing contends facets() (0x7a0ed627): no `when` facet exports it and no facet outside anyOf does.",
    ]);
    const byWhen = seamDef({ selectors: ["asset()"], when: ["Vault"], anyOf: ["Vault"] });
    expect(buildSeams({ seams: [byWhen] }, FACTS).ok).toBe(true);
  });

  test("parseSeamsFile reads the list and rejects unknown keys", () => {
    const text = `seams:\n  - selectors: ["${TRANSFER}"]\n    when: [Pausable]\n    anyOf: [Pausable]\n    reason: checks the pause first\n    source: ${cite(2)}\n`;
    expect(parseSeamsFile(text, "overlay/seams.yaml").ok).toBe(true);
    expect(messages(parseSeamsFile(`${text}    owner: Token\n`, "overlay/seams.yaml"))[0]).toStartWith("seams[0]:");
  });
});

// ── routing through core ───────────────────────────────────────────────────────────────────────────

describe("verifyTemplateRouting", () => {
  const fixture = fixtureCatalog();
  const selectors = (name: string) => fixture.facets.find((f) => f.name === name)?.selectors ?? [];
  const facts: RecipeFacts = { tag: "fixture", facets: fixture.facets.map((f) => ({ name: f.name, selectors: f.selectors })) };
  const pausable = def({
    name: "ERC20Pausable",
    phase: "v1.1",
    immutable: undefined,
    cuts: [
      { add: "ERC20", source: cite(3) },
      { add: "Pausable", source: cite(4) },
      { replace: "ERC20Pausable", source: cite(5) },
    ],
    init: { kind: "none" },
  });
  const { immutable: _drop, ...mutablePausable } = pausable;

  test("a template core routes as the script does passes", () => {
    const built = buildTemplates({ recipes: [mutablePausable as typeof pausable] }, facts);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const catalog: Catalog = { ...fixture, recipes: built.value.templates, seams: [] };
    expect(verifyTemplateRouting(catalog, built.value.routing)).toEqual([]);
    expect(selectors("ERC20Pausable").length).toBeGreaterThan(0);
  });

  test("a seam that contradicts the script is reported per selector", () => {
    const built = buildTemplates({ recipes: [mutablePausable as typeof pausable] }, facts);
    if (!built.ok) throw new Error("expected a template");
    const seam = { selector: "0xa9059cbb" as Hex4, when: ["ERC20Pausable"], anyOf: ["ERC20"], reason: "moves balances" };
    const catalog: Catalog = { ...fixture, recipes: built.value.templates, seams: [seam] };
    expect(verifyTemplateRouting(catalog, built.value.routing)).toEqual([
      {
        file: "overlay/recipes/ERC20Pausable.yaml",
        path: "0xa9059cbb",
        message: "routes to ERC20 (seam); the script routes it to ERC20Pausable.",
      },
    ]);
  });
});

// ── citations and the script drift check ──────────────────────────────────────────────────────────

const BASE_SCRIPT = [
  "import {BaseDeploy} from \"@lattice-script/base/BaseDeploy.s.sol\";",
  "contract DeployBase is BaseDeploy {",
  "    function buildCuts(string memory name_) public returns (FacetCut[] memory cuts) {",
  "        cuts = _coreCuts();",
  "    }",
  "    function _coreCuts() internal returns (FacetCut[] memory cuts) {",
  "        cuts[0] = _cut(address(new Loupe()));",
  "        cuts[1] = _cut(address(new Token()));",
  "    }",
  "}",
];
const EXT_SCRIPT = [
  "import {DeployBase} from \"@lattice-script/base/tokens/DeployBase.s.sol\";",
  "contract DeployToken is BaseDeploy {",
  "    function buildCuts(string memory name_) public returns (FacetCut[] memory cuts) {",
  "        (FacetCut[] memory base,,) = new DeployBase().buildCuts(name_);",
  "        // cuts[9] = _cut(address(new Vault()));",
  "        cuts[2] = _replace(address(new Pausable()));",
  "        init = address(new TokenInit());",
  "        initCalldata = abi.encodeCall(TokenInit.init, (name_));",
  "    }",
  "}",
];
const FILES: Record<string, string[]> = { [SRC]: EXT_SCRIPT, "script/base/tokens/DeployBase.s.sol": BASE_SCRIPT };
const read: SourceReader = (path) => FILES[path];
const FACET_NAMES = new Set(FACTS.facets.map((f) => f.name));

function overlayOf(recipe: RecipeDef & { file: string }, seams: (SeamDef & { file: string })[] = []): RecipeOverlay {
  return { recipes: [recipe], seams };
}

const EXT_DEF = def({
  buildCuts: "buildCuts(string)",
  source: cite(3, 9),
  cuts: [
    { add: "Loupe", source: "script/base/tokens/DeployBase.s.sol#L7-L7" },
    { add: "Token", source: "script/base/tokens/DeployBase.s.sol#L8-L8" },
    { replace: "Pausable", source: cite(6) },
  ],
  init: { kind: "steps", steps: [{ spec: "TokenInit", args: {} }], source: cite(7, 8) },
});

describe("checkRecipeSources", () => {
  test("citations that name what they cite pass", () => {
    expect(checkRecipeSources(overlayOf(EXT_DEF), read)).toEqual([]);
  });

  test("a missing file, a range past the end, a line that doesn't name the facet, and a wrong overload", () => {
    const broken = def({
      ...EXT_DEF,
      buildCuts: "buildCuts(address)",
      cuts: [
        { add: "Loupe", source: "script/base/Gone.s.sol#L1-L1" },
        { add: "Token", source: cite(40, 41) },
        { add: "Vault", except: [DECIMALS], source: cite(6), listSource: cite(4) },
      ],
      init: { kind: "steps", steps: [{ spec: "PausableInit", args: {} }], source: cite(7, 8) },
    });
    expect(checkRecipeSources(overlayOf(broken), read).map((i) => `${i.path}: ${i.message}`)).toEqual([
      "buildCuts: is buildCuts(address), but the cited function takes (string memory name_).",
      "cuts[0].source: cites script/base/Gone.s.sol#L1-L1, which isn't in the checkout.",
      `cuts[1].source: cites ${cite(40, 41)}, past the end of the file (10 lines).`,
      `cuts[2].source: cites ${cite(6)}, which doesn't mention Vault.`,
      `cuts[2].listSource: cites ${cite(4)}, which doesn't mention decimals.`,
      `init.source: cites ${cite(7, 8)}, which doesn't mention PausableInit.`,
    ]);
  });
});

describe("scriptFacetNames and checkScriptFacets", () => {
  test("follows base recipes and helpers, ignores comments and non-facets", () => {
    const names = scriptFacetNames(read, Object.keys(FILES), SRC, 3, FACET_NAMES);
    expect([...names].sort()).toEqual(["Loupe", "Pausable", "Token"]);
    expect(checkScriptFacets(overlayOf(EXT_DEF), read, Object.keys(FILES), FACET_NAMES)).toEqual([]);
  });

  test("a facet the template leaves out or adds is reported", () => {
    const drifted = def({ ...EXT_DEF, cuts: [{ add: "Loupe", source: cite(7) }, { add: "Vault", source: cite(6) }] });
    expect(checkScriptFacets(overlayOf(drifted), read, Object.keys(FILES), FACET_NAMES).map((i) => i.message)).toEqual([
      "leaves out Pausable, which the script cuts.",
      "leaves out Token, which the script cuts.",
      "lists Vault, which the script doesn't cut.",
    ]);
  });
});

// ── loading ────────────────────────────────────────────────────────────────────────────────────────

describe("loadRecipeOverlay", () => {
  test("reads seams.yaml and recipes/*.yaml, and collects every file's issues", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cg6-"));
    try {
      await mkdir(join(dir, "recipes"));
      await writeFile(join(dir, "recipes", "Token.yaml"), GOOD);
      await writeFile(join(dir, "recipes", "README.md"), "not a recipe");
      await writeFile(
        join(dir, "seams.yaml"),
        `seams:\n  - selectors: ["${TRANSFER}"]\n    when: [Pausable]\n    anyOf: [Pausable]\n    reason: checks the pause first\n    source: ${cite(2)}\n`,
      );
      const loaded = await loadRecipeOverlay(dir);
      expect(loaded.ok && loaded.value.recipes.map((r) => [r.name, r.file])).toEqual([["Token", "overlay/recipes/Token.yaml"]]);
      expect(loaded.ok && loaded.value.seams.map((s) => s.file)).toEqual(["overlay/seams.yaml"]);

      await writeFile(join(dir, "recipes", "Bad.yaml"), GOOD);
      await writeFile(join(dir, "seams.yaml"), "seams: nope\n");
      const failed = await loadRecipeOverlay(dir);
      expect(failed.ok ? [] : failed.error.map((i) => i.file)).toEqual(["overlay/seams.yaml", "overlay/recipes/Bad.yaml"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a recipes/ that can't be read is an issue, not an empty set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cg6-"));
    try {
      await writeFile(join(dir, "recipes"), "a file where the directory should be");
      const loaded = await loadRecipeOverlay(dir);
      expect(loaded.ok ? [] : loaded.error.map((i) => [i.file, i.message.split(":")[0]])).toEqual([["overlay/recipes", "can't be read"]]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an empty directory is an empty overlay", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cg6-"));
    try {
      expect(await loadRecipeOverlay(dir)).toEqual({ ok: true, value: { seams: [], recipes: [] } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
