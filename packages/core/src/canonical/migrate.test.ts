import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../model/json";
import { detectDocument, migrate, MIGRATIONS, runMigrations, type MigrationStep } from "./migrate";

const recipeV1: JsonObject = { schemaVersion: 1, facets: [] };

describe("migrate", () => {
  test("v1 is current: no steps are registered and v1 passes through unchanged", () => {
    expect(MIGRATIONS.size).toBe(0);
    const result = migrate(recipeV1);
    expect(result).toEqual({ ok: true, value: { value: recipeV1, from: 1, to: 1 } });
    expect(result.ok && result.value.value).toBe(recipeV1);
  });

  test("a newer recipe, project or project file names the version it needs", () => {
    const message = "This file needs Studio schema v2. This Studio reads v1.";
    expect(migrate({ schemaVersion: 2 })).toEqual({ ok: false, error: message });
    expect(migrate({ id: "p", recipe: { schemaVersion: 2 } })).toEqual({ ok: false, error: message });
    expect(migrate({ project: { recipe: { schemaVersion: 2 } }, deployments: [] })).toEqual({ ok: false, error: message });
    expect(migrate({ schemaVersion: 7 })).toEqual({ ok: false, error: "This file needs Studio schema v7. This Studio reads v1." });
  });

  test("what it can't place comes back unchanged for validation to explain", () => {
    for (const json of [null, [], "text", 3, {}, { schemaVersion: "1" }, { schemaVersion: 1.5 }, { schemaVersion: 0 }, { recipe: 1 }]) {
      const result = migrate(json);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.value).toBe(json as never);
        expect(result.value.from).toBe(result.value.to);
      }
    }
  });

  test("detects the document by where it keeps the recipe", () => {
    expect(detectDocument({ schemaVersion: 1 })).toBe("recipe");
    expect(detectDocument({ recipe: {} })).toBe("project");
    expect(detectDocument({ project: {} })).toBe("projectFile");
    expect(detectDocument(null)).toBe("recipe");
  });
});

describe("runMigrations with a registry", () => {
  // A fake history: v1 renamed `parts` to `facets`, v2 added `exclude`.
  const steps = new Map<number, MigrationStep>([
    [1, ({ parts, ...rest }) => ({ ...rest, facets: parts ?? [] })],
    [2, (recipe) => ({ ...recipe, exclude: [] })],
  ]);

  test("runs every step forward in order and stamps the version", () => {
    const result = runMigrations({ schemaVersion: 1, parts: ["ERC20"], keep: true }, "recipe", steps, 3);
    expect(result).toEqual({ ok: true, value: { value: { schemaVersion: 3, facets: ["ERC20"], keep: true, exclude: [] }, from: 1, to: 3 } });
  });

  test("starts from the file's version", () => {
    const result = runMigrations({ schemaVersion: 2, facets: [] }, "recipe", steps, 3);
    expect(result).toEqual({ ok: true, value: { value: { schemaVersion: 3, facets: [], exclude: [] }, from: 2, to: 3 } });
  });

  test("migrates the recipe inside a project and a project file, keeping everything around it", () => {
    const project = { id: "p", name: "Vault", recipe: { schemaVersion: 2, facets: [] } };
    expect(runMigrations(project, "project", steps, 3)).toEqual({
      ok: true,
      value: { value: { id: "p", name: "Vault", recipe: { schemaVersion: 3, facets: [], exclude: [] } }, from: 2, to: 3 },
    });
    const file = { project, deployments: [{ chainId: 1 }] };
    const migrated = runMigrations(file, "projectFile", steps, 3);
    expect(migrated.ok && migrated.value.value).toEqual({
      project: { id: "p", name: "Vault", recipe: { schemaVersion: 3, facets: [], exclude: [] } },
      deployments: [{ chainId: 1 }],
    });
    expect(file.project.recipe.schemaVersion).toBe(2);
  });

  test("never runs backward: a newer file is refused", () => {
    expect(runMigrations({ schemaVersion: 4 }, "recipe", steps, 3)).toEqual({
      ok: false,
      error: "This file needs Studio schema v4. This Studio reads v3.",
    });
  });

  test("a version with no step comes back unchanged", () => {
    const json = { schemaVersion: 0 };
    expect(runMigrations(json, "recipe", steps, 3)).toEqual({ ok: true, value: { value: json, from: 0, to: 0 } });
  });
});
