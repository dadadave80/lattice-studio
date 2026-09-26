import { describe, expect, test } from "bun:test";
import type { Project } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { UNPINNED_HASH } from "@/state/document-store";
import { untouched } from "./untouched";

const booted: Project = makeProject({
  id: "boot",
  name: "Untitled",
  recipe: { ...makeRecipe(), catalog: { tag: "", hash: UNPINNED_HASH } },
});
const pinned = { tag: "v0.4.0", hash: `0x${"ab".repeat(32)}` as const };

describe("untouched: the boot's document has no edits of its own", () => {
  test("the same document, a recorded prediction, and the catalog pin are not the visitor's edits", () => {
    expect(untouched(booted, booted)).toBe(true);
    const predicted = { ...booted, predicted: [{ chainId: 1, address: `0x${"11".repeat(20)}` as const }] };
    expect(untouched(booted, predicted)).toBe(true);
    const pin = { ...predicted, recipe: { ...booted.recipe, catalog: pinned } };
    expect(untouched(booted, pin)).toBe(true);
  });

  test("a rename, a recipe edit, a layout change or a deploy setting are", () => {
    expect(untouched(booted, { ...booted, name: "My own" })).toBe(false);
    expect(untouched(booted, { ...booted, recipe: { ...booted.recipe, facets: [...booted.recipe.facets, "Extra"] } })).toBe(false);
    expect(untouched(booted, { ...booted, layout: { Extra: { x: 1, y: 2, pins: "left" } } })).toBe(false);
    expect(untouched(booted, { ...booted, deploy: { ...booted.deploy, scope: "this-chain" } })).toBe(false);
  });

  test("a pin that changes anything else in the recipe, or re-pins a pinned one, is an edit", () => {
    const edited = { ...booted.recipe, catalog: pinned, exclude: ["0x12345678" as const] };
    expect(untouched(booted, { ...booted, recipe: edited })).toBe(false);
    const alreadyPinned = { ...booted, recipe: { ...booted.recipe, catalog: pinned } };
    const repinned = { ...alreadyPinned, recipe: { ...alreadyPinned.recipe, catalog: { tag: "v0.4.1", hash: pinned.hash } } };
    expect(untouched(alreadyPinned, repinned)).toBe(false);
  });
});
