/**
 * Export then import is the identity (spec L283-L291, L932) for recipe.json, share links and `.lattice.json`
 * project files, with hostile names and `string` arguments throughout. What import deliberately changes is
 * checked as such: a project file's provenance becomes "file" for every literal argument and its deployment
 * records come back `fromFile` (spec L857).
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  canonicalJson, decodeShareLink, encodeShareLink, exportProjectFile, exportRecipeJson, importFile, normalizeRecipe,
  parseProjectFile, parseRecipe, recipeHash, type ParseIssue, type Recipe,
} from "../../src";
import { deflateSync, strToU8 } from "fflate";
import {
  checkProperty, deploymentArb, formatJsonPath, hostileString, projectArb, propertyCatalogs, recipeArb, stringSites, wellFormed,
  withBrokenString,
} from "../../src/testing";

/** A share link carrying `text` as its payload, as C8 writes it: deflate-raw, then base64url. */
function linkOf(text: string): string {
  return `#s=1.${Buffer.from(deflateSync(strToU8(text))).toString("base64url")}`;
}

const catalogs = propertyCatalogs();

function withoutSchema(recipe: Recipe): Recipe {
  const { $schema: _schema, ...rest } = recipe;
  return rest;
}

for (const catalog of catalogs) {
  describe(`round trips on catalog ${catalog.lattice.tag}`, () => {
    test("recipe.json: export, import and export again give the same recipe, hash and bytes", () => {
      checkProperty(
        `${catalog.lattice.tag}: recipe.json round trip`,
        fc.property(recipeArb(catalog), (recipe) => {
          const file = exportRecipeJson(recipe, catalog);
          const imported = importFile(file.text, file.filename, [catalog]);
          if (!imported.ok) throw new Error(JSON.stringify(imported.error));
          if (imported.value.kind !== "recipe") throw new Error(`recipe.json opened as a ${imported.value.kind}`);
          expect(imported.value.recipe).toEqual(JSON.parse(file.text) as Recipe);
          expect(withoutSchema(imported.value.recipe)).toEqual(withoutSchema(normalizeRecipe(recipe, catalog)));
          expect(imported.value.recipe.name).toBe(recipe.name);
          expect(imported.value.unknownFields).toEqual([]);
          expect(recipeHash(imported.value.recipe, catalog)).toBe(recipeHash(recipe, catalog));
          expect(exportRecipeJson(imported.value.recipe, catalog).text).toBe(file.text);
          const parsed = parseRecipe(JSON.parse(file.text), { catalogs: [catalog], source: "file" });
          expect(parsed.ok && parsed.value.value).toEqual(imported.value.recipe);
        }),
      );
    });

    test("share link: decode(encode(recipe)) is the normalized recipe without $schema, and a normalized link is a fixed point", () => {
      checkProperty(
        `${catalog.lattice.tag}: share link round trip`,
        fc.property(recipeArb(catalog), fc.webUrl(), (recipe, schema) => {
          const link = encodeShareLink({ ...recipe, $schema: schema });
          expect(link.fragment.startsWith("#s=1.")).toBe(true);
          expect(link.length).toBe(link.fragment.length);
          const decoded = decodeShareLink(link.fragment, [catalog]);
          if (!decoded.ok) throw new Error(JSON.stringify(decoded.error));
          expect(decoded.value.recipe).toEqual(withoutSchema(normalizeRecipe(recipe, catalog)));
          expect(decoded.value.hash).toBe(recipeHash(recipe, catalog));
          expect(decoded.value.catalog).toBe(catalog);
          // The link carries the recipe as given (no catalog to normalize against); a normalized recipe's link
          // is a fixed point of decode then encode.
          const again = encodeShareLink(decoded.value.recipe).fragment;
          expect(again).toBe(encodeShareLink(withoutSchema(normalizeRecipe(recipe, catalog))).fragment);
          const redecoded = decodeShareLink(again, [catalog]);
          expect(redecoded.ok && redecoded.value.recipe).toEqual(decoded.value.recipe);
        }),
      );
    });

    test("project file: the project and its records come back, with provenance and From file set by the import", () => {
      checkProperty(
        `${catalog.lattice.tag}: project file round trip`,
        fc.property(
          projectArb(catalog).chain((project) => fc.tuple(fc.constant(project), fc.array(deploymentArb(project.id), { maxLength: 3 }))),
          ([project, deployments]) => {
            const file = exportProjectFile(project, deployments);
            expect(file.filename.endsWith(".lattice.json")).toBe(true);
            expect(file.filename).not.toMatch(/[/\\\n\r]/);
            // Stored as is: the app's own database reads it back unchanged.
            const stored = parseProjectFile(JSON.parse(file.text), { catalogs: [catalog], source: "db" });
            if (!stored.ok) throw new Error(JSON.stringify(stored.error));
            expect(stored.value.value.project).toEqual({ ...project, recipe: normalizeRecipe(project.recipe, catalog) });
            expect(stored.value.value.deployments).toEqual(deployments);
            // Opened as a file: the same, but every literal argument is unconfirmed and every record From file.
            const opened = importFile(file.text, file.filename, [catalog]);
            if (!opened.ok) throw new Error(JSON.stringify(opened.error));
            if (opened.value.kind !== "project") throw new Error(`a project file opened as a ${opened.value.kind}`);
            const { provenance, ...rest } = opened.value.project;
            const { provenance: _before, ...expected } = stored.value.value.project;
            expect(rest).toEqual(expected);
            expect(Object.values(provenance).every((source) => source === "file")).toBe(true);
            expect(opened.value.deployments).toEqual(deployments.map((record) => ({ ...record, fromFile: true as const })));
            expect(recipeHash(opened.value.project.recipe, catalog)).toBe(recipeHash(project.recipe, catalog));
            // And exporting what was opened is a fixed point.
            const again = exportProjectFile(opened.value.project, opened.value.deployments);
            const reopened = importFile(again.text, again.filename, [catalog]);
            expect(reopened.ok && reopened.value.kind === "project" && canonicalJson(reopened.value.project)).toBe(canonicalJson(opened.value.project));
          },
        ),
      );
    });

    test("importing recipe.json with text that may not be well-formed UTF-16 never throws, and keeps well-formed names", () => {
      checkProperty(
        `${catalog.lattice.tag}: lone surrogates in recipe.json`,
        fc.property(recipeArb(catalog, { names: hostileString(), strings: hostileString() }), (recipe) => {
          const file = exportRecipeJson(recipe, catalog);
          expect(() => JSON.parse(file.text) as unknown).not.toThrow();
          const imported = importFile(file.text, file.filename, [catalog]);
          if (!imported.ok) {
            // Refusing text with a lone surrogate (FX2) is fine, with a reason.
            for (const issue of imported.error) expect(issue.message.trim().length).toBeGreaterThan(0);
            return;
          }
          if (imported.value.kind !== "recipe") throw new Error(`recipe.json opened as a ${imported.value.kind}`);
          const name = imported.value.recipe.name;
          const given = (JSON.parse(file.text) as Recipe).name;
          if (given === undefined || given === wellFormed(given)) expect(name).toBe(given);
          // Otherwise the name opens as written or repaired to U+FFFD; C1's fix decides which (see the todo below).
          else expect([given, wellFormed(given)]).toContain(name ?? "");
        }),
      );
    });

    // JSON can spell a lone surrogate ("\ud800"), which has no UTF-8 form, so hashing can't hold it (spec L936).
    test("a lone surrogate anywhere in a recipe.json, a project file or a share link is refused at its path", () => {
      const documents = fc.oneof(
        recipeArb(catalog).map((recipe) => ({ target: "recipe" as const, document: JSON.parse(exportRecipeJson(recipe, catalog).text) as unknown })),
        recipeArb(catalog).map((recipe) => {
          const { $schema: _schema, ...rest } = JSON.parse(exportRecipeJson(recipe, catalog).text) as Recipe;
          return { target: "link" as const, document: rest as unknown };
        }),
        projectArb(catalog)
          .chain((project) => fc.tuple(fc.constant(project), fc.array(deploymentArb(project.id), { maxLength: 2 })))
          .map(([project, deployments]) => ({ target: "project" as const, document: JSON.parse(exportProjectFile(project, deployments).text) as unknown })),
      );
      checkProperty(
        `${catalog.lattice.tag}: lone surrogates refused at their path`,
        fc.property(
          documents.chain(({ target, document }) =>
            fc.record({
              target: fc.constant(target),
              document: fc.constant(document),
              site: fc.constantFrom(...stringSites(document)),
              at: fc.nat({ max: 40 }),
              broken: fc.constantFrom("\ud800", "\udbff", "\udc00", "\udfff"),
            }),
          ),
          ({ target, document, site, at, broken }) => {
            const hostile = withBrokenString(document, site, at, broken);
            const text = JSON.stringify(hostile.document);
            const filename = target === "project" ? "vault.lattice.json" : "recipe.json";
            let outcome: { ok: true } | { ok: false; error: ParseIssue[] } = { ok: true };
            expect(() => {
              outcome = target === "link" ? decodeShareLink(linkOf(text), [catalog]) : importFile(text, filename, [catalog]);
            }).not.toThrow();
            if (outcome.ok) throw new Error(`a lone surrogate at ${formatJsonPath(hostile.path)} opened`);
            const issues = (outcome as { ok: false; error: ParseIssue[] }).error;
            expect(issues.map((issue) => issue.path)).toContain(formatJsonPath(hostile.path));
            for (const issue of issues) {
              expect(issue.message.trim().length).toBeGreaterThan(0);
              if (target !== "link") expect(issue.file).toBe(filename);
            }
          },
        ),
      );
    });
  });
}
