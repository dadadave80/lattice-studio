import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as core from "./index";
import { API_OWNERS } from "./model/api";

describe("public API", () => {
  test("every function in contracts §3.4 is exported from the package root", () => {
    const exported = core as Record<string, unknown>;
    for (const name of Object.keys(API_OWNERS)) {
      const kind = name === "lines" ? "object" : "function";
      expect([name, typeof exported[name]]).toEqual([name, kind]);
    }
    expect(Object.keys(API_OWNERS).length).toBe(89);
  });

  test("registries, schemas and runChecks are exported; test helpers are not", () => {
    const exported = core as Record<string, unknown>;
    for (const name of ["PROBLEMS", "COMMAND_OWNERS", "RecipeSchema", "runChecks", "CHECKS", "problemId", "NotImplemented"]) {
      expect([name, exported[name] === undefined]).toEqual([name, false]);
    }
    for (const name of ["makeFacet", "makeCatalog", "loadFixtureCatalog", "hex", "addr"]) {
      expect([name, exported[name]]).toEqual([name, undefined]);
    }
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    // testing/ is test support (C12 adds fast-check there), not core source.
    if (statSync(path).isDirectory()) return entry === "testing" ? [] : sources(path);
    return entry.endsWith(".ts") && !entry.endsWith(".test.ts") ? [path] : [];
  });
}

describe("dependencies", () => {
  test("every bare import in core source (tests and testing/ aside) is a declared dependency", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as { dependencies: Record<string, string> };
    const allowed = new Set(Object.keys(pkg.dependencies));
    const imported = new Set<string>();
    for (const file of sources(import.meta.dir)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/^\s*(?:import|export)\b[^;"]*?\bfrom\s+"([^"]+)"|^\s*import\s+"([^"]+)"/gm)) {
        const specifier = match[1] ?? match[2] ?? "";
        if (specifier.startsWith(".")) continue;
        imported.add(specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : (specifier.split("/")[0] ?? ""));
      }
    }
    expect(imported.size).toBeGreaterThan(0);
    for (const name of imported) expect([name, allowed.has(name)]).toEqual([name, true]);
  });
});
