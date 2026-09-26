/**
 * Hostile names never break out of generated strings (spec L21, L857, L859, L936). Every template that exports
 * as it is, with a hostile project name, recipe name, every `string` init argument and (for some cases) a
 * scalar init argument replaced by a hostile-keyed object, exports through C7a (Solidity), C7b (Markdown
 * brief, recipe.json, project file) and C7c (Safe batch). Each output must have exactly the structure of the
 * same export with plain text, and each hostile value must arrive intact where it's data; a hostile-keyed
 * object, which no valid ABI type accepts, must make Solidity and Safe-batch export refuse cleanly rather
 * than encode something wrong. Nothing here pins another WP's copy: structure is compared with the plain run
 * of the same functions.
 */
import { describe, expect, test, setDefaultTimeout } from "bun:test";

// Real catalogs and real Foundry builds take seconds each, and more under a loaded machine (the merge gate).
setDefaultTimeout(60_000);
import fc from "fast-check";
import {
  analyze, exportBrief, exportFoundry, exportProjectFile, exportRecipeJson, exportSafeBatch, type Analysis, type Catalog,
  type Project, type Recipe,
} from "../../src";
import {
  addr, checkProperty, exportableTemplates, fitText, hex, hostileKey, hostileNonEmptyString, hostileString, isPrintableAscii,
  keyedArg, lexSolidity, loadableTemplates, makeProject, mapStringArgs, markdownOutline, markdownProse, propertyCatalogs,
  scalarArgPaths, solidityShape, solidityStringBytes, stringArgPaths, wellFormed, type MarkdownOutline,
} from "../../src/testing";
import { escapedLine, oneLine } from "../../src/export/docs/markdown";

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

/** `catalog.chains`' ids, or Anvil's default when the catalog carries none. */
function chainIdsOf(catalog: Catalog): number[] {
  return catalog.chains.length > 0 ? catalog.chains.map((chain) => chain.chainId) : [31337];
}

function foundryResult(catalog: Catalog, c: Case) {
  return exportFoundry({ project: c.project, catalog, analysis: c.analysis, studioVersion: STUDIO, chainIds: chainIdsOf(catalog) });
}

function foundryOf(catalog: Catalog, c: Case) {
  const out = foundryResult(catalog, c);
  if (!out.ok) throw new Error(`exportFoundry refused: ${out.error}`);
  return out.value;
}

function safeResult(catalog: Catalog, c: Case) {
  return exportSafeBatch({
    recipe: c.recipe, catalog, safe: SAFE, chainId: catalog.chains[0]?.chainId ?? 31337, entropy: c.project.deploy.entropy,
    scope: "every-chain", path: "factory", now: 1_700_000_000_000, studioVersion: STUDIO, context: ctx,
  });
}

function safeOf(catalog: Catalog, c: Case) {
  const out = safeResult(catalog, c);
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

/** `key` is the hostile field key when `keyed`, so the brief property can look for its escaped form (FX8). */
type HostileCase = { base: Recipe; name: string; strings: readonly string[]; keyed: boolean; key: string; c: Case };

for (const catalog of catalogs) {
  describe(`hostile names on catalog ${catalog.lattice.tag}`, () => {
    const fixture = catalog.lattice.tag === "fixture";
    const templates = exportableTemplates(catalog);
    const plain = new Map(templates.map((recipe) => [recipe, caseOf(catalog, recipe, "Plain", () => "Plain")]));
    /**
     * Built lazily: `fc.constantFrom` on an empty list throws, and a catalog may have no exportable template.
     * About half the cases also replace one scalar init argument with a hostile-keyed object (`keyed: true`):
     * a share link or file can put one there (model/schema.ts's `ArgSchema` only forbids the literal `"$ref"`
     * key), and `describeArg` (export/docs/brief.ts) renders its key as prose. A case with no scalar argument
     * to replace (an empty init) stays unkeyed.
     */
    const hostileCase = (): fc.Arbitrary<HostileCase> =>
      fc
        .tuple(
          fc.constantFrom(...templates),
          hostileString(),
          fc.array(hostileNonEmptyString(), { minLength: 12, maxLength: 12 }),
          fc.boolean(),
          // FX8: `__proto__`, `constructor` and `prototype` too; exports must keep them as own keys.
          hostileKey(8, { prototypeKeys: true }),
        )
        .chain(([base, name, strings, wantKeyed, key]) => {
          const built = caseOf(catalog, base, name, (i) => strings[i % strings.length] ?? "x");
          const paths = scalarArgPaths(built.recipe, catalog);
          if (!wantKeyed || paths.length === 0) return fc.constant<HostileCase>({ base, name, strings, keyed: false, key, c: built });
          return fc.constantFrom(...paths).map((path): HostileCase => {
            const recipe = keyedArg(built.recipe, catalog, path, key);
            const c: Case = { recipe, project: { ...built.project, recipe }, analysis: analyze(recipe, catalog, ctx) };
            return { base, name, strings, keyed: true, key, c };
          });
        });

    test("the templates to export: on the fixture, every loadable one, and some carry string arguments", () => {
      if (fixture) {
        expect(templates.length).toBe(loadableTemplates(catalog).length);
        expect(templates.some((recipe) => stringArgPaths(recipe, catalog).length > 0)).toBe(true);
      }
      for (const c of plain.values()) expect(c.analysis.problems.filter((p) => p.severity === "blocker").map((p) => p.id)).toEqual([]);
    });

    test.skipIf(templates.length === 0)("Solidity: a hostile name or argument changes only string literals and comments, each argument arrives intact, and a hostile-keyed object is refused, not encoded", () => {
      let keyedRuns = 0;
      const outcome = checkProperty(
        `${catalog.lattice.tag}: hostile Solidity`,
        fc.property(hostileCase(), ({ base, keyed, c }) => {
          if (keyed) {
            keyedRuns++;
            // No ABI type accepts an object where it expects a scalar; C4b's encoder refuses it by name,
            // so Solidity export never runs on a value it hasn't validated.
            expect(foundryResult(catalog, c).ok).toBe(false);
            return;
          }
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
      if (fixture) {
        expect(outcome.skipped).toBeLessThan(outcome.runs / 10);
        // Not vacuous: every fixture template has a scalar leaf, so about half of hostileCase()'s fc.boolean()
        // draws a keyed case; a floor well under that catches scalarArgPaths (or the coin) going quiet.
        expect(keyedRuns).toBeGreaterThan(outcome.runs / 4);
      }
    });

    // FX5: replaces FX3's `test.todo`. A hostile name, string argument or object-arg field key (`<img src=x
    // onerror=alert(1)>`, `<script>`, `&lt;`, `[x](javascript:alert(1))` among the pieces `hostileString` and
    // `hostileKey` draw from) must render as text: the brief's heading/table/fence outline stays the plain
    // brief's, the embedded recipe.json block is exactly `exportRecipeJson`'s text, and no raw `<` or `>`
    // (spec L21, L857: "every generated string is escaped") survives outside a fence or an inline code span.
    test.skipIf(templates.length === 0)("Markdown brief: headings, tables and fences are the plain brief's, its recipe.json block is the export, and hostile text never opens a raw HTML tag", () => {
      let keyedRuns = 0;
      const outcome = checkProperty(
        `${catalog.lattice.tag}: hostile Markdown`,
        fc.property(hostileCase(), ({ base, keyed, key, c }) => {
          const reference = markdownOutline(exportBrief({ ...(plain.get(base) as Case), catalog, studioVersion: STUDIO }).text);
          const brief = exportBrief({ recipe: c.recipe, catalog, analysis: c.analysis, studioVersion: STUDIO });
          expect(brief.filename).not.toMatch(/[/\\\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
          const outline = markdownOutline(brief.text);
          expect(structure(outline)).toEqual(structure(reference));
          for (const table of outline.tables) for (const row of table.rows) expect(row).toBe(table.columns);
          const json = outline.codeBlocks.find((block) => block.info === "json");
          expect(JSON.parse(json?.body ?? "null") as unknown).toEqual(JSON.parse(exportRecipeJson(c.recipe, catalog).text) as unknown);
          expect(markdownProse(brief.text)).not.toMatch(/[<>]/);
          if (keyed) {
            keyedRuns++;
            // FX8: the hostile key itself is in the brief's prose, escaped exactly as a value is, every time;
            // a regression that escapes values but not keys fails on any key with a character to escape, not
            // only on draws whose raw `<` or `>` happen to reach markdownProse.
            const prose = brief.text.replace(json?.body ?? "", "");
            // A key that collapses to nothing (only whitespace or line breaks) leaves nothing to look for.
            if (oneLine(key) !== "") expect([key, prose.includes(`${escapedLine(key)}: `)]).toEqual([key, true]);
          }
        }),
      );
      // Not vacuous: makes sure the hostile-keyed object case (a scalar field holding one) actually reaches
      // describeArg's object branch, not just the string-leaf case escapeHtml already covered before FX5.
      if (fixture) expect(keyedRuns).toBeGreaterThan(outcome.runs / 4);
    });

    test.skipIf(templates.length === 0)("JSON: recipe.json, the project file and the Safe batch parse, carry the text exactly, keep one-line fields plain, and refuse a hostile-keyed object cleanly", () => {
      let keyedRuns = 0;
      const outcome = checkProperty(
        `${catalog.lattice.tag}: hostile JSON`,
        fc.property(hostileCase(), ({ base, name, keyed, c }) => {
          const recipeJson = JSON.parse(exportRecipeJson(c.recipe, catalog).text) as Recipe;
          // A name that isn't well-formed UTF-16 may come out repaired (U+FFFD) once parsing refuses lone surrogates.
          expect([name, wellFormed(name)]).toContain(recipeJson.name ?? "");
          expect(recipeJson.init).toEqual(c.recipe.init);
          const projectFile = exportProjectFile(c.project, []);
          expect(projectFile.filename).not.toMatch(/[/\\\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
          expect((JSON.parse(projectFile.text) as { project: Project }).project).toEqual(c.project);
          if (keyed) {
            keyedRuns++;
            // Same refusal as Solidity: the Safe batch also encodes the init through C4b, so a hostile-keyed
            // object never reaches a transaction. recipe.json and the project file above still carry it,
            // because they store the recipe as data and never encode it.
            expect(safeResult(catalog, c).ok).toBe(false);
            return;
          }
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
      if (fixture) {
        expect(outcome.skipped).toBeLessThan(outcome.runs / 10);
        expect(keyedRuns).toBeGreaterThan(outcome.runs / 4);
      }
    });
  });
}

type SafeFile = { meta: { name: string; description?: string }; transactions: { to: string; value: string }[] };
