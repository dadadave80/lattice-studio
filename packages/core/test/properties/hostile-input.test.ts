/**
 * Malformed files and links are rejected with a precise error and never throw (spec L857, L936). C8 fuzzes its
 * own decoder with random bytes; these properties add documents with one known defect (a member deleted or
 * retyped, the text cut short), hostile prototype keys at any depth, and what opens after a defect: whatever
 * import accepts must analyze, hash and share without throwing.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { deflateSync, strToU8 } from "fflate";
import {
  analyze, decodeShareLink, encodeShareLink, exportProjectFile, exportRecipeJson, importFile, recipeHash, type Catalog, type ParseIssue, type Recipe,
} from "../../src";
import {
  checkProperty, deploymentArb, formatJsonPath, mutationArb, objectPaths, pathsRelated, projectArb, propertyCatalogs, recipeArb,
  withExtraKey, type Mutation,
} from "../../src/testing";

const catalogs = propertyCatalogs();

function linkOf(text: string): string {
  return `#s=1.${Buffer.from(deflateSync(strToU8(text))).toString("base64url")}`;
}

function describeIssues(issues: readonly ParseIssue[]): string {
  return issues.map((issue) => `${issue.path || "(root)"}: ${issue.message}`).join("; ");
}

/** Whatever opened must keep working: hashing, analysis and a share link never throw on it. */
function usable(recipe: Recipe, catalog: Catalog): void {
  expect(() => recipeHash(recipe, catalog)).not.toThrow();
  expect(() => analyze(recipe, catalog)).not.toThrow();
  expect(() => encodeShareLink(recipe)).not.toThrow();
}

/** A refusal names the file and says why; for a deleted or retyped member, one issue points at it. */
function refusedPrecisely(issues: readonly ParseIssue[], mutation: Mutation, prefix: string, file?: string): void {
  expect(issues.length).toBeGreaterThan(0);
  for (const issue of issues) {
    expect(issue.message.trim().length).toBeGreaterThan(0);
    if (file !== undefined) expect(issue.file).toBe(file);
  }
  if (mutation.kind === "truncate") return;
  const defect = formatJsonPath(mutation.path);
  const relative = defect.startsWith(prefix) ? defect.slice(prefix.length).replace(/^\./, "") : defect;
  const related = issues.some((issue) => pathsRelated(issue.path, defect) || pathsRelated(issue.path, relative));
  expect([mutation.kind, defect, related, describeIssues(issues)]).toEqual([mutation.kind, defect, true, describeIssues(issues)]);
}

/** No object anywhere in `value` has an own `__proto__` key or a prototype other than Object's (or Array's). */
function plainObjects(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  const proto: unknown = Object.getPrototypeOf(value);
  if (Array.isArray(value)) return proto === Array.prototype && value.every(plainObjects);
  if (proto !== Object.prototype && proto !== null) return false;
  if (Object.hasOwn(value, "__proto__")) return false;
  return Object.values(value).every(plainObjects);
}

describe("arbitrary input", () => {
  const catalog = catalogs[0] as Catalog;

  test("importFile never throws on arbitrary text, and every refusal names the file", () => {
    checkProperty(
      "importFile arbitrary text",
      fc.property(
        fc.oneof(fc.string({ unit: "binary", maxLength: 64 }), fc.json(), fc.jsonValue().map((v) => JSON.stringify(v))),
        fc.constantFrom("recipe.json", "x.lattice.json", "weird\n‮name.json", ""),
        (text, filename) => {
          const result = importFile(text, filename, [catalog]);
          if (!result.ok) {
            for (const issue of result.error) {
              expect(issue.message.trim().length).toBeGreaterThan(0);
              expect(issue.file).toBe(filename);
            }
          }
        },
      ),
    );
  });

  test("decodeShareLink never throws on arbitrary fragments or payloads", () => {
    const payload = fc.oneof(fc.json(), fc.string({ unit: "binary", maxLength: 64 }), fc.jsonValue().map((v) => JSON.stringify(v)));
    checkProperty(
      "decodeShareLink arbitrary input",
      fc.property(
        fc.oneof(
          fc.string({ unit: "binary", maxLength: 80 }),
          payload.map(linkOf),
          fc.uint8Array({ maxLength: 64 }).map((bytes) => `#s=1.${Buffer.from(bytes).toString("base64url")}`),
          fc.tuple(fc.nat({ max: 99 }), payload).map(([version, text]) => linkOf(text).replace("#s=1.", `#s=${version}.`)),
        ),
        (fragment) => {
          const decoded = decodeShareLink(fragment, [catalog]);
          if (decoded.ok) usable(decoded.value.recipe, catalog);
          else for (const issue of decoded.error) expect(issue.message.trim().length).toBeGreaterThan(0);
        },
      ),
    );
  });
});

for (const catalog of catalogs) {
  describe(`one defect on catalog ${catalog.lattice.tag}`, () => {
    test("recipe.json: a deleted, retyped or cut member is refused at its path, or what opens still works", () => {
      let refused = 0;
      const outcome = checkProperty(
        `${catalog.lattice.tag}: defective recipe.json`,
        fc.property(
          recipeArb(catalog).chain((recipe) => mutationArb(JSON.parse(exportRecipeJson(recipe, catalog).text))),
          (mutation) => {
            const result = importFile(mutation.text, "recipe.json", [catalog]);
            if (!result.ok) {
              refused++;
              return refusedPrecisely(result.error, mutation, "", "recipe.json");
            }
            if (result.value.kind === "recipe") usable(result.value.recipe, catalog);
            else usable(result.value.project.recipe, catalog);
          },
        ),
      );
      expect(refused).toBeGreaterThan(outcome.runs / 5);
    });

    test("share link: a deleted, retyped or cut member is refused at its path, or what opens still works", () => {
      let refused = 0;
      const outcome = checkProperty(
        `${catalog.lattice.tag}: defective share link`,
        fc.property(
          recipeArb(catalog).chain((recipe) => {
            const { $schema: _schema, ...rest } = JSON.parse(exportRecipeJson(recipe, catalog).text) as Recipe;
            return mutationArb(rest);
          }),
          (mutation) => {
            const decoded = decodeShareLink(linkOf(mutation.text), [catalog]);
            if (!decoded.ok) {
              refused++;
              return refusedPrecisely(decoded.error, mutation, "");
            }
            usable(decoded.value.recipe, catalog);
          },
        ),
      );
      expect(refused).toBeGreaterThan(outcome.runs / 5);
    });

    test(".lattice.json: a deleted, retyped or cut member is refused at its path, or what opens still works", () => {
      let refused = 0;
      const outcome = checkProperty(
        `${catalog.lattice.tag}: defective project file`,
        fc.property(
          projectArb(catalog)
            .chain((project) => fc.tuple(fc.constant(project), fc.array(deploymentArb(project.id), { maxLength: 2 })))
            .chain(([project, deployments]) => mutationArb(JSON.parse(exportProjectFile(project, deployments).text))),
          (mutation) => {
            const result = importFile(mutation.text, "vault.lattice.json", [catalog]);
            if (!result.ok) {
              refused++;
              return refusedPrecisely(result.error, mutation, "project", "vault.lattice.json");
            }
            usable(result.value.kind === "project" ? result.value.project.recipe : result.value.recipe, catalog);
          },
        ),
      );
      expect(refused).toBeGreaterThan(outcome.runs / 5);
    });

    test("__proto__, constructor and prototype keys anywhere in a file or link set no prototype and pollute nothing", () => {
      checkProperty(
        `${catalog.lattice.tag}: prototype keys`,
        fc.property(
          projectArb(catalog).chain((project) => {
            const document = JSON.parse(exportProjectFile(project, []).text) as { project: { recipe: unknown } };
            const recipe = document.project.recipe;
            return fc.record({
              target: fc.constantFrom("file" as const, "recipe" as const, "link" as const),
              key: fc.constantFrom("__proto__", "constructor", "prototype"),
              projectPath: fc.constantFrom(...objectPaths(document)),
              recipePath: fc.constantFrom(...objectPaths(recipe)),
              document: fc.constant(document as unknown),
              recipe: fc.constant(recipe),
            });
          }),
          ({ target, key, projectPath, recipePath, document, recipe }) => {
            const smuggled = { polluted: true, immutable: true, admin: "0x0000000000000000000000000000000000000bad" };
            const outcome =
              target === "file"
                ? importFile(withExtraKey(document, projectPath, key, smuggled), "x.lattice.json", [catalog])
                : target === "recipe"
                  ? importFile(withExtraKey(recipe, recipePath, key, smuggled), "recipe.json", [catalog])
                  : decodeShareLink(linkOf(withExtraKey(recipe, recipePath, key, smuggled)), [catalog]);
            expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
            expect(Object.prototype).not.toHaveProperty("polluted");
            if (outcome.ok) expect(plainObjects(outcome.value)).toBe(true);
          },
        ),
      );
    });
  });
}
