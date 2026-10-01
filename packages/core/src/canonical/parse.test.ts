import { describe, expect, test } from "bun:test";
import { analyze } from "../analysis";
import { withCore } from "../diamond/repair";
import { exportRecipeJson } from "../export/docs/recipe-json";
import { lintCopy } from "../format/copy-lint";
import type { Catalog } from "../model/catalog";
import { CORE_FACETS } from "../model/diamond";
import type { ParseIssue, ParseOptions } from "../model/io";
import type { Deployment } from "../model/project";
import type { Recipe } from "../model/recipe";
import type { Result } from "../model/result";
import { blankDiamond, loadTemplate, templateList } from "../plan";
import { decodeShareLink, encodeShareLink, importFile } from "../share";
import { loadFixtureCatalog, makeCatalog, makeFacet, makeProject, makeRecipe } from "../testing";
import { recipeHash } from "./hash";
import { canonicalJson } from "./json";
import { normalizeRecipe } from "./normalize";
import { formatParseIssue, parseProject, parseProjectFile, parseRecipe } from "./parse";
import { ADMIN, ADMIN_LOWER, MAX_UINT256, catalog, stepsRecipe } from "./test-support";

const file: ParseOptions = { catalogs: [catalog], source: "file", filename: "recipe.json" };

/** A recipe as a file holds it: JSON text, parsed. */
function fromText(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, null, 2));
}

function issuesOf<T>(result: Result<T, ParseIssue[]>): ParseIssue[] {
  if (result.ok) throw new Error("expected issues");
  return result.error;
}

describe("parseRecipe", () => {
  test("validates, normalizes and names the catalog it pins", () => {
    const json = fromText(stepsRecipe({ facets: ["ERC20", "DiamondLoupeFacet", "AccessControl", "ERC20Votes"], owners: { "0xA9059CBB": "ERC20Votes" } }));
    const result = parseRecipe(json, file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value.facets).toEqual(["DiamondLoupeFacet", "AccessControl", "ERC20", "ERC20Votes"]);
    expect(result.value.value.owners).toEqual({ "0xa9059cbb": "ERC20Votes" });
    expect(result.value.catalog).toBe(catalog);
    expect(result.value.unknownFields).toEqual([]);
    expect("migratedFrom" in result.value).toBe(false);
  });

  test("finds the catalog by hash in any letter case", () => {
    const json = fromText(stepsRecipe({ catalog: { tag: "v0.4.0", hash: catalog.hash.replace(/[a-f]/g, (c) => c.toUpperCase()) as `0x${string}` } }));
    const result = parseRecipe(json, file);
    expect(result.ok && result.value.catalog).toBe(catalog);
    expect(result.ok && result.value.value.catalog.hash).toBe(catalog.hash);
  });

  test("integers above 2^53 survive parse, hash and export as exact strings", () => {
    const text = JSON.stringify(stepsRecipe(), null, 2);
    expect(text).toContain(`"supply": "${MAX_UINT256}"`);
    const result = parseRecipe(JSON.parse(text), file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { init } = result.value.value;
    expect(init.kind === "steps" && init.steps[1]?.args["supply"]).toBe(MAX_UINT256);
    expect(recipeHash(result.value.value)).toBe(recipeHash(stepsRecipe(), catalog));
    const exported = canonicalJson(result.value.value);
    expect(exported).toContain(`"supply":"${MAX_UINT256}"`);
    const reparsed = parseRecipe(JSON.parse(exported), file);
    expect(reparsed.ok && recipeHash(reparsed.value.value)).toBe(recipeHash(result.value.value));
  });

  test("an integer written as a JSON number is refused, since it may already have been rounded", () => {
    const json = fromText(stepsRecipe());
    const recipe = json as { init: { steps: { args: Record<string, unknown> }[] } };
    const step = recipe.init.steps[1];
    for (const value of [2 ** 60, 16]) {
      if (step) step.args["supply"] = value;
      const [issue] = issuesOf(parseRecipe(json, file));
      expect(issue?.path).toBe("init.steps[1].args.supply");
      expect(issue?.message).toBe(
        `is ${value}; expected text (integers as decimal strings), true or false, a list, an object or {"$ref": "self" | "deployer"}.`,
      );
      expect(issue?.file).toBe("recipe.json");
    }
  });

  test("a recipe opens with the same value and hash whether or not its catalog is bundled", () => {
    // On a catalog with both core facets, a recipe carrying both: the core repair changes nothing either way.
    const full = makeCatalog({ ...catalog, facets: [...catalog.facets, makeFacet({ name: "ERC165Facet", area: "diamond", selectors: ["supportsInterface(bytes4)"] })] });
    const recipe = stepsRecipe({
      facets: ["DiamondLoupeFacet", "ERC165Facet", "AccessControl", "ERC20", "ERC20Votes"],
      init: {
        kind: "steps",
        steps: [
          { spec: "AccessControlInit", args: { admin: ADMIN_LOWER } },
          { spec: "LabelInit", args: { label: "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01", code: `0x${"AB".repeat(20)}`, keeper: ADMIN } },
        ],
      },
    });
    const normalized = normalizeRecipe(recipe, full);
    const { init } = normalized;
    expect(init.kind === "steps" && init.steps[1]?.args).toEqual({
      label: "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01",
      code: `0x${"ab".repeat(20)}`,
      keeper: ADMIN,
    });
    const bundled = parseRecipe(fromText(normalized), { ...file, catalogs: [full] });
    const unbundled = parseRecipe(fromText(normalized), { catalogs: [], source: "link" });
    expect(bundled.ok && unbundled.ok).toBe(true);
    if (!bundled.ok || !unbundled.ok) return;
    expect(unbundled.value.catalog).toBeNull();
    expect(unbundled.value.value).toEqual(normalized);
    expect(bundled.value.value).toEqual(normalized);
    expect(recipeHash(unbundled.value.value)).toBe(recipeHash(recipe, full));
    expect(recipeHash(bundled.value.value)).toBe(recipeHash(recipe, full));
  });

  test("owner keys that differ only in case must agree on the facet", () => {
    const conflict = fromText(stepsRecipe({ owners: { "0xA9059CBB": "ERC20", "0xa9059cbb": "ERC20Votes" } }));
    expect(issuesOf(parseRecipe(conflict, file)).map(formatParseIssue)).toEqual([
      'recipe.json: owners["0xA9059CBB"] routes 0xa9059cbb to ERC20, but owners["0xa9059cbb"] routes it to ERC20Votes. Choose one owner.',
    ]);
    const unbundled = issuesOf(parseRecipe(conflict, { catalogs: [], source: "link" }));
    expect(unbundled.map((found) => found.path)).toEqual(['owners["0xA9059CBB"]']);
    const agreeing = parseRecipe(fromText(stepsRecipe({ owners: { "0xA9059CBB": "ERC20Votes", "0xa9059cbb": "ERC20Votes" } })), file);
    expect(agreeing.ok && agreeing.value.value.owners).toEqual({ "0xa9059cbb": "ERC20Votes" });
  });

  test("unknown fields round-trip, are listed and stay out of the hash", () => {
    const json = {
      ...(fromText(stepsRecipe()) as Record<string, unknown>),
      comment: "hand-edited",
      catalog: { tag: "v0.4.0", hash: catalog.hash, mirror: "ipfs://x" },
    };
    const result = parseRecipe(json, file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unknownFields).toEqual(["catalog.mirror", "comment"]);
    const value = result.value.value as unknown as Record<string, unknown>;
    expect(value["comment"]).toBe("hand-edited");
    expect(value["catalog"]).toEqual({ tag: "v0.4.0", hash: catalog.hash, mirror: "ipfs://x" });
    const exported = JSON.parse(canonicalJson(value)) as Record<string, unknown>;
    expect(exported["comment"]).toBe("hand-edited");
    const again = parseRecipe(exported, file);
    expect(again.ok && again.value.unknownFields).toEqual(["catalog.mirror", "comment"]);
    expect(recipeHash(result.value.value)).toBe(recipeHash(stepsRecipe(), catalog));
  });

  test("unknown fields inside init and its steps are listed too", () => {
    const steps = fromText(stepsRecipe()) as { init: { steps: Record<string, unknown>[] } } & Record<string, unknown>;
    (steps.init as Record<string, unknown>)["note"] = "x";
    const first = steps.init.steps[0];
    if (first) first["why"] = 1;
    const result = parseRecipe(steps, file);
    expect(result.ok && result.value.unknownFields).toEqual(["init.steps[0].why", "init.note"]);
    const none = parseRecipe({ ...(fromText(stepsRecipe()) as Record<string, unknown>), init: { kind: "none", note: "x" } }, file);
    expect(none.ok && none.value.unknownFields).toEqual(["init.note"]);
  });

  test("a facet the named catalog lacks reads like spec L501", () => {
    const json = fromText(stepsRecipe({ facets: ["DiamondLoupeFacet", "AccessControl", "ERC20", "ERC20X"] }));
    const issues = issuesOf(parseRecipe(json, file));
    expect(issues).toEqual([{ path: "facets[3]", message: "‘ERC20X’ isn't in Lattice 0.4.0.", file: "recipe.json" }]);
    expect(issues.map(formatParseIssue)).toEqual(["recipe.json: facets[3] ‘ERC20X’ isn't in Lattice 0.4.0."]);
  });

  test("init specs the catalog lacks are named too, every one", () => {
    const json = fromText(
      stepsRecipe({
        facets: ["Nope", "DiamondLoupeFacet"],
        init: { kind: "steps", steps: [{ spec: "AccessControlInit", args: {} }, { spec: "GhostInit", args: {} }] },
      }),
    );
    expect(issuesOf(parseRecipe(json, file)).map(formatParseIssue)).toEqual([
      "recipe.json: facets[0] ‘Nope’ isn't in Lattice 0.4.0.",
      "recipe.json: init.steps[1].spec ‘GhostInit’ isn't in Lattice 0.4.0.",
    ]);
    const bundle = fromText(stepsRecipe({ init: { kind: "bundle", spec: "GhostInit", args: {} } }));
    expect(issuesOf(parseRecipe(bundle, file)).map(formatParseIssue)).toEqual(["recipe.json: init.spec ‘GhostInit’ isn't in Lattice 0.4.0."]);
  });

  test("owners naming an unplaced facet parse; that's SEL-05's to report", () => {
    const json = fromText(stepsRecipe({ owners: { "0xa9059cbb": "GovernedVault" } }));
    expect(parseRecipe(json, file).ok).toBe(true);
  });

  test("a catalog this build doesn't bundle: no name checks, catalog null, facets in input order, the missing core appended", () => {
    const json = fromText(stepsRecipe({ catalog: { tag: "v0.4.1", hash: `0x${"cd".repeat(32)}` }, facets: ["ERC20X", "DiamondLoupeFacet"] }));
    const result = parseRecipe(json, file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.catalog).toBeNull();
    // Without a catalog there's no order to insert by, so the core facet the recipe lacks goes last.
    expect(result.value.value.facets).toEqual(["ERC20X", "DiamondLoupeFacet", "ERC165Facet"]);
    const { init } = result.value.value;
    expect(init.kind === "steps" && init.steps[1]?.args["supply"]).toBe(MAX_UINT256);
  });

  test("a newer schema is refused with the version it needs", () => {
    const json = { ...(fromText(stepsRecipe()) as Record<string, unknown>), schemaVersion: 2 };
    const issues = issuesOf(parseRecipe(json, file));
    expect(issues).toEqual([{ path: "", message: "This file needs Studio schema v2. This Studio reads v1.", file: "recipe.json" }]);
    expect(formatParseIssue(issues[0] as ParseIssue)).toBe("recipe.json: This file needs Studio schema v2. This Studio reads v1.");
    const link = issuesOf(parseRecipe(json, { catalogs: [catalog], source: "link" }));
    expect(link.map(formatParseIssue)).toEqual(["This link needs Studio schema v2. This Studio reads v1."]);
  });

  test("schema issues carry the file and render as `file: path message`", () => {
    const json = { ...(fromText(stepsRecipe()) as Record<string, unknown>), facets: [1], exclude: ["0x1234"] };
    expect(issuesOf(parseRecipe(json, file)).map(formatParseIssue)).toEqual([
      "recipe.json: facets[0] is 1; expected text.",
      'recipe.json: exclude[0] is "0x1234"; expected a 4-byte selector (0x followed by 8 hex digits).',
    ]);
  });

  test("an input that isn't a recipe at all says so about the whole file", () => {
    expect(issuesOf(parseRecipe([], file)).map(formatParseIssue)).toEqual(["recipe.json: This file is a list; expected an object."]);
    expect(issuesOf(parseRecipe(null, { catalogs: [], source: "link" })).map(formatParseIssue)).toEqual([
      "This link is null; expected an object.",
    ]);
  });

  test("a missing schemaVersion is a schema issue, not a migration", () => {
    const { schemaVersion: _ignored, ...rest } = stepsRecipe();
    expect(issuesOf(parseRecipe(rest, file)).map(formatParseIssue)).toEqual(["recipe.json: schemaVersion is missing."]);
  });

  test("JSON nested past the depth limit is refused, not recursed into", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 200; i++) deep = [deep];
    const json = { ...(fromText(stepsRecipe()) as Record<string, unknown>), extra: deep };
    const [issue] = issuesOf(parseRecipe(json, file));
    expect(issue?.message).toBe("nests deeper than 64 levels.");
  });

  test("never throws, whatever it's given", () => {
    for (const json of [undefined, 0, "recipe", true, {}, { schemaVersion: 1 }, { schemaVersion: 99 }, Symbol.iterator]) {
      expect(() => parseRecipe(json, file)).not.toThrow();
      expect(parseRecipe(json, file).ok).toBe(false);
    }
  });
});

describe("parseProject", () => {
  const project = makeProject({
    recipe: stepsRecipe({ facets: ["ERC20", "DiamondLoupeFacet"] }),
    deploy: { path: "factory", entropy: `0x${"AB".repeat(11)}`, scope: "every-chain" },
    predicted: [{ chainId: 11155111, address: ADMIN_LOWER }],
  });

  test("normalizes the recipe inside, the entropy and predicted addresses", () => {
    const result = parseProject(fromText(project), { catalogs: [catalog], source: "db" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value.recipe.facets).toEqual(["DiamondLoupeFacet", "ERC20"]);
    expect(result.value.value.deploy.entropy).toBe(`0x${"ab".repeat(11)}`);
    expect(result.value.value.predicted).toEqual([{ chainId: 11155111, address: ADMIN }]);
    expect(result.value.catalog).toBe(catalog);
  });

  test("paths inside the recipe start with `recipe.`", () => {
    const json = fromText({ ...project, recipe: stepsRecipe({ facets: ["ERC20X"] }) });
    expect(issuesOf(parseProject(json, { catalogs: [catalog], source: "file", filename: "vault.lattice.json" })).map(formatParseIssue)).toEqual([
      "vault.lattice.json: recipe.facets[0] ‘ERC20X’ isn't in Lattice 0.4.0.",
    ]);
  });

  test("a newer recipe inside a stored project is refused, naming the project", () => {
    const json = fromText({ ...project, recipe: { ...stepsRecipe(), schemaVersion: 3 } });
    expect(issuesOf(parseProject(json, { catalogs: [catalog], source: "db" })).map(formatParseIssue)).toEqual([
      "This project needs Studio schema v3. This Studio reads v1.",
    ]);
  });

  test("lists unknown fields with their paths", () => {
    const json = { ...(fromText(project) as Record<string, unknown>), color: "teal" };
    const result = parseProject(json, { catalogs: [catalog], source: "db" });
    expect(result.ok && result.value.unknownFields).toEqual(["color"]);
    expect(result.ok && (result.value.value as unknown as Record<string, unknown>)["color"]).toBe("teal");
  });
});

describe("parseProjectFile", () => {
  const deployment: Deployment = {
    projectId: "test-project",
    chainId: 11155111,
    address: ADMIN_LOWER,
    path: "factory",
    deployer: ADMIN_LOWER,
    salt: `0x${"AB".repeat(32)}`,
    status: "confirmed",
    tx: `0x${"CD".repeat(32)}`,
    recipeHash: `0x${"EF".repeat(32)}`,
    catalogHash: catalog.hash,
    at: "2026-09-23T10:00:00.000Z",
    verification: "match",
    revision: 1,
  };
  const projectFile = { project: makeProject({ recipe: stepsRecipe() }), deployments: [deployment] };
  const opts: ParseOptions = { catalogs: [catalog], source: "file", filename: "governed-vault.lattice.json" };

  test("normalizes deployment records: addresses EIP-55, hex lowercase", () => {
    const result = parseProjectFile(fromText(projectFile), opts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value.deployments).toEqual([
      {
        ...deployment,
        address: ADMIN,
        deployer: ADMIN,
        salt: `0x${"ab".repeat(32)}`,
        tx: `0x${"cd".repeat(32)}`,
        recipeHash: `0x${"ef".repeat(32)}`,
      },
    ]);
    expect(result.value.value.project.recipe).toEqual(stepsRecipe());
  });

  test("paths start with `project.recipe.`; a newer file is refused as the brief words it", () => {
    const bad = fromText({ ...projectFile, project: { ...projectFile.project, recipe: stepsRecipe({ facets: ["DiamondLoupeFacet", "ERC20X"] }) } });
    expect(issuesOf(parseProjectFile(bad, opts)).map(formatParseIssue)).toEqual([
      "governed-vault.lattice.json: project.recipe.facets[1] ‘ERC20X’ isn't in Lattice 0.4.0.",
    ]);
    const newer = fromText({ ...projectFile, project: { ...projectFile.project, recipe: { ...stepsRecipe(), schemaVersion: 2 } } });
    expect(issuesOf(parseProjectFile(newer, opts)).map(formatParseIssue)).toEqual([
      "governed-vault.lattice.json: This file needs Studio schema v2. This Studio reads v1.",
    ]);
  });

  test("schema issues in deployment records carry their path", () => {
    const bad = fromText({ ...projectFile, deployments: [{ ...deployment, chainId: -1 }] });
    const [issue] = issuesOf(parseProjectFile(bad, opts));
    expect(issue?.path).toBe("deployments[0].chainId");
    expect(issue?.file).toBe("governed-vault.lattice.json");
  });
});

describe("formatParseIssue", () => {
  test("file, then path, then message; each only when present", () => {
    expect(formatParseIssue({ path: "facets[3]", message: "‘ERC20X’ isn't in Lattice 0.4.0.", file: "recipe.json" })).toBe(
      "recipe.json: facets[3] ‘ERC20X’ isn't in Lattice 0.4.0.",
    );
    expect(formatParseIssue({ path: "facets[3]", message: "is 1; expected text." })).toBe("facets[3] is 1; expected text.");
    expect(formatParseIssue({ path: "", message: "This link is null; expected an object." })).toBe("This link is null; expected an object.");
  });
});

// FX2: a lone surrogate anywhere in the input is refused with a ParseIssue, never a throw from canonicalJson
// later (spec L936). C8's share-link decode runs the decoded payload through parseRecipe with source "link",
// so exercising that source here covers it without reaching into C8's files.
describe("lone surrogates", () => {
  const MESSAGE = "has a broken character. Fix the text and try again.";

  function withArgName(name: string): unknown {
    const json = fromText(stepsRecipe());
    const recipe = json as { init: { steps: { args: Record<string, unknown> }[] } };
    const step = recipe.init.steps[1];
    if (step) step.args["name"] = name;
    return json;
  }

  test("a lone high surrogate in a recipe value is refused at its path, never thrown", () => {
    const json = withArgName("Vault\ud800Share");
    expect(() => parseRecipe(json, file)).not.toThrow();
    const issues = issuesOf(parseRecipe(json, file));
    expect(issues).toEqual([{ path: "init.steps[1].args.name", message: MESSAGE, file: "recipe.json" }]);
    expect(lintCopy(MESSAGE)).toEqual([]);
  });

  test("a lone low surrogate is refused the same way", () => {
    const json = withArgName("Vault\udc00Share");
    expect(() => parseRecipe(json, file)).not.toThrow();
    const [issue] = issuesOf(parseRecipe(json, file));
    expect(issue?.path).toBe("init.steps[1].args.name");
    expect(issue?.message).toBe(MESSAGE);
  });

  test("a lone surrogate in an object key is refused at the key's parent path", () => {
    const json = fromText(stepsRecipe());
    const recipe = json as { init: { steps: { args: Record<string, unknown> }[] } };
    const step = recipe.init.steps[1];
    if (step) step.args["\ud800bad"] = "x";
    expect(() => parseRecipe(json, file)).not.toThrow();
    const [issue] = issuesOf(parseRecipe(json, file));
    expect(issue?.path).toBe("init.steps[1].args");
    expect(issue?.message).toBe(MESSAGE);
  });

  test("a project file with a lone surrogate in a deployment field is refused, never thrown", () => {
    const projectFile = { project: makeProject({ recipe: stepsRecipe() }), deployments: [] as unknown[] };
    const json = fromText(projectFile) as { project: { recipe: { init: { steps: { args: Record<string, unknown> }[] } } } };
    const step = json.project.recipe.init.steps[1];
    if (step) step.args["name"] = "Vault\ud800Share";
    const opts: ParseOptions = { catalogs: [catalog], source: "file", filename: "governed-vault.lattice.json" };
    expect(() => parseProjectFile(json, opts)).not.toThrow();
    const [issue] = issuesOf(parseProjectFile(json, opts));
    expect(issue?.path).toBe("project.recipe.init.steps[1].args.name");
    expect(issue?.file).toBe("governed-vault.lattice.json");
    expect(issue?.message).toBe(MESSAGE);
  });

  test("a share-link payload with a lone surrogate is refused, never thrown (C8's decodeShareLink path)", () => {
    const json = withArgName("Vault\udc00Share");
    const opts: ParseOptions = { catalogs: [catalog], source: "link" };
    expect(() => parseRecipe(json, opts)).not.toThrow();
    expect(issuesOf(parseRecipe(json, opts)).map(formatParseIssue)).toEqual([`init.steps[1].args.name ${MESSAGE}`]);
  });

  test("a surrogate buried past the JSON depth limit never overflows the stack", () => {
    let deep: unknown = "\ud800";
    for (let i = 0; i < 100_000; i++) deep = [deep];
    expect(() => parseRecipe(deep, file)).not.toThrow();
    expect(parseRecipe(deep, file).ok).toBe(false);
  });

  test("a valid surrogate pair (an emoji) still parses and hashes", () => {
    const json = withArgName("🎉Vault");
    const result = parseRecipe(json, file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value.init.kind === "steps" && result.value.value.init.steps[1]?.args["name"]).toBe("🎉Vault");
    expect(() => recipeHash(result.value.value)).not.toThrow();
    expect(() => canonicalJson(result.value.value)).not.toThrow();
  });
});

describe("the core repair", () => {
  const fixture = loadFixtureCatalog();
  const on: Catalog = fixture.ok ? fixture.value : catalog;
  const opts: ParseOptions = { catalogs: [on], source: "file", filename: "recipe.json" };
  const ctx = { known: [], unconfirmed: [] };

  /** A recipe on the fixture catalog, as a file holds it; the empty step plan keeps the automatic introspection step. */
  function fileOf(recipe: Partial<Recipe>): unknown {
    return fromText(makeRecipe({ init: { kind: "steps", steps: [] }, ...recipe }, on));
  }

  test.skipIf(!fixture.ok)("a recipe missing the core gains it in catalog order, and CORE-01 and CORE-05 don't fire", () => {
    const result = parseRecipe(fileOf({ facets: ["Receive", "ERC20"] }), opts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value.facets).toEqual(["ERC20", "Receive", "DiamondLoupeFacet", "ERC165Facet"]);
    const codes = analyze(result.value.value, on, ctx).problems.map((p) => p.code);
    expect(codes.filter((code) => code === "CORE-01" || code === "CORE-05")).toEqual([]);
  });

  test.skipIf(!fixture.ok)("each core facet alone gets the other back beside it", () => {
    for (const kept of CORE_FACETS) {
      const result = parseRecipe(fileOf({ facets: [kept, "ERC20"] }), opts);
      expect(result.ok && result.value.value.facets).toEqual(["ERC20", "DiamondLoupeFacet", "ERC165Facet"]);
    }
  });

  test.skipIf(!fixture.ok)("a project's layout loses the core's entries, as a stored project and as a project file", () => {
    const project = makeProject({
      recipe: makeRecipe({ facets: ["ERC20", ...CORE_FACETS], init: { kind: "steps", steps: [] } }, on),
      layout: {
        ERC20: { x: 0, y: 0, pins: "right" },
        DiamondLoupeFacet: { x: 400, y: 0, pins: "right" },
        ERC165Facet: { x: 800, y: 0, pins: "left", expanded: true },
      },
    });
    const stored = parseProject(fromText(project), { catalogs: [on], source: "db" });
    expect(stored.ok && stored.value.value.layout).toEqual({ ERC20: { x: 0, y: 0, pins: "right" } });
    const asFile = parseProjectFile(fromText({ project, deployments: [] }), opts);
    expect(asFile.ok && asFile.value.value.project.layout).toEqual({ ERC20: { x: 0, y: 0, pins: "right" } });
    // Autosave reads projects back with no catalogs at all (persist/records.ts): the same repair, appended.
    const unbundled = parseProject(fromText({ ...project, recipe: { ...project.recipe, facets: ["ERC20"] } }), { catalogs: [], source: "db" });
    expect(unbundled.ok && unbundled.value.value.recipe.facets).toEqual(["ERC20", "DiamondLoupeFacet", "ERC165Facet"]);
    expect(unbundled.ok && Object.keys(unbundled.value.value.layout)).toEqual(["ERC20"]);
  });

  test.skipIf(!fixture.ok)("every loadable template and the Blank diamond already carry the core: the repair is the identity, so their hashes don't move", () => {
    const names = templateList(on).filter((item) => item.loadable).map((item) => item.name);
    expect(names.length).toBeGreaterThan(0);
    const recipes = names.map((name) => {
      const loaded = loadTemplate(on, name);
      if (!loaded.ok) throw new Error(loaded.error);
      return loaded.value;
    });
    recipes.push(blankDiamond(on));
    for (const recipe of recipes) {
      expect(withCore(recipe, on)).toBe(recipe);
      const parsed = parseRecipe(fromText(recipe), opts);
      expect(parsed.ok && parsed.value.value).toEqual(recipe);
      expect(parsed.ok && recipeHash(parsed.value.value)).toBe(recipeHash(recipe, on));
    }
  });

  test.skipIf(!fixture.ok)("a share link and an imported file both come back with the core", () => {
    const recipe = makeRecipe({ facets: ["ERC20"], init: { kind: "steps", steps: [] } }, on);
    const link = decodeShareLink(encodeShareLink(recipe).fragment, [on]);
    expect(link.ok && link.value.recipe.facets).toEqual(["ERC20", "DiamondLoupeFacet", "ERC165Facet"]);
    const exported = exportRecipeJson(recipe, on);
    const imported = importFile(exported.text, exported.filename, [on]);
    expect(imported.ok && imported.value.kind === "recipe" && imported.value.recipe.facets).toEqual(["ERC20", "DiamondLoupeFacet", "ERC165Facet"]);
  });
});
