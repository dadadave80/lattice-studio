import type { ProblemDocEntry } from "./types";

/** NET-01 .. NET-08 (spec L335-L342; Rules R8, R16, R21). */
export const NET: readonly ProblemDocEntry[] = [
  {
    code: "NET-01",
    family: "Chain readiness",
    title: "CreateX isn't right on this chain",
    meaning:
      "The CreateX path is chosen, but CreateX either isn't deployed on the selected chain, or the contract at its address isn't CreateX: its runtime codehash doesn't match the one Studio pins.",
    why:
      "CreateX predicts an address purely from the raw salt it's given (`keccak256(abi.encode(salt))`). Predicting against a different contract, or none, would be meaningless, so Studio checks the codehash against [CreateX](https://github.com/pcaversaccio/createx)'s own release before ever building a transaction against it.",
    fixes: ["Use LatticeFactory instead.", "Choose another chain."],
    exampleParams: { chain: "Sepolia", case: "codehash", expected: "0xbd8a7ea8cfca7b4e5f5041d7d3e6f2c8e0f6b53f" },
    exampleNote: "The contract at CreateX's address on Sepolia doesn't match its known codehash:",
  },
  {
    code: "NET-02",
    family: "Chain readiness",
    title: "Arachnid's proxy is missing",
    meaning:
      "A shared contract needs deploying on the selected chain, but Arachnid's deployment proxy either isn't there, or its codehash doesn't match the one Studio pins.",
    why:
      "Every shared contract — a facet's release, an init contract, LatticeRegistry, LatticeFactory itself — deploys through [Arachnid's deterministic deployment proxy](https://github.com/Arachnid/deterministic-deployment-proxy), which runs `create2(salt, initcode)` with nothing else: no sender binding, no follow-up call. It's a plain contract, not a precompile, so it has to actually be there, keyless-deployed at its own fixed address, before Studio can deploy anything at a release address.",
    fixes: ["Choose another chain."],
    exampleParams: { chain: "Sepolia", case: "missing", expected: "0x00" },
    exampleNote: "The proxy isn't deployed on Sepolia yet:",
  },
  {
    code: "NET-03",
    family: "Chain readiness",
    title: "Shared contracts missing on this chain",
    meaning:
      "One or more shared contracts this plan needs — facets, init contracts, LatticeRegistry or LatticeFactory itself — aren't deployed on the selected chain yet.",
    why:
      "Every shared contract deploys once per chain, at an address anyone can predict from its bytecode and salt; nothing about deploying it is secret or exclusive. Studio checks the plan's full list against the chain before a deploy, and offers to deploy whatever's missing at its release address, dependencies first.",
    fixes: ["Deploy the missing contracts."],
    exampleParams: { chain: "Sepolia", core: ["LatticeFactory"], missing: ["A", "B", "C"], total: 15 },
    exampleNote: "LatticeFactory and three of fifteen facets and init contracts aren't on Sepolia yet:",
  },
  {
    code: "NET-04",
    family: "Chain readiness",
    title: "Code doesn't match the catalog",
    meaning:
      "The code already deployed at a shared contract's release address doesn't match what the catalog expects: something else was deployed there, or a different version of the same contract.",
    why:
      "A release address only means what it claims when the code at it actually matches the catalog's build. Studio compares the deployed runtime codehash against the one the catalog pins for that name and version, so a diamond never cuts to code nobody can account for.",
    fixes: ["Choose another chain."],
    exampleParams: {
      chain: "Sepolia",
      name: "ERC20",
      version: "0.4.0",
      address: "0x0000000000000000000000000000000000000004",
      expected: "0x00",
      actual: "0x01",
    },
    exampleNote: "The code at ERC20's release address on Sepolia isn't Lattice's 0.4.0 build:",
  },
  {
    code: "NET-05",
    family: "Chain readiness",
    title: "Salt already used",
    meaning:
      "The predicted address for this recipe already has code on the selected chain: the same signing account already deployed a diamond with this salt (the factory path), or the salt has already been used (the CreateX path).",
    why:
      "[The factory returns the existing diamond rather than building a new one](lattice:src/LatticeFactory.sol#82-84) for a repeated sender-and-salt pair, so a second deploy would hand back what's already there and ignore the recipe, not apply it; on the CreateX path, reusing a salt reverts outright. Studio checks the predicted address for code before ever building the transaction.",
    fixes: ["Use a new salt."],
    exampleParams: { chain: "Sepolia", path: "factory", address: "0x0000000000000000000000000000000000000005" },
    exampleNote: "The factory path, once a diamond already exists at the predicted address:",
  },
  {
    code: "NET-06",
    family: "Chain readiness",
    title: "Gas over the chain's cap",
    meaning:
      "The deploy's estimated gas is close to, or over, the selected chain's per-transaction cap: a warning from 80% of the cap, a blocker once the estimate passes it.",
    why:
      "[EIP-7825](https://eips.ethereum.org/EIPS/eip-7825) sets a hard per-transaction limit of 16,777,216 gas on Ethereum since Fusaka, and other chains set their own; a deploy that needs more can never go through in one transaction, no matter how it's built. There's no separate size check for a Lattice diamond: the initcode is always the same constant bytes, and cuts and init travel as call data, so this cap is the real limit.",
    fixes: ["Remove facets to bring the estimate down."],
    exampleParams: { chain: "Sepolia", gas: "17200000", cap: "16777216", share: 1.025 },
    exampleNote: "This deploy is estimated over Sepolia's cap:",
  },
  {
    code: "NET-07",
    family: "Chain readiness",
    title: "Simulating without eth_simulateV1",
    meaning:
      "The selected RPC doesn't support `eth_simulateV1`, so the deploy review simulates with `eth_call` instead. The preview still works; it just shows fewer details.",
    why:
      "`eth_simulateV1` gives a fuller trace than a plain `eth_call`, but not every RPC provider supports it yet. This is informational only: it changes what the preview can show, never whether the deploy itself will succeed.",
    fixes: ["Use another RPC."],
    exampleParams: { chain: "Sepolia" },
    exampleNote: "The message is the same every time:",
  },
  {
    code: "NET-08",
    family: "Chain readiness",
    title: "Registry doesn't list this version",
    meaning:
      "The selected chain's LatticeRegistry doesn't list one or more of the facet versions the catalog pins. The plan can still deploy; it just cuts those facets without the registry's on-chain version check.",
    why:
      "LatticeFactory checks a facet's version against LatticeRegistry when the registry lists it, as an extra guard against cutting the wrong build; a version the registry doesn't know about simply skips that guard rather than failing the deploy. This can happen on a newer chain, or one whose registry hasn't been updated yet, so Studio warns and asks for it to be acknowledged rather than blocking a deploy that would otherwise succeed.",
    fixes: ["Cut without the registry check, and acknowledge it.", "Choose another chain."],
    exampleParams: { chain: "Sepolia", facets: ["A", "B", "C"], count: 3 },
    exampleNote: "Three facets will be cut without the registry's on-chain check:",
  },
];
