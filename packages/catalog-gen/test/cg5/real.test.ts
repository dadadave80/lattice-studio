/**
 * The real overlay in `overlay/`: it loads, it lints clean against Lattice at the pin, the facets and inits v1
 * recipes use carry no warnings, and it agrees with K3's fixture values except where the source says otherwise
 * (each difference listed below with its reason). The lint's source checks run when a Lattice checkout exists
 * (`LATTICE_DIR` or `lattice/`); init params are checked when it's built.
 */
import { describe, expect, test } from "bun:test";
import type { InitParam, InitSpec } from "@lattice-studio/core";
import { facetOverlayFields, initOverlayFields, loadOverlay, type Overlay } from "../../src/overlay";
import { formatIssue, formatLintSummary, type LintResult, lintOverlay } from "../../src/overlay-lint";
import { fixtureCatalog, latticeDir, latticeFacts } from "./facts";

const loaded = await loadOverlay();
if (!loaded.ok) throw new Error(loaded.error.map((i) => `${i.file} ${i.path}: ${i.message}`).join("\n"));
const overlay: Overlay = loaded.value;
const fixture = fixtureCatalog();
const dir = latticeDir();

/** Facets and inits the v1 recipes and the Blank diamond use (spec L990), plus the automatic ERC-165 steps. */
const V1_FACETS = [
  ...new Set([
    ...fixture.recipes.filter((r) => r.phase === "v1").flatMap((r) => r.recipe.facets),
    "AccessControlDiamondCut",
  ]),
].sort();
const V1_INITS = [
  "GovernedVaultInit",
  "ERC20Init",
  "SafeDiamondCutInit",
  "AccessControlInit",
  "DiamondIntrospectionInit.initUpgradeable",
  "DiamondIntrospectionInit.initImmutable",
];

describe("overlay/", () => {
  test("every one of the 105 facets has an entry", () => {
    expect(Object.keys(overlay.facets).sort()).toEqual(fixture.facets.map((f) => f.name).sort());
  });

  test("the v1 recipes' facets are all in it", () => {
    expect(V1_FACETS).toEqual([
      "AccessControl", "AccessControlDiamondCut", "DiamondLoupeFacet", "ERC165Facet", "ERC20", "ERC20Votes", "ERC4626",
      "EmergencyStop", "GovernedDiamondCut", "GovernedVault", "Governor", "Receive", "SafeDiamondCut", "TimelockController",
      "VaultCore", "Votes",
    ]);
    for (const f of V1_FACETS) expect(overlay.facets[f]).toBeDefined();
    for (const i of V1_INITS) expect(overlay.inits[i]).toBeDefined();
  });
});

describe.skipIf(dir === null)("the lint against Lattice at the pin", async () => {
  const facts = dir === null ? undefined : await latticeFacts(dir);
  const result: LintResult = facts === undefined ? { errors: [], warnings: [] } : lintOverlay(overlay, facts);

  test("0 errors", () => {
    expect(result.errors.map(formatIssue)).toEqual([]);
  });

  test("every facet and init the v1 recipes use has no warnings", () => {
    const v1 = new Set<string>([...V1_FACETS, ...V1_INITS]);
    expect(result.warnings.filter((w) => v1.has(w.subject)).map(formatIssue)).toEqual([]);
  });

  test("every init contract at the pin has an entry, and every entry is one", () => {
    const names = (facts?.inits ?? []).map((i) => i.name).sort();
    expect(Object.keys(overlay.inits).sort()).toEqual(names);
  });

  test("summary (for the report)", () => {
    console.log(`${formatLintSummary(result)}${facts?.built ? "" : "\n  (lattice/out missing: init params unchecked)"}`);
    for (const w of result.warnings) console.log(`  ${formatIssue(w)}`);
  });
});

// ── K3's fixture values (fixtures/gen/overlay.ts), and where the source overrides them ─────────────

/** Overlay values that differ from or add to the fixture's, each with its reason. */
const FACET_DIFFERENCES: Record<string, { field: "init" | "defaultOwnerOf" | "requires"; why: string }[]> = {
  ERC20Votes: [{ field: "init", why: "ERC20VotesInit initializes the module (src/tokens/ERC20/ERC20VotesInit.sol); K3 set init only for fixture inits" }],
  GovernedVault: [{ field: "init", why: "GovernedVaultInit is its init (src/defi/GovernedVaultInit.sol#L44-L87)" }],
  VaultCore: [{ field: "defaultOwnerOf", why: "DeployVaultCore replaces ERC4626's deposit/mint/withdraw/redeem with VaultCore's (#L21-L23)" }],
};

/**
 * Hard requirements the source states that the fixture doesn't carry (K3 wrote only what v1 flows touch). Each
 * cites a "mount alongside" / "must be present" line in the facet's NatSpec; see the overlay entry.
 */
const REQUIRES_ADDED: Record<string, string[][]> = {
  BridgeERC20: [["CrosschainLink"]],
  BridgeERC7802: [["CrosschainLink"]],
  CrosschainTimelockHandler: [["CrosschainLink"], ["TimelockController"]],
  ERC20Crosschain: [["ERC20"], ["CrosschainLink"]],
  ERC20Votes: [["ERC20"], ["Votes"]],
  ERC4626: [["ERC20"]],
  ERC7802: [["ERC20"]],
  PrivateVoting: [["Semaphore"]],
  ERC20Pausable: [["Pausable"]],
  ERC1271Signature: [["AccountSigner"]],
  ERC4337Validation: [["AccountSigner"]],
};

/** The added requirements' strengths, as each source's wording reads (see the overlay entries' notes). */
const ADDED_STRENGTH: Record<string, "hard" | "convention"> = {
  "ERC20Pausable:Pausable": "convention",
  "ERC1271Signature:AccountSigner": "convention",
  "ERC4337Validation:AccountSigner": "convention",
};

describe("agrees with K3's fixture", () => {
  test("every added requirement is present with its strength (hard unless the source reads as a companion)", () => {
    for (const [name, anyOfs] of Object.entries(REQUIRES_ADDED)) {
      const added = facetOverlayFields(overlay.facets[name]).requires.filter((r) => anyOfs.some((a) => a.join() === r.anyOf.join()));
      expect(added.map((r) => [r.anyOf, r.strength])).toEqual(anyOfs.map((a) => [a, ADDED_STRENGTH[`${name}:${a.join()}`] ?? "hard"]));
    }
  });

  for (const f of fixture.facets) {
    test(`${f.name}: requires, family, defaultOwnerOf and init`, () => {
      const got = facetOverlayFields(overlay.facets[f.name]);
      const differs = new Set((FACET_DIFFERENCES[f.name] ?? []).map((d) => d.field));
      const added = REQUIRES_ADDED[f.name] ?? [];
      expect(got.requires.filter((r) => !added.some((a) => a.join() === r.anyOf.join()))).toEqual(f.requires);
      expect(got.family).toEqual(f.family);
      if (differs.has("defaultOwnerOf")) expect(got.defaultOwnerOf).toEqual(expect.arrayContaining(f.defaultOwnerOf ?? []));
      else expect(got.defaultOwnerOf).toEqual(f.defaultOwnerOf);
      if (differs.has("init")) expect(got.init).not.toEqual(f.init);
      else if (f.init !== undefined) expect(got.init).toBe(f.init);
      if (f.summary !== undefined && overlay.facets[f.name]?.summary !== undefined && f.name === "DiamondCutFacet") {
        expect(got.summary).toBe(f.summary);
      }
    });
  }

  const decorations = (p: InitParam): unknown => ({
    name: p.name,
    unit: p.unit,
    rule: p.rule,
    example: p.example,
    exampleSource: p.exampleSource,
    authority: p.authority,
    role: p.role,
    components: p.components?.map(decorations),
  });

  for (const spec of fixture.inits) {
    test(`${spec.name}: kind, after, sameCall, sequence, registersInterfaces and param decorations`, () => {
      const entry = overlay.inits[spec.name];
      expect(entry).toBeDefined();
      const got = initOverlayFields(entry);
      const want: Partial<InitSpec> = { kind: spec.kind, after: spec.after, sameCall: spec.sameCall };
      if (spec.sequence !== undefined) want.sequence = spec.sequence;
      if (spec.registersInterfaces !== undefined) want.registersInterfaces = spec.registersInterfaces;
      expect(got).toEqual(want as typeof got);
      const params: InitParam[] = spec.params.map((p) => {
        const o = entry?.params?.[p.name];
        const merge = (q: InitParam, ov: typeof o): InitParam => {
          const out: InitParam = { name: q.name, type: q.type, doc: q.doc };
          for (const k of ["unit", "rule", "example", "exampleSource", "authority", "role"] as const) {
            if (ov?.[k] !== undefined) (out as Record<string, unknown>)[k] = ov[k];
          }
          if (q.components) out.components = q.components.map((c) => merge(c, ov?.components?.[c.name]));
          return out;
        };
        return merge(p, o);
      });
      expect(params.map(decorations)).toEqual(spec.params.map(decorations));
    });
  }
});
