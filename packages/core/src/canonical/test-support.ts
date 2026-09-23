/** A small catalog and recipes for this module's tests (not exported from the barrel). */
import type { Catalog } from "../model/catalog";
import type { Recipe } from "../model/recipe";
import { makeCatalog, makeFacet, makeInit, makeRecipe } from "../testing";

/** Checksummed, and the same address all lowercase. */
export const ADMIN = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
export const ADMIN_LOWER = "0x71c7656ec7ab88b098defb751b7401b5f6d8976f";
export const ASSET = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

/** 2^256 - 1: far past 2^53, where a JSON number would round. */
export const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

export const catalog: Catalog = makeCatalog({
  lattice: { tag: "v0.4.0", commit: "a".repeat(40) },
  facets: [
    makeFacet({ name: "DiamondLoupeFacet", area: "diamond", selectors: ["facets()", "facetAddresses()"] }),
    makeFacet({ name: "AccessControl", area: "access", selectors: ["grantRole(bytes32,address)"] }),
    makeFacet({ name: "ERC20", area: "tokens", selectors: ["transfer(address,uint256)", "approve(address,uint256)"] }),
    makeFacet({ name: "ERC20Votes", area: "tokens", selectors: ["transfer(address,uint256)", "delegate(address)"] }),
    makeFacet({ name: "Receive", area: "utils" }),
  ],
  inits: [
    makeInit({
      name: "ERC20Init",
      fn: "init(string,string,uint256)",
      params: [
        { name: "name", type: "string", doc: "Token name" },
        { name: "symbol", type: "string", doc: "Token symbol" },
        { name: "supply", type: "uint256", doc: "Initial supply", unit: "wei" },
      ],
    }),
    makeInit({
      name: "AccessControlInit",
      fn: "init(address)",
      params: [{ name: "admin", type: "address", doc: "Admin", authority: true }],
    }),
    makeInit({
      name: "LabelInit",
      fn: "init(string,bytes20,address)",
      params: [
        { name: "label", type: "string", doc: "Label" },
        { name: "code", type: "bytes20", doc: "Code" },
        { name: "keeper", type: "address", doc: "Keeper", authority: true },
      ],
    }),
    makeInit({
      name: "VaultInit",
      kind: "bundle",
      fn: "init((address,string,uint256,bytes32),address[],uint48[])",
      params: [
        {
          name: "p",
          type: "tuple",
          doc: "Vault settings",
          components: [
            { name: "asset", type: "address", doc: "Asset" },
            { name: "name", type: "string", doc: "Share name" },
            { name: "cap", type: "uint256", doc: "Deposit cap" },
            { name: "tag", type: "bytes32", doc: "Tag" },
          ],
        },
        { name: "guardians", type: "address[]", doc: "Guardians" },
        { name: "delays", type: "uint48[]", doc: "Delays", unit: "seconds" },
      ],
    }),
  ],
});

/** A steps recipe on `catalog`, already normalized. */
export function stepsRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return makeRecipe(
    {
      facets: ["DiamondLoupeFacet", "AccessControl", "ERC20", "ERC20Votes"],
      owners: { "0xa9059cbb": "ERC20Votes" },
      exclude: ["0x095ea7b3"],
      init: {
        kind: "steps",
        steps: [
          { spec: "AccessControlInit", args: { admin: { $ref: "deployer" } } },
          { spec: "ERC20Init", args: { name: "Vault Share", symbol: "VS", supply: MAX_UINT256 } },
        ],
      },
      ...overrides,
    },
    catalog,
  );
}

/** A bundle recipe on `catalog`, already normalized. */
export function bundleRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return makeRecipe(
    {
      facets: ["DiamondLoupeFacet", "AccessControl"],
      init: {
        kind: "bundle",
        spec: "VaultInit",
        args: {
          p: { asset: ASSET, name: "0xABC Vault", cap: "1000000", tag: `0x${"ab".repeat(32)}` },
          guardians: [ADMIN, { $ref: "self" }],
          delays: ["86400", "3600"],
        },
      },
      ...overrides,
    },
    catalog,
  );
}
