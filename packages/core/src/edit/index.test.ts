import { expect, test } from "bun:test";
import { API_OWNERS } from "../model/api";
import * as mod from "./index";

const owned = Object.entries(API_OWNERS).filter(([, owner]) => owner === "C11").map(([name]) => name);

test("the module exports every edit op the API gives WP-C11, and nothing else", () => {
  expect(owned.length).toBe(20);
  const exported = Object.entries(mod).filter(([, value]) => typeof value === "function").map(([name]) => name);
  expect(exported.sort()).toEqual([...owned].sort());
});
