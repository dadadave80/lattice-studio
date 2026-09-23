import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { solidityString } from "../export/escape";
import { validateDeployment, validateProject, validateRecipe } from "../model/schema";
import { analyze } from "../analysis";
import { deploymentArb, projectArb, recipeArb } from "./arbitraries";
import { loadBuiltCatalog, loadFixtureCatalog, propertyCatalogs } from "./fixtures";
import { HOSTILE_NAMES, hostileKey, hostileString, wellFormed } from "./hostile";
import { formatJsonPath, jsonKind, jsonWith, mutationArb, pathsRelated, retyped, stringSites, withBrokenString, withExtraKey } from "./mutate";
import { checkProperty } from "./property";
import { lexSolidity, markdownOutline, markdownProse, overlappingPairs, solidityShape, solidityStringBytes, tableCells } from "./shape";
import {
  exportableTemplates, fillFor, filledTemplate, fitText, keyedArg, loadableTemplates, mapStringArgs, offlineRule, scalarArgPaths,
  stringArgPaths,
} from "./templates";

describe("rules", () => {
  test("offlineRule reads every term of the grammar, tightening bounds; code() is a chain rule", () => {
    expect(offlineRule("range(0,100)&gt(3)&gte(2)&nonzero&maxlen(8)&maxlen(5)&code(safe)&enum(a|b)")).toEqual({
      min: 4n, max: 100n, nonzero: true, maxlen: 5, options: ["a", "b"],
    });
    expect(offlineRule(undefined)).toEqual({});
    expect(offlineRule("bogus(&range(x,1)")).toEqual({});
  });

  test("fillFor meets each rule for its type", () => {
    expect(fillFor({ type: "uint256", rule: "gte(1)" })).toBe("1");
    expect(fillFor({ type: "uint256", rule: "gt(9)" })).toBe("10");
    expect(fillFor({ type: "uint8", rule: "range(0,0)" })).toBe("0");
    expect(fillFor({ type: "uint32", rule: "range(5,7)&nonzero" })).toBe("5");
    expect(fillFor({ type: "int8", rule: "range(-5,-2)" })).toBe("-2");
    expect(fillFor({ type: "uint8", rule: "enum(3|4)" })).toBe("3");
    expect(fillFor({ type: "string", rule: "enum(alpha|beta)" })).toBe("alpha");
    expect(fillFor({ type: "string", rule: "maxlen(0)" })).toBe("");
    expect(fillFor({ type: "address", rule: "nonzero&code(safe)" })).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(fillFor({ type: "bytes4" })).toBe("0x01010101");
    expect(fillFor({ type: "address[]" })).toEqual([]);
    expect(fillFor({ type: "tuple", components: [{ name: "n", type: "uint8", doc: "", rule: "gt(1)" }] })).toEqual({ n: "2" });
  });

  test("fitText cuts to maxlen by whole code points, or takes the first enum option", () => {
    expect(fitText("🦊🦊🦊", "maxlen(2)")).toBe("🦊🦊");
    expect(fitText("anything", "enum(x|y)")).toBe("x");
    expect(fitText("kept", undefined)).toBe("kept");
  });

  test("hostileKey never draws the literal \"$ref\"; PROTOTYPE_KEYS are drawn by default, excluded only when asked", () => {
    const withDefaults = fc.sample(hostileKey(), { seed: 4, numRuns: 500 });
    for (const key of withDefaults) expect(key).not.toBe("$ref");
    expect(withDefaults).toEqual(expect.arrayContaining(["__proto__", "constructor", "prototype"]));

    for (const key of fc.sample(hostileKey(8, { prototypeKeys: false }), { seed: 4, numRuns: 500 })) {
      expect(key).not.toBe("$ref");
      expect(key).not.toBe("__proto__");
      expect(key).not.toBe("constructor");
      expect(key).not.toBe("prototype");
    }
  });
});

const fixture = loadFixtureCatalog();

describe("catalog loaders", () => {
  test("the built catalog loads when it's there, or says why; property suites always get the fixture", () => {
    const built = loadBuiltCatalog();
    if (built.ok) expect(built.value.lattice.tag).not.toBe("fixture");
    else expect(built.error).toMatch(/catalog\//);
    const catalogs = propertyCatalogs();
    expect(catalogs[0]?.lattice.tag).toBe("fixture");
    expect(catalogs.length).toBe(built.ok ? 2 : 1);
  });
});

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

  test("markdownProse drops fenced bodies and inline code, leaving only what a viewer reads as text", () => {
    const text = "# <Title>\n\nSee `<code>` here.\n\n```html\n<script>\n```\n\nAnd `` ` `` a lone backtick span.";
    expect(markdownProse(text)).toBe("# <Title>\n\nSee  here.\n\n\nAnd  a lone backtick span.");
    expect(markdownProse("plain")).toBe("plain");
  });

  test("markdownProse doesn't pair a backslash-escaped backtick with a later real span, so a stray < between them stays visible", () => {
    const text = "x\\`<leak `real` y";
    const prose = markdownProse(text);
    expect(prose).toContain("<leak");
    expect(prose).not.toContain("real");
  });

  test("markdownProse tells an escaped backslash from an escaping one: two backslashes before a backtick leave it a real, unescaped opener", () => {
    // x\\`real`<leak \`y: "\\" (an escaped backslash) then an unescaped "`" opens a real span around "real";
    // "<leak " is plain text; the trailing "\`" is one backslash escaping that backtick, so it stays literal.
    // A regex that only checks one preceding character misreads the real opener as escaped (it sees the
    // second of the two backslashes) and instead pairs the real closer with the trailing escaped backtick,
    // stripping "<leak" along with it.
    const text = "x\\\\`real`<leak \\`y";
    const prose = markdownProse(text);
    expect(prose).toContain("<leak");
    expect(prose).not.toContain("real");
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

  test("a top-level container like a project file's `project` never counts as a precise enclosing path", () => {
    expect(pathsRelated("project", "project.recipe.facets[0]")).toBe(true);
    expect(pathsRelated("project", "project.recipe.facets[0]", ["project"])).toBe(false);
    expect(pathsRelated("project.recipe", "project.recipe.facets[0]", ["project"])).toBe(true);
    expect(pathsRelated("project", "project", ["project"])).toBe(true);
  });

  test("retyped gives another JSON kind: objects also become arrays and null", () => {
    const kinds = (value: unknown) => new Set(fc.sample(retyped(value), { seed: 3, numRuns: 200 }).map(jsonKind));
    expect(kinds({ a: 1 })).toEqual(new Set(["null", "array", "number", "boolean", "string"]));
    expect(kinds([1]).has("array")).toBe(false);
    expect(kinds(null).has("null")).toBe(false);
    expect(kinds("x").has("string")).toBe(true);
  });

  test("stringSites lists values and keys; withBrokenString splices into one and names where a parser should point", () => {
    const doc = { name: "ab", owners: { "0xa9059cbb": "ERC20" } };
    expect(stringSites(doc)).toEqual([
      { kind: "key", path: [], key: "name" },
      { kind: "key", path: [], key: "owners" },
      { kind: "value", path: ["name"] },
      { kind: "key", path: ["owners"], key: "0xa9059cbb" },
      { kind: "value", path: ["owners", "0xa9059cbb"] },
    ]);
    expect(withBrokenString(doc, { kind: "value", path: ["name"] }, 1, "\ud800")).toEqual({ document: { name: "a\ud800b", owners: doc.owners }, path: ["name"] });
    const key = withBrokenString(doc, { kind: "key", path: ["owners"], key: "0xa9059cbb" }, 99, "\udc00");
    expect(key).toEqual({ document: { name: "ab", owners: { "0xa9059cbb\udc00": "ERC20" } }, path: ["owners"] });
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
    expect(exportableTemplates(catalog).map((recipe) => recipe.template?.name)).toEqual(names);
    expect(exportableTemplates({ ...catalog, recipes: [] })).toEqual([]);
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

  test("scalarArgPaths finds every scalar leaf (not just string), and keyedArg wraps one in a hostile-keyed object", () => {
    if (catalog === undefined) return;
    const vault = filledTemplate(catalog, "GovernedVault");
    if (!vault.ok) throw new Error("GovernedVault missing");
    const paths = scalarArgPaths(vault.value, catalog);
    // Every field of GovernedVaultInit's tuple `p` is a scalar leaf; `asset` (address) and `decimalsOffset`
    // (uint8) prove this reaches beyond the `string`-typed leaves `stringArgPaths` finds.
    expect(paths).toContain("bundle.p.asset");
    expect(paths).toContain("bundle.p.decimalsOffset");
    expect(paths).toEqual(expect.arrayContaining(stringArgPaths(vault.value, catalog)));
    const keyed = keyedArg(vault.value, catalog, "bundle.p.asset", "__inject__");
    expect(keyed.init.kind === "bundle" && (keyed.init.args["p"] as { asset?: unknown } | undefined)?.asset).toEqual({
      __inject__: vault.value.init.kind === "bundle" ? (vault.value.init.args["p"] as { asset?: unknown })?.asset : undefined,
    });
    // A path `scalarArgPaths` doesn't have, or a tuple's own path, leaves the recipe unchanged.
    expect(keyedArg(vault.value, catalog, "no.such.path", "k")).toEqual(vault.value);
    expect(keyedArg(vault.value, catalog, "bundle.p", "k")).toEqual(vault.value);
  });
});
