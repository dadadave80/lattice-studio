import type { ProblemDocEntry } from "./types";

/** SEL-01 .. SEL-05, SEM-01 (spec L311-L316; Rules R1, R19). */
export const SEL_SEM: readonly ProblemDocEntry[] = [
  {
    code: "SEL-01",
    family: "Selectors and seams",
    title: "Selector needs an owner",
    meaning:
      "Two or more placed facets export the same selector, and nothing decides which one wins: no seam, no single default owner, and no owner chosen yet. A diamond can cut a selector to one facet only, so the deploy and the Foundry export both stay blocked until someone chooses.",
    why:
      "A diamond cut can route a selector to one facet only ([EIP-2535](https://eips.ethereum.org/EIPS/eip-2535)'s cut rules: adding an already-mapped selector reverts). Lattice's [`LatticeFactory`](lattice:src/LatticeFactory.sol) enforces this on-chain, so Studio raises it before a deploy or an export ever reaches a wallet.",
    fixes: [
      "Keep the facet already routed, or route it to another contender.",
      "Three or more contenders: choose an owner from a list.",
      "Several selectors share one set of contenders: choose an owner for each, in one pass.",
    ],
    exampleParams: {
      selector: "0xcdfe7f5c",
      signature: "sendMessage(bytes,bytes,bytes[])",
      contenders: ["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"],
    },
    exampleNote: "AxelarGatewayAdapter and HyperlaneGatewayAdapter both export the same cross-chain selector:",
  },
  {
    code: "SEL-02",
    family: "Selectors and seams",
    title: "Facet gives up selectors",
    meaning:
      "A placed facet exports some selectors that route to a different facet instead, because that facet claims them by default. This is informational: there's nothing to fix here, only somewhere to look if the routing seems off.",
    why:
      "When exactly one contender lists a selector among its defaults, it owns it automatically (`via: \"default\"`), and every other facet that also exports it gives it up without raising a problem. The note names where those selectors went, so the routing stays legible without opening every card.",
    fixes: ["Show the selectors and the facets that own them instead."],
    exampleParams: { facet: "ERC20", count: 4, selectors: [], to: ["GovernedVault", "ERC4626"] },
    exampleNote: "ERC20 exports four selectors that GovernedVault and ERC4626 claim by default:",
  },
  {
    code: "SEL-03",
    family: "Selectors and seams",
    title: "Facet routes nothing",
    meaning:
      "A placed facet contributes no selectors to the diamond: every one it exports is a seam served elsewhere, owned by another facet, excluded, or some mix of those. The card sits on the sheet and does nothing.",
    why:
      "A facet that cuts no selectors still adds deployment cost, and a card that looks placed but does nothing is easy to miss. Studio flags it so it never survives into a deploy by accident.",
    fixes: ["Remove the facet.", "When one of its selectors could route here instead, route it."],
    exampleParams: { facet: "ERC20Pausable", count: 2, why: "seams", servedBy: ["GovernedVault"], movable: [] },
    exampleNote: "Both of ERC20Pausable's selectors are seams GovernedVault already serves:",
  },
  {
    code: "SEL-04",
    family: "Selectors and seams",
    title: "exportSelectors() can't be cut",
    meaning:
      "An imported recipe names an owner for `exportSelectors()` 0x0ef22643. It never can have one: every facet's catalog entry has it stripped before Studio ever sees it, so no recipe, imported or edited, can route it into a diamond.",
    why:
      "`exportSelectors()` lets a facet report its own selectors off-chain; it plays no part in a diamond's routing table. [`LatticeFactory`](lattice:src/LatticeFactory.sol), `LatticeRegistry` and `LatticeVersion.sol` all keep it out of every cut, and the catalog strips it from every facet at build time.",
    fixes: ["Remove the owner an import named for it."],
    exampleParams: { selector: "0x0ef22643", signature: "exportSelectors()" },
    exampleNote: "An imported recipe named an owner for it anyway:",
  },
  {
    code: "SEL-05",
    family: "Selectors and seams",
    title: "Owner isn't valid",
    meaning:
      "An imported recipe names an owner for a selector, but that facet either isn't on the sheet or doesn't export the selector at all. Editing the sheet never causes this on its own: removing a facet drops its owners along with it.",
    why:
      "A recipe's owner list only means something next to the facets it names, and an imported one can carry an owner from a catalog that has since changed. Studio checks every imported owner against the sheet as the recipe loads.",
    fixes: ["Clear the owner."],
    exampleParams: { selector: "0xa9059cbb", facet: "GovernedVault", reason: "not-placed", signature: "transfer(address,uint256)" },
    exampleNote: "An imported recipe names GovernedVault as the owner of transfer, but GovernedVault isn't on the sheet:",
  },
  {
    code: "SEM-01",
    family: "Selectors and seams",
    title: "Seam routed off its allowed facets",
    meaning:
      "A seam selector — one that several facets share state through — is routed to a facet the seam doesn't allow, or every facet that could serve it is missing from the sheet. A seam has one job: keep related selectors on versions that agree about shared state.",
    why:
      "With ERC20Votes placed, `transfer` and `transferFrom` must run a version that [updates vote checkpoints](lattice:src/tokens/ERC20/ERC20Votes.sol#32-37), or a transfer would move balances without moving the votes that track them; `delegate` and `delegateBySig` must run ERC20Votes' own version for the same reason. GovernedVault carries its own seams: `deposit`, `mint`, `withdraw`, `redeem` and `castVoteBySig` must run GovernedVault's version, `totalAssets` VaultCore's, and `decimals` ERC4626's. Once every facet a seam needs is placed, Studio routes it automatically and blocks any explicit owner outside the allowed set.",
    fixes: [
      "Route the selector to an allowed facet.",
      "Remove the facet that's routed there instead.",
      "None of the allowed facets is placed: place one.",
    ],
    exampleParams: {
      selector: "0xa9059cbb",
      signature: "transfer(address,uint256)",
      allowed: ["GovernedVault", "ERC20Votes"],
      reason: "updates vote checkpoints",
      owner: "ERC20Pausable",
      nonePlaced: false,
    },
    exampleNote: "ERC20Pausable owns transfer, but the seam only allows GovernedVault or ERC20Votes to serve it:",
  },
];
