import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { keccak256, stringToBytes } from "viem";
import type { Catalog } from "../model/catalog";
import type { Hex4 } from "../model/hex";
import type { Recipe } from "../model/recipe";
import { catalogHash, hashedRecipe, recipeHash } from "./hash";
import { canonicalJson } from "./json";
import { normalizeRecipe } from "./normalize";
import { ADMIN, ADMIN_LOWER, MAX_UINT256, bundleRecipe, catalog, stepsRecipe } from "./test-support";

/** The same object with its keys (and nested keys) in reverse insertion order. */
function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseKeys) as T;
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).reverse();
  return Object.fromEntries(entries.map(([key, inner]) => [key, reverseKeys(inner)])) as T;
}

const base = stepsRecipe();
const baseHash = recipeHash(base, catalog);

describe("recipeHash is unchanged by", () => {
  test("key order, at every level", () => {
    expect(recipeHash(reverseKeys(base), catalog)).toBe(baseHash);
    expect(recipeHash(reverseKeys(bundleRecipe()), catalog)).toBe(recipeHash(bundleRecipe(), catalog));
  });

  test("facet placement order and duplicates", () => {
    const shuffled = stepsRecipe({ facets: ["ERC20Votes", "ERC20", "AccessControl", "DiamondLoupeFacet", "ERC20"] });
    expect(recipeHash(shuffled, catalog)).toBe(baseHash);
  });

  test("address case in arguments, and hex case in selectors and hashes", () => {
    const lower = stepsRecipe({
      init: {
        kind: "steps",
        steps: [
          { spec: "AccessControlInit", args: { admin: ADMIN_LOWER } },
          { spec: "ERC20Init", args: { name: "Vault Share", symbol: "VS", supply: MAX_UINT256 } },
        ],
      },
    });
    const checksummed = stepsRecipe({
      catalog: { tag: "v0.4.0", hash: catalog.hash.toUpperCase().replace("0X", "0x") as Recipe["catalog"]["hash"] },
      owners: { "0xA9059CBB": "ERC20Votes" },
      exclude: ["0x095EA7B3"],
      init: {
        kind: "steps",
        steps: [
          { spec: "AccessControlInit", args: { admin: ADMIN } },
          { spec: "ERC20Init", args: { name: "Vault Share", symbol: "VS", supply: MAX_UINT256 } },
        ],
      },
    });
    expect(recipeHash(checksummed, catalog)).toBe(recipeHash(lower, catalog));
  });

  test("name, $schema and template", () => {
    const decorated: Recipe = {
      ...base,
      $schema: "https://studio.example/schema/recipe-v1.json",
      name: "GovernedVault",
      template: { name: "GovernedVault", catalogHash: catalog.hash },
    };
    expect(recipeHash(decorated, catalog)).toBe(baseHash);
  });

  test("unknown fields, at the top and nested", () => {
    const extended = {
      ...base,
      comment: "hand-edited",
      catalog: { ...base.catalog, mirror: "ipfs://…" },
      init: { ...base.init, note: "x", steps: base.init.kind === "steps" ? base.init.steps.map((step) => ({ ...step, why: 1 })) : [] },
    } as unknown as Recipe;
    expect(recipeHash(extended, catalog)).toBe(baseHash);
  });

  test("property: any facet order, owners order and selector case", () => {
    const names = catalog.facets.map((facet) => facet.name);
    fc.assert(
      fc.property(fc.shuffledSubarray(names, { minLength: names.length }), fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }), (facets, upper) => {
        const cased = (hex: string, up: boolean | undefined): Hex4 => (up ? `0x${hex.slice(2).toUpperCase()}` : hex) as Hex4;
        const owners: Record<Hex4, string> = {};
        const pairs: [string, string][] = [["0xa9059cbb", "ERC20Votes"], ["0x5c19a95c", "ERC20Votes"], ["0x2f2ff15d", "AccessControl"]];
        for (const [index, [selector, owner]] of pairs.entries()) owners[cased(selector, upper[index])] = owner;
        const reference = stepsRecipe({ facets: names, owners: Object.fromEntries(pairs) });
        expect(recipeHash(stepsRecipe({ facets, owners }), catalog)).toBe(recipeHash(reference, catalog));
      }),
    );
  });
});

describe("recipeHash changes with", () => {
  const variants: [string, Recipe][] = [
    ["a facet", stepsRecipe({ facets: ["DiamondLoupeFacet", "AccessControl", "ERC20", "ERC20Votes", "Receive"] })],
    ["one facet fewer", stepsRecipe({ facets: ["DiamondLoupeFacet", "AccessControl", "ERC20"] })],
    ["an owner", stepsRecipe({ owners: { "0xa9059cbb": "ERC20" } })],
    ["a new owner entry", stepsRecipe({ owners: { "0xa9059cbb": "ERC20Votes", "0x5c19a95c": "ERC20Votes" } })],
    ["an exclusion", stepsRecipe({ exclude: ["0x095ea7b3", "0x5c19a95c"] })],
    ["no exclusions", stepsRecipe({ exclude: [] })],
    [
      "an init argument",
      stepsRecipe({
        init: {
          kind: "steps",
          steps: [
            { spec: "AccessControlInit", args: { admin: { $ref: "self" } } },
            { spec: "ERC20Init", args: { name: "Vault Share", symbol: "VS", supply: MAX_UINT256 } },
          ],
        },
      }),
    ],
    [
      "init step order",
      stepsRecipe({
        init: {
          kind: "steps",
          steps: [
            { spec: "ERC20Init", args: { name: "Vault Share", symbol: "VS", supply: MAX_UINT256 } },
            { spec: "AccessControlInit", args: { admin: { $ref: "deployer" } } },
          ],
        },
      }),
    ],
    ["the last digit of an integer above 2^53", stepsRecipe({
      init: {
        kind: "steps",
        steps: [
          { spec: "AccessControlInit", args: { admin: { $ref: "deployer" } } },
          { spec: "ERC20Init", args: { name: "Vault Share", symbol: "VS", supply: `${MAX_UINT256.slice(0, -1)}4` } },
        ],
      },
    })],
    ["immutable", { ...base, immutable: true }],
    ["no init", stepsRecipe({ init: { kind: "none" } })],
    ["the catalog tag", stepsRecipe({ catalog: { tag: "v0.4.1", hash: catalog.hash } })],
  ];

  test.each(variants)("%s", (_, variant) => {
    expect(recipeHash(variant, catalog)).not.toBe(baseHash);
  });

  test("every variant hashes differently from every other", () => {
    const hashes = new Set(variants.map(([, variant]) => recipeHash(variant, catalog)));
    expect(hashes.size).toBe(variants.length);
  });
});

describe("recipeHash", () => {
  test("is keccak256 of the canonical JSON of the hashed fields", () => {
    const normalized = normalizeRecipe(base, catalog);
    const expected = keccak256(
      stringToBytes(
        canonicalJson({
          schemaVersion: 1,
          catalog: normalized.catalog,
          facets: normalized.facets,
          owners: normalized.owners,
          exclude: normalized.exclude,
          init: normalized.init,
        }),
      ),
    );
    expect(baseHash).toBe(expected);
    expect(baseHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("with a catalog equals the hash of normalizeRecipe's output without one", () => {
    const messy = stepsRecipe({ facets: ["ERC20", "DiamondLoupeFacet", "ERC20Votes", "AccessControl"], owners: { "0xA9059CBB": "ERC20Votes" } });
    expect(recipeHash(messy, catalog)).toBe(recipeHash(normalizeRecipe(messy, catalog)));
  });

  test("hashes the bundle form too, and leaves unknown fields out of the hashed shape", () => {
    const bundle = { ...bundleRecipe(), extra: true } as unknown as Recipe;
    expect(Object.keys(hashedRecipe(bundle))).toEqual(["schemaVersion", "catalog", "facets", "owners", "exclude", "init"]);
    expect(recipeHash(bundle, catalog)).toBe(recipeHash(bundleRecipe(), catalog));
  });

  test("integers above 2^53 stay exact strings in the hashed JSON", () => {
    const text = canonicalJson(hashedRecipe(normalizeRecipe(base, catalog)));
    expect(text).toContain(`"supply":"${MAX_UINT256}"`);
  });

  test("golden: the exact bytes a small recipe hashes", () => {
    const recipe: Recipe = {
      $schema: "https://example.test/recipe.json",
      schemaVersion: 1,
      name: "Tiny",
      catalog: { tag: "v0.4.0", hash: `0x${"11".repeat(32)}` },
      facets: ["DiamondLoupeFacet"],
      owners: { "0xa9059cbb": "ERC20" },
      exclude: ["0x095ea7b3"],
      init: { kind: "bundle", spec: "VaultInit", args: { p: { cap: "1", asset: { $ref: "self" } } } },
      immutable: true,
    };
    const text =
      `{"catalog":{"hash":"0x${"11".repeat(32)}","tag":"v0.4.0"},"exclude":["0x095ea7b3"],"facets":["DiamondLoupeFacet"],` +
      '"immutable":true,"init":{"args":{"p":{"asset":{"$ref":"self"},"cap":"1"}},"kind":"bundle","spec":"VaultInit"},' +
      '"owners":{"0xa9059cbb":"ERC20"},"schemaVersion":1}';
    expect(canonicalJson(hashedRecipe(recipe))).toBe(text);
    expect(recipeHash(recipe)).toBe(keccak256(stringToBytes(text)));
  });

  test("is deterministic across calls", () => {
    expect(recipeHash(stepsRecipe(), catalog)).toBe(baseHash);
  });
});

describe("catalogHash", () => {
  test("is keccak256 of the canonical index without its hash field", () => {
    const { hash: _ignored, ...rest } = catalog;
    expect(catalogHash(catalog)).toBe(keccak256(stringToBytes(canonicalJson(rest))));
    expect(catalogHash(rest)).toBe(catalogHash(catalog));
  });

  test("ignores the stored hash and key order; changes with content", () => {
    const rehashed: Catalog = { ...catalog, hash: `0x${"00".repeat(32)}` };
    expect(catalogHash(rehashed)).toBe(catalogHash(catalog));
    expect(catalogHash(reverseKeys(catalog))).toBe(catalogHash(catalog));
    expect(catalogHash({ ...catalog, provisional: "Lattice 0.2.0 at dev f4a32c8; v1 targets 0.4.0" })).not.toBe(catalogHash(catalog));
    expect(catalogHash({ ...catalog, facets: catalog.facets.slice(1) })).not.toBe(catalogHash(catalog));
  });
});
