// WP-C9 replaces this file with its real tests: until it lands, every function here is a stub.
import { expect, test } from "bun:test";
import { API_OWNERS, type ApiName } from "../model/api";
import { NotImplemented } from "../model/wp";
import * as mod from "./index";

const stubs = Object.entries(mod).filter(([, value]) => typeof value === "function");

test("the module exports its stubs", () => {
  expect(stubs.length).toBeGreaterThan(0);
});

test.each(stubs)("%s throws NotImplemented naming WP-C9", (name, fn) => {
  expect(API_OWNERS[name as ApiName]).toBe("C9");
  let caught: unknown;
  try {
    (fn as (...args: unknown[]) => unknown)();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(NotImplemented);
  expect((caught as NotImplemented).wp).toBe("C9");
  expect((caught as NotImplemented).fn).toBe(name);
  expect((caught as NotImplemented).message).toBe("Not built yet · WP-C9");
});
