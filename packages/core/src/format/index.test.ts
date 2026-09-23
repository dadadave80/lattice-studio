import { expect, test } from "bun:test";
import { API_OWNERS, type ApiName } from "../model/api";
import * as mod from "./index";

const fns = Object.entries(mod).filter(([, value]) => typeof value === "function");

/** Cut index, the diamond-state stamp and the problem-summary chip have no `model/api.ts` type (C10's brief). */
const LOCAL_ONLY = new Set(["formatCutIndex", "formatStamp", "formatProblemSummary"]);

test("the module exports every C10 format function the registry lists, and nothing else", () => {
  const formatNames = Object.entries(API_OWNERS)
    .filter(([, owner]) => owner === "C10")
    .map(([name]) => name)
    .filter((name) => name !== "narrate" && name !== "lines"); // narrate/lines live in ./narrate, not ./format
  for (const name of formatNames) {
    if (name === "renderProblem") continue; // renderProblem lives in ./narrate
    expect(mod).toHaveProperty(name);
  }
  for (const [name] of fns) {
    if (LOCAL_ONLY.has(name)) continue;
    expect(API_OWNERS[name as ApiName]).toBe("C10");
  }
});

test("every export is a real function, not a stub", () => {
  expect(fns.length).toBeGreaterThan(0);
  for (const [, fn] of fns) expect(() => (fn as (...args: unknown[]) => unknown)()).not.toThrow(/Not built yet/);
});
