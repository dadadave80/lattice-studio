import { describe, expect, test } from "bun:test";
import type { ParseIssue, ParseOptions } from "../model/io";
import type { Deployment } from "../model/project";
import type { Result } from "../model/result";
import { makeProject } from "../testing";
import { recipeHash } from "./hash";
import { canonicalJson } from "./json";
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
    if (step) step.args["supply"] = 2 ** 60;
    const [issue] = issuesOf(parseRecipe(json, file));
    expect(issue?.path).toBe("init.steps[1].args.supply");
    expect(issue?.message).toContain("integers as decimal strings");
    expect(issue?.file).toBe("recipe.json");
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

  test("a catalog this build doesn't bundle: no name checks, catalog null, facets in input order", () => {
    const json = fromText(stepsRecipe({ catalog: { tag: "v0.4.1", hash: `0x${"cd".repeat(32)}` }, facets: ["ERC20X", "DiamondLoupeFacet"] }));
    const result = parseRecipe(json, file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.catalog).toBeNull();
    expect(result.value.value.facets).toEqual(["ERC20X", "DiamondLoupeFacet"]);
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
