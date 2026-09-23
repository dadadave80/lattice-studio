import { expect, test } from "bun:test";
import { API_OWNERS } from "../model/api";
import * as mod from "./index";

test("the barrel exports exactly C9's public functions, and no internal helper", () => {
  const owned = Object.entries(API_OWNERS)
    .filter(([, owner]) => owner === "C9")
    .map(([name]) => name)
    .sort();
  expect(Object.keys(mod).sort()).toEqual(owned);
  for (const name of owned) expect(typeof (mod as Record<string, unknown>)[name]).toBe("function");
});
