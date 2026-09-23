/** A catalog shaped like Lattice 0.4.0's GovernedVault corner, and recipes on it, for this module's tests. */
import type { Catalog, InitParam } from "../model/catalog";
import { toChecksum } from "../model/hex";
import type { Deployment, ProjectFile } from "../model/project";
import type { Recipe } from "../model/recipe";
import { makeCatalog, makeFacet, makeInit, makeProject, makeRecipe, makeTemplate } from "../testing";

export const ADMIN = toChecksum("0x71c7656ec7ab88b098defb751b7401b5f6d8976f");
export const SAFE = toChecksum("0x4b20993bc481177ec7e8f571cecae8a9e22c02db");
export const ASSET = toChecksum("0x5fbdb2315678afecb367f032d93f642f64180aa3");

const GOVERNED_VAULT_FACETS = [
  "ERC20", "ERC20Votes", "ERC4626", "GovernedVault", "VaultCore", "GovernedDiamondCut", "Governor",
  "TimelockController", "Votes", "EmergencyStop", "AccessControl", "Receive", "DiamondLoupeFacet", "ERC165Facet",
];

const GOVERNED_VAULT_PARAMS: InitParam[] = [
  {
    name: "p",
    type: "tuple",
    doc: "Vault, token and governance settings",
    components: [
      { name: "asset", type: "address", doc: "Underlying asset", rule: "code(token)" },
      { name: "name", type: "string", doc: "Share name" },
      { name: "symbol", type: "string", doc: "Share symbol" },
      { name: "decimalsOffset", type: "uint8", doc: "Decimals offset" },
      { name: "minDelay", type: "uint256", doc: "Timelock delay", unit: "seconds" },
      { name: "votingDelay", type: "uint48", doc: "Voting delay", unit: "seconds" },
      { name: "votingPeriod", type: "uint32", doc: "Voting period", unit: "seconds" },
      { name: "proposalThreshold", type: "uint256", doc: "Proposal threshold", unit: "wei" },
      { name: "quorumNumerator", type: "uint256", doc: "Quorum", unit: "percent" },
    ],
  },
];

/** Tagged v0.4.0, so issues read "isn't in Lattice 0.4.0." */
export const catalog: Catalog = makeCatalog({
  lattice: { tag: "v0.4.0", commit: "f".repeat(40) },
  facets: [
    ...GOVERNED_VAULT_FACETS.map((name) => makeFacet({ name, selectors: [`${name.toLowerCase()}Probe()`] })),
    makeFacet({ name: "SafeDiamondCut", selectors: ["diamondCut((address,uint8,bytes4[])[],address,bytes)"] }),
  ],
  inits: [
    makeInit({ name: "GovernedVaultInit", kind: "bundle", fn: "init((address,string,string,uint8,uint256,uint48,uint32,uint256,uint256))", params: GOVERNED_VAULT_PARAMS }),
    makeInit({
      name: "ERC20Init",
      fn: "init(string,string)",
      params: [
        { name: "name", type: "string", doc: "Token name" },
        { name: "symbol", type: "string", doc: "Token symbol" },
      ],
    }),
    makeInit({ name: "AccessControlInit", fn: "init(address)", params: [{ name: "admin", type: "address", doc: "Admin", authority: true, role: "DEFAULT_ADMIN_ROLE" }] }),
    makeInit({
      name: "SafeDiamondCutInit",
      fn: "init(address,address)",
      params: [
        { name: "admin", type: "address", doc: "Admin", authority: true },
        { name: "safe", type: "address", doc: "Safe", authority: true, rule: "code(safe)" },
      ],
    }),
    makeInit({
      name: "GuardInit",
      fn: "init(address[],(address,string))",
      params: [
        { name: "guardians", type: "address[]", doc: "Guardians", authority: true },
        {
          name: "keeper",
          type: "tuple",
          doc: "Keeper",
          components: [
            { name: "account", type: "address", doc: "Account", authority: true },
            { name: "label", type: "string", doc: "Label" },
          ],
        },
      ],
    }),
  ],
});

/** GovernedVault as Lattice's script builds it, with the asset filled in: the link the spec measures. */
export function governedVault(): Recipe {
  return makeRecipe(
    {
      name: "GovernedVault",
      template: { name: "GovernedVault", catalogHash: catalog.hash },
      facets: [...GOVERNED_VAULT_FACETS],
      owners: {
        "0x01e1d114": "VaultCore", "0x06fdde03": "GovernedVault", "0x23b872dd": "GovernedVault",
        "0x313ce567": "ERC4626", "0x4bf5d7e9": "GovernedVault", "0x5c19a95c": "ERC20Votes",
        "0x6e553f65": "GovernedVault", "0x8ff262e3": "GovernedVault", "0x91ddadf4": "GovernedVault",
        "0x94bf804d": "GovernedVault", "0xa9059cbb": "GovernedVault", "0xb460af94": "GovernedVault",
        "0xba087652": "GovernedVault", "0xc3cda520": "ERC20Votes",
      },
      init: {
        kind: "bundle",
        spec: "GovernedVaultInit",
        args: {
          p: {
            asset: ASSET, name: "Grant vault", symbol: "gVLT", decimalsOffset: "0", minDelay: "300",
            votingDelay: "60", votingPeriod: "600", proposalThreshold: "0", quorumNumerator: "4",
          },
        },
      },
    },
    catalog,
  );
}

/** A token with a literal admin: the authority address LINK-01 is about. */
export function tokenWithAdmin(admin: string = ADMIN): Recipe {
  return makeRecipe(
    {
      name: "Token",
      facets: ["ERC20", "AccessControl", "DiamondLoupeFacet"],
      exclude: ["0x095ea7b3"],
      init: {
        kind: "steps",
        steps: [
          { spec: "AccessControlInit", args: { admin } },
          { spec: "ERC20Init", args: { name: "Grant token", symbol: "GRT" } },
        ],
      },
    },
    catalog,
  );
}

/** A Safe-governed cut with "This diamond" as admin and a literal Safe. */
export function safeCut(): Recipe {
  return makeRecipe(
    {
      facets: ["DiamondLoupeFacet", "SafeDiamondCut"],
      init: { kind: "steps", steps: [{ spec: "SafeDiamondCutInit", args: { admin: { $ref: "self" }, safe: SAFE } }] },
      immutable: true,
    },
    catalog,
  );
}

/** Every recipe shape this catalog offers, as templates. */
export const templatedCatalog: Catalog = {
  ...catalog,
  recipes: [
    makeTemplate({ name: "GovernedVault", recipe: governedVault() }),
    makeTemplate({ name: "Token", recipe: tokenWithAdmin() }),
    makeTemplate({ name: "SafeDiamondCut", recipe: safeCut() }),
    makeTemplate({ name: "Blank", recipe: makeRecipe({ facets: ["DiamondLoupeFacet"] }, catalog) }),
  ],
};

export function deployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    projectId: "test-project",
    chainId: 11155111,
    address: toChecksum("0x5fc8d32690cc91d4c39d9d3abcbd16989f875707"),
    path: "factory",
    deployer: toChecksum("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"),
    salt: `0x${"11".repeat(32)}`,
    status: "confirmed",
    tx: `0x${"22".repeat(32)}`,
    block: 42,
    recipeHash: `0x${"33".repeat(32)}`,
    catalogHash: catalog.hash,
    at: "2026-09-23T10:00:00.000Z",
    verification: "exact_match",
    revision: 1,
    ...overrides,
  };
}

/** A `.lattice.json` whose provenance claims the admin is already confirmed. */
export function projectFile(recipe: Recipe = tokenWithAdmin()): ProjectFile {
  return {
    project: makeProject({
      name: "Grant token",
      recipe,
      layout: { ERC20: { x: 0, y: 0, pins: "right" } },
      provenance: { "steps[0].admin": "confirmed", "steps[5].ghost": "confirmed" },
    }),
    deployments: [deployment(), deployment({ chainId: 1, status: "mismatch", verification: "failed" })],
  };
}
