/**
 * `allFacetStorage` against `fixtures/lattice`: a facet's own namespace (only when its own library annotates
 * one), the namespaces its own library calls directly (one hop, not the whole call graph), diamond-lib's
 * three-facet override (contracts §4), and a facet with no library of its own inheriting what the library it
 * delegates into itself touches.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { allFacetStorage, scanLatticeStorage } from "../../src/storage";

const LATTICE = join(import.meta.dir, "fixtures", "lattice");

const FACETS = [
  { name: "DiamondCutFacet", sourcePath: "lib/diamond-lib/src/facets/DiamondCutFacet.sol" },
  { name: "OwnableFacet", sourcePath: "lib/diamond-lib/src/facets/OwnableFacet.sol" },
  { name: "AccessControl", sourcePath: "src/access/AccessControl.sol" },
  { name: "ERC20", sourcePath: "src/tokens/ERC20/ERC20.sol" },
  { name: "ERC20Votes", sourcePath: "src/tokens/ERC20/ERC20Votes.sol" },
  { name: "ModuleManager", sourcePath: "src/modules/ModuleManager.sol" },
  { name: "ModuleView", sourcePath: "src/modules/ModuleView.sol" },
  { name: "Widget", sourcePath: "src/widgets/Widget.sol" },
];

async function compute() {
  const scan = await scanLatticeStorage(LATTICE);
  if (!scan.ok) throw new Error(scan.error);
  const all = await allFacetStorage(LATTICE, FACETS, scan.value.registry);
  if (!all.ok) throw new Error(all.error);
  return all.value;
}

describe("allFacetStorage", () => {
  test("an ordinary facet owns its own library's namespace and touches nothing else", async () => {
    const { facets } = await compute();
    expect(facets.get("AccessControl")).toEqual({
      storage: { id: "fixture.storage.AccessControl", slot: "0x4bd7c7bcc4cbb414d2a39dc2ec177a93e50117c969ea6ef6a327f91790905f00" },
      touches: [],
    });
    expect(facets.get("ERC20")).toEqual({
      storage: { id: "fixture.storage.ERC20", slot: "0x244d9891fa3a334747a8fd738d3bd398221bda9761683399c33fc8167f013e00" },
      touches: [],
    });
  });

  test("a facet with no storage of its own touches every namespace its own library calls, one hop", async () => {
    const { facets } = await compute();
    expect(facets.get("ERC20Votes")).toEqual({
      touches: ["fixture.storage.AccessControl", "fixture.storage.ERC20"],
    });
  });

  test("diamond-lib's pass-through facets own nothing and touch only diamond.lib.storage (contracts §4)", async () => {
    const { facets } = await compute();
    expect(facets.get("DiamondCutFacet")).toEqual({ touches: ["diamond.lib.storage"] });
    expect(facets.get("OwnableFacet")).toEqual({ touches: ["diamond.lib.storage"] });
  });

  test("a facet with no library of its own inherits what the library it delegates into touches", async () => {
    const { facets } = await compute();
    expect(facets.get("ModuleManager")).toEqual({
      storage: { id: "fixture.storage.ModuleManager", slot: "0x4a5a1bb15d6a8aecdb835ce6590cfc227c3c7bfa62801f91d2e3a6f29abc5e00" },
      touches: ["fixture.storage.AccessControl"],
    });
    expect(facets.get("ModuleView")).toEqual({
      touches: ["fixture.storage.AccessControl", "fixture.storage.ModuleManager"],
    });
  });

  test("a library name mentioned only in a doc comment is never a call (isCalled ignores // and /* */ comments)", async () => {
    // WidgetLib.sol imports AccessControlLib (so it's a real candidate ref) but only ever writes its name inside
    // NatSpec ("Emits ... from AccessControlLib._grantRole ..."), mirroring EmergencyStopLib.sol:104. Before
    // stripping comments, the substring "AccessControlLib." there would look exactly like a call.
    const { facets } = await compute();
    expect(facets.get("Widget")).toEqual({
      storage: { id: "fixture.storage.Widget", slot: "0xa9e789f03ff5d9c6dc8db8a7738dbd7f4e4c404f8712a279f0cd6e8e7563f400" },
      touches: [],
    });
  });

  test("no two facets claim the same storage id", async () => {
    const { duplicateOwners } = await compute();
    expect(duplicateOwners).toEqual([]);
  });

  test("a facet whose source path doesn't exist is an error, not a silent empty result", async () => {
    const scan = await scanLatticeStorage(LATTICE);
    if (!scan.ok) throw new Error(scan.error);
    const result = await allFacetStorage(LATTICE, [{ name: "Ghost", sourcePath: "src/Ghost.sol" }], scan.value.registry);
    expect(result.ok).toBe(false);
  });
});

describe("allFacetStorage: contracts §4 \"no two catalog facets share a storage id or slot\"", () => {
  test("two different ids that happen to declare the same slot are still caught", async () => {
    const COLLISION = join(import.meta.dir, "fixtures", "slot-collision");
    const scan = await scanLatticeStorage(COLLISION);
    if (!scan.ok) throw new Error(scan.error);
    const result = await allFacetStorage(
      COLLISION,
      [
        { name: "C", sourcePath: "src/C.sol" },
        { name: "D", sourcePath: "src/D.sol" },
      ],
      scan.value.registry,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.value.facets.get("C")?.storage?.id).toBe("fixture.storage.C");
    expect(result.value.facets.get("D")?.storage?.id).toBe("fixture.storage.D");
    expect(result.value.duplicateOwners).toEqual([
      "slot 0x3333333333333333333333333333333333333333333333333333333333333300 is claimed by both C and D.",
    ]);
  });
});
