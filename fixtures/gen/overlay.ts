/**
 * Hand-written overlay facts for the fixture catalog: everything the v1 flows touch that Lattice's source states
 * but no compiler artifact carries (spec L136-L204, contracts §4). Each fact cites the Lattice source it comes
 * from as a `Cite` (a file and a phrase on the cited line); the generator resolves it to `path#Lx-Ly` at the pin,
 * so a citation that drifts fails the build instead of lying.
 */
import type { Hex4 } from "../../packages/core/src/model/hex.ts";
import type { Facet, InitParam, InitSpec, RecipeTemplate, Seam } from "../../packages/core/src/model/catalog.ts";
import type { Arg, Recipe } from "../../packages/core/src/model/recipe.ts";

/** A source citation: `needle` is text on the first cited line; `lines` widens it to a range. */
export type Cite = { path: string; needle: string; lines?: number };

const VAULT_SCRIPT = "script/base/defi/DeployGovernedVault.s.sol";
const COMPOSE_GUIDE = "docs/guides/compose-your-own-diamond.md";
const GRANT_EXAMPLE = "script/base/defi/GrantExample.s.sol";

// ── selectors the overlay names ────────────────────────────────────────────────────────────────────

export const SEL = {
  name: "0x06fdde03",
  decimals: "0x313ce567",
  transfer: "0xa9059cbb",
  transferFrom: "0x23b872dd",
  totalAssets: "0x01e1d114",
  deposit: "0x6e553f65",
  mint: "0x94bf804d",
  withdraw: "0xb460af94",
  redeem: "0xba087652",
  delegate: "0x5c19a95c",
  delegateBySig: "0xc3cda520",
  clock: "0x91ddadf4",
  clockMode: "0x4bf5d7e9",
  castVoteBySig: "0x8ff262e3",
} as const satisfies Record<string, Hex4>;

// ── families (spec L164, R4, DEP-03) ───────────────────────────────────────────────────────────────

export const FAMILIES: { family: NonNullable<Facet["family"]>; facets: string[]; source: Cite }[] = [
  {
    family: "upgrade",
    facets: ["DiamondCutFacet", "AccessControlDiamondCut", "GovernedDiamondCut", "SafeDiamondCut", "GovernedSafeDiamondCut"],
    source: { path: "src/governance/AccessControlDiamondCut.sol", needle: "selector `0x1f931c1c`, gated behind EmergencyStop" },
  },
  {
    // The three AccessControl variants serve the same five role selectors over one role store: a diamond holds one.
    family: "access",
    facets: ["AccessControl", "AccessControlEnumerable", "AccessControlTimed"],
    source: { path: "src/access/AccessControlEnumerable.sol", needle: "Diamond facet exposing AccessControl + per-role address enumeration" },
  },
  {
    // One marker per account model (spec L324): the ERC-7579 stack's signer and the ERC-6900 stack's validation.
    family: "account",
    facets: ["AccountSigner", "ERC6900Validation"],
    source: { path: "script/base/accounts/DeployAccount6900.s.sol", needle: "userOp validation, signature, account view) replace the ERC-7579 stack" },
  },
];

// ── requirements (spec L167, DEP-01, DEP-02) ───────────────────────────────────────────────────────

type Requirement = Facet["requires"][number] & { facet: string; source: Cite };

export const REQUIRES: Requirement[] = [
  {
    facet: "VaultCore",
    anyOf: ["ERC4626"],
    strength: "hard",
    reason: "it runs the assets behind ERC4626's shares and initializes after it",
    source: { path: "src/defi/libraries/VaultCoreLib.sol", needle: "after ERC4626Lib.__ERC4626_init", lines: 2 },
  },
  {
    facet: "GovernedDiamondCut",
    anyOf: ["EmergencyStop"],
    strength: "convention",
    reason: "a guardian can halt upgrades",
    source: { path: "src/governance/GovernedDiamondCut.sol", needle: "gated behind EmergencyStop + UPGRADE_EXECUTOR_ROLE" },
  },
  {
    facet: "SafeDiamondCut",
    anyOf: ["EmergencyStop"],
    strength: "convention",
    reason: "a guardian can halt upgrades",
    source: { path: "script/base/governance/DeploySafeDiamondCut.s.sol", needle: "`0x1f931c1c`, gated by EmergencyStop + the pinned Safe" },
  },
  {
    facet: "GovernedSafeDiamondCut",
    anyOf: ["EmergencyStop"],
    strength: "convention",
    reason: "a guardian can halt upgrades",
    source: { path: "src/governance/libraries/GovernedSafeDiamondCutLib.sol", needle: "AccessControlLib.checkRole(EMERGENCY_GUARDIAN_ROLE)" },
  },
  {
    // Source wins (contracts §4 rulings): its NatSpec gates cuts behind EmergencyStop like the other three.
    facet: "AccessControlDiamondCut",
    anyOf: ["EmergencyStop"],
    strength: "convention",
    reason: "a guardian can halt upgrades",
    source: { path: "src/governance/AccessControlDiamondCut.sol", needle: "gated behind EmergencyStop + `DEFAULT_ADMIN_ROLE`" },
  },
  // No `requires` on AccessControl for role writers: C3 derives namespace DEP-02 from `touches` vs `storage.id`.
];

// ── storage and summaries the prototype got wrong ──────────────────────────────────────────────────

/**
 * Facets that only call into DiamondLib's storage: they list `diamond.lib.storage` in `touches`, never as their
 * own `storage` (contracts §4 rulings), so placing both raises no STO-01.
 */
export const TOUCHES_ONLY: { facet: string; namespace: string; source: Cite }[] = [
  {
    facet: "DiamondCutFacet",
    namespace: "diamond.lib.storage",
    source: { path: "lib/diamond-lib/src/facets/DiamondCutFacet.sol", needle: "DiamondLib.diamondCut(_diamondCut, _init, _calldata)" },
  },
  {
    facet: "DiamondLoupeFacet",
    namespace: "diamond.lib.storage",
    source: { path: "lib/diamond-lib/src/facets/DiamondLoupeFacet.sol", needle: "DiamondStorage storage ds = DiamondLib.diamondStorage()" },
  },
];

/** Summaries written here because the source NatSpec is stale (DiamondCutFacet's is OwnableFacet's). */
export const SUMMARIES: { facet: string; summary: string; source: Cite }[] = [
  {
    facet: "DiamondCutFacet",
    summary: "Owner-gated EIP-2535 diamondCut: adds, replaces and removes functions, then optionally runs an init through delegatecall.",
    source: { path: "lib/diamond-lib/src/facets/DiamondCutFacet.sol", needle: "function diamondCut(", lines: 5 },
  },
];

// ── default owners (spec L168) ─────────────────────────────────────────────────────────────────────

export const DEFAULT_OWNERS: { facet: string; selectors: Hex4[]; source: Cite }[] = [
  { facet: "ERC4626", selectors: [SEL.decimals], source: { path: COMPOSE_GUIDE, needle: "ERC4626 owns share decimals" } },
  { facet: "VaultCore", selectors: [SEL.totalAssets], source: { path: COMPOSE_GUIDE, needle: "VaultCore owns strategy-aware `totalAssets`" } },
  {
    facet: "ERC20Votes",
    selectors: [SEL.delegate, SEL.delegateBySig],
    source: { path: COMPOSE_GUIDE, needle: "ERC20Votes owns balance-aware delegation" },
  },
  {
    facet: "GovernedVault",
    selectors: [SEL.name, SEL.clock, SEL.clockMode],
    source: { path: COMPOSE_GUIDE, needle: "ERC20Votes owns balance-aware delegation; GovernedVault owns the shared name, clock", lines: 2 },
  },
];

// ── seams (R19, spec L169-L174) ────────────────────────────────────────────────────────────────────

export const SEAMS: (Seam & { source: Cite })[] = [
  ...[SEL.transfer, SEL.transferFrom].map((selector) => ({
    selector,
    when: ["ERC20Votes"],
    anyOf: ["GovernedVault", "ERC20Votes"],
    reason: "moves vote checkpoints with balances",
    source: { path: "script/base/tokens/DeployERC20Votes.s.sol", needle: "its checkpoint-updating `transfer`/`transferFrom` REPLACE", lines: 2 },
  })),
  ...[SEL.delegate, SEL.delegateBySig].map((selector) => ({
    selector,
    when: ["ERC20Votes"],
    anyOf: ["ERC20Votes"],
    reason: "delegates the account's real balance, so votes aren't left at zero",
    source: { path: "src/governance/Votes.sol", needle: "WARNING (VOT-08): The base Votes facet passes 0 voting units", lines: 2 },
  })),
  ...[SEL.deposit, SEL.mint, SEL.withdraw, SEL.redeem].map((selector) => ({
    selector,
    when: ["GovernedVault"],
    anyOf: ["GovernedVault"],
    reason: "moves vote checkpoints when shares are minted or burned",
    source: { path: VAULT_SCRIPT, needle: "`deposit`/`mint`/`withdraw`/`redeem` — excluded from ERC4626 and VaultCore", lines: 2 },
  })),
  {
    selector: SEL.castVoteBySig,
    when: ["GovernedVault"],
    anyOf: ["GovernedVault"],
    reason: "uses the vault's own ballot nonce",
    source: { path: VAULT_SCRIPT, needle: "`castVoteBySig` — excluded from Governor" },
  },
  {
    selector: SEL.totalAssets,
    when: ["GovernedVault"],
    anyOf: ["VaultCore"],
    reason: "counts the assets strategies hold",
    source: { path: VAULT_SCRIPT, needle: "`totalAssets` — excluded from ERC4626" },
  },
  {
    selector: SEL.decimals,
    when: ["GovernedVault"],
    anyOf: ["ERC4626"],
    reason: "applies the ERC-4626 decimals offset",
    source: { path: VAULT_SCRIPT, needle: "`decimals` — excluded from ERC20" },
  },
];

// ── facet inits (spec L167 `init`) ─────────────────────────────────────────────────────────────────

export const FACET_INITS: { facet: string; init: string; source: Cite }[] = [
  { facet: "ERC20", init: "ERC20Init", source: { path: "src/tokens/ERC20/ERC20Init.sol", needle: "function init(" } },
  { facet: "ERC20Permit", init: "ERC20PermitInit", source: { path: "src/tokens/ERC20/ERC20PermitInit.sol", needle: "function init(" } },
  { facet: "ERC4626", init: "ERC4626Init", source: { path: "src/tokens/ERC4626/ERC4626Init.sol", needle: "function init(" } },
  { facet: "VaultCore", init: "VaultCoreInit", source: { path: "src/defi/VaultCoreInit.sol", needle: "function init(" } },
  { facet: "ERC6538Registry", init: "ERC6538RegistryInit", source: { path: "src/privacy/ERC6538RegistryInit.sol", needle: "function init(" } },
  { facet: "AccessControl", init: "AccessControlInit", source: { path: "src/access/AccessControlInit.sol", needle: "function init(" } },
  { facet: "SafeDiamondCut", init: "SafeDiamondCutInit", source: { path: "src/governance/SafeDiamondCutInit.sol", needle: "function init(" } },
  {
    facet: "GovernedSafeDiamondCut",
    init: "GovernedSafeDiamondCutInit",
    source: { path: "src/governance/GovernedSafeDiamondCutInit.sol", needle: "function init(" },
  },
  { facet: "GovernedDiamondCut", init: "GovernedDiamondCutInit", source: { path: "src/governance/GovernedDiamondCutInit.sol", needle: "function init(" } },
  // DiamondCutFacet checks the owner OwnableInit sets; without it the diamond can never be upgraded.
  { facet: "DiamondCutFacet", init: "OwnableInit", source: { path: "lib/diamond-lib/src/facets/DiamondCutFacet.sol", needle: "function diamondCut(", lines: 3 } },
  { facet: "OwnableFacet", init: "OwnableInit", source: { path: "lib/diamond-lib/src/initializers/OwnableInit.sol", needle: "function init(" } },
];

// ── init specs (spec L175-L191, contracts §3.1) ────────────────────────────────────────────────────

/** An InitSpec before the generator adds `release`, with the source of its signature. */
/** `afterSource` cites the library note an `after` constraint comes from (R10). */
export type InitSource = Omit<InitSpec, "release"> & { path: string; source: Cite; afterSource?: Cite };

const ADMIN_ROLE = "DEFAULT_ADMIN_ROLE";

function param(p: InitParam): InitParam {
  return p;
}

const STUDIO = "studio";
const GRANT = `${GRANT_EXAMPLE}#L26-L26`;

export const INITS: InitSource[] = [
  {
    name: "MultiInit",
    contract: "MultiInit",
    fn: "multiInit(address[],bytes[])",
    kind: "step",
    params: [
      param({ name: "_initAddresses", type: "address[]", doc: "The init contracts, delegatecalled in order." }),
      param({ name: "_initData", type: "bytes[]", doc: "The calldata for each init contract, index-aligned with the addresses." }),
    ],
    initializes: [],
    after: [],
    sameCall: [],
    path: "lib/diamond-lib/src/initializers/MultiInit.sol",
    source: { path: "lib/diamond-lib/src/initializers/MultiInit.sol", needle: "function multiInit(" },
  },
  {
    name: "DiamondIntrospectionInit.initUpgradeable",
    contract: "DiamondIntrospectionInit",
    fn: "initUpgradeable()",
    kind: "step",
    params: [],
    initializes: [],
    after: [],
    sameCall: [],
    registersInterfaces: true,
    path: "src/utils/DiamondIntrospectionInit.sol",
    source: { path: "src/utils/DiamondIntrospectionInit.sol", needle: "function initUpgradeable()", lines: 3 },
  },
  {
    name: "DiamondIntrospectionInit.initImmutable",
    contract: "DiamondIntrospectionInit",
    fn: "initImmutable()",
    kind: "step",
    params: [],
    initializes: [],
    after: [],
    sameCall: [],
    registersInterfaces: true,
    path: "src/utils/DiamondIntrospectionInit.sol",
    source: { path: "src/utils/DiamondIntrospectionInit.sol", needle: "function initImmutable()", lines: 5 },
  },
  {
    name: "ERC165Init",
    contract: "ERC165Init",
    fn: "init()",
    kind: "step",
    params: [],
    initializes: [{ module: "ERC165" }],
    after: [],
    sameCall: [],
    path: "lib/diamond-lib/src/initializers/ERC165Init.sol",
    source: { path: "lib/diamond-lib/src/initializers/ERC165Init.sol", needle: "function init()", lines: 3 },
  },
  {
    name: "OwnableInit",
    contract: "OwnableInit",
    fn: "init(address)",
    kind: "step",
    params: [
      param({ name: "_owner", type: "address", doc: "The address to set as the contract owner.", rule: "nonzero", authority: true, role: "owner" }),
    ],
    initializes: [{ module: "Ownable", with: { owner: "_owner" } }],
    after: [],
    sameCall: [],
    path: "lib/diamond-lib/src/initializers/OwnableInit.sol",
    source: { path: "lib/diamond-lib/src/initializers/OwnableInit.sol", needle: "function init(address _owner)", lines: 4 },
  },
  {
    name: "AccessControlInit",
    contract: "AccessControlInit",
    fn: "init(address)",
    kind: "step",
    params: [param({ name: "admin", type: "address", doc: "The address granted `DEFAULT_ADMIN_ROLE`.", rule: "nonzero", authority: true, role: ADMIN_ROLE })],
    initializes: [{ module: "AccessControl", with: { admin: "admin" } }],
    after: [],
    sameCall: [],
    path: "src/access/AccessControlInit.sol",
    source: { path: "src/access/AccessControlInit.sol", needle: "function init(address admin)", lines: 3 },
  },
  {
    name: "ERC20Init",
    contract: "ERC20Init",
    fn: "init(string,string)",
    kind: "step",
    params: [
      param({ name: "name_", type: "string", doc: "Token name.", example: "Example Token", exampleSource: STUDIO }),
      param({ name: "symbol_", type: "string", doc: "Token symbol.", example: "EXT", exampleSource: STUDIO }),
    ],
    initializes: [{ module: "ERC20", with: { name: "name_", symbol: "symbol_" } }],
    after: [],
    sameCall: [],
    path: "src/tokens/ERC20/ERC20Init.sol",
    source: { path: "src/tokens/ERC20/ERC20Init.sol", needle: "function init(string memory name_", lines: 3 },
  },
  {
    name: "ERC4626Init",
    contract: "ERC4626Init",
    fn: "init(address,string,string,uint8)",
    kind: "step",
    params: [
      param({ name: "asset_", type: "address", doc: "The underlying ERC-20 asset the vault holds.", rule: "nonzero&code(token)" }),
      param({ name: "name_", type: "string", doc: "The vault share token name." }),
      param({ name: "symbol_", type: "string", doc: "The vault share token symbol." }),
      param({ name: "decimalsOffset_", type: "uint8", doc: "Virtual-share decimals offset for inflation-attack mitigation (usually 0)." }),
    ],
    initializes: [
      { module: "ERC20", with: { name: "name_", symbol: "symbol_" } },
      { module: "ERC4626", with: { asset: "asset_", decimalsOffset: "decimalsOffset_" } },
    ],
    after: [],
    sameCall: [],
    path: "src/tokens/ERC4626/ERC4626Init.sol",
    source: { path: "src/tokens/ERC4626/ERC4626Init.sol", needle: "function init(address asset_", lines: 4 },
  },
  {
    name: "VaultCoreInit",
    contract: "VaultCoreInit",
    fn: "init(address,string,string,address,uint8)",
    kind: "step",
    params: [
      param({ name: "asset_", type: "address", doc: "The underlying ERC-20 asset the vault holds.", rule: "nonzero&code(token)" }),
      param({ name: "name_", type: "string", doc: "The vault share token name." }),
      param({ name: "symbol_", type: "string", doc: "The vault share token symbol." }),
      param({
        name: "admin_",
        type: "address",
        doc: "The account granted `DEFAULT_ADMIN_ROLE` (may set the strategy manager).",
        rule: "nonzero",
        authority: true,
        role: ADMIN_ROLE,
      }),
      param({ name: "decimalsOffset_", type: "uint8", doc: "Virtual-share decimals offset for inflation-attack mitigation (usually 0)." }),
    ],
    initializes: [
      { module: "AccessControl", with: { admin: "admin_" } },
      { module: "ERC20", with: { name: "name_", symbol: "symbol_" } },
      { module: "ERC4626", with: { asset: "asset_", decimalsOffset: "decimalsOffset_" } },
      { module: "VaultCore" },
    ],
    // Satisfied by VaultCoreInit itself, which runs AccessControl and ERC4626 first (contracts §4 `after`).
    after: ["AccessControl", "ERC4626"],
    afterSource: { path: "src/defi/libraries/VaultCoreLib.sol", needle: "after ERC4626Lib.__ERC4626_init", lines: 2 },
    sameCall: [],
    path: "src/defi/VaultCoreInit.sol",
    source: { path: "src/defi/VaultCoreInit.sol", needle: "function init(address asset_", lines: 7 },
  },
  {
    name: "ERC20PermitInit",
    contract: "ERC20PermitInit",
    fn: "init(string)",
    kind: "step",
    params: [param({ name: "name_", type: "string", doc: "The EIP-712 domain name: the token name." })],
    initializes: [{ module: "EIP712", with: { name: "name_", version: "1" } }, { module: "Nonces" }, { module: "ERC20Permit" }],
    after: [],
    sameCall: [],
    path: "src/tokens/ERC20/ERC20PermitInit.sol",
    source: { path: "src/tokens/ERC20/ERC20PermitInit.sol", needle: "function init(string memory name_)", lines: 5 },
  },
  {
    name: "ERC6538RegistryInit",
    contract: "ERC6538RegistryInit",
    fn: "init()",
    kind: "step",
    params: [],
    initializes: [{ module: "EIP712", with: { name: "ERC6538Registry", version: "1.0" } }, { module: "ERC6538Registry" }],
    after: [],
    sameCall: [],
    path: "src/privacy/ERC6538RegistryInit.sol",
    source: { path: "src/privacy/ERC6538RegistryInit.sol", needle: "function init()", lines: 4 },
  },
  {
    name: "SafeDiamondCutInit",
    contract: "SafeDiamondCutInit",
    fn: "init(address,address,uint256)",
    kind: "step",
    params: [
      param({
        name: "admin",
        type: "address",
        doc: "The address granted `DEFAULT_ADMIN_ROLE` (manages guardians and resumes operation).",
        rule: "nonzero",
        authority: true,
        role: ADMIN_ROLE,
      }),
      param({ name: "safe", type: "address", doc: "The Gnosis Safe multisig pinned as the sole cut authority.", rule: "nonzero&code(safe)", authority: true, role: "diamondCut" }),
      param({
        name: "minThreshold",
        type: "uint256",
        doc: "The minimum signature threshold the pinned Safe must enforce.",
        rule: "gte(1)",
        example: "2",
        exampleSource: STUDIO,
      }),
    ],
    initializes: [
      { module: "AccessControl", with: { admin: "admin" } },
      { module: "EmergencyStop" },
      { module: "SafeDiamondCut", with: { safe: "safe", minThreshold: "minThreshold" } },
    ],
    after: [],
    sameCall: [],
    registersInterfaces: true,
    path: "src/governance/SafeDiamondCutInit.sol",
    source: { path: "src/governance/SafeDiamondCutInit.sol", needle: "function init(address admin, address safe, uint256 minThreshold)", lines: 6 },
  },
  {
    name: "GovernedSafeDiamondCutInit",
    contract: "GovernedSafeDiamondCutInit",
    fn: "init(address,address,uint256,uint256)",
    kind: "step",
    params: [
      param({
        name: "admin",
        type: "address",
        doc: "The address granted `DEFAULT_ADMIN_ROLE` (manages guardians and resumes operation).",
        rule: "nonzero",
        authority: true,
        role: ADMIN_ROLE,
      }),
      param({
        name: "safe",
        type: "address",
        doc: "The Gnosis Safe multisig pinned as the sole scheduling/execution authority.",
        rule: "nonzero&code(safe)",
        authority: true,
        role: "scheduleCut",
      }),
      param({ name: "minThreshold", type: "uint256", doc: "The minimum signature threshold the pinned Safe must enforce.", rule: "gte(1)" }),
      param({ name: "minDelay", type: "uint256", doc: "The minimum timelock delay (seconds) between schedule and execute.", unit: "seconds" }),
    ],
    initializes: [
      { module: "AccessControl", with: { admin: "admin" } },
      { module: "EmergencyStop" },
      { module: "GovernedSafeDiamondCut", with: { safe: "safe", minThreshold: "minThreshold", minDelay: "minDelay" } },
    ],
    after: [],
    sameCall: [],
    registersInterfaces: true,
    path: "src/governance/GovernedSafeDiamondCutInit.sol",
    source: { path: "src/governance/GovernedSafeDiamondCutInit.sol", needle: "function init(address admin, address safe, uint256 minThreshold, uint256 minDelay)", lines: 6 },
  },
  {
    name: "GovernedDiamondCutInit",
    contract: "GovernedDiamondCutInit",
    fn: "init(address)",
    kind: "step",
    params: [
      param({
        name: "admin",
        type: "address",
        doc: "The address granted `DEFAULT_ADMIN_ROLE` (manages guardians and resumes operation).",
        rule: "nonzero",
        authority: true,
        role: ADMIN_ROLE,
      }),
    ],
    initializes: [{ module: "AccessControl", with: { admin: "admin" } }, { module: "EmergencyStop" }, { module: "GovernedDiamondCut" }],
    // Satisfied by GovernedDiamondCutInit itself, which runs AccessControl first.
    after: ["AccessControl"],
    afterSource: { path: "src/governance/libraries/GovernedDiamondCutLib.sol", needle: "AccessControl must already be initialized", lines: 2 },
    sameCall: [],
    registersInterfaces: true,
    path: "src/governance/GovernedDiamondCutInit.sol",
    source: { path: "src/governance/GovernedDiamondCutInit.sol", needle: "function init(address admin)", lines: 6 },
  },
  {
    name: "GovernedVaultInit",
    contract: "GovernedVaultInit",
    fn: "init((address,string,string,uint8,uint256,uint48,uint32,uint256,uint256))",
    kind: "bundle",
    params: [
      param({
        name: "p",
        type: "tuple",
        doc: "Governance parameters for the self-governed vault.",
        components: [
          param({ name: "asset", type: "address", doc: "Underlying ERC-20 the vault holds.", rule: "nonzero&code(token)" }),
          param({
            name: "name",
            type: "string",
            doc: "Share-token name (also the EIP-712 domain name and governor name).",
            example: "Grant vault",
            exampleSource: GRANT,
          }),
          param({ name: "symbol", type: "string", doc: "Share-token symbol.", example: "gVLT", exampleSource: GRANT }),
          param({ name: "decimalsOffset", type: "uint8", doc: "ERC-4626 virtual-share offset (usually 0).", example: "0", exampleSource: GRANT }),
          param({
            name: "minDelay",
            type: "uint256",
            doc: "Timelock delay between queue and execute.",
            unit: "seconds",
            example: "300",
            exampleSource: GRANT,
          }),
          param({
            name: "votingDelay",
            type: "uint48",
            doc: "Time between proposal creation and voting start.",
            unit: "seconds",
            example: "60",
            exampleSource: GRANT,
          }),
          param({
            name: "votingPeriod",
            type: "uint32",
            doc: "How long the vote stays open (must be > 0).",
            unit: "seconds",
            rule: "gt(0)",
            example: "600",
            exampleSource: GRANT,
          }),
          param({
            name: "proposalThreshold",
            type: "uint256",
            doc: "Minimum votes to create a proposal.",
            unit: "wei",
            example: "0",
            exampleSource: GRANT,
          }),
          param({
            name: "quorumNumerator",
            type: "uint256",
            doc: "Quorum as a percentage of total supply.",
            unit: "percent",
            rule: "range(0,100)",
            example: "4",
            exampleSource: GRANT,
          }),
        ],
      }),
    ],
    initializes: [
      { module: "AccessControl", with: { admin: "address(this)" } },
      { module: "EmergencyStop" },
      { module: "GovernedDiamondCut" },
      { module: "ERC20", with: { name: "p.name", symbol: "p.symbol" } },
      { module: "ERC4626", with: { asset: "p.asset", decimalsOffset: "p.decimalsOffset" } },
      { module: "EIP712", with: { name: "p.name", version: "1" } },
      { module: "Nonces" },
      { module: "Votes" },
      { module: "ERC20Votes" },
      { module: "VaultCore" },
      {
        module: "TimelockController",
        with: { minDelay: "p.minDelay", proposers: "[address(this)]", executors: "[address(0)]", admin: "address(this)" },
      },
      {
        module: "Governor",
        with: {
          name: "p.name",
          token: "address(this)",
          timelock: "address(this)",
          votingDelay: "p.votingDelay",
          votingPeriod: "p.votingPeriod",
          proposalThreshold: "p.proposalThreshold",
          quorumNumerator: "p.quorumNumerator",
        },
      },
    ],
    after: [],
    sameCall: [],
    sequence: [
      "AccessControl",
      "EmergencyStop",
      "ERC-165 flags",
      "GovernedDiamondCut",
      "ERC20",
      "ERC4626",
      "EIP712",
      "Nonces",
      "Votes",
      "ERC20Votes",
      "VaultCore",
      "TimelockController",
      "Governor",
      "GovernedVault",
    ],
    registersInterfaces: true,
    path: "src/defi/GovernedVaultInit.sol",
    source: { path: "src/defi/GovernedVaultInit.sol", needle: "function init(GovernedVaultParams calldata p)", lines: 44 },
  },
  {
    name: "AccountInit",
    contract: "AccountInit",
    fn: "init(address)",
    kind: "step",
    params: [param({ name: "owner", type: "address", doc: "The account's initial ECDSA signing owner.", rule: "nonzero", authority: true, role: "signer" })],
    initializes: [
      { module: "Ownable", with: { owner: "address(this)" } },
      { module: "AccessControl", with: { admin: "address(this)" } },
      { module: "AccountSigner", with: { owner: "owner" } },
      { module: "ERC4337Validation", with: { entryPoint: "entryPoint_" } },
      { module: "ERC1271Signature" },
      { module: "ERC7821Executor" },
    ],
    after: [],
    sameCall: [],
    registersInterfaces: true,
    ctorArgs: [{ name: "entryPoint_", type: "address" }],
    path: "src/accounts/erc7579/AccountInit.sol",
    source: { path: "src/accounts/erc7579/AccountInit.sol", needle: "function init(address owner)", lines: 3 },
  },
  {
    name: "AccountInit6900",
    contract: "AccountInit6900",
    fn: "init(address)",
    kind: "step",
    params: [
      param({
        name: "owner",
        type: "address",
        doc: "The account's admin: the authority that installs and uninstalls validations and executions.",
        rule: "nonzero",
        authority: true,
        role: ADMIN_ROLE,
      }),
    ],
    initializes: [
      { module: "Ownable", with: { owner: "address(this)" } },
      { module: "AccessControl", with: { admin: "owner" } },
      { module: "EIP712", with: { name: "Lattice Modular Account", version: "1" } },
      { module: "ERC4337Validation", with: { entryPoint: "entryPoint_" } },
      { module: "ERC6900Signature" },
    ],
    after: [],
    sameCall: [],
    registersInterfaces: true,
    ctorArgs: [{ name: "entryPoint_", type: "address" }],
    path: "src/accounts/erc6900/AccountInit6900.sol",
    source: { path: "src/accounts/erc6900/AccountInit6900.sol", needle: "function init(address owner)", lines: 15 },
  },
];

// ── recipe templates (spec L192-L197, Flow 2) ──────────────────────────────────────────────────────

/** A template as the generator builds it: facets and owners come from the script's cuts at the pin. */
export type TemplateSource = {
  name: string;
  script: string;
  /** The script function whose `cuts[i] = …` lines build the diamond. */
  cutsFn: string;
  proxy: RecipeTemplate["proxy"];
  phase: RecipeTemplate["phase"];
  init: Recipe["init"];
  immutable?: true;
  source: Cite;
};

function args(values: Record<string, Arg>): Record<string, Arg> {
  return values;
}

export const TEMPLATES: TemplateSource[] = [
  {
    name: "GovernedVault",
    script: VAULT_SCRIPT,
    cutsFn: "_buildBaseCuts",
    proxy: "Lattice",
    phase: "v1",
    // `asset` has no example: GrantExample deploys a fresh test asset, so the template leaves it for INIT-01.
    init: {
      kind: "bundle",
      spec: "GovernedVaultInit",
      args: args({
        p: {
          name: "Grant vault",
          symbol: "gVLT",
          decimalsOffset: "0",
          minDelay: "300",
          votingDelay: "60",
          votingPeriod: "600",
          proposalThreshold: "0",
          quorumNumerator: "4",
        },
      }),
    },
    source: { path: VAULT_SCRIPT, needle: "function _buildBaseCuts()", lines: 17 },
  },
  {
    name: "ERC20",
    script: "script/base/tokens/DeployERC20.s.sol",
    cutsFn: "_coreCuts",
    proxy: "Lattice",
    phase: "v1",
    // The immutable default overload: ERC20Init, then DiamondIntrospectionInit.initImmutable, which the planner appends.
    init: { kind: "steps", steps: [{ spec: "ERC20Init", args: args({ name_: "Example Token", symbol_: "EXT" }) }] },
    immutable: true,
    source: { path: "script/base/tokens/DeployERC20.s.sol", needle: "function _coreCuts()", lines: 7 },
  },
  {
    name: "SafeDiamondCut",
    script: "script/base/governance/DeploySafeDiamondCut.s.sol",
    cutsFn: "buildCuts",
    proxy: "Lattice",
    phase: "v1",
    // `safe` is left empty for INIT-01; the admin is the deploying account, resolved when the transaction is built.
    init: { kind: "steps", steps: [{ spec: "SafeDiamondCutInit", args: args({ admin: { $ref: "deployer" }, minThreshold: "2" }) }] },
    source: { path: "script/base/governance/DeploySafeDiamondCut.s.sol", needle: "cuts = new FacetCut[](6);", lines: 9 },
  },
  {
    name: "Account",
    script: "script/base/accounts/DeployAccount.s.sol",
    cutsFn: "buildCuts",
    proxy: "AccountDiamond",
    phase: "v1.1",
    init: { kind: "steps", steps: [{ spec: "AccountInit", args: args({}) }] },
    source: { path: "script/base/accounts/DeployAccount.s.sol", needle: "cuts = new FacetCut[](9);", lines: 11 },
  },
  {
    name: "Account6900",
    script: "script/base/accounts/DeployAccount6900.s.sol",
    cutsFn: "buildCuts",
    proxy: "ModularAccount6900",
    phase: "v1.1",
    init: { kind: "steps", steps: [{ spec: "AccountInit6900", args: args({}) }] },
    source: { path: "script/base/accounts/DeployAccount6900.s.sol", needle: "cuts = new FacetCut[](10);", lines: 12 },
  },
];

/**
 * The Blank diamond (spec L990): not a Lattice deploy script, so not a catalog template. C5a's `blankDiamond`
 * builds it; the fixture test checks its routing against this definition.
 */
export const BLANK_DIAMOND = {
  facets: ["DiamondLoupeFacet", "ERC165Facet", "Receive", "AccessControl", "AccessControlDiamondCut"],
  init: { kind: "steps", steps: [{ spec: "AccessControlInit", args: { admin: { $ref: "deployer" } } }] } satisfies Recipe["init"],
};

// ── linked libraries and the registry owner (CG2's CCR, contracts §3.1) ───────────────────────────

/** Linked libraries released as shared contracts, and the facets whose code links them. */
export const LIBRARIES: { name: string; linkedBy: string[]; source: Cite }[] = [
  {
    name: "PoseidonT3",
    linkedBy: ["Semaphore", "ShieldedPool"],
    // A library with a `public` function, called by the LeanIMT both facets' trees use (SemaphoreLib L54, ShieldedPoolLib L56).
    source: { path: "lib/zk-kit/lean-imt/InternalLeanIMT.sol", needle: 'import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";' },
  },
];

/** The sentence on a facet release that links a library Lattice doesn't pin. */
export function linksProvisional(library: string): string {
  return `links ${library}, which Lattice doesn't pin yet`;
}

/** Decision D6's placeholder LatticeRegistry owner while the release is provisional. */
export const REGISTRY_OWNER = "0x000000000000000000000000000000000000dEaD";

// ── fixture-next (the migrate flow) ────────────────────────────────────────────────────────────────

/** What `fixture-next` changes. Every change is invented; the README lists them. */
export const NEXT_CHANGES = {
  /** Gains an invented selector, with new (fake) code. */
  gains: { facet: "EmergencyStop", signature: "guardianCount()" },
  /** Loses a selector it exports at the pin, with new (fake) code. */
  loses: { facet: "Governor", signature: "version()" },
  /** Gets new (fake) code with the same selectors: codehash, init code hash and address change. */
  rebuilt: "ERC20",
} as const;
