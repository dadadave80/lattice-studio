/**
 * The overlay schema, loader and projections (contracts §4 "Overlay files"), on small inline files.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyInitOverlay,
  buildOverlay,
  facetOverlayFields,
  initOverlayFields,
  loadOverlay,
  type OverlayFile,
  overlaySources,
  parseOverlayFile,
  parseSource,
} from "../../src/overlay";

const facet = (text: string) => parseOverlayFile("facets", text, "overlay/facets/defi.yaml");
const init = (text: string) => parseOverlayFile("inits", text, "overlay/inits/defi.yaml");
const messages = (r: { ok: boolean; error?: { path: string; message: string }[] }) =>
  r.ok ? [] : (r.error ?? []).map((i) => `${i.path}: ${i.message}`);

const VAULT_CORE = `
VaultCore:
  requires:
    - anyOf: [ERC4626]
      strength: hard
      reason: it runs the assets behind ERC4626's shares and initializes after it
      source: src/defi/libraries/VaultCoreLib.sol#L64-L65
  defaultOwnerOf:
    - selectors: ["0x01e1d114"]
      source: docs/guides/compose-your-own-diamond.md#L40-L40
  init:
    name: VaultCoreInit
    source: src/defi/VaultCoreInit.sol#L24-L31
  seamReview: totalAssets is a seam in GovernedVault.
`;

describe("citations", () => {
  test("path#La-Lb parses; a backwards or single-number range doesn't", () => {
    expect(parseSource("src/a.sol#L3-L9")).toEqual({ path: "src/a.sol", from: 3, to: 9 });
    expect(parseSource("src/a.sol#L26-L26")).toEqual({ path: "src/a.sol", from: 26, to: 26 });
    expect(parseSource("src/a.sol#L9-L3")).toBeUndefined();
    expect(parseSource("src/a.sol#L9")).toBeUndefined();
    expect(parseSource("src/a.sol")).toBeUndefined();
    expect(parseSource("src/a.sol#L0-L3")).toBeUndefined();
  });
});

describe("facets/<area>.yaml", () => {
  test("a full entry parses", () => {
    const r = facet(VAULT_CORE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value["VaultCore"]?.requires?.[0]?.anyOf).toEqual(["ERC4626"]);
  });

  test("an empty file is an empty area", () => {
    expect(facet("")).toEqual({ ok: true, value: {} });
  });

  test("an unquoted selector is refused with a message that says to quote it", () => {
    const r = facet(`X:\n  defaultOwnerOf:\n    - selectors: [0x01e1d114]\n      source: a.sol#L1-L1\n`);
    expect(messages(r).join("\n")).toContain('quoted lowercase 4-byte selector like "0x06fdde03"');
  });

  test("an uppercase selector is refused", () => {
    const r = facet(`X:\n  defaultOwnerOf:\n    - selectors: ["0x01E1D114"]\n      source: a.sol#L1-L1\n`);
    expect(r.ok).toBe(false);
  });

  test("a requirement without a citation, or with a bad one, is refused", () => {
    const base = "X:\n  requires:\n    - anyOf: [Y]\n      strength: hard\n      reason: it needs Y\n";
    expect(messages(facet(base)).join()).toContain("X.requires[0].source");
    expect(messages(facet(`${base}      source: src/y.sol:12\n`)).join()).toContain("expected a citation like");
  });

  test("unknown keys are refused, so a typo can't pass silently", () => {
    expect(messages(facet("X:\n  require: []\n")).join()).toContain("require");
  });

  test("strength and family are closed sets", () => {
    expect(facet("X:\n  requires:\n    - {anyOf: [Y], strength: soft, reason: r, source: a.sol#L1-L1}\n").ok).toBe(false);
    expect(facet("X:\n  family: {name: vault, source: a.sol#L1-L1}\n").ok).toBe(false);
  });

  test("invalid YAML is one issue naming the file", () => {
    const r = facet("X: [unclosed\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]).toMatchObject({ file: "overlay/facets/defi.yaml", path: "" });
  });
});

describe("inits/<area>.yaml", () => {
  const ok = `
SafeDiamondCutInit:
  kind: step
  source: src/governance/SafeDiamondCutInit.sol#L25-L30
  registersInterfaces: true
  params:
    safe:
      rule: nonzero&code(safe)
      authority: true
      role: diamondCut
      source: src/governance/libraries/SafeDiamondCutLib.sol#L126-L133
    minThreshold:
      rule: gte(1)
      source: src/governance/libraries/SafeDiamondCutLib.sol#L128-L128
      example: "2"
      exampleSource: studio
`;

  test("a full entry parses", () => {
    expect(init(ok).ok).toBe(true);
  });

  test("an init needs kind and source", () => {
    const m = messages(init("X:\n  params: {}\n")).join("\n");
    expect(m).toContain("X.kind");
    expect(m).toContain("X.source");
  });

  test("an unquoted number example is refused: numbers lose precision", () => {
    const r = init('X:\n  kind: step\n  source: a.sol#L1-L2\n  params:\n    n:\n      example: 300\n      exampleSource: studio\n');
    expect(messages(r).join()).toContain('quoted value like "300"');
  });

  test("an example needs its exampleSource, and exampleSource is studio or a citation", () => {
    expect(messages(init('X:\n  kind: step\n  source: a.sol#L1-L2\n  params:\n    n:\n      example: "3"\n')).join()).toContain(
      "example and exampleSource go together",
    );
    expect(
      messages(init('X:\n  kind: step\n  source: a.sol#L1-L2\n  params:\n    n:\n      example: "3"\n      exampleSource: me\n')).join(),
    ).toContain('expected "studio" or a citation');
  });

  test("authority and role go together, and a rule, unit or authority needs a source", () => {
    const m = (p: string) => messages(init(`X:\n  kind: step\n  source: a.sol#L1-L2\n  params:\n    a:\n${p}`)).join("\n");
    expect(m("      role: owner\n")).toContain("a role goes with authority: true");
    expect(m("      authority: true\n      role: owner\n")).toContain("a unit, rule or authority needs a source");
    expect(m("      authority: true\n      source: a.sol#L1-L1\n")).toContain("name the role");
    expect(m("      unit: seconds\n")).toContain("needs a source");
    expect(m("      unit: hours\n      source: a.sol#L1-L1\n")).not.toBe("");
  });

  test("tuple components nest with the same shape", () => {
    const r = init(
      'X:\n  kind: bundle\n  source: a.sol#L1-L2\n  params:\n    p:\n      components:\n        q:\n          rule: gt(0)\n',
    );
    expect(messages(r).join()).toContain("X.params.p.components.q.source");
  });

  test("a multi-entry init is keyed <Contract>.<fn>", () => {
    expect(init("DiamondIntrospectionInit.initUpgradeable:\n  kind: step\n  source: a.sol#L21-L23\n").ok).toBe(true);
    expect(init("A.b.c:\n  kind: step\n  source: a.sol#L21-L23\n").ok).toBe(false);
  });
});

describe("buildOverlay and loadOverlay", () => {
  const file = (kind: OverlayFile["kind"], area: string, text: string): OverlayFile => ({
    kind,
    area,
    file: `overlay/${kind}/${area}.yaml`,
    text,
  });

  test("entries carry their area and file", () => {
    const r = buildOverlay([file("facets", "defi", VAULT_CORE)]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.facets["VaultCore"]).toMatchObject({ area: "defi", file: "overlay/facets/defi.yaml" });
  });

  test("a file not named after an area is refused", () => {
    const r = buildOverlay([file("facets", "vaults", VAULT_CORE)]);
    expect(messages(r).join()).toContain('named after "vaults", which isn\'t an area');
  });

  test("a facet written in two files is refused, naming the first", () => {
    const r = buildOverlay([file("facets", "tokens", VAULT_CORE), file("facets", "defi", VAULT_CORE)]);
    expect(messages(r)).toEqual(["VaultCore: is already written in overlay/facets/defi.yaml."]);
  });

  test("every file's issues come back together", () => {
    const r = buildOverlay([file("facets", "defi", "X:\n  nope: 1\n"), file("inits", "tokens", "Y:\n  kind: step\n")]);
    expect(messages(r)).toHaveLength(2);
  });

  test("loadOverlay reads facets/ and inits/ and ignores CG6's files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cg5-overlay-"));
    try {
      mkdirSync(join(dir, "facets"));
      mkdirSync(join(dir, "inits"));
      mkdirSync(join(dir, "recipes"));
      writeFileSync(join(dir, "facets", "defi.yaml"), VAULT_CORE);
      writeFileSync(join(dir, "inits", "defi.yaml"), "VaultCoreInit:\n  kind: step\n  source: src/defi/VaultCoreInit.sol#L24-L31\n");
      writeFileSync(join(dir, "seams.yaml"), "not: [an, overlay, file");
      writeFileSync(join(dir, "recipes", "GovernedVault.yaml"), "whatever: 1\n");
      const r = await loadOverlay(dir);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(Object.keys(r.value.facets)).toEqual(["VaultCore"]);
        expect(Object.keys(r.value.inits)).toEqual(["VaultCoreInit"]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("projections onto the catalog", () => {
  test("facetOverlayFields drops citations and flattens default owners", () => {
    const r = facet(VAULT_CORE);
    if (!r.ok) throw new Error("fixture");
    expect(facetOverlayFields(r.value["VaultCore"])).toEqual({
      requires: [{ anyOf: ["ERC4626"], strength: "hard", reason: "it runs the assets behind ERC4626's shares and initializes after it" }],
      defaultOwnerOf: ["0x01e1d114"],
      init: "VaultCoreInit",
    });
  });

  test("no entry gives requires: [] and nothing else", () => {
    expect(facetOverlayFields(undefined)).toEqual({ requires: [] });
    expect(initOverlayFields(undefined)).toEqual({ kind: "step", after: [], sameCall: [] });
  });

  test("applyInitOverlay completes a skeleton; the overlay's doc wins over NatSpec, components merge by name", () => {
    const r = init(`
GovernedVaultInit:
  kind: bundle
  source: src/defi/GovernedVaultInit.sol#L44-L87
  registersInterfaces: true
  params:
    p:
      components:
        votingPeriod:
          doc: How long the vote stays open.
          unit: seconds
          rule: gt(0)
          source: src/governance/libraries/GovernorLib.sol#L159-L159
          example: "600"
          exampleSource: script/base/defi/GrantExample.s.sol#L26-L26
  sequence:
    modules: [AccessControl, Governor]
    source: src/defi/GovernedVaultInit.sol#L44-L87
`);
    if (!r.ok) throw new Error(messages(r).join());
    const skeleton = {
      name: "GovernedVaultInit",
      params: [
        {
          name: "p",
          type: "tuple",
          doc: "",
          components: [
            { name: "asset", type: "address", doc: "" },
            { name: "votingPeriod", type: "uint32", doc: "natspec" },
          ],
        },
      ],
      registersInterfaces: true as const,
    };
    expect(applyInitOverlay(skeleton, r.value["GovernedVaultInit"])).toEqual({
      name: "GovernedVaultInit",
      kind: "bundle",
      after: [],
      sameCall: [],
      sequence: ["AccessControl", "Governor"],
      registersInterfaces: true,
      params: [
        {
          name: "p",
          type: "tuple",
          doc: "",
          components: [
            { name: "asset", type: "address", doc: "" },
            {
              name: "votingPeriod",
              type: "uint32",
              doc: "How long the vote stays open.",
              unit: "seconds",
              rule: "gt(0)",
              example: "600",
              exampleSource: "script/base/defi/GrantExample.s.sol#L26-L26",
            },
          ],
        },
      ],
    });
  });

  test("applyInitOverlay keeps the skeleton's registersInterfaces (CG4 reads it from the source)", () => {
    const r = init("X:\n  kind: step\n  source: a.sol#L1-L2\n  registersInterfaces: true\n");
    if (!r.ok) throw new Error("fixture");
    const out = applyInitOverlay({ params: [] }, r.value["X"]);
    expect("registersInterfaces" in out).toBe(false);
  });

  test("overlaySources lists every Lattice citation and skips studio", () => {
    const r = buildOverlay([
      { kind: "facets", area: "defi", file: "overlay/facets/defi.yaml", text: VAULT_CORE },
      {
        kind: "inits",
        area: "defi",
        file: "overlay/inits/defi.yaml",
        text: 'X:\n  kind: step\n  source: a.sol#L1-L2\n  params:\n    n:\n      example: "1"\n      exampleSource: studio\n',
      },
    ]);
    if (!r.ok) throw new Error("fixture");
    expect(overlaySources(r.value).map((s) => `${s.at} ${s.source}`)).toEqual([
      "VaultCore.requires[0] src/defi/libraries/VaultCoreLib.sol#L64-L65",
      "VaultCore.defaultOwnerOf[0] docs/guides/compose-your-own-diamond.md#L40-L40",
      "VaultCore.init src/defi/VaultCoreInit.sol#L24-L31",
      "X a.sol#L1-L2",
    ]);
  });
});
