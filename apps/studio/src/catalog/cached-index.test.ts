import { describe, expect, test } from "bun:test";
import { hasCachedIndex, overrideCachedIndex } from "./cached-index";

describe("hasCachedIndex (spec L695: placeholders on the first visit only)", () => {
  test("no service worker controls the page: a first visit, nothing cached", () => {
    expect(hasCachedIndex()).toBe(false);
  });

  test("an override stands in for the service worker, and its undo restores the real answer", () => {
    const undo = overrideCachedIndex(true);
    expect(hasCachedIndex()).toBe(true);
    undo();
    expect(hasCachedIndex()).toBe(false);
  });
});
