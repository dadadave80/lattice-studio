import { expect, test } from "bun:test";
import { ARACHNID_PROXY, CREATEX } from "../address";
import { API_OWNERS, type ApiName } from "../model/api";
import * as mod from "./index";

test("every C5c function is exported and built", () => {
  const owned = (Object.keys(API_OWNERS) as ApiName[]).filter((name) => API_OWNERS[name] === "C5c");
  expect(owned.sort()).toEqual(["buildDiamondDeploy", "buildMissingDeploys", "calldataHash", "gasShare"]);
  for (const name of owned) expect(typeof (mod as Record<string, unknown>)[name]).toBe("function");
  expect(() => mod.gasShare(1n, 2n)).not.toThrow();
  expect(() => mod.calldataHash("0x")).not.toThrow();
});

test("deploy reuses the address module's constants instead of redefining them", () => {
  expect(Object.keys(mod)).not.toContain("ARACHNID_PROXY");
  expect(Object.keys(mod)).not.toContain("CREATEX");
  expect([ARACHNID_PROXY, CREATEX]).not.toContain(mod.MULTICALL3);
});
