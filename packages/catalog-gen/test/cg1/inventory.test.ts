import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  entryRef,
  INVENTORY_PATH,
  parseInventory,
  readInventory,
  readInventoryArtifacts,
} from "../../src/inventory";

const FIXTURE = join(import.meta.dir, "fixtures", "lattice");

function source(names: string[], paths: string[], sizes: [number, number] = [names.length, paths.length]): string {
  const list = (xs: string[]) => xs.map((x) => `            "${x}"`).join(",\n");
  return `library FacetInventory {
    function inventory() internal pure returns (string[] memory names, string[] memory paths) {
        string[${sizes[0]}] memory n = [
${list(names)}
        ];
        string[${sizes[1]}] memory p = [
${list(paths)}
        ];
    }
}`;
}

function error(result: { ok: boolean; error?: string }): string {
  expect(result.ok).toBe(false);
  return result.error ?? "";
}

describe("parseInventory", () => {
  test("reads the checked-in sample in order, with basename entries flagged", async () => {
    const result = await readInventory(FIXTURE);
    expect(result).toEqual({
      ok: true,
      value: [
        { name: "ERC20", artifact: "src/tokens/ERC20/ERC20.sol:ERC20", file: "src/tokens/ERC20/ERC20.sol", basename: false },
        { name: "Receive", artifact: "src/Receive.sol:Receive", file: "src/Receive.sol", basename: false },
        {
          name: "DiamondCutFacet",
          artifact: "DiamondCutFacet.sol:DiamondCutFacet",
          file: "DiamondCutFacet.sol",
          basename: true,
        },
      ],
    });
  });

  test("ignores comments inside the arrays, quotes and colons included", () => {
    const text = source(["A", "B"], ["src/A.sol:A", "src/B.sol:B"]).replace(
      '"B"',
      '// a "quoted:thing" in a comment\n            "B" /* "C" */',
    );
    const result = parseInventory(text);
    expect(result.ok && result.value.map((e) => e.name)).toEqual(["A", "B"]);
  });

  test("an escaped quote doesn't end a string, so the comment stripper and the string scanner agree", () => {
    // Were `\"` taken as the closing quote, `// x", "B"];` would read as a comment and swallow the rest of the line.
    const text = String.raw`string[2] memory n = ["A\" // x", "B"]; string[2] memory p = ["src/A.sol:A\" // x", "src/B.sol:B"];`;
    const result = parseInventory(text);
    expect(result.ok && result.value.map((e) => e.name)).toEqual([String.raw`A\" // x`, "B"]);
  });

  test("a comment marker inside a single-quoted string stays", () => {
    const text = String.raw`string s = 'a // \' b'; string[1] memory n = ["A"]; string[1] memory p = ["src/A.sol:A"];`;
    const result = parseInventory(text);
    expect(result.ok && result.value.map((e) => e.name)).toEqual(["A"]);
  });

  test("accepts the paths array first", () => {
    const text = `string[1] memory p = ["src/A.sol:A"]; string[1] memory n = ["A"];`;
    const result = parseInventory(text);
    expect(result.ok && result.value).toEqual([{ name: "A", artifact: "src/A.sol:A", file: "src/A.sol", basename: false }]);
  });

  test("refuses a path that names another contract", () => {
    expect(error(parseInventory(source(["A", "B"], ["src/A.sol:A", "src/B.sol:C"])))).toBe(
      `${INVENTORY_PATH}: entry 1 is named B but its path "src/B.sol:C" names C.`,
    );
  });

  test("refuses an array whose length differs from its declared size", () => {
    expect(error(parseInventory(source(["A"], ["src/A.sol:A"], [2, 1])))).toBe(
      `${INVENTORY_PATH}: array n declares 2 entries but lists 1.`,
    );
  });

  test("refuses names and paths of different lengths", () => {
    expect(error(parseInventory(source(["A", "B"], ["src/A.sol:A"])))).toBe(`${INVENTORY_PATH}: 2 names but 1 paths.`);
  });

  test("refuses a duplicate", () => {
    expect(error(parseInventory(source(["A", "A"], ["src/A.sol:A", "src/B.sol:A"])))).toBe(
      `${INVENTORY_PATH}: A is listed twice.`,
    );
  });

  test("refuses a path without a .sol file", () => {
    expect(error(parseInventory(source(["A"], ["src/A:A"])))).toBe(
      `${INVENTORY_PATH}: entry A has path "src/A:A", which doesn't name a .sol file.`,
    );
  });

  test("refuses a file without exactly two arrays", () => {
    expect(error(parseInventory("library FacetInventory {}"))).toBe(
      `${INVENTORY_PATH}: expected 2 string array literals (names and paths), found 0.`,
    );
  });

  test("refuses two arrays that are both names", () => {
    expect(error(parseInventory(`string[1] memory a = ["A"]; string[1] memory b = ["B"];`))).toBe(
      `${INVENTORY_PATH}: couldn't tell the names array from the paths array.`,
    );
  });

  test("says which file is missing", async () => {
    const dir = join(FIXTURE, "nowhere");
    expect(error(await readInventory(dir))).toBe(`${join(dir, INVENTORY_PATH)} doesn't exist.`);
  });
});

describe("artifacts of the inventory", () => {
  test("entryRef keeps the full source path unless the entry is a basename", () => {
    expect(entryRef({ name: "ERC20", artifact: "", file: "src/tokens/ERC20/ERC20.sol", basename: false })).toEqual({
      file: "ERC20.sol",
      contract: "ERC20",
      sourcePath: "src/tokens/ERC20/ERC20.sol",
    });
    expect(entryRef({ name: "X", artifact: "", file: "X.sol", basename: true })).toEqual({ file: "X.sol", contract: "X" });
  });

  test("source paths come from the artifacts, including diamond-lib's basename entries", async () => {
    const inventory = await readInventory(FIXTURE);
    if (!inventory.ok) throw new Error(inventory.error);
    const result = await readInventoryArtifacts(FIXTURE, inventory.value);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.map((r) => [r.entry.name, r.artifact.sourcePath])).toEqual([
      ["ERC20", "src/tokens/ERC20/ERC20.sol"],
      ["Receive", "src/Receive.sol"],
      ["DiamondCutFacet", "lib/diamond-lib/src/facets/DiamondCutFacet.sol"],
    ]);
  });

  test("names the facet whose artifact is missing", async () => {
    const result = await readInventoryArtifacts(FIXTURE, [
      { name: "Nope", artifact: "src/Nope.sol:Nope", file: "src/Nope.sol", basename: false },
    ]);
    expect(error(result)).toBe(
      `Nope: no artifact for src/Nope.sol:Nope under ${join(FIXTURE, "out")}. Build with FOUNDRY_PROFILE=ci forge build.`,
    );
  });
});
