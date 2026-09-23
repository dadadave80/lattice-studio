/**
 * Text-level parsing: `@custom:storage-location erc7201:<id>` annotations and `bytes32 constant NAME = 0x...;`
 * slot declarations, classified by whichever formula their immediately preceding comment documents. The two
 * comment shapes and the multi-line declaration below are copied from real Lattice source (AccessControlLib.sol,
 * ERC20VotesLib.sol) so a regression here means real source stopped parsing, not just a synthetic case.
 */
import { describe, expect, test } from "bun:test";
import { describeMismatch, findAnnotations, findSlotConstants, type SlotMismatch } from "../../src/storage";

describe("findAnnotations", () => {
  test("finds an erc7201 annotation and its line", () => {
    const text = [
      "// SPDX-License-Identifier: MIT",
      "pragma solidity ^0.8.30;",
      "",
      "/// @custom:storage-location erc7201:lattice.storage.ERC20",
      "struct ERC20Storage {",
      "    uint256 x;",
      "}",
    ].join("\n");
    expect(findAnnotations(text, "src/ERC20Lib.sol")).toEqual([
      { id: "lattice.storage.ERC20", file: "src/ERC20Lib.sol", line: 4 },
    ]);
  });

  test("a file with no annotation finds nothing", () => {
    expect(findAnnotations("library Foo {}", "src/Foo.sol")).toEqual([]);
  });

  test("finds two annotations in one file at their own lines", () => {
    const text = "one\n/// @custom:storage-location erc7201:a\nstruct A {}\n\n/// @custom:storage-location erc7201:b\nstruct B {}\n";
    expect(findAnnotations(text, "f.sol")).toEqual([
      { id: "a", file: "f.sol", line: 2 },
      { id: "b", file: "f.sol", line: 5 },
    ]);
  });
});

describe("findSlotConstants: namespace formula", () => {
  test("classifies the full ERC-7201 wrapper, not a bare keccak256", () => {
    const text =
      '/// @dev `keccak256(abi.encode(uint256(keccak256("lattice.storage.AccessControl")) - 1)) & ~bytes32(uint256(0xff))`.\n' +
      "bytes32 constant ACCESS_CONTROL_STORAGE_SLOT = 0xb914f813e2d49e02dd5aa794466aa4a74f9c100c2b1e98e29e7267020b834d00;\n";
    const found = findSlotConstants(text, "src/AccessControlLib.sol");
    expect(found).toEqual([
      {
        file: "src/AccessControlLib.sol",
        line: 2,
        name: "ACCESS_CONTROL_STORAGE_SLOT",
        declared: "0xb914f813e2d49e02dd5aa794466aa4a74f9c100c2b1e98e29e7267020b834d00",
        formula: { kind: "namespace", id: "lattice.storage.AccessControl" },
      },
    ]);
  });

  test("a bare typehash keccak256(\"...\") comment is not the ERC-7201 formula", () => {
    const text =
      '/// @dev The owner slot is given by:\n/// `bytes32(~uint256(uint32(bytes4(keccak256("_OWNER_SLOT_NOT")))))`.\n' +
      "bytes32 internal constant _OWNER_SLOT = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff74873927;\n";
    const found = findSlotConstants(text, "src/OwnableLib.sol");
    expect(found).toHaveLength(1);
    expect(found[0]?.formula).toBeUndefined();
  });

  test("handles the value wrapping to its own line (ERC20VotesLib.sol's pattern)", () => {
    const text =
      '/// @dev `keccak256(abi.encode(uint256(keccak256("diamond.lib.storage.ERC165")) - 1)) & ~bytes32(uint256(0xff))`.\n' +
      "bytes32 constant ERC20VOTES_ERC165_STORAGE_LOCATION =\n" +
      "    0x9ca7f3e2e2bfb15fdf072b85dde92837cddacee6cf2f6b38cd06c9457c1c4200;\n";
    const found = findSlotConstants(text, "src/ERC20VotesLib.sol");
    expect(found[0]?.formula).toEqual({ kind: "namespace", id: "diamond.lib.storage.ERC165" });
    expect(found[0]?.declared).toBe("0x9ca7f3e2e2bfb15fdf072b85dde92837cddacee6cf2f6b38cd06c9457c1c4200");
  });
});

describe("findSlotConstants: map formula", () => {
  test("classifies keccak256(abi.encode(bytes4, base))", () => {
    const text =
      "/// @dev 0x7965db0b is `type(IAccessControl).interfaceId`.\n" +
      "/// `keccak256(abi.encode(bytes4(0x7965db0b), 0x9ca7f3e2e2bfb15fdf072b85dde92837cddacee6cf2f6b38cd06c9457c1c4200))`.\n" +
      "bytes32 constant ERC165_MAP_IACCESSCONTROL_SLOT = 0xce317eb1da4e1492e501dc3f63d2206e3e9294a33442f09d99ce09cbbaaeae1f;\n";
    const found = findSlotConstants(text, "src/AccessControlLib.sol");
    expect(found[0]?.formula).toEqual({
      kind: "map",
      selector: "0x7965db0b",
      base: "0x9ca7f3e2e2bfb15fdf072b85dde92837cddacee6cf2f6b38cd06c9457c1c4200",
    });
  });
});

describe("findSlotConstants: unrelated constants", () => {
  test("a role id with no formula comment is skipped, not misclassified", () => {
    const text =
      "/// @dev The default admin role is the zero bytes32 value.\n" +
      "bytes32 constant SOME_ROLE = 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;\n";
    const found = findSlotConstants(text, "src/AccessControlLib.sol");
    expect(found).toHaveLength(1);
    expect(found[0]?.formula).toBeUndefined();
  });

  test("only the closest preceding comment is read; an earlier constant's formula doesn't bleed through", () => {
    const text =
      '/// @dev `keccak256(abi.encode(uint256(keccak256("lattice.storage.A")) - 1)) & ~bytes32(uint256(0xff))`.\n' +
      "bytes32 constant A_SLOT = 0x1111111111111111111111111111111111111111111111111111111111111111;\n" +
      "\n" +
      "bytes32 constant B_SLOT = 0x2222222222222222222222222222222222222222222222222222222222222222;\n";
    const found = findSlotConstants(text, "f.sol");
    expect(found[0]?.formula).toEqual({ kind: "namespace", id: "lattice.storage.A" });
    expect(found[1]?.formula).toBeUndefined();
  });
});

test("describeMismatch renders file, line, declared, expected and why", () => {
  const mismatch: SlotMismatch = {
    file: "src/Foo.sol",
    line: 12,
    name: "FOO_SLOT",
    kind: "namespace",
    id: "lattice.storage.Foo",
    declared: "0x00",
    expected: "0x01",
  };
  expect(describeMismatch(mismatch)).toBe("src/Foo.sol:12: FOO_SLOT = 0x00, expected 0x01 (erc7201:lattice.storage.Foo).");
});
