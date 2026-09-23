import { describe, expect, test } from "bun:test";
import { authorityTable } from "../../authority";
import { parseProjectFile, parseRecipe, recipeHash } from "../../canonical";
import { formatSelector, lintCopy } from "../../format";
import type { Catalog } from "../../model/catalog";
import type { Deployment, Project } from "../../model/project";
import type { Recipe } from "../../model/recipe";
import { blankDiamond, buildPlan, loadTemplate, templateList } from "../../plan";
import { addr, hex, makeCatalog, makeFacet, makeInit, makeRecipe, loadFixtureCatalog } from "../../testing";
import { analyze } from "../../analysis";
import { cell, codeBlock, fenceFor, oneLine, table } from "./markdown";
import { acceptanceSection, exportBrief, leavesOutSection, SECTION_HEADINGS } from "./brief";
import { exportRecipeJson } from "./recipe-json";
import { exportProjectFile } from "./project-file";
import { recipeJsonSchema } from "./json-schema";
import { RECIPE_SCHEMA_URL } from "./schema-url";
import { slug } from "./slug";
import { schemaMatches } from "./test-support";

// ── a small, deterministic diamond, so most assertions don't depend on the fixture catalog ──────────

const catalog: Catalog = makeCatalog({
  lattice: { tag: "test", commit: "0".repeat(40) },
  facets: [
    makeFacet({
      name: "DiamondLoupeFacet",
      area: "diamond",
      selectors: ["facets()", "facetFunctionSelectors(address)", "facetAddresses()", "facetAddress(bytes4)"],
    }),
    makeFacet({
      name: "AccessControl",
      area: "access",
      family: "upgrade",
      selectors: ["grantRole(bytes32,address)", "hasRole(bytes32,address)"],
    }),
    makeFacet({ name: "ERC20", area: "tokens", selectors: ["transfer(address,uint256)", "approve(address,uint256)"] }),
  ],
  inits: [
    makeInit({
      name: "AccessControlInit",
      contract: "AccessControlInit",
      fn: "init(address)",
      kind: "step",
      params: [{ name: "admin", type: "address", doc: "Gets DEFAULT_ADMIN_ROLE.", authority: true, role: "DEFAULT_ADMIN_ROLE" }],
    }),
  ],
});

const recipe: Recipe = makeRecipe(
  {
    name: "Test Vault",
    facets: ["ERC20", "AccessControl", "DiamondLoupeFacet"],
    init: { kind: "steps", steps: [{ spec: "AccessControlInit", args: { admin: { $ref: "self" } } }] },
  },
  catalog,
);

const analysis = analyze(recipe, catalog);
const studioVersion = "0.1.0-test";

/** Table rows and fenced code blocks aren't prose; strip them before `lintCopy` reads what's left. */
function proseOnly(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("|"))
    .join("\n");
}

describe("markdown helpers", () => {
  test("cell escapes pipes, backslashes and collapses newlines", () => {
    expect(cell("a | b")).toBe("a \\| b");
    expect(cell("back\\slash")).toBe("back\\\\slash");
    expect(cell("two\nlines")).toBe("two lines");
  });

  test("oneLine collapses newlines and trims", () => {
    expect(oneLine("  a \n b  ")).toBe("a b");
  });

  test("fenceFor grows past the longest backtick run in the content", () => {
    expect(fenceFor("plain")).toBe("```");
    expect(fenceFor("has ``` three")).toBe("````");
    expect(fenceFor("has ```` four")).toBe("`````");
  });

  test("codeBlock fences hostile content without breaking out", () => {
    const body = "line one\n```\nline two";
    const block = codeBlock(body, "text");
    expect(block.startsWith("````text\n")).toBe(true);
    expect(block.endsWith("\n````")).toBe(true);
    expect(block).toContain(body);
  });

  test("table renders a header, a rule and the rows", () => {
    expect(table(["A", "B"], [["1", "2"]])).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });
});

describe("slug", () => {
  test("splits PascalCase and camelCase into words", () => {
    expect(slug("GovernedVault")).toBe("governed-vault");
    expect(slug("ERC20Votes")).toBe("erc20-votes");
  });

  test("free text becomes kebab-case", () => {
    expect(slug("  Hello, World!  ")).toBe("hello-world");
  });

  test("path separators never survive into a filename", () => {
    expect(slug("../../etc/passwd")).toBe("etc-passwd");
  });

  test("unicode is transliterated where it can be, dropped otherwise", () => {
    expect(slug("Café Núñez")).toBe("cafe-nunez");
    expect(slug("日本語")).toBe("untitled");
  });

  test("empty, undefined and punctuation-only names fall back to untitled", () => {
    expect(slug(undefined)).toBe("untitled");
    expect(slug("")).toBe("untitled");
    expect(slug("***")).toBe("untitled");
  });
});

describe("RECIPE_SCHEMA_URL", () => {
  test("is the D11 placeholder", () => {
    expect(RECIPE_SCHEMA_URL).toBe("https://lattice-studio.invalid/schema/recipe.v1.json");
  });
});

describe("exportRecipeJson", () => {
  test("carries $schema, canonical key order and catalog-order facets, 2-space indent", () => {
    const file = exportRecipeJson(recipe, catalog);
    expect(file.filename).toBe("recipe.json");
    expect(file.mime).toBe("application/json");
    expect(file.text.endsWith("\n")).toBe(true);
    const parsed: unknown = JSON.parse(file.text);
    expect(Object.keys(parsed as object)).toEqual(["$schema", "schemaVersion", "name", "catalog", "facets", "owners", "exclude", "init"]);
    expect((parsed as Recipe).$schema).toBe(RECIPE_SCHEMA_URL);
    expect((parsed as Recipe).facets).toEqual(["DiamondLoupeFacet", "AccessControl", "ERC20"]);
    expect(file.text).toContain('{\n  "$schema"');
  });

  test("overrides whatever $schema the input recipe already carried", () => {
    const file = exportRecipeJson({ ...recipe, $schema: "https://example.invalid/old.json" }, catalog);
    expect((JSON.parse(file.text) as Recipe).$schema).toBe(RECIPE_SCHEMA_URL);
  });

  test("round-trips through parseRecipe with the same hash as the analysis it came from", () => {
    const file = exportRecipeJson(recipe, catalog);
    const parsed = parseRecipe(JSON.parse(file.text), { catalogs: [catalog], source: "file", filename: file.filename });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.unknownFields).toEqual([]);
    expect(recipeHash(parsed.value.value, catalog)).toBe(analysis.recipeHash);
  });

  test("is deterministic", () => {
    expect(exportRecipeJson(recipe, catalog).text).toBe(exportRecipeJson(recipe, catalog).text);
  });
});

describe("exportProjectFile", () => {
  const project: Project = {
    id: "p1",
    name: "GovernedVault",
    recipe,
    layout: { ERC20: { x: 40, y: 80, pins: "left" } },
    deploy: { path: "factory", entropy: hex(1, 11), scope: "this-chain" },
    provenance: {},
    predicted: [],
  };
  const deployment: Deployment = {
    projectId: "p1",
    chainId: 11_155_111,
    address: addr(1),
    path: "factory",
    deployer: addr(2),
    salt: hex(3),
    status: "confirmed",
    recipeHash: analysis.recipeHash,
    catalogHash: catalog.hash,
    at: "2026-01-01T00:00:00.000Z",
    verification: "match",
    revision: 1,
  };

  test("names the file after the project, kebab-cased", () => {
    expect(exportProjectFile(project, [deployment]).filename).toBe("governed-vault.lattice.json");
  });

  test("falls back to untitled.lattice.json for an unnamed project", () => {
    expect(exportProjectFile({ ...project, name: "" }, []).filename).toBe("untitled.lattice.json");
  });

  test("round-trips through parseProjectFile", () => {
    const file = exportProjectFile(project, [deployment]);
    const parsed = parseProjectFile(JSON.parse(file.text), { catalogs: [catalog], source: "file", filename: file.filename });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.value.project.id).toBe("p1");
    expect(parsed.value.value.deployments).toHaveLength(1);
    expect(parsed.value.unknownFields).toEqual([]);
  });

  test("2-space indent, trailing newline, application/json", () => {
    const file = exportProjectFile(project, [deployment]);
    expect(file.mime).toBe("application/json");
    expect(file.text.endsWith("\n")).toBe(true);
    expect(file.text).toContain('{\n  "project"');
  });
});

describe("recipeJsonSchema", () => {
  const schema = recipeJsonSchema();

  test("is identified by RECIPE_SCHEMA_URL and titled", () => {
    expect(schema["$id"]).toBe(RECIPE_SCHEMA_URL);
    expect(typeof schema["title"]).toBe("string");
  });

  test("matches z.toJSONSchema's own shape (model/schema.test.ts pins this)", () => {
    expect(schema["type"]).toBe("object");
    expect(schema["required"]).toEqual(["schemaVersion", "catalog", "facets", "owners", "exclude", "init"]);
  });

  test("is deterministic and JSON-safe", () => {
    expect(JSON.stringify(recipeJsonSchema())).toBe(JSON.stringify(schema));
    expect(() => JSON.stringify(schema)).not.toThrow();
  });

  test("accepts a well-formed recipe and refuses obviously bad shapes", () => {
    const good = JSON.parse(exportRecipeJson(recipe, catalog).text);
    expect(schemaMatches(good, schema)).toBe(true);
    expect(schemaMatches({ ...good, schemaVersion: 2 }, schema)).toBe(false);
    expect(schemaMatches({ ...good, owners: { "not-a-selector": "ERC20" } }, schema)).toBe(false);
    expect(schemaMatches({ ...good, init: { kind: "later" } }, schema)).toBe(false);
    const { schemaVersion: _drop, ...missing } = good;
    expect(schemaMatches(missing, schema)).toBe(false);
  });
});

describe("exportBrief", () => {
  const brief = exportBrief({ recipe, catalog, analysis, studioVersion });

  test("names the file after the recipe", () => {
    expect(brief.filename).toBe("test-vault.brief.md");
    expect(brief.mime).toBe("text/markdown");
  });

  test("the header carries the recipe hash, catalog tag, each facet's pinned version and the Studio version", () => {
    expect(brief.text).toContain(`Recipe hash: \`${analysis.recipeHash}\``);
    expect(brief.text).toContain("Catalog: `test`");
    expect(brief.text).toContain(`Studio: ${studioVersion}`);
    expect(brief.text).toContain("DiamondLoupeFacet 0.4.0");
    expect(brief.text).toContain("AccessControl 0.4.0");
    expect(brief.text).toContain("ERC20 0.4.0");
  });

  test("embeds the exact recipe.json export", () => {
    expect(brief.text).toContain(exportRecipeJson(recipe, catalog).text.trimEnd());
  });

  test("every section the spec asks for is present, in order", () => {
    let cursor = -1;
    for (const heading of SECTION_HEADINGS) {
      const at = brief.text.indexOf(heading);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  test("the cut plan carries each entry's live formatted selectors (C10's formatSelector, not a pinned string)", () => {
    const { entries } = buildPlan(recipe, catalog, analysis.routing);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const facet = catalog.facets.find((f) => f.name === entry.facet);
      for (const selector of entry.selectors) {
        const found = facet?.selectors.find((s) => s.hex.toLowerCase() === selector.toLowerCase());
        expect(brief.text).toContain(formatSelector(found ?? { hex: selector, signature: selector }, "dense"));
      }
    }
  });

  test("the authority table carries each row's live via text (C4c's authorityTable, not a pinned string)", () => {
    const rows = authorityTable(recipe, catalog);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(brief.text).toContain(row.via);
  });

  test("the open problems section carries each problem's live rendered message (C3/C10, not a pinned string)", () => {
    expect(analysis.problems.length).toBeGreaterThan(0);
    for (const p of analysis.problems) expect(brief.text).toContain(p.message);
  });

  test("carries the acceptance-check command verbatim", () => {
    expect(brief.text).toContain('cast call <diamond> "facets()((address,bytes4[])[])" --rpc-url $RPC_URL');
  });

  test('says "Do not redeploy facets; check their codehashes." verbatim', () => {
    expect(brief.text).toContain("Do not redeploy facets; check their codehashes.");
  });

  test("says what it leaves out", () => {
    expect(brief.text).toContain("## What this leaves out");
    expect(brief.text).toContain("leaves out the project's layout");
  });

  test("is deterministic", () => {
    expect(exportBrief({ recipe, catalog, analysis, studioVersion }).text).toBe(brief.text);
  });

  test("falls back to Untitled diamond and untitled.brief.md without a name", () => {
    const { name: _name, ...rest } = recipe;
    const unnamed: Recipe = rest;
    const unnamedAnalysis = analyze(unnamed, catalog);
    const unnamedBrief = exportBrief({ recipe: unnamed, catalog, analysis: unnamedAnalysis, studioVersion });
    expect(unnamedBrief.filename).toBe("untitled.brief.md");
    expect(unnamedBrief.text.startsWith("# Untitled diamond agent brief")).toBe(true);
  });

  test("a hostile project name can't break the heading or a table cell", () => {
    const hostile = { ...recipe, name: 'A "quoted" | pipe `tick`\nnewline * bold_' };
    const hostileAnalysis = analyze(hostile, catalog);
    const hostileBrief = exportBrief({ recipe: hostile, catalog, analysis: hostileAnalysis, studioVersion });
    expect(hostileBrief.text.split("\n")[0]?.startsWith("# A \"quoted\" | pipe `tick` newline")).toBe(true);
    expect(hostileBrief.filename).not.toContain("/");
    expect(hostileBrief.filename).not.toContain("\n");
  });

  test("lintCopy finds nothing in the brief's prose", () => {
    expect(lintCopy(proseOnly(brief.text))).toEqual([]);
  });

  test("an init argument can't inject a Markdown heading, table row or fence (spec L21, L857)", () => {
    const stringArgCatalog: Catalog = makeCatalog({
      lattice: { tag: "test", commit: "0".repeat(40) },
      facets: [makeFacet({ name: "DiamondLoupeFacet", area: "diamond", selectors: ["facets()"] })],
      inits: [
        makeInit({
          name: "ERC20Init",
          contract: "ERC20Init",
          fn: "init(string)",
          kind: "step",
          params: [{ name: "name_", type: "string", doc: "Token name." }],
        }),
      ],
    });
    const injected = 'Evil\n## Injected heading\n\n| a | b |\n| --- | --- |\n```\nfenced\n```';
    const hostile: Recipe = makeRecipe(
      {
        name: "Hostile",
        facets: ["DiamondLoupeFacet"],
        init: { kind: "steps", steps: [{ spec: "ERC20Init", args: { name_: injected } }] },
      },
      stringArgCatalog,
    );
    const hostileAnalysis = analyze(hostile, stringArgCatalog);
    const hostileBrief = exportBrief({ recipe: hostile, catalog: stringArgCatalog, analysis: hostileAnalysis, studioVersion });
    const lines = hostileBrief.text.split("\n");
    expect(lines.some((line) => line.trim() === "## Injected heading")).toBe(false);
    // The whole value collapses to one line (newlines become spaces), so none of its pieces can land on a
    // line of their own: this is a stronger check than scanning for a bare "```" line, which the brief's own
    // legitimate fences (the embedded recipe JSON, the acceptance command) also produce.
    expect(hostileBrief.text).toContain("Evil ## Injected heading | a | b | | --- | --- | ``` fenced ```");
  });
});

describe("the brief's own fixed prose and structure (never another WP's copy)", () => {
  test("the section headings, in order", () => {
    expect(SECTION_HEADINGS).toMatchSnapshot();
  });

  test("the acceptance-checks text", () => {
    expect(acceptanceSection()).toMatchSnapshot();
  });

  test("the what-this-leaves-out text, with and without open blockers", () => {
    expect(leavesOutSection(0)).toMatchSnapshot();
    expect(leavesOutSection(3)).toMatchSnapshot();
  });
});

// ── the fixture catalog's real templates (K3), skipped cleanly until it exists ──────────────────────

const fixture = loadFixtureCatalog();

describe("against the fixture catalog's templates", () => {
  test.skipIf(!fixture.ok)("every loadable template's recipe.json round-trips, validates and lints clean", () => {
    if (!fixture.ok) return;
    const fixtureCatalog = fixture.value;
    const loadable = templateList(fixtureCatalog).filter((item) => item.loadable);
    expect(loadable.length).toBeGreaterThan(0);
    const schema = recipeJsonSchema();
    for (const item of [...loadable, { name: "Blank diamond" }]) {
      const loaded = item.name === "Blank diamond" ? { ok: true as const, value: blankDiamond(fixtureCatalog) } : loadTemplate(fixtureCatalog, item.name);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) continue;
      const templateAnalysis = analyze(loaded.value, fixtureCatalog);
      const file = exportRecipeJson(loaded.value, fixtureCatalog);
      const json = JSON.parse(file.text);
      expect(schemaMatches(json, schema)).toBe(true);
      const parsed = parseRecipe(json, { catalogs: [fixtureCatalog], source: "file", filename: file.filename });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(recipeHash(parsed.value.value, fixtureCatalog)).toBe(templateAnalysis.recipeHash);
      const brief = exportBrief({ recipe: loaded.value, catalog: fixtureCatalog, analysis: templateAnalysis, studioVersion });
      expect(lintCopy(proseOnly(brief.text))).toEqual([]);
    }
  });
});
