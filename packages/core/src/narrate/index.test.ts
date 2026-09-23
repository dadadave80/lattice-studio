import { expect, test } from "bun:test";
import { API_OWNERS } from "../model/api";
import * as mod from "./index";

test("the module exports renderProblem, narrate and every lines.* builder, all real (no stub)", () => {
  expect(API_OWNERS.renderProblem).toBe("C10");
  expect(API_OWNERS.narrate).toBe("C10");
  expect(API_OWNERS.lines).toBe("C10");
  expect(typeof mod.renderProblem).toBe("function");
  expect(typeof mod.narrate).toBe("function");
  expect(typeof mod.lines).toBe("object");
});

test("renderProblem no longer returns the placeholder shape", () => {
  const text = mod.renderProblem("CORE-02", {});
  expect(text).not.toContain("CORE-02 {");
  expect(text).toBe("Nothing can change this diamond after deploy.");
});

test("narrate resets on load (prev = null)", () => {
  const empty = { recipeHash: "0x00" as const, routing: {}, problems: [], plan: [], init: null, stats: { facets: 0, routed: 0, exported: 0, excluded: 0, namespaces: 0 } };
  expect(mod.narrate(null, empty)).toEqual([]);
});

test("every lines.* builder is a function, not a stub", () => {
  const builders = Object.values(mod.lines);
  expect(builders.length).toBeGreaterThan(20);
  for (const builder of builders) expect(typeof builder).toBe("function");
});
