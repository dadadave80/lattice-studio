/**
 * The real recipe overlay (`overlay/recipes/`, `overlay/seams.yaml`) against the fixture catalog's facets (K3), the
 * init overlay (CG5), the golden routing GT1 recorded from Lattice's scripts, and, when a checkout exists
 * (`LATTICE_DIR` or `lattice/`), the scripts themselves.
 */
import { describe, expect, test } from "bun:test";
import {
  analyze,
  type Arg,
  type Catalog,
  computeRouting,
  type Hex4,
  type InitParam,
  lintCopy,
  loadTemplate,
  normalizeRecipe,
  RecipeTemplateSchema,
  type RecipeTemplate,
  renderProblem,
  type Seam,
} from "@lattice-studio/core";
import { loadOverlay } from "../../src/overlay";
import { lintOverlay } from "../../src/overlay-lint";
import {
  type BuiltTemplates,
  buildSeams,
  buildTemplates,
  checkRecipeSources,
  checkScriptFacets,
  loadRecipeOverlay,
  type RecipeOverlay,
  SKIPPED_SCRIPTS,
  selectorOf,
  verifyTemplateRouting,
  ZERO_HASH,
} from "../../src/recipes";
import { deployScripts, fixtureCatalog, goldenRouting, latticeDir, readerFor, recipeFacts, V1 } from "./support";

const loaded = await loadRecipeOverlay();
if (!loaded.ok) throw new Error(loaded.error.map((i) => `${i.file} ${i.path}: ${i.message}`).join("\n"));
const overlay: RecipeOverlay = loaded.value;
const fixture = fixtureCatalog();
const facts = await recipeFacts(fixture);

const seamsBuilt = buildSeams(overlay, facts);
if (!seamsBuilt.ok) throw new Error(seamsBuilt.error.map((i) => `${i.path}: ${i.message}`).join("\n"));
const seams: Seam[] = seamsBuilt.value;
const templatesBuilt = buildTemplates(overlay, facts);
if (!templatesBuilt.ok) throw new Error(templatesBuilt.error.map((i) => `${i.file} ${i.path}: ${i.message}`).join("\n"));
const built: BuiltTemplates = templatesBuilt.value;

/** The fixture catalog with this overlay's seams and templates in place of K3's. */
const catalog: Catalog = { ...fixture, seams, recipes: built.templates };
const template = (name: string): RecipeTemplate => {
  const found = built.templates.find((t) => t.name === name);
  if (found === undefined) throw new Error(`no template ${name}`);
  return found;
};
const owners = (routing: ReturnType<typeof computeRouting>): Record<string, string> =>
  Object.fromEntries(Object.entries(routing).flatMap(([s, r]) => (r.owner === undefined ? [] : [[s, r.owner]])));

const dir = latticeDir();

describe("the recipe overlay", () => {
  test("loads, and every template builds against the catalog's facets and inits", () => {
    expect(built.templates.length).toBe(84);
    expect(built.templates.slice(0, 3).map((t) => t.name)).toEqual([...V1]);
    expect(built.templates.filter((t) => t.phase === "v1").map((t) => t.name)).toEqual([...V1]);
    expect(new Set(built.templates.map((t) => t.phase))).toEqual(new Set(["v1", "v1.1"]));
  });

  test("proxies: the account recipes need their own (R20); everything else is a plain Lattice diamond", () => {
    const off = built.templates.filter((t) => t.proxy !== "Lattice").map((t) => [t.name, t.proxy]);
    expect(off).toEqual([
      ["Account", "AccountDiamond"],
      ["Account6900", "ModularAccount6900"],
    ]);
  });

  test("every template is a valid RecipeTemplate with the zero hash, normalized and never the introspection step", () => {
    for (const t of built.templates) {
      expect(RecipeTemplateSchema.safeParse(t).success).toBe(true);
      expect(t.recipe.catalog).toEqual({ tag: "fixture", hash: ZERO_HASH });
      expect(t.recipe.template).toBeUndefined();
      expect(normalizeRecipe(t.recipe, catalog)).toEqual(t.recipe);
      const specs = t.recipe.init.kind === "steps" ? t.recipe.init.steps.map((s) => s.spec) : t.recipe.init.kind === "bundle" ? [t.recipe.init.spec] : [];
      expect(specs.some((s) => s.startsWith("DiamondIntrospectionInit"))).toBe(false);
    }
  });

  test("core routes every template exactly as its script's cuts do, seams included", () => {
    expect(verifyTemplateRouting(catalog, built.routing)).toEqual([]);
  });

  test("templates that leave arguments empty say so; v1 templates carry no gaps", () => {
    expect(built.gaps.filter((g) => g.phase === "v1")).toEqual([]);
    for (const g of built.gaps) expect(lintCopy(g.gaps)).toEqual([]);
  });
});

describe.skipIf(dir === null)("against the Lattice checkout", () => {
  const read = readerFor(dir ?? "");
  const scripts = dir === null ? [] : deployScripts(dir);

  test("every deploy script is a template or skipped with a reason", () => {
    const covered = new Set([...overlay.recipes.map((r) => r.script), ...Object.keys(SKIPPED_SCRIPTS)]);
    expect(scripts.filter((s) => !covered.has(s))).toEqual([]);
    expect([...covered].filter((s) => !scripts.includes(s))).toEqual([]);
    expect(overlay.recipes.filter((r) => SKIPPED_SCRIPTS[r.script] !== undefined)).toEqual([]);
    expect(new Set(overlay.recipes.map((r) => r.script)).size).toBe(overlay.recipes.length);
  });

  test("every citation is in the checkout and names what it cites", () => {
    expect(checkRecipeSources(overlay, read)).toEqual([]);
  });

  test("a template with no gaps note passes every init argument its script does: the script passes none", () => {
    for (const r of overlay.recipes.filter((d) => d.phase !== "v1" && d.gaps === undefined)) {
      expect(r.init.kind).toBe("steps");
      if (r.init.kind !== "steps") continue;
      const [path, range] = r.init.source.split("#L");
      const [from, to] = (range ?? "").split("-L").map(Number);
      const text = (read(path ?? "") ?? []).slice((from ?? 1) - 1, to).join(" ");
      expect([r.name, r.init.steps.every((s) => Object.keys(s.args).length === 0), /\.init, \(\)\)/.test(text)]).toEqual([r.name, true, true]);
    }
  });

  test("each template cuts exactly the facets its script constructs", () => {
    expect(checkScriptFacets(overlay, read, scripts, new Set(fixture.facets.map((f) => f.name)))).toEqual([]);
  });
});

// ── the golden routing (GT1) ───────────────────────────────────────────────────────────────────────

describe("v1 templates equal what Lattice's scripts build (golden/expected)", () => {
  for (const name of V1) {
    const golden = goldenRouting(name);
    const t = template(name);
    const def = overlay.recipes.find((r) => r.name === name);

    test(`${name}: script and overload`, () => {
      expect(t.script).toBe(golden.script);
      expect(def?.buildCuts).toBe(golden.buildCuts);
    });

    test(`${name}: core's routing equals the golden routing, selector for selector`, () => {
      const routing = computeRouting(t.recipe, catalog);
      expect(owners(routing)).toEqual(golden.routing);
      expect(built.routing[name]).toEqual(golden.routing as Record<Hex4, string>);
      const serving = new Set(Object.values(golden.routing));
      expect(new Set(t.recipe.facets)).toEqual(serving);
      expect(new Set(golden.facets)).toEqual(serving);
    });

    test(`${name}: owners alone reproduce it, with no seams and no default owners`, () => {
      const bare: Catalog = {
        ...catalog,
        seams: [],
        facets: catalog.facets.map(({ defaultOwnerOf: _d, ...f }) => f),
      };
      expect(owners(computeRouting(t.recipe, bare))).toEqual(golden.routing);
    });

    test(`${name}: the init is the script's, minus the automatic ERC-165 step`, () => {
      const init = t.recipe.init;
      const stored = init.kind === "bundle" ? [init.spec] : init.kind === "steps" ? init.steps.map((s) => s.spec) : [];
      const scripted = golden.init.steps.map((s) => s.init).filter((s) => s !== "DiamondIntrospectionInit");
      expect(stored).toEqual(scripted);
    });
  }

  test("GovernedVault: a bundle called directly; clock and CLOCK_MODE are GovernedVault's", () => {
    const t = template("GovernedVault");
    expect(t.recipe.init.kind).toBe("bundle");
    expect(goldenRouting("GovernedVault").init.kind).toBe("direct");
    expect(t.recipe.owners[selectorOf("clock()")]).toBe("GovernedVault");
    expect(t.recipe.owners[selectorOf("CLOCK_MODE()")]).toBe("GovernedVault");
    expect(t.recipe.facets).toHaveLength(14);
  });

  test("ERC20: immutable, its MultiInit's second call is the introspection step the planner appends", () => {
    const t = template("ERC20");
    expect(t.recipe.immutable).toBe(true);
    expect(goldenRouting("ERC20").init.steps.map((s) => `${s.init}.${s.signature}`)).toEqual([
      "ERC20Init.init(string,string)",
      "DiamondIntrospectionInit.initImmutable()",
    ]);
  });

  test("SafeDiamondCut: one stored step, which encodes as a direct call like the script's", () => {
    const t = template("SafeDiamondCut");
    expect(t.recipe.init).toEqual({ kind: "steps", steps: [{ spec: "SafeDiamondCutInit", args: { admin: { $ref: "deployer" }, minThreshold: "2" } }] });
    expect(goldenRouting("SafeDiamondCut").init.kind).toBe("direct");
  });

  test("the v1 templates equal K3's fixture templates", () => {
    for (const name of V1) {
      expect(template(name).recipe).toEqual(fixture.recipes.find((r) => r.name === name)?.recipe as RecipeTemplate["recipe"]);
    }
  });
});

// ── seams (R19) ────────────────────────────────────────────────────────────────────────────────────

describe("seams equal R19", () => {
  const R19: [string, string[], string[], string][] = [
    ["transfer(address,uint256)", ["ERC20Votes"], ["GovernedVault", "ERC20Votes"], "updates vote checkpoints"],
    ["transferFrom(address,address,uint256)", ["ERC20Votes"], ["GovernedVault", "ERC20Votes"], "updates vote checkpoints"],
    ["delegate(address)", ["ERC20Votes"], ["ERC20Votes"], "counts the delegator's balance as votes"],
    ["delegateBySig(address,uint256,uint256,uint8,bytes32,bytes32)", ["ERC20Votes"], ["ERC20Votes"], "counts the delegator's balance as votes"],
    ["deposit(uint256,address)", ["GovernedVault"], ["GovernedVault"], "updates vote checkpoints when shares are minted or burned"],
    ["mint(uint256,address)", ["GovernedVault"], ["GovernedVault"], "updates vote checkpoints when shares are minted or burned"],
    ["withdraw(uint256,address,address)", ["GovernedVault"], ["GovernedVault"], "updates vote checkpoints when shares are minted or burned"],
    ["redeem(uint256,address,address)", ["GovernedVault"], ["GovernedVault"], "updates vote checkpoints when shares are minted or burned"],
    ["castVoteBySig(uint256,uint8,address,bytes)", ["GovernedVault"], ["GovernedVault"], "uses the vault's own ballot nonce"],
    ["totalAssets()", ["GovernedVault"], ["VaultCore"], "counts the assets strategies hold"],
    ["decimals()", ["GovernedVault"], ["ERC4626"], "applies the ERC-4626 decimals offset"],
  ];

  test("exactly R19's selectors, activation and allowed servers", () => {
    expect(seams).toEqual(R19.map(([signature, when, anyOf, reason]) => ({ selector: selectorOf(signature), when, anyOf, reason })));
  });

  test("the same seams K3's fixture has; only the copy follows the spec", () => {
    expect(seams.map(({ reason: _r, ...s }) => s)).toEqual(fixture.seams.map(({ reason: _r, ...s }) => s));
  });

  test("clock, CLOCK_MODE and name aren't seams: they're GovernedVault's defaults (golden routing, compose guide)", () => {
    for (const signature of ["clock()", "CLOCK_MODE()", "name()"]) {
      expect(seams.some((s) => s.selector === selectorOf(signature))).toBe(false);
    }
  });

  test("SEM-01 reads as the spec's example (L316)", () => {
    const transfer = seams[0];
    expect(
      renderProblem("SEM-01", {
        selector: "0xa9059cbb",
        signature: "transfer(address,uint256)",
        allowed: transfer?.anyOf ?? [],
        reason: transfer?.reason ?? "",
        owner: "ERC20Pausable",
        nonePlaced: false,
      }),
    ).toBe("`transfer(address,uint256)` must be served by a version that updates vote checkpoints (GovernedVault or ERC20Votes), not ERC20Pausable.");
    for (const s of seams) expect(lintCopy(s.reason)).toEqual([]);
  });

  test("routing GovernedVault's seams says so (via seam)", () => {
    const routing = computeRouting(template("GovernedVault").recipe, catalog);
    for (const s of seams) expect(routing[s.selector]?.via).toBe("seam");
  });

  test("CG5's lint finds nothing wrong with them", async () => {
    const base = await loadOverlay();
    if (!base.ok) throw new Error("the init overlay doesn't load");
    const lint = lintOverlay(base.value, { facets: fixture.facets.map((f) => ({ name: f.name, selectors: f.selectors.map((s) => s.hex) })), seams });
    expect([...lint.errors, ...lint.warnings].filter((i) => i.kind === "seam")).toEqual([]);
  });
});

// ── example arguments (CG5's overlay) ──────────────────────────────────────────────────────────────

describe("v1 arguments are the overlay's examples", () => {
  /** Every example in a spec's params, by argument path ("p.name"). */
  function examples(params: readonly InitParam[], prefix = ""): Map<string, unknown> {
    const out = new Map<string, unknown>();
    for (const p of params) {
      if (p.example !== undefined) out.set(`${prefix}${p.name}`, p.example);
      if (p.components !== undefined) for (const [k, v] of examples(p.components, `${prefix}${p.name}.`)) out.set(k, v);
    }
    return out;
  }
  /** Every leaf argument, by path. */
  function leaves(args: Record<string, Arg>, prefix = ""): Map<string, Arg> {
    const out = new Map<string, Arg>();
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === "object" && !Array.isArray(v) && !("$ref" in v)) for (const [p, w] of leaves(v as Record<string, Arg>, `${prefix}${k}.`)) out.set(p, w);
      else out.set(`${prefix}${k}`, v);
    }
    return out;
  }
  const steps = (t: RecipeTemplate) =>
    t.recipe.init.kind === "bundle" ? [{ spec: t.recipe.init.spec, args: t.recipe.init.args }] : t.recipe.init.kind === "steps" ? t.recipe.init.steps : [];

  test("every argument with an example equals it, and every example is filled in", async () => {
    const base = await loadOverlay();
    if (!base.ok) throw new Error("the init overlay doesn't load");
    for (const name of V1) {
      for (const step of steps(template(name))) {
        const spec = fixture.inits.find((i) => i.name === step.spec);
        expect(spec).toBeDefined();
        const want = examples(spec?.params ?? []);
        const have = leaves(step.args);
        for (const [path, value] of want) expect([name, path, have.get(path)]).toEqual([name, path, value as Arg]);
        for (const [path, value] of have) {
          if (typeof value === "string") expect([name, path, want.get(path)]).toEqual([name, path, value]);
        }
        // The fixture's examples are CG5's: the same values in overlay/inits/.
        const overlayParams = base.value.inits[step.spec]?.params ?? {};
        for (const [path, value] of want) {
          const [head, field] = path.split(".");
          const entry = field === undefined ? overlayParams[head ?? ""] : overlayParams[head ?? ""]?.components?.[field];
          expect(entry?.example).toEqual(value as Arg);
        }
      }
    }
  });

  test("GovernedVault's come from GrantExample; asset and safe are left for INIT-01", () => {
    const vault = template("GovernedVault").recipe.init;
    expect(vault).toEqual({
      kind: "bundle",
      spec: "GovernedVaultInit",
      args: {
        p: { name: "Grant vault", symbol: "gVLT", decimalsOffset: "0", minDelay: "300", votingDelay: "60", votingPeriod: "600", proposalThreshold: "0", quorumNumerator: "4" },
      },
    });
    const params = fixture.inits.find((i) => i.name === "GovernedVaultInit")?.params[0]?.components ?? [];
    for (const p of params.filter((c) => c.example !== undefined)) expect(p.exampleSource).toBe("script/base/defi/GrantExample.s.sol#L26-L26");
    const erc20 = fixture.inits.find((i) => i.name === "ERC20Init")?.params ?? [];
    expect(erc20.map((p) => p.exampleSource)).toEqual(["studio", "studio"]);
  });
});

// ── through core, as Studio loads them ─────────────────────────────────────────────────────────────

describe("loading the templates", () => {
  test("v1 templates load with the live hash; the rest say when they arrive", () => {
    const live: Catalog = { ...catalog, hash: `0x${"ab".repeat(32)}` };
    for (const name of V1) {
      const loadedRecipe = loadTemplate(live, name);
      expect(loadedRecipe.ok).toBe(true);
      if (loadedRecipe.ok) {
        expect(loadedRecipe.value.catalog.hash).toBe(live.hash);
        expect(loadedRecipe.value.template).toEqual({ name, catalogHash: live.hash });
      }
    }
    expect(loadTemplate(live, "ERC20Votes")).toEqual({ ok: false, error: "ERC20Votes arrives in v1.1." });
    expect(loadTemplate(live, "Account")).toEqual({ ok: false, error: "Account arrives in v1.1 and needs its own factory (AccountFactory)." });
  });

  test("v1 templates raise no selector or seam problems beyond SEL-02's info (spec Flow 2, L312)", () => {
    for (const name of V1) {
      const problems = analyze(template(name).recipe, catalog).problems;
      const routingProblems = problems.filter((p) => (p.code.startsWith("SEL-") && p.code !== "SEL-02") || p.code === "SEM-01");
      expect([name, routingProblems.map((p) => p.id)]).toEqual([name, []]);
    }
  });

  test("example arguments are flagged until changed (INIT-05), Studio's and Lattice's alike", () => {
    for (const name of V1) {
      const codes = analyze(template(name).recipe, catalog).problems.map((p) => p.code);
      expect([name, codes.includes("INIT-05")]).toEqual([name, true]);
    }
  });

  test("GovernedVault loads with only INIT-01 for asset as a blocker (spec Flow 2)", () => {
    const problems = analyze(template("GovernedVault").recipe, catalog).problems;
    expect(problems.filter((p) => p.severity === "blocker").map((p) => p.id)).toEqual(["INIT-01:bundle.p.asset"]);
  });
});
