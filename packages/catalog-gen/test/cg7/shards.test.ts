import { describe, expect, test } from "bun:test";
import type { AbiItem } from "@lattice-studio/core";
import { keccak256 } from "viem";
import { buildFacetDetail, codePath, detailPath, jsonFileBytes, shardRefFor, standardJsonPath, textFileBytes } from "../../src/shards";

const EMPTY_METADATA = { output: { abi: [], userdoc: {}, devdoc: {} } };
const SOURCE = { path: "src/Receive.sol", url: "https://github.com/dadadave80/lattice/blob/deadbeef/src/Receive.sol" };

describe("path conventions (contracts §4)", () => {
  test("code, shard and standard-JSON paths", () => {
    expect(codePath("ERC20")).toBe("code/ERC20.creation.hex");
    expect(detailPath("ERC20")).toBe("shards/ERC20.json");
    expect(standardJsonPath("Lattice")).toBe("json/Lattice.standard.json");
  });
});

describe("jsonFileBytes and textFileBytes", () => {
  test("JSON files are two-space indented with a trailing newline, in the given key order", () => {
    const bytes = jsonFileBytes({ b: 1, a: 2 });
    expect(new TextDecoder().decode(bytes)).toBe('{\n  "b": 1,\n  "a": 2\n}\n');
  });

  test("text files are written as-is, with no added newline", () => {
    const bytes = textFileBytes("0xabc");
    expect(new TextDecoder().decode(bytes)).toBe("0xabc");
  });
});

describe("shardRefFor", () => {
  test("bytes is the file's exact length and hash is keccak256 of those exact bytes", () => {
    const bytes = textFileBytes("0xdeadbeef");
    const ref = shardRefFor("code/X.creation.hex", bytes);
    expect(ref).toEqual({ path: "code/X.creation.hex", bytes: bytes.length, hash: keccak256(bytes) });
  });
});

describe("buildFacetDetail", () => {
  test("Receive's shard ABI is empty: shardAbi drops exportSelectors() and keeps only functions, errors and events, and `receive` is none of those", () => {
    const abi: AbiItem[] = [{ type: "receive", stateMutability: "payable" }];
    const detail = buildFacetDetail("Receive", abi, EMPTY_METADATA, [], SOURCE);
    expect(detail).toEqual({ name: "Receive", abi: [], natspec: { functions: {} }, source: SOURCE });
  });

  test("keeps functions, errors and events, and drops exportSelectors()", () => {
    const abi: AbiItem[] = [
      { type: "function", name: "exportSelectors", inputs: [], outputs: [{ type: "bytes4[]" }], stateMutability: "pure" },
      { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
      { type: "error", name: "InsufficientBalance", inputs: [] },
      { type: "event", name: "Transfer", inputs: [], anonymous: false },
      { type: "constructor", inputs: [], stateMutability: "nonpayable" },
    ];
    const detail = buildFacetDetail("ERC20", abi, EMPTY_METADATA, [], SOURCE);
    expect(detail.abi.map((item) => item.type)).toEqual(["function", "error", "event"]);
    expect(detail.abi.some((item) => "name" in item && item.name === "exportSelectors")).toBe(false);
  });

  test("natspec comes from CG1's facetNatspec, keyed by the given selectors", () => {
    const abi: AbiItem[] = [{ type: "function", name: "foo", inputs: [], outputs: [], stateMutability: "view" }];
    const metadata = { output: { abi: [], userdoc: { methods: { "foo()": { notice: "Does foo." } } }, devdoc: {} } };
    const detail = buildFacetDetail("X", abi, metadata, [{ hex: "0xaaaaaaaa", signature: "foo()" }], SOURCE);
    expect(detail.natspec.functions["0xaaaaaaaa"]).toEqual({ notice: "Does foo." });
  });

  test("carries the given storageLayout in the type's field order, and omits it when absent", () => {
    const withLayout = buildFacetDetail("X", [], EMPTY_METADATA, [], SOURCE, { slots: [] });
    expect(withLayout.storageLayout).toEqual({ slots: [] });
    expect(Object.keys(withLayout)).toEqual(["name", "abi", "natspec", "storageLayout", "source"]);

    const withoutLayout = buildFacetDetail("X", [], EMPTY_METADATA, [], SOURCE);
    expect("storageLayout" in withoutLayout).toBe(false);
    expect(Object.keys(withoutLayout)).toEqual(["name", "abi", "natspec", "source"]);
  });
});
