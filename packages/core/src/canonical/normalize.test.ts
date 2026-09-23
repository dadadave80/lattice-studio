import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import type { Hex4 } from "../model/hex";
import type { Recipe } from "../model/recipe";
import { makeRecipe } from "../testing";
import { normalizeRecipe, normalizeWith } from "./normalize";
import { ADMIN, ADMIN_LOWER, ASSET, bundleRecipe, catalog, stepsRecipe } from "./test-support";

describe("normalizeRecipe", () => {
  test("facets are deduplicated into catalog order", () => {
    const recipe = stepsRecipe({ facets: ["ERC20Votes", "ERC20", "DiamondLoupeFacet", "ERC20", "AccessControl"] });
    expect(normalizeRecipe(recipe, catalog).facets).toEqual(["DiamondLoupeFacet", "AccessControl", "ERC20", "ERC20Votes"]);
  });

  test("facets the catalog lacks follow the known ones in input order", () => {
    const recipe = stepsRecipe({ facets: ["Zeta", "ERC20", "Alpha", "DiamondLoupeFacet", "Zeta"] });
    expect(normalizeRecipe(recipe, catalog).facets).toEqual(["DiamondLoupeFacet", "ERC20", "Zeta", "Alpha"]);
  });

  test("owners keys are lowercase and emitted sorted; exclude is lowercase, sorted and deduplicated", () => {
    const recipe = stepsRecipe({
      owners: { "0xFFFFFFFF": "ERC20", "0xA9059CBB": "ERC20Votes", "0x00000001": "ERC20" },
      exclude: ["0xFFFFFFFF", "0x095EA7B3", "0x095ea7b3", "0x00000002"],
    });
    const normalized = normalizeRecipe(recipe, catalog);
    expect(Object.entries(normalized.owners)).toEqual([
      ["0x00000001", "ERC20"],
      ["0xa9059cbb", "ERC20Votes"],
      ["0xffffffff", "ERC20"],
    ]);
    expect(normalized.exclude).toEqual(["0x00000002", "0x095ea7b3", "0xffffffff"]);
  });

  test("owners keys that differ only in case resolve the same way whatever their order", () => {
    const a = normalizeRecipe(stepsRecipe({ owners: { "0xABCDEF01": "ERC20", "0xabcdef01": "ERC20Votes" } }), catalog);
    const b = normalizeRecipe(stepsRecipe({ owners: { "0xabcdef01": "ERC20Votes", "0xABCDEF01": "ERC20" } }), catalog);
    expect(a.owners).toEqual({ "0xabcdef01": "ERC20Votes" });
    expect(b.owners).toEqual(a.owners);
  });

  test("catalog and template hashes are lowercase", () => {
    const upper = `0x${"AB".repeat(32)}` as const;
    const recipe = stepsRecipe({ catalog: { tag: "v0.4.0", hash: upper }, template: { name: "GovernedVault", catalogHash: upper } });
    const normalized = normalizeRecipe(recipe, catalog);
    expect(normalized.catalog.hash).toBe(`0x${"ab".repeat(32)}`);
    expect(normalized.template?.catalogHash).toBe(`0x${"ab".repeat(32)}`);
  });

  test("arguments normalize by their parameter types; text is never touched", () => {
    const recipe = bundleRecipe({
      init: {
        kind: "bundle",
        spec: "VaultInit",
        args: {
          p: { asset: ASSET.toLowerCase(), name: "0xABC Vault", cap: "000123", tag: `0x${"AB".repeat(32)}` },
          guardians: [ADMIN_LOWER, { $ref: "self" }],
          delays: ["0x15180", "-0"],
        },
      },
    });
    const normalized = normalizeRecipe(recipe, catalog);
    expect(normalized.init).toEqual({
      kind: "bundle",
      spec: "VaultInit",
      args: {
        p: { asset: ASSET, name: "0xABC Vault", cap: "123", tag: `0x${"ab".repeat(32)}` },
        guardians: [ADMIN, { $ref: "self" }],
        delays: ["86400", "0"],
      },
    });
  });

  test("step arguments normalize by their own spec; references stay symbolic", () => {
    const recipe = stepsRecipe({
      init: {
        kind: "steps",
        steps: [
          { spec: "AccessControlInit", args: { admin: ADMIN_LOWER } },
          { spec: "ERC20Init", args: { name: "0xDEAD", symbol: "DEAD", supply: "0001" } },
          { spec: "AccessControlInit", args: { admin: { $ref: "deployer" } } },
        ],
      },
    });
    const init = normalizeRecipe(recipe, catalog).init;
    expect(init).toEqual({
      kind: "steps",
      steps: [
        { spec: "AccessControlInit", args: { admin: ADMIN } },
        { spec: "ERC20Init", args: { name: "0xDEAD", symbol: "DEAD", supply: "1" } },
        { spec: "AccessControlInit", args: { admin: { $ref: "deployer" } } },
      ],
    });
  });

  test("values that don't fit their type are left for validation", () => {
    const recipe = stepsRecipe({
      init: { kind: "steps", steps: [{ spec: "ERC20Init", args: { name: "N", symbol: "S", supply: "1e18" } }] },
    });
    const init = normalizeRecipe(recipe, catalog).init;
    expect(init.kind === "steps" && init.steps[0]?.args["supply"]).toBe("1e18");
  });

  test("an init or parameter the catalog lacks normalizes by shape: addresses EIP-55, other hex lowercase", () => {
    const recipe = stepsRecipe({
      init: {
        kind: "steps",
        steps: [{ spec: "UnknownInit", args: { who: ADMIN_LOWER, data: "0xABCD", n: "0007", list: [ADMIN_LOWER, true], nested: { x: "0xFF" } } }],
      },
    });
    const init = normalizeRecipe(recipe, catalog).init;
    expect(init.kind === "steps" && init.steps[0]?.args).toEqual({
      who: ADMIN,
      data: "0xabcd",
      n: "0007",
      list: [ADMIN, true],
      nested: { x: "0xff" },
    });
  });

  test("unknown fields survive at every level, after the known ones", () => {
    const recipe = {
      extra: { keep: 1 },
      ...stepsRecipe(),
      catalog: { ...stepsRecipe().catalog, note: "pinned" },
      init: { kind: "none", why: "later" },
    } as unknown as Recipe;
    const normalized = normalizeRecipe(recipe, catalog) as unknown as Record<string, unknown>;
    expect(Object.keys(normalized)).toEqual(["schemaVersion", "catalog", "facets", "owners", "exclude", "init", "extra"]);
    expect(normalized["extra"]).toEqual({ keep: 1 });
    expect(normalized["catalog"]).toEqual({ tag: "v0.4.0", hash: catalog.hash, note: "pinned" });
    expect(normalized["init"]).toEqual({ kind: "none", why: "later" });
  });

  test("keys come out in the spec's order, with optional ones only when present", () => {
    const recipe: Recipe = { ...stepsRecipe(), immutable: true, name: "Vault", $schema: "https://example.test/recipe.json" };
    expect(Object.keys(normalizeRecipe(recipe, catalog))).toEqual([
      "$schema", "schemaVersion", "name", "catalog", "facets", "owners", "exclude", "init", "immutable",
    ]);
  });

  test("without a catalog, facets keep their input order (deduplicated)", () => {
    const recipe = makeRecipe({ facets: ["ERC20", "DiamondLoupeFacet", "ERC20"] });
    expect(normalizeWith(recipe, null).facets).toEqual(["ERC20", "DiamondLoupeFacet"]);
  });

  test("never mutates its input, and is idempotent", () => {
    const recipe = stepsRecipe({ facets: ["ERC20", "DiamondLoupeFacet"], owners: { "0xA9059CBB": "ERC20" } });
    const before = structuredClone(recipe);
    const once = normalizeRecipe(recipe, catalog);
    expect(recipe).toEqual(before);
    expect(normalizeRecipe(once, catalog)).toEqual(once);
  });

  test("property: idempotent for any facet order, selector case and duplicates", () => {
    const names = catalog.facets.map((facet) => facet.name);
    const selector = fc.stringMatching(/^0x[0-9a-fA-F]{8}$/);
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...names, "Other")),
        fc.dictionary(selector, fc.constantFrom(...names)),
        fc.array(selector),
        (facets, owners, exclude) => {
          const once = normalizeRecipe(stepsRecipe({ facets, owners, exclude: exclude as Hex4[] }), catalog);
          expect(normalizeRecipe(once, catalog)).toEqual(once);
        },
      ),
    );
  });
});
