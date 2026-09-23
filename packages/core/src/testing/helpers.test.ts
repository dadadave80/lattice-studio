import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { solidityString } from "../export/escape";
import { validateDeployment, validateProject, validateRecipe } from "../model/schema";
import { analyze } from "../analysis";
import { deploymentArb, projectArb, recipeArb } from "./arbitraries";
import { loadFixtureCatalog } from "./fixtures";
import { HOSTILE_NAMES, hostileString, wellFormed } from "./hostile";
import { formatJsonPath, jsonWith, mutationArb, pathsRelated, withExtraKey } from "./mutate";
import { checkProperty } from "./property";
import { lexSolidity, markdownOutline, overlappingPairs, solidityShape, solidityStringBytes, tableCells } from "./shape";
import { filledTemplate, loadableTemplates, mapStringArgs, stringArgPaths } from "./templates";

const fixture = loadFixtureCatalog();

describe("shape", () => {
  test("lexSolidity separates literals and comments from code, and refuses a literal that breaks its line", () => {
    const tokens = lexSolidity('string x = "a\\"b"; // c "d"\n/* e */ y;');
    expect(tokens.map((t) => t.kind)).toEqual(["code", "code", "code", "string", "code", "comment", "comment", "code", "code"]);
    expect(solidityShape('contract A { string s = "x"; }', { A: "<C>" })).toEqual(["contract", "<C>", "{", "string", "s", "=", "<string>", ";", "}"]);
    expect(() => lexSolidity('x = "a\nb";')).toThrow("line break inside a string literal");
    expect(() => lexSolidity("/* open")).toThrow("unterminated block comment");
  });

  test("solidityStringBytes reads back exactly the UTF-8 C7a's encoder writes, for any text", () => {
    checkProperty(
      "solidity literal round trip",
      fc.property(hostileString(), (text) => {
        const bytes = solidityStringBytes(solidityString(text));
        expect(Array.from(bytes ?? [])).toEqual(Array.from(new TextEncoder().encode(wellFormed(text))));
      }),
    );
    expect(solidityStringBytes('"\\q"')).toBeUndefined();
  });

  test("markdownOutline finds headings, tables and fences, and a fence closes only with its own kind", () => {
    const text = "# Title\n\n| a | b \\| c |\n| --- | --- |\n| 1 | 2 |\n\n````json\n```\n## not a heading\n````\n## Next";
    const outline = markdownOutline(text);
    expect(outline.headings).toEqual([[1, "Title"], [2, "Next"]]);
    expect(outline.tables).toEqual([{ line: 3, columns: 2, rows: [2] }]);
    expect(outline.codeBlocks).toEqual([{ line: 7, info: "json", body: "```\n## not a heading" }]);
    expect(outline.balanced).toBe(true);
    expect(markdownOutline("```\nopen").balanced).toBe(false);
    expect(markdownOutline("# a b").headings).toEqual([[1, "a b"]]);
    expect(tableCells("| a \\| b | c |")).toBe(2);
  });

  test("overlappingPairs ignores touching edges", () => {
    const rects = { A: { x: 0, y: 0, width: 10, height: 10 }, B: { x: 10, y: 0, width: 10, height: 10 }, C: { x: 5, y: 5, width: 10, height: 10 } };
    expect(overlappingPairs(rects)).toEqual(["A/C", "B/C"]);
  });
});

describe("mutate", () => {
  test("paths print the way parse errors do, and related paths nest either way below the root", () => {
    expect(formatJsonPath(["init", "steps", 0, "args", "admin"])).toBe("init.steps[0].args.admin");
    expect(formatJsonPath(["owners", "0xa9059cbb"])).toBe('owners["0xa9059cbb"]');
    expect(pathsRelated("facets[2]", "facets[2]")).toBe(true);
    expect(pathsRelated("init", "init.kind")).toBe(true);
    expect(pathsRelated("init.steps[0].args.admin", "init.steps")).toBe(true);
    expect(pathsRelated("", "facets[2]")).toBe(false);
    expect(pathsRelated("facets", "facetsX")).toBe(false);
  });

  test("jsonWith replaces or deletes one member without touching the input; withExtraKey writes the key first", () => {
    const doc = { a: [1, 2, 3], b: { c: "x" } };
    expect(jsonWith(doc, ["a", 1], undefined, true)).toEqual({ a: [1, 3], b: { c: "x" } });
    expect(jsonWith(doc, ["b", "c"], 5)).toEqual({ a: [1, 2, 3], b: { c: 5 } });
    expect(doc).toEqual({ a: [1, 2, 3], b: { c: "x" } });
    expect(withExtraKey(doc, ["b"], "__proto__", { p: 1 })).toBe('{"a":[1,2,3],"b":{"__proto__":{"p":1},"c":"x"}}');
  });

  test("a mutation always changes the document", () => {
    const doc = { a: [1, "two"], b: { c: null } };
    const text = JSON.stringify(doc, null, 2);
    for (const mutation of fc.sample(mutationArb(doc), { seed: 1, numRuns: 100 })) expect(mutation.text).not.toBe(text);
  });
});

describe.skipIf(!fixture.ok)("arbitraries and templates on the fixture catalog", () => {
  const catalog = fixture.ok ? fixture.value : undefined;

  test("generated recipes, projects and deployment records pass the schemas", () => {
    if (catalog === undefined) return;
    checkProperty(
      "arbitraries are schema-valid",
      fc.property(projectArb(catalog), deploymentArb("p"), (project, deployment) => {
        const recipe = validateRecipe(project.recipe);
        expect(recipe.ok || JSON.stringify(recipe.error)).toBe(true);
        const checked = validateProject(project);
        expect(checked.ok || JSON.stringify(checked.error)).toBe(true);
        expect(validateDeployment(deployment).ok).toBe(true);
      }),
    );
    for (const recipe of fc.sample(recipeArb(catalog), { seed: 2, numRuns: 20 })) expect(recipe.catalog.hash).toBe(catalog.hash);
  });

  test("filled templates have every argument, so nothing blocks on a missing one", () => {
    if (catalog === undefined) return;
    const names = loadableTemplates(catalog);
    expect(names).toContain("GovernedVault");
    for (const name of names) {
      const recipe = filledTemplate(catalog, name);
      if (!recipe.ok) throw new Error(recipe.error);
      expect([name, analyze(recipe.value, catalog).problems.filter((p) => p.code === "INIT-01").map((p) => p.id)]).toEqual([name, []]);
    }
    expect(filledTemplate(catalog, "NoSuchTemplate").ok).toBe(false);
  });

  test("mapStringArgs reaches tuple components and step arguments by path", () => {
    if (catalog === undefined) return;
    const vault = filledTemplate(catalog, "GovernedVault");
    const token = filledTemplate(catalog, "ERC20");
    if (!vault.ok || !token.ok) throw new Error("templates missing");
    expect(stringArgPaths(vault.value, catalog)).toEqual(["bundle.p.name", "bundle.p.symbol"]);
    expect(stringArgPaths(token.value, catalog)).toEqual(["steps[0].name_", "steps[0].symbol_"]);
    const renamed = mapStringArgs(token.value, catalog, (path) => path);
    expect(renamed.init.kind === "steps" && renamed.init.steps[0]?.args).toEqual({ name_: "steps[0].name_", symbol_: "steps[0].symbol_" });
    expect(HOSTILE_NAMES.length).toBeGreaterThan(5);
  });
});
