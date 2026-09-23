import { describe, expect, test } from "bun:test";
import { formatParseIssue, parseRecipe } from "../canonical/parse";
import type { Catalog } from "../model/catalog";
import type { ImportedFile } from "../model/io";
import { makeRecipe } from "../testing";
import { importFile } from "./import";
import { ADMIN, catalog, governedVault, projectFile, safeCut, tokenWithAdmin } from "./test-support";

function opened(text: string, filename: string, catalogs: readonly Catalog[] = [catalog]): ImportedFile {
  const result = importFile(text, filename, catalogs);
  if (!result.ok) throw new Error(result.error.map(formatParseIssue).join("\n"));
  return result.value;
}

function refused(text: string, filename: string, catalogs: readonly Catalog[] = [catalog]): string[] {
  const result = importFile(text, filename, catalogs);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.error.map(formatParseIssue);
}

const json = (value: unknown): string => JSON.stringify(value, null, 2);

describe("recipe.json", () => {
  test("opens as a recipe, parsed as C1 parses a file", () => {
    const file = opened(json(tokenWithAdmin()), "recipe.json");
    const parsed = parseRecipe(tokenWithAdmin(), { catalogs: [catalog], source: "file", filename: "recipe.json" });
    if (!parsed.ok || file.kind !== "recipe") throw new Error("expected a recipe");
    expect(file.recipe).toEqual(parsed.value.value);
    expect(file.catalog).toBe(catalog);
    expect(file.unknownFields).toEqual([]);
    expect(file.unconfirmed).toEqual(["steps[0].admin"]);
  });

  test("a leading byte-order mark is fine", () => {
    expect(opened(`﻿${json(safeCut())}`, "safe.json").kind).toBe("recipe");
  });

  test("errors name the file, the path and the reason (spec L501)", () => {
    const recipe = makeRecipe({ facets: ["ERC20", "AccessControl", "DiamondLoupeFacet", "ERC20X"] }, catalog);
    expect(refused(json(recipe), "recipe.json")).toEqual(["recipe.json: facets[3] ‘ERC20X’ isn't in Lattice 0.4.0."]);
  });

  test("a newer schema is refused with the version it needs", () => {
    expect(refused(json({ ...tokenWithAdmin(), schemaVersion: 2 }), "recipe.json")).toEqual([
      "recipe.json: This file needs Studio schema v2. This Studio reads v1.",
    ]);
  });

  test("empty files and files that aren't JSON say so", () => {
    expect(refused("", "recipe.json")).toEqual(["recipe.json: This file is empty. Choose a .lattice.json or recipe.json file."]);
    expect(refused(" \n\t", "recipe.json")).toEqual(["recipe.json: This file is empty. Choose a .lattice.json or recipe.json file."]);
    expect(refused("{\"schemaVersion\": 1,", "recipe.json")).toEqual(["recipe.json: This file isn't valid JSON. Choose a .lattice.json or recipe.json file."]);
    expect(refused("\u0089PNG\r\n", "diagram.png")).toEqual(["diagram.png: This file isn't valid JSON. Choose a .lattice.json or recipe.json file."]);
  });

  test("a recipe pinned to a catalog this build doesn't bundle opens with every literal address unconfirmed", () => {
    const file = opened(json(governedVault()), "vault.json", []);
    expect(file.catalog).toBeNull();
    expect(file.unconfirmed).toEqual(["bundle.p.asset"]);
  });
});

describe(".lattice.json", () => {
  test("opens as a project with its deployments marked From file", () => {
    const source = projectFile();
    const file = opened(json(source), "grant-token.lattice.json");
    if (file.kind !== "project") throw new Error("expected a project");
    expect(file.project.name).toBe("Grant token");
    expect(file.project.layout).toEqual(source.project.layout);
    expect(file.deployments).toEqual(source.deployments.map((record) => ({ ...record, fromFile: true })));
    expect(file.catalog).toBe(catalog);
    expect(file.unconfirmed).toEqual(["steps[0].admin"]);
  });

  test("replaces the file's provenance: every argument came from the file, whatever it claims", () => {
    const file = opened(json(projectFile()), "grant-token.lattice.json");
    if (file.kind !== "project") throw new Error("expected a project");
    expect(file.project.provenance).toEqual({ "steps[0].admin": "file", "steps[1].name": "file", "steps[1].symbol": "file" });
  });

  test("references never get provenance", () => {
    const file = opened(json(projectFile(safeCut())), "safe.lattice.json");
    if (file.kind !== "project") throw new Error("expected a project");
    expect(file.project.provenance).toEqual({ "steps[0].safe": "file" });
    expect(file.unconfirmed).toEqual(["steps[0].safe"]);
  });

  test("content decides the kind; the name only breaks a tie", () => {
    expect(opened(json(projectFile()), "recipe.json").kind).toBe("project");
    expect(opened(json(tokenWithAdmin()), "odd.lattice.json").kind).toBe("recipe");
    // A recipe may keep an unknown `project` field (spec L289); without `deployments` it's still a recipe.
    const keeping = opened(json({ ...tokenWithAdmin(), project: { note: "kept" } }), "recipe.json");
    expect(keeping.kind).toBe("recipe");
    expect(keeping.unknownFields).toEqual(["project"]);
    expect(refused(json({}), "broken.lattice.json")).toEqual([
      "broken.lattice.json: project is missing.",
      "broken.lattice.json: deployments is missing.",
    ]);
  });

  test("errors inside the project name the file and the full path", () => {
    const source = projectFile(makeRecipe({ facets: ["ERC20X"] }, catalog));
    expect(refused(json(source), "grant-token.lattice.json")).toEqual([
      "grant-token.lattice.json: project.recipe.facets[0] ‘ERC20X’ isn't in Lattice 0.4.0.",
    ]);
    const badRecord = { ...projectFile(), deployments: [{ ...projectFile().deployments[0], address: "0x1234" }] };
    const found = refused(json(badRecord), "grant-token.lattice.json");
    expect(found.length).toBe(1);
    expect(found[0]?.startsWith("grant-token.lattice.json: deployments[0].address ")).toBe(true);
  });

  test("a project whose admin is a literal address keeps it and marks it unconfirmed", () => {
    const file = opened(json(projectFile(tokenWithAdmin(ADMIN.toLowerCase()))), "grant-token.lattice.json");
    if (file.kind !== "project" || file.project.recipe.init.kind !== "steps") throw new Error("expected steps");
    expect(file.project.recipe.init.steps[0]?.args["admin"]).toBe(ADMIN);
    expect(file.unconfirmed).toEqual(["steps[0].admin"]);
  });
});

describe("hostile files", () => {
  test("deep nesting is refused, not thrown", () => {
    const depth = 100_000;
    const text = `{"project":${"[".repeat(depth)}${"]".repeat(depth)},"deployments":[]}`;
    expect(() => importFile(text, "deep.lattice.json", [catalog])).not.toThrow();
    expect(importFile(text, "deep.lattice.json", [catalog]).ok).toBe(false);
  });

  test("never throws on arbitrary text", () => {
    let seed = 11;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    const pieces = ["{", "}", "[", "]", "\"project\"", "\"schemaVersion\"", ":", ",", "1", "null", "\"x\"", "\"facets\""];
    for (let round = 0; round < 500; round++) {
      const text = Array.from({ length: next() % 24 }, () => pieces[next() % pieces.length] ?? "").join("");
      const result = importFile(text, "fuzz.json", [catalog]);
      expect(result.ok ? true : result.error.every((issue) => issue.file === "fuzz.json" && issue.message.length > 0)).toBe(true);
    }
  });
});
