import type { ProblemDocEntry } from "./types";

/** CORE-01 .. CORE-05, DEP-01 .. DEP-03, STO-01, STO-02 (spec L317-L325; Rules R2, R4, R5, R12, R13). */
export const CORE_DEP_STO: readonly ProblemDocEntry[] = [
  {
    code: "CORE-01",
    family: "Diamond core, dependencies and storage",
    title: "Loupe is incomplete",
    meaning:
      "One or more of the four loupe selectors — `facets()`, `facetFunctionSelectors(address)`, `facetAddresses()` and `facetAddress(bytes4)` — aren't cut into the diamond: DiamondLoupeFacet isn't placed, or it is but one of the four is excluded.",
    why:
      "EIP-2535 requires every diamond to answer all four loupe calls, and Lattice's [`LatticeFactory`](lattice:src/LatticeFactory.sol#103-107) checks for them at deploy time, refusing to build a diamond that's missing any. Studio blocks earlier, before a transaction is ever built.",
    fixes: ["Place DiamondLoupeFacet.", "Excluded rather than missing: include the selector again."],
    exampleParams: { selector: "0x7a0ed627", signature: "facets()", missing: ["0x7a0ed627"], facet: "DiamondLoupeFacet", excluded: false },
    exampleNote: "DiamondLoupeFacet isn't on the sheet, so facets() has nowhere to route:",
  },
  {
    code: "CORE-02",
    family: "Diamond core, dependencies and storage",
    title: "No upgrade mechanism",
    meaning:
      "Nothing on the sheet can change this diamond after it deploys: no DiamondCutFacet, AccessControlDiamondCut, GovernedDiamondCut, SafeDiamondCut or GovernedSafeDiamondCut is placed. Immutability is a deliberate choice, not a default, so Studio asks for it to be acknowledged.",
    why:
      "A diamond with no cut facet [can never be upgraded](lattice:src/interfaces/ILatticeFactory.sol#55-56): there's no function left that could change its routing. That's a legitimate design, but it forecloses every future fix, so the deploy review makes it an explicit choice rather than a silent one.",
    fixes: ["Choose an upgrade mechanism.", "Keep the diamond immutable, and acknowledge it."],
    exampleParams: {},
    exampleNote: "The message is the same every time:",
  },
  {
    code: "CORE-03",
    family: "Diamond core, dependencies and storage",
    title: "Two upgrade mechanisms placed",
    meaning:
      "Two members of the upgrade-mechanism family are placed together. DiamondCutFacet, AccessControlDiamondCut, GovernedDiamondCut, SafeDiamondCut and GovernedSafeDiamondCut all provide a way to cut the diamond, and a diamond holds one, even when the two share no selector.",
    why:
      "A second upgrade path can bypass the protection the first one exists for: [`AccessControlDiamondCut`](lattice:src/governance/AccessControlDiamondCut.sol#16-19) would let its admin skip the [delay `GovernedSafeDiamondCut` enforces](lattice:src/governance/GovernedSafeDiamondCut.sol#150-169) (`scheduleCut`, `minDelay`, `executeCut`). This isn't a routing conflict Studio can resolve by choosing an owner; it means removing one of the two facets.",
    fixes: ["Remove one of the two facets."],
    exampleParams: {
      facets: ["AccessControlDiamondCut", "GovernedSafeDiamondCut"],
      reason: "AccessControlDiamondCut would let the admin skip GovernedSafeDiamondCut's delay",
    },
    exampleNote: "AccessControlDiamondCut and GovernedSafeDiamondCut are both placed:",
  },
  {
    code: "CORE-04",
    family: "Diamond core, dependencies and storage",
    title: "No Receive facet",
    meaning:
      "Nothing on the sheet accepts plain ETH sent to the diamond. A `.transfer` or `.send` call to it will revert, because there's no `receive()` to catch it.",
    why:
      "A diamond only accepts plain ETH through a facet that routes selector `0x00000000` to a `receive()` function, and only [`Receive`](lattice:src/Receive.sol#12-31) does that in the catalog. This is a warning, not a blocker: many diamonds never need to receive ETH directly.",
    fixes: ["Place Receive."],
    exampleParams: { facet: "Receive" },
    exampleNote: "The message is the same every time:",
  },
  {
    code: "CORE-05",
    family: "Diamond core, dependencies and storage",
    title: "No ERC165Facet",
    meaning:
      "Nothing on the sheet answers `supportsInterface()`, so wallets, block explorers and other contracts that check interface support before calling in can't detect what this diamond implements.",
    why:
      "ERC-165 detection needs a facet that routes `supportsInterface(bytes4)`; the catalog's `ERC165Facet` is the only one that does. `ERC165Facet` comes from diamond-lib, the library Lattice builds its diamonds on. It's a warning rather than a blocker, because a diamond still works without it — callers just have to assume rather than ask.",
    fixes: ["Place ERC165Facet."],
    exampleParams: { facet: "ERC165Facet" },
    exampleNote: "The message is the same every time:",
  },
  {
    code: "DEP-01",
    family: "Diamond core, dependencies and storage",
    title: "Hard requirement unmet",
    meaning:
      "A placed facet needs another facet to work, and none of the facets that would satisfy that requirement is on the sheet. Some facets build directly on another's storage or calls, and can't function alone.",
    why:
      "Requirements like this come from how a facet's library is written, not from routing: VaultCore reads and writes through ERC4626's own share accounting, so it has nothing to run against without it. The overlay records each facet's hard requirements from how Lattice composes its own recipes, and Studio checks them on every edit.",
    fixes: ["Place one of the facets the requirement allows.", "More than one option: compare them side by side."],
    exampleParams: { facet: "VaultCore", anyOf: ["ERC4626"], reason: "it runs the assets behind ERC4626's shares and initializes after it" },
    exampleNote: "VaultCore is placed without the facet it depends on:",
  },
  {
    code: "DEP-02",
    family: "Diamond core, dependencies and storage",
    title: "Convention not met",
    meaning:
      "Either a facet's usual companion is missing (the two are commonly placed together, though the diamond still works without the second), or a namespace is written at init with no facet on the sheet to manage it afterward.",
    why:
      "These are conventions Lattice's own recipes follow, not on-chain rules, so Studio warns instead of blocking: a GovernedDiamondCut without EmergencyStop still upgrades correctly, it just has no guardian who can halt a bad upgrade in flight. A namespace written with no manager is similar: the values land in storage, but nothing on the sheet can change them again.",
    fixes: ["Place the missing facet."],
    exampleParams: { kind: "companion", facet: "GovernedDiamondCut", anyOf: ["EmergencyStop"], reason: "a guardian can halt upgrades" },
    exampleNote: "GovernedDiamondCut is placed without its usual companion:",
  },
  {
    code: "DEP-03",
    family: "Diamond core, dependencies and storage",
    title: "Two facets from one family",
    meaning:
      "Two placed facets belong to the same family — an access model or an account model — and a diamond holds only one member of a family at a time.",
    why:
      "AccountSigner and ERC6900Validation both answer who can act as this account, through different, incompatible models; a diamond built around one can't also make sense of the other. The overlay records each facet's family from how Lattice groups its own recipes.",
    fixes: ["Remove one of the two facets."],
    exampleParams: { facets: ["AccountSigner", "ERC6900Validation"], family: "account" },
    exampleNote: "Two account models are placed together:",
  },
  {
    code: "STO-01",
    family: "Diamond core, dependencies and storage",
    title: "Storage namespace collision",
    meaning:
      "Two placed facets both claim the same ERC-7201 storage id, or land on the same computed slot. Only one library can own a namespace's storage; a second writer would silently corrupt the first one's state.",
    why:
      "An [ERC-7201](https://eips.ethereum.org/EIPS/eip-7201) namespace id determines its storage slot by formula, so two facets that declare the same id land on the same slot no matter how the diamond is composed. Studio computes every placed facet's slot from its own library constant, the same way Lattice does, never from written documentation, which can drift out of step with the code.",
    fixes: ["Remove one of the two facets."],
    exampleParams: { id: "lattice.storage.X", slot: "0x00", facets: ["A", "B"] },
    exampleNote: "Two facets both claim one namespace:",
  },
  {
    code: "STO-02",
    family: "Diamond core, dependencies and storage",
    title: "Namespace shared by design",
    meaning:
      "A placed facet reads or writes a namespace another facet declares as its own. This is informational: some facets are built to extend another's storage on purpose, so nothing here needs fixing.",
    why:
      "ERC20Votes adds checkpoints alongside ERC20's own balances, in the same namespace, so sharing it is the intended design, not a collision. Studio still names it, so it stays clear which facet owns the namespace's layout.",
    fixes: [],
    exampleParams: { facet: "ERC20Votes", namespace: "lattice.storage.ERC20", owner: "ERC20" },
    exampleNote: "The message is the same every time:",
  },
];
