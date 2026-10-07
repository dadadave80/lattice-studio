import { describe, expect, test } from "bun:test";
import { isHexValue, splitIdentifier } from "./identifier-parts";

describe("splitIdentifier", () => {
  test("namespaces wrap after each dot", () => {
    expect(splitIdentifier("lattice.storage.GovernedVault")).toEqual(["lattice.", "storage.", "GovernedVault"]);
  });

  test("source paths wrap after each slash", () => {
    expect(splitIdentifier("src/tokens/ERC4626/ERC4626.sol")).toEqual(["src/", "tokens/", "ERC4626/", "ERC4626.", "sol"]);
  });

  test("signatures wrap after the paren and each comma", () => {
    expect(splitIdentifier("ERC20Init.init(string,string)")).toEqual(["ERC20Init.", "init(", "string,", "string)"]);
  });

  test("a parenthesis in prose isn't a break point: no lone \"(\" at a line's end", () => {
    expect(splitIdentifier("In GovernedVaultInit (bundle)")).toEqual(["In GovernedVaultInit (bundle)"]);
  });

  test("snake_case wraps after the underscore", () => {
    expect(splitIdentifier("DEFAULT_ADMIN_ROLE")).toEqual(["DEFAULT_", "ADMIN_", "ROLE"]);
  });

  test("a plain word and hex stay whole", () => {
    expect(splitIdentifier("TimelockController")).toEqual(["TimelockController"]);
    expect(splitIdentifier("0xcdfe7f5c")).toEqual(["0xcdfe7f5c"]);
    expect(splitIdentifier("")).toEqual([]);
  });
});

describe("isHexValue", () => {
  test("only a whole 0x value is hex", () => {
    expect(isHexValue("0xD4C5f5a9")).toBe(true);
    expect(isHexValue("0x")).toBe(false);
    expect(isHexValue("0xD4C5 · 2 selectors")).toBe(false);
    expect(isHexValue("ERC165")).toBe(false);
  });
});
