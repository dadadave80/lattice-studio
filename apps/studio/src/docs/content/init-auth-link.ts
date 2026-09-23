import type { ProblemDocEntry } from "./types";

/** INIT-01 .. INIT-05, AUTH-01, AUTH-02, LINK-01 (spec L326-L334; Rules R7, R9, R10, R14). */
export const INIT_AUTH_LINK: readonly ProblemDocEntry[] = [
  {
    code: "INIT-01",
    family: "Init, authority and links",
    title: "Init argument invalid",
    meaning:
      "A required init argument is missing, or its value breaks the rule Studio validates it against — including a chain rule such as a Safe that must already exist at the address an argument names, once a chain is selected.",
    why:
      "Some rules come straight from Solidity: [governor quorum](lattice:src/governance/VotesLib.sol#81-91) must sit between 0 and 100, because it's read as a percentage of total supply, and a voting period of zero would never let anyone vote. Others depend on what's on-chain, such as a Safe that hasn't been deployed yet. Studio validates every field's rule as it's typed, and again once a chain is selected.",
    fixes: ["Edit the field."],
    exampleParams: { path: "bundle.p.quorum", label: "Governor quorum", missing: false, detail: "it must be 0-100 (percent of supply)", value: 140 },
    exampleNote: "Quorum was set above the range the field allows:",
  },
  {
    code: "INIT-02",
    family: "Init, authority and links",
    title: "Init step out of order",
    meaning:
      "A step init runs before another step it needs to have already run — an order Lattice's own library documents, not one Studio invents.",
    why:
      "[VaultCore reads ERC4626's share accounting during its own init](lattice:src/defi/VaultCoreLib.sol#64-65), so ERC4626 has to initialize first or VaultCore reads nothing. Order constraints like this live in the overlay, one per documented dependency, and only apply to step inits — a bundle's order is fixed in Solidity and shown read-only, never something Studio could reorder.",
    fixes: ["Reorder the steps automatically.", "Move the step by hand."],
    exampleParams: { path: "steps[2]", spec: "VaultCoreInit", module: "VaultCore", after: "ERC4626" },
    exampleNote: "VaultCoreInit is placed before the ERC4626 step it depends on:",
  },
  {
    code: "INIT-03",
    family: "Init, authority and links",
    title: "Two inits set up one module",
    meaning:
      "Two init steps both set up the same module. Depending on what they do, this either conflicts outright, grants the same roles to different addresses, or does the exact same thing twice — a blocker, a warning and an info case, in that order.",
    why:
      "A module's init usually isn't written to guard against running twice: [`AccessControlLib`'s init](lattice:src/access/AccessControlLib.sol#71-76) grants roles every time it runs, so two AccessControl-setting steps produce two grants, possibly to different admins, and EIP712's init overwrites the domain it just wrote. Studio checks every pair of steps that touch the same module for exactly this.",
    fixes: ["Remove one of the two steps.", "Granting roles to different admins: use one admin for both."],
    exampleParams: {
      module: "EIP712",
      case: "conflict",
      specs: ["ERC20PermitInit", "ERC6538RegistryInit"],
      paths: ["steps[0]", "steps[1]"],
      detail: "set the diamond's one EIP-712 domain, to different names, so only one standard's signatures would verify",
    },
    exampleNote: "ERC20PermitInit and ERC6538RegistryInit both write the diamond's EIP-712 domain:",
  },
  {
    code: "INIT-04",
    family: "Init, authority and links",
    title: "Missing init step",
    meaning:
      "A placed facet needs an init step and the plan doesn't provide one, or a module that must initialize in the same call as another has no init step of its own.",
    why:
      "A facet without its init step deploys with empty or zero storage: an [`AccessControlLib`](lattice:src/access/AccessControlLib.sol#71-76)-based facet needs its init to grant the first roles, and ERC20 needs its to set `name()` and `symbol()` at all. Studio checks every placed facet's init entry against the plan, and blocks a deploy that would leave one unset.",
    fixes: ["Add the init step."],
    exampleParams: { module: "ERC20", spec: "ERC20Init", facet: "ERC20", consequence: "`name()` and `symbol()` would be empty" },
    exampleNote: "ERC20 is placed with no init step for it:",
  },
  {
    code: "INIT-05",
    family: "Init, authority and links",
    title: "Example values still in place",
    meaning:
      "One or more init fields still hold the value a template loaded them with, unchanged. Example values are meant to be replaced, not deployed with.",
    why:
      "A template's fields start with plausible demo values so the sheet never looks broken while it's being filled in, but a voting period of ten minutes or a quorum of four percent is rarely what a real diamond should ship with. Studio tracks each field's source and asks for the set to be reviewed, or kept on purpose, before deploy.",
    fixes: ["Review the fields.", "Keep the example values, and acknowledge it."],
    exampleParams: {
      count: 5,
      paths: ["bundle.p.votingPeriod", "bundle.p.quorum"],
      examples: [
        { path: "bundle.p.votingPeriod", label: "Voting period", value: "600", unit: "seconds" },
        { path: "bundle.p.quorum", label: "Quorum", value: "4", unit: "percent" },
      ],
    },
    exampleNote: "Five fields, including voting period and quorum, are still at their template values:",
  },
  {
    code: "AUTH-01",
    family: "Init, authority and links",
    title: "Authority rests with one key",
    meaning:
      "Upgrade or admin authority rests with a single account: one with no code, or one delegated through EIP-7702. No second party and no delay stand between that key and the diamond.",
    why:
      "During init, `msg.sender` is always [LatticeFactory or CreateX](lattice:src/LatticeFactory.sol), never a default address, so every authority argument names a real account explicitly, and Studio can see exactly who holds it. A single key is a legitimate choice for many diamonds, but it's worth confirming before it's locked in, especially when it could instead be a Safe or a governance contract.",
    fixes: ["Use a Safe.", "Use governance.", "Keep the single key, and acknowledge it."],
    exampleParams: {
      holder: "0x0000000000000000000000000000000000000001",
      roles: ["diamondCut", "DEFAULT_ADMIN_ROLE"],
      paths: [],
      delegated: false,
      chain: "Sepolia",
    },
    exampleNote: "One account holds every authority role this diamond grants:",
  },
  {
    code: "AUTH-02",
    family: "Init, authority and links",
    title: "Authority argument reuses an old address",
    meaning:
      "An authority argument is a literal address that this diamond would have had under a different salt, account or chain, or that a recorded deployment already holds. Typing it in by hand loses the reference Studio could otherwise keep live.",
    why:
      "During init, `msg.sender` is the factory, never the diamond itself, so nothing can default to \"this diamond\" the way it could in a constructor. When an address happens to match a prediction or a past deployment, it's almost always meant as a reference to this diamond, and keeping it as a literal goes stale the moment the salt or the chain changes.",
    fixes: ["Use \"This diamond\" instead of the literal address.", "Edit the field."],
    exampleParams: {
      path: "steps[0].admin",
      role: "DEFAULT_ADMIN_ROLE",
      address: "0x0000000000000000000000000000000000000002",
      source: "prediction",
      chainId: 11155111,
      chain: "Sepolia",
    },
    exampleNote: "The admin argument names an address this diamond would have had before the salt changed:",
  },
  {
    code: "LINK-01",
    family: "Init, authority and links",
    title: "Address not confirmed",
    meaning:
      "An address that receives authority came from a shared link or an opened file, and hasn't been confirmed since. A link or a file edited before it's shared could change who ends up with control, without the address ever being read in full.",
    why:
      "A link or a file can carry any address at all, so Studio never lets one reach authority silently: it shows the full address, with any ENS name, and asks for it to be confirmed once before it can be used. This is separate from AUTH-02, which is about a stale reference to this diamond; this is about trusting where an address came from at all.",
    fixes: ["Confirm the address.", "Edit the field."],
    exampleParams: { path: "steps[0].admin", role: "diamondCut", address: "0x0000000000000000000000000000000000000003", source: "link" },
    exampleNote: "The upgrade role goes to an address a shared link supplied:",
  },
];
