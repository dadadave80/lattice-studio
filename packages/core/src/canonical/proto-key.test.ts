// FX8: a `"__proto__"` key anywhere in untrusted JSON is refused at its path before the schema runs, and
// normalization keeps one that gets past the boundary as an own property instead of dropping it or letting it
// replace a copy's prototype.
import { describe, expect, test } from "bun:test";
import { lintCopy } from "../format/copy-lint";
import type { ParseIssue, ParseOptions } from "../model/io";
import type { Recipe } from "../model/recipe";
import type { Result } from "../model/result";
import { makeProject } from "../testing";
import { canonicalJson } from "./json";
import { migrate } from "./migrate";
import { normalizeRecipe } from "./normalize";
import { formatParseIssue, parseProject, parseProjectFile, parseRecipe } from "./parse";
import { findProtoKey, PROTO_KEY_MESSAGE } from "./proto-key";
import { bundleRecipe, catalog, PROTO_VALUE, stepsRecipe, withProtoKey } from "./test-support";

const recipeFile: ParseOptions = { catalogs: [catalog], source: "file", filename: "recipe.json" };
const projectFileOpts: ParseOptions = { catalogs: [catalog], source: "file", filename: "vault.lattice.json" };

function issuesOf<T>(result: Result<T, ParseIssue[]>): string[] {
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.error.map(formatParseIssue);
}

function projectFileOf(recipe: Recipe): unknown {
  return {
    project: makeProject({ recipe, layout: { AccessControl: { x: 0, y: 0, pins: "right" } } }),
    deployments: [],
  };
}

describe("findProtoKey", () => {
  test("finds the key at any depth, in objects and lists, and names its own path", () => {
    expect(findProtoKey(withProtoKey({ a: 1 }, []))).toEqual(["__proto__"]);
    expect(findProtoKey(withProtoKey({ a: [{ b: {} }] }, ["a", 0, "b"]))).toEqual(["a", 0, "b", "__proto__"]);
    expect(findProtoKey({ a: [{ b: "__proto__" }], constructor: 1, prototype: 2 })).toBeNull();
    expect(findProtoKey(null)).toBeNull();
    expect(findProtoKey("__proto__")).toBeNull();
  });

  test("a key buried past the JSON depth limit never overflows the stack", () => {
    let deep: unknown = withProtoKey({}, []);
    for (let i = 0; i < 100_000; i++) deep = [deep];
    expect(() => findProtoKey(deep)).not.toThrow();
  });

  test("the message passes the copy rules", () => {
    expect(lintCopy(PROTO_KEY_MESSAGE)).toEqual([]);
  });
});

describe("parse refuses a __proto__ key with its path", () => {
  const recipeCases: [string, (string | number)[], Recipe][] = [
    ["__proto__", [], stepsRecipe()],
    ["owners.__proto__", ["owners"], stepsRecipe()],
    ["init.args.p.__proto__", ["init", "args", "p"], bundleRecipe()],
    ["init.steps[1].args.__proto__", ["init", "steps", 1, "args"], stepsRecipe()],
  ];

  for (const [path, at, recipe] of recipeCases) {
    test(`recipe.json: ${path}`, () => {
      expect(issuesOf(parseRecipe(withProtoKey(recipe, at), recipeFile))).toEqual([`recipe.json: ${path} ${PROTO_KEY_MESSAGE}`]);
    });
  }

  test("a share-link payload names the path without a file", () => {
    const json = withProtoKey(stepsRecipe(), ["owners"]);
    expect(issuesOf(parseRecipe(json, { catalogs: [catalog], source: "link" }))).toEqual([`owners.__proto__ ${PROTO_KEY_MESSAGE}`]);
  });

  const fileCases: [string, (string | number)[]][] = [
    ["__proto__", []],
    ["project.layout.__proto__", ["project", "layout"]],
    ["project.recipe.owners.__proto__", ["project", "recipe", "owners"]],
    ["project.recipe.init.args.p.__proto__", ["project", "recipe", "init", "args", "p"]],
  ];

  for (const [path, at] of fileCases) {
    test(`project file: ${path}`, () => {
      const json = withProtoKey(projectFileOf(bundleRecipe()), at);
      expect(issuesOf(parseProjectFile(json, projectFileOpts))).toEqual([`vault.lattice.json: ${path} ${PROTO_KEY_MESSAGE}`]);
    });
  }

  test("a stored project (autosave) is refused the same way", () => {
    const json = withProtoKey(makeProject({ recipe: stepsRecipe() }), ["layout"]);
    expect(issuesOf(parseProject(json, { catalogs: [catalog], source: "db" }))).toEqual([`layout.__proto__ ${PROTO_KEY_MESSAGE}`]);
  });

  test("the same documents without the key still parse", () => {
    expect(parseRecipe(JSON.parse(JSON.stringify(bundleRecipe())), recipeFile).ok).toBe(true);
    expect(parseProjectFile(JSON.parse(JSON.stringify(projectFileOf(bundleRecipe()))), projectFileOpts).ok).toBe(true);
  });

  test("keys that only look like it (constructor, prototype) are ordinary unknown fields", () => {
    const json = JSON.parse(JSON.stringify({ ...stepsRecipe(), constructor: "x", prototype: { a: 1 } })) as unknown;
    const result = parseRecipe(json, recipeFile);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.unknownFields).toEqual(["constructor", "prototype"]);
  });
});

describe("migrate refuses a __proto__ key with its path", () => {
  test("in a recipe, a project and a project file", () => {
    expect(migrate(withProtoKey(stepsRecipe(), ["owners"]))).toEqual({
      ok: false,
      error: `This file has a reserved field name at owners.__proto__. Remove the field and try again.`,
    });
    expect(migrate(withProtoKey({ recipe: stepsRecipe() }, []))).toEqual({
      ok: false,
      error: `This file has a reserved field name at __proto__. Remove the field and try again.`,
    });
    const file = migrate(withProtoKey(projectFileOf(stepsRecipe()), ["project", "recipe", "init", "steps", 0, "args"]));
    expect(file.ok ? "" : file.error).toContain("project.recipe.init.steps[0].args.__proto__");
  });
});

describe("normalize keeps a __proto__ key that gets past the boundary", () => {
  function argsOf(recipe: Recipe): Record<string, unknown> {
    if (recipe.init.kind !== "bundle") throw new Error("expected a bundle");
    return recipe.init.args;
  }

  test("an object value stays an own property and never becomes the copy's prototype", () => {
    const input = withProtoKey(bundleRecipe(), ["init", "args", "p"]) as Recipe;
    const out = normalizeRecipe(input, catalog);
    const p = argsOf(out)["p"] as Record<string, unknown>;
    expect(Object.getPrototypeOf(p)).toBe(Object.prototype);
    expect(Object.hasOwn(p, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(p, "__proto__")?.value).toEqual(PROTO_VALUE);
    expect("polluted" in p).toBe(false);
    expect(canonicalJson(p)).toContain('"__proto__":{"polluted":true}');
  });

  test("a string value is kept, not dropped (FX5 saw {\"__proto__\":\"\\\"\"} come back as {})", () => {
    const input = withProtoKey(bundleRecipe(), ["init", "args"], '"') as Recipe;
    const args = argsOf(normalizeRecipe(input, catalog));
    expect(Object.getOwnPropertyDescriptor(args, "__proto__")?.value).toBe('"');
    expect(Object.getPrototypeOf(args)).toBe(Object.prototype);
  });

  test("in an argument with no catalog type, in owners and as an unknown top-level field", () => {
    const untyped = withProtoKey(stepsRecipe(), ["init", "steps", 1, "args"]) as Recipe;
    const step = normalizeRecipe(untyped, null).init;
    expect(step.kind === "steps" && Object.hasOwn(step.steps[1]?.args ?? {}, "__proto__")).toBe(true);
    const owners = normalizeRecipe(withProtoKey(stepsRecipe(), ["owners"], "ERC20") as Recipe, catalog).owners;
    expect(Object.getOwnPropertyDescriptor(owners, "__proto__")?.value).toBe("ERC20");
    const top = normalizeRecipe(withProtoKey(stepsRecipe(), []) as Recipe, catalog);
    expect(Object.getPrototypeOf(top)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(top, "__proto__")?.value).toEqual(PROTO_VALUE);
  });

  test("normalizing twice is still the identity with the key in place", () => {
    const once = normalizeRecipe(withProtoKey(bundleRecipe(), ["init", "args", "p"]) as Recipe, catalog);
    expect(canonicalJson(normalizeRecipe(once, catalog))).toBe(canonicalJson(once));
  });
});
