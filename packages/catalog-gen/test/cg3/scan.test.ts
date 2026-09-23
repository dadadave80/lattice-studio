/**
 * `scanLatticeStorage` against `fixtures/lattice`, a small synthetic checkout shaped like the real one: a
 * diamond-lib pair (`DiamondLib`, `ERC165Lib`, `OwnableLib` with no annotation of its own), two ordinary
 * namespace-owning libraries, and `ERC20VotesLib.sol` reproduced at the exact file:line of the known Lattice bug
 * (ledger "For Lattice" #2) so the waiver logic is exercised against real coordinates, not a stand-in.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { describeMismatch, scanLatticeStorage, WAIVED_SLOT } from "../../src/storage";

const LATTICE = join(import.meta.dir, "fixtures", "lattice");
const DUPLICATE = join(import.meta.dir, "fixtures", "duplicate");
const UNVERIFIED = join(import.meta.dir, "fixtures", "unverified");
const UNCLASSIFIED = join(import.meta.dir, "fixtures", "unclassified");

describe("scanLatticeStorage", () => {
  test("builds the registry from every annotated namespace, verified", async () => {
    const result = await scanLatticeStorage(LATTICE);
    if (!result.ok) throw new Error(result.error);
    expect([...result.value.registry.keys()].sort()).toEqual([
      "diamond.lib.storage",
      "diamond.lib.storage.ERC165",
      "fixture.storage.AccessControl",
      "fixture.storage.ERC20",
      "fixture.storage.ModuleManager",
      "fixture.storage.Widget",
    ]);
    expect(result.value.registry.get("fixture.storage.ERC20")).toEqual({
      file: "src/tokens/ERC20/libraries/ERC20Lib.sol",
      line: 5,
      slot: "0x244d9891fa3a334747a8fd738d3bd398221bda9761683399c33fc8167f013e00",
    });
    expect(result.value.unclassified).toEqual([]);
  });

  test("has no unwaived mismatches", async () => {
    const result = await scanLatticeStorage(LATTICE);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.mismatches).toEqual([]);
  });

  test("waives exactly the known bug, at its own file and line, and nowhere else", async () => {
    const result = await scanLatticeStorage(LATTICE);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.waived).toHaveLength(1);
    const [waived] = result.value.waived;
    expect(waived).toMatchObject({ file: WAIVED_SLOT.file, line: WAIVED_SLOT.line, kind: "map" });
    expect(waived?.declared).toBe("0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563");
    expect(waived?.expected).toBe("0xfb939cb1ca033f66389071014066e3ba51464fd8ec15c96518ea9663d9c0f494");
    expect(describeMismatch(waived!)).toContain(`${WAIVED_SLOT.file}:${WAIVED_SLOT.line}`);
  });

  test("OwnableLib's non-ERC-7201 owner slot never enters the registry or the mismatch list", async () => {
    const result = await scanLatticeStorage(LATTICE);
    if (!result.ok) throw new Error(result.error);
    const files = [...result.value.registry.values()].map((v) => v.file);
    expect(files).not.toContain("lib/diamond-lib/src/libraries/OwnableLib.sol");
    expect(result.value.mismatches.some((m) => m.name === "_OWNER_SLOT")).toBe(false);
  });

  test("a directory with neither src/ nor lib/diamond-lib/src/ is an error", async () => {
    const result = await scanLatticeStorage(join(import.meta.dir, "fixtures", "does-not-exist"));
    expect(result.ok).toBe(false);
  });
});

describe("scanLatticeStorage: duplicate annotations", () => {
  test("two files annotating the same id are reported, not silently overwritten", async () => {
    const result = await scanLatticeStorage(DUPLICATE);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.duplicateIds).toEqual([
      "fixture.storage.Dup is annotated in both src/a/ALib.sol:7 and src/a/BLib.sol:7.",
    ]);
  });

  test("both files' wrong slots are reported as mismatches, with file and line", async () => {
    const result = await scanLatticeStorage(DUPLICATE);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.mismatches).toEqual([
      {
        file: "src/a/ALib.sol",
        line: 5,
        name: "A_STORAGE_SLOT",
        kind: "namespace",
        id: "fixture.storage.Dup",
        declared: "0x1111111111111111111111111111111111111111111111111111111111111100",
        expected: "0x4879ed6cbf4c40b00ef78601fa6758a30d91dea40f6d3652752bcd672979a700",
      },
      {
        file: "src/a/BLib.sol",
        line: 5,
        name: "B_STORAGE_SLOT",
        kind: "namespace",
        id: "fixture.storage.Dup",
        declared: "0x2222222222222222222222222222222222222222222222222222222222222200",
        expected: "0x4879ed6cbf4c40b00ef78601fa6758a30d91dea40f6d3652752bcd672979a700",
      },
    ]);
  });

  test("the registry still records the first-seen file's declared (if wrong) slot, for the report to flag", async () => {
    // A mismatch is reported as an error either way (the test above); the registry reflects what's actually on
    // chain (the declared literal), not a "corrected" value nobody wrote.
    const result = await scanLatticeStorage(DUPLICATE);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.registry.get("fixture.storage.Dup")).toEqual({
      file: "src/a/ALib.sol",
      line: 5,
      slot: "0x1111111111111111111111111111111111111111111111111111111111111100",
    });
    expect(result.value.unverified).toEqual([]);
  });
});

describe("scanLatticeStorage: an annotation with no matching slot constant", () => {
  test("is surfaced as unverified, not silently dropped as \"no storage\"", async () => {
    const result = await scanLatticeStorage(UNVERIFIED);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.registry.size).toBe(0);
    expect(result.value.unverified).toEqual([{ id: "fixture.storage.NoSlot", file: "src/NoSlotLib.sol", line: 5 }]);
  });
});

describe("scanLatticeStorage: an ERC165_MAP_* constant resolveFormula still can't classify", () => {
  test("is surfaced as unclassified, not silently skipped", async () => {
    const result = await scanLatticeStorage(UNCLASSIFIED);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.unclassified).toHaveLength(1);
    expect(result.value.unclassified[0]).toMatchObject({
      file: "src/WhateverLib.sol",
      line: 5,
      name: "ERC165_MAP_IWHATEVER_SLOT",
      formula: undefined,
    });
    // it's still nobody's own namespace, so it never enters the registry or a facet's storage
    expect(result.value.registry.size).toBe(0);
  });
});
