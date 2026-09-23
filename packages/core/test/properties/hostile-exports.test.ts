/**
 * Hostile names never break out of generated strings (spec L21, L857, L859, L936). Every template that exports
 * as it is, with a hostile project name, recipe name and every `string` init argument, exports through C7a
 * (Solidity), C7b (Markdown brief, recipe.json, project file) and C7c (Safe batch). Each output must have exactly
 * the structure of the same export with plain text, and each hostile value must arrive intact where it's data.
 * Nothing here pins another WP's copy: structure is compared with the plain run of the same functions.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  analyze, exportBrief, exportFoundry, exportProjectFile, exportRecipeJson, exportSafeBatch, type Analysis, type Catalog,
  type Project, type Recipe,
} from "../../src";
import {
  addr, checkProperty, exportableTemplates, fitText, hex, hostileNonEmptyString, hostileString, isPrintableAscii, lexSolidity,
  loadableTemplates, makeProject, mapStringArgs, markdownOutline, propertyCatalogs, solidityShape, solidityStringBytes,
  stringArgPaths, wellFormed, type MarkdownOutline,
} from "../../src/testing";

const catalogs = propertyCatalogs();
const ctx = { known: [], unconfirmed: [] };
const STUDIO = "0.1.0";
const SAFE = addr(0x5afe);
/** Characters that must never reach a one-line field of a Safe batch: controls, format (bidi), line separators. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

type Case = { recipe: Recipe; project: Project; analysis: Analysis };

/** `base` with this name and every string argument from `strings`, cut to the parameter's `maxlen` or `enum`. */
function caseOf(catalog: Catalog, base: Recipe, name: string, strings: (i: number) => string): Case {
  let i = 0;
  const recipe = { ...mapStringArgs(base, catalog, (_path, _value, param) => fitText(strings(i++), param.rule)), name };
  const project = makeProject({ name, recipe, deploy: { path: "factory", entropy: hex(0xc12, 11), scope: "every-chain" } });
  return { recipe, project, analysis: analyze(recipe, catalog, ctx) };
}

function foundryOf(catalog: Catalog, c: Case) {
  const chainIds = catalog.chains.length > 0 ? catalog.chains.map((chain) => chain.chainId) : [31337];
  const out = exportFoundry({ project: c.project, catalog, analysis: c.analysis, studioVersion: STUDIO, chainIds });
  if (!out.ok) throw new Error(`exportFoundry refused: ${out.error}`);
  return out.value;
}

function safeOf(catalog: Catalog, c: Case) {
  const out = exportSafeBatch({
    recipe: c.recipe, catalog, safe: SAFE, chainId: catalog.chains[0]?.chainId ?? 31337, entropy: c.project.deploy.entropy,
    scope: "every-chain", path: "factory", now: 1_700_000_000_000, studioVersion: STUDIO, context: ctx,
  });
  if (!out.ok) throw new Error(`exportSafeBatch refused: ${out.error}`);
  return out.value;
}

/** The outline without the h1's text, which holds the name. */
function structure(outline: MarkdownOutline) {
  return {
    headings: outline.headings.map(([level, text], i) => (i === 0 ? [level] : [level, text])),
    tables: outline.tables.map((table) => [table.columns, ...table.rows]),
    blocks: outline.codeBlocks.map((block) => block.info),
    balanced: outline.balanced,
  };
}

function bytesOf(text: string): string {
  return Array.from(new TextEncoder().encode(text)).join(",");
}

for (const catalog of catalogs) {
  describe(`hostile names on catalog ${catalog.lattice.tag}`, () => {
    const fixture = catalog.lattice.tag === "fixture";
    const templates = exportableTemplates(catalog);
    const plain = new Map(templates.map((recipe) => [recipe, caseOf(catalog, recipe, "Plain", () => "Plain")]));
    /** Built lazily: `fc.constantFrom` on an empty list throws, and a catalog may have no exportable template. */
    const hostileCase = () =>
      fc
        .tuple(fc.constantFrom(...templates), hostileString(), fc.array(hostileNonEmptyString(), { minLength: 12, maxLength: 12 }))
        .map(([base, name, strings]) => ({ base, name, strings, c: caseOf(catalog, base, name, (i) => strings[i % strings.length] ?? "x") }));

    test("the templates to export: on the fixture, every loadable one, and some carry string arguments", () => {
      if (fixture) {
        expect(templates.length).toBe(loadableTemplates(catalog).length);
        expect(templates.some((recipe) => stringArgPaths(recipe, catalog).length > 0)).toBe(true);
      }
      for (const c of plain.values()) expect(c.analysis.problems.filter((p) => p.severity === "blocker").map((p) => p.id)).toEqual([]);
    });

    test.skipIf(templates.length === 0)("Solidity: a hostile name or argument changes only string literals and comments, and each argument arrives intact", () => {
      const outcome = checkProperty(
        `${catalog.lattice.tag}: hostile Solidity`,
        fc.property(hostileCase(), ({ base, c }) => {
          fc.pre(c.analysis.problems.every((p) => p.severity !== "blocker"));
          const plainCase = plain.get(base) as Case;
          const reference = foundryOf(catalog, plainCase);
          const file = foundryOf(catalog, c);
          const contract = file.filename.replace(/\.s\.sol$/, "");
          expect(contract).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
          const plainContract = reference.filename.replace(/\.s\.sol$/, "");
          // The arguments are hashed, so the recipe hash constant is the one code token allowed to differ.
          expect(solidityShape(file.text, { [contract]: "<Contract>", [c.analysis.recipeHash]: "<recipeHash>" })).toEqual(
            solidityShape(reference.text, { [plainContract]: "<Contract>", [plainCase.analysis.recipeHash]: "<recipeHash>" }),
          );
          // Every literal or comment the hostile text reached is printable ASCII on one line (no bidi, no breaks).
          const tokens = lexSolidity(file.text);
          const plainTokens = lexSolidity(reference.text);
          tokens.forEach((token, i) => {
            if (token.kind !== "code" && token.text !== plainTokens[i]?.text) expect([token.text, isPrintableAscii(token.text)]).toEqual([token.text, true]);
          });
          const literals = new Set(tokens.filter((t) => t.kind === "string").map((t) => Array.from(solidityStringBytes(t.text) ?? []).join(",")));
          mapStringArgs(c.recipe, catalog, (path, value) => {
            expect([path, literals.has(bytesOf(wellFormed(value)))]).toEqual([path, true]);
            return value;
          });
        }),
      );
      // On the fixture no hostile text is refused; a real catalog's rules may refuse some, and those runs skip.
      if (fixture) expect(outcome.skipped).toBeLessThan(outcome.runs / 10);
    });

    test.skipIf(templates.length === 0)("Markdown brief: headings, tables and fences are the plain brief's, and its recipe.json block is the export", () => {
      checkProperty(
        `${catalog.lattice.tag}: hostile Markdown`,
        fc.property(hostileCase(), ({ base, c }) => {
          const reference = markdownOutline(exportBrief({ ...(plain.get(base) as Case), catalog, studioVersion: STUDIO }).text);
          const brief = exportBrief({ recipe: c.recipe, catalog, analysis: c.analysis, studioVersion: STUDIO });
          expect(brief.filename).not.toMatch(/[/\\\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
          const outline = markdownOutline(brief.text);
          expect(structure(outline)).toEqual(structure(reference));
          for (const table of outline.tables) for (const row of table.rows) expect(row).toBe(table.columns);
          const json = outline.codeBlocks.find((block) => block.info === "json");
          expect(JSON.parse(json?.body ?? "null") as unknown).toEqual(JSON.parse(exportRecipeJson(c.recipe, catalog).text) as unknown);
        }),
      );
    });

    // Known gap, recorded until FX3 lands: the brief writes names and arguments into Markdown unescaped, so raw
    // HTML and links (`<img src=x onerror=alert(1)>`, `<script>`, `[x](javascript:alert(1))`) render as HTML or a
    // live link in a Markdown viewer. Structure can't break (the property above), but spec L857 renders names as
    // text. Once FX3 escapes them, assert that no hostile `<`, `>` or `](javascript:` survives outside code.
    test.todo("FX3: the brief escapes HTML and javascript: links in names and arguments", () => undefined);

    test.skipIf(templates.length === 0)("JSON: recipe.json, the project file and the Safe batch parse, carry the text exactly, and keep one-line fields plain", () => {
      const outcome = checkProperty(
        `${catalog.lattice.tag}: hostile JSON`,
        fc.property(hostileCase(), ({ base, name, c }) => {
          const recipeJson = JSON.parse(exportRecipeJson(c.recipe, catalog).text) as Recipe;
          // A name that isn't well-formed UTF-16 may come out repaired (U+FFFD) once parsing refuses lone surrogates.
          expect([name, wellFormed(name)]).toContain(recipeJson.name ?? "");
          expect(recipeJson.init).toEqual(c.recipe.init);
          const projectFile = exportProjectFile(c.project, []);
          expect(projectFile.filename).not.toMatch(/[/\\\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
          expect((JSON.parse(projectFile.text) as { project: Project }).project).toEqual(c.project);
          fc.pre(c.analysis.problems.every((p) => p.severity !== "blocker"));
          const batch = safeOf(catalog, c);
          const reference = JSON.parse(safeOf(catalog, plain.get(base) as Case).text) as SafeFile;
          const file = JSON.parse(batch.text) as SafeFile;
          expect(batch.filename).not.toMatch(/[/\\\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
          expect(HIDDEN.test(file.meta.name)).toBe(false);
          for (const line of (file.meta.description ?? "").split("\n")) expect([line, HIDDEN.test(line)]).toEqual([line, false]);
          expect((file.meta.description ?? "").split("\n").length).toBe((reference.meta.description ?? "").split("\n").length);
          expect(file.transactions.map((t) => [t.to, t.value])).toEqual(reference.transactions.map((t) => [t.to, t.value]));
        }),
      );
      if (fixture) expect(outcome.skipped).toBeLessThan(outcome.runs / 10);
    });
  });
}

type SafeFile = { meta: { name: string; description?: string }; transactions: { to: string; value: string }[] };
