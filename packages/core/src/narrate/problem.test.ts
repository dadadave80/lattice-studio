import { describe, expect, test } from "bun:test";
import { lintCopy } from "../format/copy-lint";
import { formatAddress } from "../format/format";
import type { ProblemParams } from "../model/problems";
import { addr, sel } from "../testing/ids";
import { renderProblem } from "./problem";

const rendered: string[] = [];

/** Renders and records the message, so every one is checked against `lintCopy` at the end. */
function render<C extends keyof ProblemParams>(code: C, params: ProblemParams[C]): string {
  const text = renderProblem(code, params);
  rendered.push(text);
  return text;
}

describe("SEL, SEM", () => {
  test("SEL-01: spec example, word for word", () => {
    expect(
      render("SEL-01", {
        selector: "0xcdfe7f5c",
        signature: "sendMessage(bytes,bytes,bytes[])",
        contenders: ["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"],
      }),
    ).toBe("`sendMessage(bytes,bytes,bytes[])` 0xcdfe7f5c is exported by AxelarGatewayAdapter and HyperlaneGatewayAdapter. Choose one owner.");
  });

  test("SEL-01: three or more contenders join with a comma before 'and'", () => {
    const text = render("SEL-01", {
      selector: "0xcdfe7f5c",
      signature: "sendMessage(bytes,bytes,bytes[])",
      contenders: ["AxelarGatewayAdapter", "HyperlaneGatewayAdapter", "LayerZeroAdapter"],
    });
    expect(text).toBe(
      "`sendMessage(bytes,bytes,bytes[])` 0xcdfe7f5c is exported by AxelarGatewayAdapter, HyperlaneGatewayAdapter and LayerZeroAdapter. Choose one owner.",
    );
  });

  test("SEL-02: spec example", () => {
    expect(render("SEL-02", { facet: "ERC20", count: 4, selectors: [], to: ["GovernedVault", "ERC4626"] })).toBe(
      "ERC20 gives 4 selectors to GovernedVault and ERC4626.",
    );
  });

  test("SEL-03: seams, 2 selectors — spec example", () => {
    expect(render("SEL-03", { facet: "ERC20Pausable", count: 2, why: "seams", servedBy: ["GovernedVault"], movable: [] })).toBe(
      "ERC20Pausable cuts nothing: both its selectors are seams that GovernedVault serves. Remove it.",
    );
  });

  test("SEL-03: every why, and count 1 / 2 / 3+ (singular subject agrees with a singular noun)", () => {
    expect(render("SEL-03", { facet: "Facet", count: 1, why: "seams", servedBy: ["Governor"], movable: [] })).toBe(
      "Facet cuts nothing: its only selector is a seam that Governor serves. Remove it.",
    );
    expect(render("SEL-03", { facet: "Facet", count: 3, why: "seams", servedBy: ["Governor", "Timelock"], movable: [] })).toBe(
      "Facet cuts nothing: all its selectors are seams that Governor and Timelock serve. Remove it.",
    );
    expect(render("SEL-03", { facet: "Facet", count: 2, why: "owned", servedBy: ["Governor"], movable: [] })).toBe(
      "Facet cuts nothing: both its selectors are owned by Governor. Remove it.",
    );
    expect(render("SEL-03", { facet: "Facet", count: 2, why: "excluded", servedBy: [], movable: [] })).toBe(
      "Facet cuts nothing: both its selectors are excluded. Remove it.",
    );
    expect(render("SEL-03", { facet: "Facet", count: 2, why: "mixed", servedBy: [], movable: [] })).toBe(
      "Facet cuts nothing: both its selectors are split between seams, other owners and exclusions. Remove it.",
    );
    expect(render("SEL-03", { facet: "Facet", count: 1, why: "mixed", servedBy: [], movable: [] })).toBe(
      "Facet cuts nothing: its only selector is split between a seam, another owner or an exclusion. Remove it.",
    );
  });

  test("SEL-04: spec example, no hex in the message", () => {
    expect(render("SEL-04", { selector: sel(0x0ef22643), signature: "exportSelectors()" })).toBe("`exportSelectors()` is never cut into a diamond.");
  });

  test("SEL-05: not-placed — spec example (bare function name, hex outside the backticks)", () => {
    expect(render("SEL-05", { selector: "0xa9059cbb", facet: "GovernedVault", reason: "not-placed", signature: "transfer(address,uint256)" })).toBe(
      "GovernedVault isn't on the sheet, so it can't own `transfer` 0xa9059cbb.",
    );
  });

  test("SEL-05: not-exported", () => {
    expect(render("SEL-05", { selector: "0xa9059cbb", facet: "GovernedVault", reason: "not-exported", signature: "transfer(address,uint256)" })).toBe(
      "GovernedVault doesn't export `transfer` 0xa9059cbb, so it can't own it.",
    );
  });

  test("SEL-05: no signature names the hex alone", () => {
    expect(render("SEL-05", { selector: "0xa9059cbb", facet: "GovernedVault", reason: "not-exported" })).toBe(
      "GovernedVault doesn't export 0xa9059cbb, so it can't own it.",
    );
  });

  test("SEM-01: spec example, owner present", () => {
    expect(
      render("SEM-01", {
        selector: "0xa9059cbb",
        signature: "transfer(address,uint256)",
        allowed: ["GovernedVault", "ERC20Votes"],
        reason: "updates vote checkpoints",
        owner: "ERC20Pausable",
        nonePlaced: false,
      }),
    ).toBe("`transfer(address,uint256)` must be served by a version that updates vote checkpoints (GovernedVault or ERC20Votes), not ERC20Pausable.");
  });

  test("SEM-01: none of the allowed facets is placed", () => {
    expect(
      render("SEM-01", {
        selector: "0xa9059cbb",
        signature: "transfer(address,uint256)",
        allowed: ["GovernedVault", "ERC20Votes"],
        reason: "updates vote checkpoints",
        nonePlaced: true,
      }),
    ).toBe("`transfer(address,uint256)` must be served by a version that updates vote checkpoints: place GovernedVault or ERC20Votes.");
  });
});

describe("CORE", () => {
  test("CORE-01: missing and excluded", () => {
    expect(render("CORE-01", { selector: "0x7a0ed627", signature: "facets()", missing: ["0x7a0ed627"], facet: "DiamondLoupeFacet", excluded: false })).toBe(
      "The loupe is incomplete: `facets()` is missing. Every Lattice diamond needs all four.",
    );
    expect(render("CORE-01", { selector: "0x7a0ed627", signature: "facets()", missing: ["0x7a0ed627"], facet: "DiamondLoupeFacet", excluded: true })).toBe(
      "The loupe is incomplete: `facets()` is excluded. Every Lattice diamond needs all four.",
    );
  });

  test("CORE-02, CORE-04, CORE-05: static", () => {
    expect(render("CORE-02", {})).toBe("Nothing can change this diamond after deploy.");
    expect(render("CORE-04", { facet: "Receive" })).toBe("Plain ETH sent to this diamond will revert.");
    expect(render("CORE-05", { facet: "ERC165Facet" })).toBe("`supportsInterface()` won't exist; wallets and explorers can't detect interfaces.");
  });

  test("CORE-03: spec example, the reason clause verbatim", () => {
    expect(
      render("CORE-03", {
        facets: ["AccessControlDiamondCut", "GovernedSafeDiamondCut"],
        reason: "AccessControlDiamondCut would let the admin skip GovernedSafeDiamondCut's delay",
      }),
    ).toBe("One upgrade mechanism per diamond: AccessControlDiamondCut would let the admin skip GovernedSafeDiamondCut's delay.");
  });
});

describe("DEP, STO", () => {
  test("DEP-01: spec example", () => {
    expect(render("DEP-01", { facet: "VaultCore", anyOf: ["ERC4626"], reason: "it runs the assets behind ERC4626's shares and initializes after it" })).toBe(
      "VaultCore requires ERC4626: it runs the assets behind ERC4626's shares and initializes after it.",
    );
  });

  test("DEP-01: two options, joined with 'or'", () => {
    expect(render("DEP-01", { facet: "VaultCore", anyOf: ["ERC4626", "ERC4626Alt"], reason: "r" })).toBe("VaultCore requires ERC4626 or ERC4626Alt: r.");
  });

  test("DEP-02: companion — spec example", () => {
    expect(render("DEP-02", { kind: "companion", facet: "GovernedDiamondCut", anyOf: ["EmergencyStop"], reason: "a guardian can halt upgrades" })).toBe(
      "GovernedDiamondCut usually ships with EmergencyStop, so a guardian can halt upgrades.",
    );
  });

  test("DEP-02: namespace, generic wording without a reason", () => {
    expect(render("DEP-02", { kind: "namespace", namespace: "lattice.storage.AccessControl", anyOf: ["AccessControl"] })).toBe(
      "`lattice.storage.AccessControl` is written at init, but without AccessControl nobody can manage it later.",
    );
  });

  test("DEP-02: namespace with a reason — the reason is the whole message, verbatim (contracts §3.1, spec L323)", () => {
    expect(
      render("DEP-02", {
        kind: "namespace",
        namespace: "lattice.storage.AccessControl",
        anyOf: ["AccessControl"],
        reason: "Roles are written at init, but without AccessControl nobody can manage them later.",
      }),
    ).toBe("Roles are written at init, but without AccessControl nobody can manage them later.");
  });

  test("DEP-03: spec example", () => {
    expect(render("DEP-03", { facets: ["AccountSigner", "ERC6900Validation"], family: "account" })).toBe(
      "AccountSigner and ERC6900Validation are different account models; one diamond holds one.",
    );
  });

  test("STO-01: spec example", () => {
    expect(render("STO-01", { id: "lattice.storage.X", slot: "0x00", facets: ["A", "B"] })).toBe("`lattice.storage.X` is claimed by A and B.");
  });

  test("STO-02: spec example", () => {
    expect(render("STO-02", { facet: "ERC20Votes", namespace: "lattice.storage.ERC20", owner: "ERC20" })).toBe(
      "ERC20Votes shares `lattice.storage.ERC20` with ERC20.",
    );
  });
});

describe("INIT", () => {
  test("INIT-01: spec example, value present", () => {
    expect(render("INIT-01", { path: "bundle.p.quorum", label: "Governor quorum", missing: false, detail: "it must be 0-100 (percent of supply)", value: 140 })).toBe(
      "Governor quorum is 140; it must be 0-100 (percent of supply).",
    );
  });

  test("INIT-01: a chain rule (no value to quote) is the detail alone", () => {
    expect(render("INIT-01", { path: "bundle.p.safe", label: "Safe", missing: false, detail: "No Safe at this address on Sepolia yet. Deploy the Safe first", chain: "Sepolia" })).toBe(
      "No Safe at this address on Sepolia yet. Deploy the Safe first.",
    );
  });

  test("INIT-01: a missing required argument — detail is a complete sentence", () => {
    expect(render("INIT-01", { path: "bundle.p.asset", label: "Asset", missing: true, detail: "This field is required." })).toBe("This field is required.");
  });

  test("INIT-02: spec example", () => {
    expect(render("INIT-02", { path: "steps[2]", spec: "VaultCoreInit", module: "VaultCore", after: "ERC4626" })).toBe(
      "VaultCore initializes before ERC4626; it must come after.",
    );
  });

  test("INIT-03: every case", () => {
    expect(
      render("INIT-03", {
        module: "EIP712",
        case: "conflict",
        specs: ["ERC20PermitInit", "ERC6538RegistryInit"],
        paths: ["steps[0]", "steps[1]"],
        detail: "set the diamond's one EIP-712 domain, to different names, so only one standard's signatures would verify",
      }),
    ).toBe("ERC20PermitInit and ERC6538RegistryInit both set the diamond's one EIP-712 domain, to different names, so only one standard's signatures would verify.");
    expect(render("INIT-03", { module: "AccessControl", case: "roles", specs: ["AccessControlInit", "GovernedVaultInit"], paths: ["steps[0]", "steps[1]"] })).toBe(
      "AccessControlInit and GovernedVaultInit both set up AccessControl, granting its roles to different admins.",
    );
    expect(render("INIT-03", { module: "AccessControl", case: "same", specs: ["AccessControlInit", "GovernedVaultInit"], paths: ["steps[0]", "steps[1]"] })).toBe(
      "AccessControlInit and GovernedVaultInit both set up AccessControl, identically.",
    );
  });

  test("INIT-04: spec example (consequence given)", () => {
    expect(render("INIT-04", { module: "ERC20", spec: "ERC20Init", facet: "ERC20", consequence: "`name()` and `symbol()` would be empty" })).toBe(
      "ERC20 has no init step, so `name()` and `symbol()` would be empty.",
    );
  });

  test("INIT-04: generic wording without a consequence", () => {
    expect(render("INIT-04", { module: "ERC20Init", spec: "ERC20Init", facet: "ERC20" })).toBe("ERC20 has no init step, so ERC20Init is never initialized.");
  });

  test("INIT-04: a sameCall module with no init", () => {
    expect(render("INIT-04", { module: "EmergencyStopInit", spec: "EmergencyStopInit", sameCallWith: "AccessControlInit" })).toBe(
      "EmergencyStopInit has no init step; it initializes in the same call as AccessControlInit, so it needs one too.",
    );
    expect(render("INIT-04", { module: "EmergencyStopInit", spec: "EmergencyStopInit" })).toBe("EmergencyStopInit has no init step, so it is never initialized.");
  });

  test("INIT-05: spec example", () => {
    expect(
      render("INIT-05", {
        count: 5,
        paths: ["bundle.p.votingPeriod", "bundle.p.quorum"],
        examples: [
          { path: "bundle.p.votingPeriod", label: "Voting period", value: "600", unit: "seconds" },
          { path: "bundle.p.quorum", label: "Quorum", value: "4", unit: "percent" },
        ],
      }),
    ).toBe("5 fields still use example values, including voting period (600 s) and quorum (4%).");
  });

  test("INIT-05: preserves an acronym label and singular count", () => {
    expect(render("INIT-05", { count: 1, paths: ["bundle.p.ens"], examples: [{ path: "bundle.p.ens", label: "ENS name", value: "example.eth" }] })).toBe(
      "1 field still uses example values, including ENS name (example.eth).",
    );
  });
});

describe("AUTH, LINK", () => {
  test("AUTH-01: spec example shape (single key)", () => {
    const holder = addr(1);
    expect(render("AUTH-01", { holder, roles: ["diamondCut", "DEFAULT_ADMIN_ROLE"], paths: [], delegated: false, chain: "Sepolia" })).toBe(
      `\`diamondCut\` and \`DEFAULT_ADMIN_ROLE\` rest with ${formatAddress(holder)}, a single key. If it's a Safe that isn't deployed yet, deploy it first.`,
    );
  });

  test("AUTH-01: an EIP-7702 delegated account never suggests an undeployed Safe", () => {
    const holder = addr(1);
    expect(render("AUTH-01", { holder, roles: ["DEFAULT_ADMIN_ROLE"], paths: [], delegated: true, chain: "Sepolia" })).toBe(
      `\`DEFAULT_ADMIN_ROLE\` rest with ${formatAddress(holder)}, an EIP-7702 delegated account.`,
    );
  });

  test("AUTH-02: spec example wording, generic (no source)", () => {
    const address = addr(2);
    expect(render("AUTH-02", { path: "steps[0].admin", role: "DEFAULT_ADMIN_ROLE", address })).toBe(
      `The admin is ${formatAddress(address)}, an address this diamond had or a recorded deployment holds.`,
    );
  });

  test("AUTH-02: prediction source, spec example wording", () => {
    const address = addr(2);
    expect(render("AUTH-02", { path: "steps[0].admin", role: "DEFAULT_ADMIN_ROLE", address, source: "prediction", chainId: 11155111, chain: "Sepolia" })).toBe(
      `The admin is ${formatAddress(address)}, where this diamond would have been before the salt changed.`,
    );
  });

  test("AUTH-02: deployment source", () => {
    const address = addr(2);
    expect(render("AUTH-02", { path: "steps[0].admin", role: "DEFAULT_ADMIN_ROLE", address, source: "deployment", chainId: 11155111, chain: "Sepolia" })).toBe(
      `The admin is ${formatAddress(address)}, an address a deployment on Sepolia recorded.`,
    );
  });

  test("LINK-01: spec example wording", () => {
    const address = addr(3);
    expect(render("LINK-01", { path: "steps[0].admin", role: "UPGRADER_ROLE", address, source: "link" })).toBe(
      `The upgrade role goes to ${formatAddress(address)}, which came from a shared link.`,
    );
  });

  test("LINK-01: an opened file", () => {
    const address = addr(3);
    expect(render("LINK-01", { path: "steps[0].admin", role: "UPGRADER_ROLE", address, source: "file" })).toBe(
      `The upgrade role goes to ${formatAddress(address)}, which came from an opened file.`,
    );
  });

  test("LINK-01: no source (generic)", () => {
    const address = addr(3);
    expect(render("LINK-01", { path: "steps[0].admin", role: "UPGRADER_ROLE", address })).toBe(
      `The upgrade role goes to ${formatAddress(address)}, which came from a link or a file and hasn't been confirmed.`,
    );
  });
});

describe("NET", () => {
  test("NET-01: codehash case, spec example", () => {
    expect(render("NET-01", { chain: "Sepolia", case: "codehash", expected: "0xbd8a7ea8cfca7b4e5f5041d7d3e6f2c8e0f6b53f" })).toBe(
      "The contract at CreateX's address on Sepolia isn't CreateX: its codehash differs from 0xbd8a7ea8…b53f.",
    );
  });

  test("NET-01: missing", () => {
    expect(render("NET-01", { chain: "Sepolia", case: "missing", expected: "0x00" })).toBe("CreateX isn't deployed on Sepolia.");
  });

  test("NET-02: missing, spec example", () => {
    expect(render("NET-02", { chain: "Sepolia", case: "missing", expected: "0x00" })).toBe(
      "Arachnid's deployment proxy isn't on Sepolia, so missing contracts can't be deployed at their release addresses.",
    );
  });

  test("NET-03: spec example", () => {
    expect(render("NET-03", { chain: "Sepolia", core: ["LatticeFactory"], missing: ["A", "B", "C"], total: 15 })).toBe(
      "LatticeFactory and 3 of 15 facets and init contracts aren't on Sepolia yet. Anyone can deploy them at their release addresses.",
    );
  });

  test("NET-03: core empty, and both core members present", () => {
    expect(render("NET-03", { chain: "Sepolia", core: [], missing: ["A"], total: 1 })).toBe(
      "1 of 1 facets and init contracts aren't on Sepolia yet. Anyone can deploy them at their release addresses.",
    );
    expect(render("NET-03", { chain: "Sepolia", core: ["LatticeRegistry", "LatticeFactory"], missing: [], total: 0 })).toBe(
      "LatticeRegistry and LatticeFactory aren't on Sepolia yet. Anyone can deploy them at their release addresses.",
    );
  });

  test("NET-04: spec example", () => {
    const address = addr(4);
    expect(render("NET-04", { chain: "Sepolia", name: "ERC20", version: "0.4.0", address, expected: "0x00", actual: "0x01" })).toBe(
      `The code at ${formatAddress(address)} isn't Lattice ERC20 0.4.0.`,
    );
  });

  test("NET-05: both paths, spec wording", () => {
    const address = addr(5);
    expect(render("NET-05", { chain: "Sepolia", path: "factory", address })).toBe(
      "This account already deployed a diamond with this salt; deploying would return it and ignore this recipe.",
    );
    expect(render("NET-05", { chain: "Sepolia", path: "createx", address })).toBe("This salt was already used on Sepolia; deploying would revert.");
  });

  test("NET-06: spec example", () => {
    expect(render("NET-06", { chain: "Sepolia", gas: "17200000", cap: "16777216", share: 1.025 })).toBe(
      "This deploy needs about 17.2M gas; Sepolia allows 16.8M per transaction.",
    );
  });

  test("NET-07: static", () => {
    expect(render("NET-07", { chain: "Sepolia" })).toBe("Simulating with `eth_call`: fewer details in the preview.");
  });

  test("NET-08: spec example, and singular count", () => {
    expect(render("NET-08", { chain: "Sepolia", facets: ["A", "B", "C"], count: 3 })).toBe(
      "3 facets will be cut without the registry's on-chain check: Sepolia's LatticeRegistry doesn't list their pinned versions.",
    );
    expect(render("NET-08", { chain: "Sepolia", facets: ["A"], count: 1 })).toBe(
      "1 facet will be cut without the registry's on-chain check: Sepolia's LatticeRegistry doesn't list its pinned version.",
    );
  });
});

test("every rendered message passes lintCopy", () => {
  expect(rendered.length).toBeGreaterThan(30);
  for (const text of rendered) expect(lintCopy(text)).toEqual([]);
});
