/**
 * Export then import is the identity (spec L283-L291, L932) for recipe.json, share links and `.lattice.json`
 * project files, with hostile names and `string` arguments throughout. What import deliberately changes is
 * checked as such: a project file's provenance becomes "file" for every literal argument and its deployment
 * records come back `fromFile` (spec L857).
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  analyze, canonicalJson, decodeShareLink, encodeShareLink, exportProjectFile, exportRecipeJson, importFile, normalizeRecipe,
  parseProjectFile, parseRecipe, recipeHash, type Recipe,
} from "../../src";
import { checkProperty, deploymentArb, hostileString, projectArb, propertyCatalogs, recipeArb, wellFormed } from "../../src/testing";

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

    test("recipe.json keeps a name that isn't well-formed UTF-16 exactly, and importing it never throws", () => {
      checkProperty(
        `${catalog.lattice.tag}: lone surrogates in recipe.json`,
        fc.property(recipeArb(catalog, { names: hostileString(), strings: hostileString() }), (recipe) => {
          const file = exportRecipeJson(recipe, catalog);
          expect(() => JSON.parse(file.text) as unknown).not.toThrow();
          const imported = importFile(file.text, file.filename, [catalog]);
          if (!imported.ok || imported.value.kind !== "recipe") throw new Error(JSON.stringify(imported));
          expect(imported.value.recipe.name).toBe(recipe.name);
        }),
      );
    });

    // Known gap (follow-up for C1): JSON can spell a lone surrogate ("\ud800"), `parseRecipe` and `importFile`
    // accept it, and then `recipeHash`, `analyze` and `encodeShareLink` throw from `canonicalJson`. Spec L936
    // wants such a file refused with a precise error (or its text repaired). This flips to a failure, on purpose,
    // once C1 fixes it: then drop `.failing`.
    test.failing("a file holding a lone surrogate is refused with a path, or opens into a recipe that hashes, analyzes and shares", () => {
      checkProperty(
        `${catalog.lattice.tag}: lone surrogates refused or repaired`,
        fc.property(recipeArb(catalog, { strings: hostileString().map((text) => `${text}\ud800`) }), (recipe) => {
          const imported = importFile(JSON.stringify(recipe), "recipe.json", [catalog]);
          if (!imported.ok) {
            expect(imported.error.every((issue) => issue.path !== "" && issue.message !== "")).toBe(true);
            return;
          }
          if (imported.value.kind !== "recipe") throw new Error("expected a recipe");
          const opened = imported.value.recipe;
          expect(() => recipeHash(opened, catalog)).not.toThrow();
          expect(() => analyze(opened, catalog)).not.toThrow();
          const decoded = decodeShareLink(encodeShareLink(opened).fragment, [catalog]);
          expect(decoded.ok && decoded.value.recipe.name).toBe(opened.name === undefined ? undefined : wellFormed(opened.name));
        }),
      );
    });
  });
}
