/**
 * Integration: the pinned Lattice checkout's real source (`src/` and `lib/diamond-lib/src/`), cross-checked
 * against K3's fixture catalog (`fixtures/catalog/fixture/index.json`). Runs whenever this WP has its own Lattice
 * checkout (or `LATTICE_DIR` points at one); skipped against the main checkout's read-only `lattice/`. Needs no
 * `forge build`: storage.ts only reads source text, never compiler output.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { studioEnv } from "../../src/anvil";
import { readInventory } from "../../src/inventory";
import { allFacetStorage, scanLatticeStorage, WAIVED_SLOT } from "../../src/storage";
import { realBuildGate } from "../cg1/real-build-gate";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const gate = realBuildGate((name) => studioEnv(name, REPO_ROOT), REPO_ROOT, (bin) => Bun.which(bin));
const LATTICE = gate.latticeDir;

type FixtureFacet = { name: string; storage?: { id: string; slot: string }; touches: string[] };
type FixtureCatalog = { facets: FixtureFacet[] };

/** The facet contract's own source path, the way solc's `compilationTarget` gives it (spec L156-L168). */
async function resolveSourcePath(entry: { name: string; file: string; basename: boolean }): Promise<string> {
  if (!entry.basename) return entry.file;
  const path = `lib/diamond-lib/src/facets/${entry.name}.sol`;
  if (!(await Bun.file(join(LATTICE, path)).exists())) throw new Error(`${entry.name}: expected ${path}`);
  return path;
}

/**
 * Facets whose `touches` genuinely can't be found by following library calls (contracts §4's storage/touches
 * pairing is source-derived; these four instead reflect a compositional relationship documented only in the
 * deploy scripts spec R19 cites, e.g. `DeployGovernedVault.s.sol`, never as a call in the library file itself).
 * Verified by reading every library each of these facets' own library imports: none of them calls, or is called
 * by, a library that reaches the missing namespace.
 */
const EXPLAINED_TOUCHES_DIFFERENCES: Record<string, { missing: string[]; extra: string[] }> = {
  // ERC20CappedLib only ever receives a pre-computed `newSupply` parameter; it never calls ERC20Lib.
  ERC20Capped: { missing: ["lattice.storage.ERC20"], extra: [] },
  // GovernedVaultLib.sol imports nothing but its own interface: its composition with VaultCore, ERC4626,
  // Governor, ERC20, EIP712, Nonces and Votes is a seam relationship (spec R19), not a library call.
  GovernedVault: {
    missing: [
      "lattice.storage.AccessControl",
      "lattice.storage.EIP712",
      "lattice.storage.ERC20",
      "lattice.storage.ERC4626",
      "lattice.storage.Governor",
      "lattice.storage.Nonces",
      "lattice.storage.VaultCore",
      "lattice.storage.Votes",
    ],
    extra: [],
  },
  // VaultCoreLib calls ERC4626Lib directly (one hop, correctly touched); ERC4626Lib itself calls ERC20Lib
  // (a second hop CG3 doesn't follow, matching every other case where a peer library's own further calls
  // aren't inherited, e.g. BridgeERC20 doesn't touch AccessControl through CrosschainLinkLib).
  VaultCore: { missing: ["lattice.storage.ERC20"], extra: [] },
  // VotesLib is token-agnostic (`_getVotingUnits` is overridden by ERC20VotesLib); it never calls ERC20Lib.
  Votes: { missing: ["lattice.storage.ERC20"], extra: [] },
};

const title = "against the pinned Lattice's real source";
describe.skipIf(!gate.run)(gate.run ? title : `${title} (skipped: ${gate.reason})`, () => {
  test("the registry has exactly the 90 pinned annotations, all verified, one waived", async () => {
    const scan = await scanLatticeStorage(LATTICE);
    if (!scan.ok) throw new Error(scan.error);
    expect(scan.value.registry.size).toBe(90);
    expect(scan.value.mismatches).toEqual([]);
    expect(scan.value.duplicateIds).toEqual([]);
    expect(scan.value.unverified).toEqual([]);
    expect(scan.value.unclassified).toEqual([]);
    expect(scan.value.waived).toHaveLength(1);
    expect(scan.value.waived[0]).toMatchObject({ file: WAIVED_SLOT.file, line: WAIVED_SLOT.line });
  });

  test("every facet's storage and touches, cross-checked against K3's fixture catalog", async () => {
    const inventory = await readInventory(LATTICE);
    if (!inventory.ok) throw new Error(inventory.error);
    expect(inventory.value).toHaveLength(100);

    const facets = await Promise.all(
      inventory.value.map(async (e) => ({ name: e.name, sourcePath: await resolveSourcePath(e) })),
    );

    const scan = await scanLatticeStorage(LATTICE);
    if (!scan.ok) throw new Error(scan.error);
    const all = await allFacetStorage(LATTICE, facets, scan.value.registry);
    if (!all.ok) throw new Error(all.error);
    expect(all.value.duplicateOwners).toEqual([]); // contracts §4: no two catalog facets share a storage id

    const fixturePath = join(REPO_ROOT, "fixtures", "catalog", "fixture", "index.json");
    const fixture = (await Bun.file(fixturePath).json()) as FixtureCatalog;
    expect(fixture.facets).toHaveLength(100);

    const unexplainedDiffs: string[] = [];
    for (const f of fixture.facets) {
      const mine = all.value.facets.get(f.name);
      if (mine === undefined) {
        unexplainedDiffs.push(`${f.name}: not in the computed catalog.`);
        continue;
      }
      const wantId = f.storage?.id;
      const gotId = mine.storage?.id;
      if (wantId !== gotId) unexplainedDiffs.push(`${f.name}: storage.id wanted ${wantId}, got ${gotId}.`);
      if (wantId !== undefined && gotId !== undefined) {
        expect(mine.storage?.slot.toLowerCase()).toBe(f.storage?.slot.toLowerCase());
      }

      const want = new Set(f.touches);
      const got = new Set(mine.touches);
      const explained = EXPLAINED_TOUCHES_DIFFERENCES[f.name];
      const missing = [...want].filter((id) => !got.has(id) && !(explained?.missing.includes(id) ?? false));
      const extra = [...got].filter((id) => !want.has(id) && !(explained?.extra.includes(id) ?? false));
      if (missing.length > 0) unexplainedDiffs.push(`${f.name}: missing touches ${missing.join(", ")}.`);
      if (extra.length > 0) unexplainedDiffs.push(`${f.name}: extra touches ${extra.join(", ")}.`);

      // The explained gap itself must still be real: nothing "extra" claimed as explained should ever
      // silently absorb a genuinely new difference this build introduces.
      if (explained !== undefined) {
        const stillMissing = explained.missing.filter((id) => want.has(id) && !got.has(id));
        expect(stillMissing).toEqual(explained.missing);
      }
    }
    expect(unexplainedDiffs).toEqual([]);
  });
});
