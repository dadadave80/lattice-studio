// WP-C10 replaces this file with its real tests: until it lands, every function here is a stub, and
// renderProblem is a non-throwing placeholder.
import { expect, test } from "bun:test";
import { API_OWNERS, type ApiName } from "../model/api";
import { NotImplemented } from "../model/wp";
import * as mod from "./index";

const stubs = Object.entries(mod).filter(([name, value]) => typeof value === "function" && name !== "renderProblem");

test("renderProblem's placeholder is the code and the params with sorted keys, deterministic", () => {
  expect(API_OWNERS.renderProblem).toBe("C10");
  expect(mod.renderProblem("DEP-01", { reason: "r", facet: "VaultCore", anyOf: ["ERC4626"] })).toBe(
    'DEP-01 {"anyOf":["ERC4626"],"facet":"VaultCore","reason":"r"}',
  );
  expect(mod.renderProblem("SEL-01", { b: { d: 1, c: 2 }, a: null })).toBe('SEL-01 {"a":null,"b":{"c":2,"d":1}}');
});

test("the module exports its stubs", () => {
  expect(stubs.length).toBeGreaterThan(0);
});

test.each(stubs)("%s throws NotImplemented naming WP-C10", (name, fn) => {
  expect(API_OWNERS[name as ApiName]).toBe("C10");
  let caught: unknown;
  try {
    (fn as (...args: unknown[]) => unknown)();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(NotImplemented);
  expect((caught as NotImplemented).wp).toBe("C10");
  expect((caught as NotImplemented).fn).toBe(name);
  expect((caught as NotImplemented).message).toBe("Not built yet · WP-C10");
});

test.each(Object.entries(mod.lines))("lines.%s is a stub naming WP-C10", (name, builder) => {
  expect(() => (builder as (...args: unknown[]) => unknown)()).toThrow(new NotImplemented("C10", `lines.${name}`));
});
