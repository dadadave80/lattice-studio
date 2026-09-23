/**
 * Text-level parsing: `@custom:storage-location erc7201:<id>` annotations and `bytes32 constant NAME = 0x...;`
 * slot declarations, classified by whichever formula their immediately preceding comment documents. The two
 * comment shapes and the multi-line declaration below are copied from real Lattice source (AccessControlLib.sol,
 * ERC20VotesLib.sol) so a regression here means real source stopped parsing, not just a synthetic case.
 */
import { describe, expect, test } from "bun:test";
import { describeMismatch, findAnnotations, findSlotConstants, type SlotMismatch, stripComments } from "../../src/storage";

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

const ERC165_BASE = "0x9ca7f3e2e2bfb15fdf072b85dde92837cddacee6cf2f6b38cd06c9457c1c4200";

describe("findSlotConstants: map formula, the ordinary inline shape", () => {
  test("classifies keccak256(abi.encode(bytes4, base))", () => {
    const text =
      "/// @dev 0x7965db0b is `type(IAccessControl).interfaceId`.\n" +
      `/// \`keccak256(abi.encode(bytes4(0x7965db0b), ${ERC165_BASE}))\`.\n` +
      "bytes32 constant ERC165_MAP_IACCESSCONTROL_SLOT = 0xce317eb1da4e1492e501dc3f63d2206e3e9294a33442f09d99ce09cbbaaeae1f;\n";
    const found = findSlotConstants(text, "src/AccessControlLib.sol");
    expect(found[0]?.formula).toEqual({ kind: "map", selector: "0x7965db0b", base: ERC165_BASE });
  });
});

describe("findSlotConstants: map formula, the widened shapes CG3 review asked for", () => {
  test("a documentary copy that names the base instead of repeating it (GovernedDiamondCutLib.sol's ERC165_MAP_ICUT_SLOT)", () => {
    const text =
      "/// @dev `type(IGovernedDiamondCut).interfaceId == 0x1f931c1c`, identical to `IDiamondCut` (the\n" +
      "///      interface exposes only `diamondCut`). Its ERC-165 map slot is therefore\n" +
      "///      `keccak256(abi.encode(bytes4(0x1f931c1c), ERC165_STORAGE_LOCATION))`\n" +
      "///      `= 0xa0f80413692945aab97c6ef0328381ebb94e4b17a84d11ebf6b61f73435b6d7e`, which is exactly\n" +
      "///      `DiamondLib`'s `ERC165_MAP_ICUT_SLOT`. We do NOT mint a separate constant.\n" +
      "bytes32 constant ERC165_MAP_ICUT_SLOT = 0xa0f80413692945aab97c6ef0328381ebb94e4b17a84d11ebf6b61f73435b6d7e;\n";
    const found = findSlotConstants(text, "src/GovernedDiamondCutLib.sol");
    expect(found[0]?.formula).toEqual({ kind: "map", selector: "0x1f931c1c", base: ERC165_BASE });
  });

  test("a trailing same-line // 0xselector comment, shared header several declarations up (ERC7579ModuleConfigLib.sol)", () => {
    const text =
      "/// @dev ERC-165 map slots for the three OZ ERC-7579 interfaces the Diamond supports.\n" +
      "///      `keccak256(abi.encode(bytes4(id), 0x9ca7f3e2…c1c4200))`.\n" +
      "bytes32 constant ERC165_MAP_IERC7579EXECUTION_SLOT = 0x1adc25256844eecf70d1111a7d897d059d6c39bccc33e2fe1bcdd0aa07e45227; // 0x3f3f9537\n" +
      "bytes32 constant ERC165_MAP_IERC7579ACCOUNTCONFIG_SLOT =\n" +
      "    0xca27659497801bbd07af0889ead6ea5a1a9b8739438e7af51464f7082b08ae43; // 0xbe1d6cf6\n" +
      "bytes32 constant ERC165_MAP_IERC7579MODULECONFIG_SLOT =\n" +
      "    0x1c2e0d7514777ddafe41add8aefc1cb6319fbc463de0c6eb0b00433efbdbdd41; // 0x232dbb4a\n";
    const found = findSlotConstants(text, "src/ERC7579ModuleConfigLib.sol");
    expect(found).toHaveLength(3);
    expect(found[0]?.formula).toEqual({ kind: "map", selector: "0x3f3f9537", base: ERC165_BASE });
    // These two have no comment of their own at all (their window is blank): the trailing comment on each
    // constant's own line is enough on its own, with no need to reach back to the shared header.
    expect(found[1]?.formula).toEqual({ kind: "map", selector: "0xbe1d6cf6", base: ERC165_BASE });
    expect(found[2]?.formula).toEqual({ kind: "map", selector: "0x232dbb4a", base: ERC165_BASE });
  });

  test("batched \"Name = 0xselector\" pairs in a shared header, keyed by the constant's own name (ERC6551AccountLib.sol)", () => {
    const text =
      "/// @dev ERC-165 map slots. `keccak256(abi.encode(bytes4(id), 0x9ca7f3e2…c1c4200))`.\n" +
      "///      IERC6551Account = 0x6faff5f1; IERC6551Executable = 0x51945447.\n" +
      "bytes32 constant ERC165_MAP_IERC6551ACCOUNT_SLOT = 0xe5e50471a231013bea8f6034ec0b978814d697120ebd88e3624ed42959ed0a66;\n" +
      "bytes32 constant ERC165_MAP_IERC6551EXECUTABLE_SLOT =\n" +
      "    0x7119a8e42d55700f1f34f34e17ffb769e414497fcab2ff2004aa97c610742b4b;\n";
    const found = findSlotConstants(text, "src/ERC6551AccountLib.sol");
    expect(found[0]?.formula).toEqual({ kind: "map", selector: "0x6faff5f1", base: ERC165_BASE });
    // The second constant's own window is blank; its selector comes from the shared header two declarations up,
    // matched by name (IERC6551EXECUTABLE ~ IERC6551Executable), not just "whatever pair comes first".
    expect(found[1]?.formula).toEqual({ kind: "map", selector: "0x51945447", base: ERC165_BASE });
  });

  test("a bare selector introduced only as \"is type(X).interfaceId\", no formula at all (AccessManagerLib.sol)", () => {
    const text =
      "/// @dev `0x8fc52f86` is `type(IAccessManager).interfaceId`.\n" +
      "bytes32 constant ERC165_MAP_IACCESSMANAGER_SLOT = 0xa0825c9ce05c3e98cbd409c12bc8bdadc253d720dbb80af60f4b2f3807f3c1dd;\n";
    const found = findSlotConstants(text, "src/AccessManagerLib.sol");
    expect(found[0]?.formula).toEqual({ kind: "map", selector: "0x8fc52f86", base: ERC165_BASE });
  });

  test("a shared header's pairs never bleed onto a differently-named constant with its own blank window", () => {
    const text =
      "/// @dev IFoo = 0x11111111; IBar = 0x22222222.\n" +
      "bytes32 constant ERC165_MAP_IFOO_SLOT = 0x1111111111111111111111111111111111111111111111111111111111111111;\n" +
      "bytes32 constant ERC165_MAP_IBAZ_SLOT = 0x2222222222222222222222222222222222222222222222222222222222222222;\n";
    const found = findSlotConstants(text, "f.sol");
    expect(found[0]?.formula).toEqual({ kind: "map", selector: "0x11111111", base: ERC165_BASE });
    // IBAZ has no pair named "IBAZ" in the header (only IFoo and IBar), so it stays unclassified rather than
    // grabbing IBar's selector just because it's nearby.
    expect(found[1]?.formula).toBeUndefined();
  });

  test("a genuinely new comment shape is left unclassified, not guessed at", () => {
    const text = "/// @dev Some future format this parser has never seen.\nbytes32 constant ERC165_MAP_IWHATEVER_SLOT = 0x3333333333333333333333333333333333333333333333333333333333333333;\n";
    const found = findSlotConstants(text, "f.sol");
    expect(found[0]?.formula).toBeUndefined();
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

describe("stripComments", () => {
  test("blanks a // line comment, keeping the newline", () => {
    const code = stripComments("AccessControlLib.checkRole(); // AccessControlLib.other()\nfoo();");
    expect(code).toBe("AccessControlLib.checkRole();                            \nfoo();");
    expect(code.split("\n")).toHaveLength(2);
    expect(code).toContain("AccessControlLib.checkRole();"); // real code, kept
    expect(code.split("\n")[0]).not.toContain("other"); // the comment's own mention, gone
  });

  test("blanks a /* */ block comment, keeping any newlines inside it", () => {
    const code = stripComments("a(); /* AccessControlLib.\n  x */ b();");
    expect(code).toBe("a();                     \n       b();");
    expect(code.split("\n")).toHaveLength(2);
    expect(code).not.toContain("AccessControlLib");
  });

  test("a doc comment naming a library, like EmergencyStopLib.sol:104's \"(from AccessControlLib._grantRole)\", disappears", () => {
    const text =
      "/// @dev Emits `GuardianAdded` only if new. Note: also emits `IAccessControl.RoleGranted`\n" +
      "///      (from AccessControlLib._grantRole) when a guardian is added.\n" +
      "function addGuardian() internal {\n" +
      "    EmergencyStopStorageLib.doThing();\n" +
      "}\n";
    const code = stripComments(text);
    expect(code).not.toContain("AccessControlLib.");
    expect(code).toContain("EmergencyStopStorageLib.doThing();");
  });

  test("a string literal that happens to contain // or /* is left alone", () => {
    expect(stripComments('string memory s = "https://example.com/* not a comment */";')).toBe(
      'string memory s = "https://example.com/* not a comment */";',
    );
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
