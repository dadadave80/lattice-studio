import { describe, expect, test } from "bun:test";
import { lintCopy } from "../format/copy-lint";
import { formatAddress } from "../format/format";
import { addr, hex } from "../testing/ids";
import { lines } from "./lines";

const rendered: string[] = [];

function record(text: string): string {
  rendered.push(text);
  return text;
}

describe("lines", () => {
  test("catalogLoaded: spec's first console line, and provisional", () => {
    expect(record(lines.catalogLoaded({ version: "0.4.0", facets: 100 }).text)).toBe("Catalog: Lattice 0.4.0 · 100 facets.");
    expect(lines.catalogLoaded({ version: "0.4.0", facets: 100 }).tag).toBe("Note");
    expect(record(lines.catalogLoaded({ version: "0.2.0", facets: 90, provisional: "Lattice 0.2.0 at dev f4a32c8; v1 targets 0.4.0" }).text)).toBe(
      "Catalog: Lattice 0.2.0 at dev f4a32c8; v1 targets 0.4.0 · 90 facets.",
    );
  });

  test("projectOpened: spec example", () => {
    const now = "2026-09-23T12:00:00.000Z";
    const savedAt = "2026-09-23T11:58:00.000Z";
    const draft = lines.projectOpened({ name: "GovernedVault", facets: 14, savedAt, now });
    expect(record(draft.text)).toBe("Opened GovernedVault · 14 facets · saved 2 min ago.");
    expect(draft.tag).toBe("Note");
  });

  test("linkOpened: spec example", () => {
    const draft = lines.linkOpened({ recipeHash: hex(0x3f2a, 32), toConfirm: 2 });
    expect(record(draft.text)).toBe(`Opened a shared link · recipe ${hex(0x3f2a, 32).slice(0, 6)}…${hex(0x3f2a, 32).slice(-4)} · 2 addresses to confirm.`);
    expect(draft.tag).toBe("Note");
  });

  test("recipeLoaded: spec example, with and without a script", () => {
    const withScript = lines.recipeLoaded({ name: "GovernedVault", facets: 14, selectors: 120, script: "script/base/defi/DeployGovernedVault.s.sol" });
    expect(record(withScript.text)).toBe("Loaded GovernedVault · 14 facets · 120 selectors · from script/base/defi/DeployGovernedVault.s.sol.");
    expect(withScript.tag).toBe("Note");
    expect(record(lines.recipeLoaded({ name: "Blank", facets: 5, selectors: 30 }).text)).toBe("Loaded Blank · 5 facets · 30 selectors.");
  });

  test("placed: spec example, no trailing period, and without a namespace", () => {
    const draft = lines.placed({ facet: "ERC20", selectors: 9, namespace: "lattice.storage.ERC20" });
    expect(record(draft.text)).toBe("Placed ERC20 · 9 selectors · erc7201:lattice.storage.ERC20");
    expect(draft.tag).toBe("Placed");
    expect(record(lines.placed({ facet: "Receive", selectors: 1 }).text)).toBe("Placed Receive · 1 selector");
  });

  test("removed: spec example", () => {
    const draft = lines.removed({ facets: ["ERC20", "ERC4626"] });
    expect(record(draft.text)).toBe("Removed ERC20 and ERC4626.");
    expect(draft.tag).toBe("Note");
  });

  test("collision: spec example", () => {
    const draft = lines.collision({
      contenders: ["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"],
      selectors: [
        { hex: "0xcdfe7f5c", signature: "sendMessage(bytes,bytes,bytes[])" },
        { hex: "0xdc680a0f", signature: "supportsAttribute(bytes4)" },
      ],
    });
    expect(record(draft.text)).toBe(
      "AxelarGatewayAdapter and HyperlaneGatewayAdapter both export `sendMessage · 0xcdfe7f5c` and `supportsAttribute · 0xdc680a0f`. Choose an owner.",
    );
    expect(draft.tag).toBe("Collision");
  });

  test("resolved: spec example", () => {
    const draft = lines.resolved({
      selectors: [
        { hex: "0xcdfe7f5c", signature: "sendMessage(bytes,bytes,bytes[])" },
        { hex: "0xdc680a0f", signature: "supportsAttribute(bytes4)" },
      ],
      owner: "HyperlaneGatewayAdapter",
    });
    expect(record(draft.text)).toBe("Resolved: `sendMessage · 0xcdfe7f5c` and `supportsAttribute · 0xdc680a0f` route to HyperlaneGatewayAdapter.");
    expect(draft.tag).toBe("Resolved");
  });

  test("resolved: one selector uses the singular verb", () => {
    expect(record(lines.resolved({ selectors: [{ hex: "0xa9059cbb", signature: "transfer(address,uint256)" }], owner: "ERC20" }).text)).toBe(
      "Resolved: `transfer · 0xa9059cbb` routes to ERC20.",
    );
  });

  test("missing: spec example wording", () => {
    const draft = lines.missing({ facet: "VaultCore", requires: "ERC4626", reason: "it runs the assets behind ERC4626's shares" });
    expect(record(draft.text)).toBe("VaultCore requires ERC4626: it runs the assets behind ERC4626's shares.");
    expect(draft.tag).toBe("Missing");
  });

  test("dependencyMet: spec example", () => {
    const draft = lines.dependencyMet({ facet: "VaultCore" });
    expect(record(draft.text)).toBe("Dependency met: VaultCore.");
    expect(draft.tag).toBe("Resolved");
  });

  test("fieldSet: spec example", () => {
    const draft = lines.fieldSet({ label: "Governor quorum", value: "4%" });
    expect(record(draft.text)).toBe("Set Governor quorum to 4%.");
    expect(draft.tag).toBe("Init");
  });

  test("stepMoved: spec example, and without 'after'", () => {
    const draft = lines.stepMoved({ spec: "VaultCore", step: 3, after: "ERC4626" });
    expect(record(draft.text)).toBe("Moved VaultCore to step 3, after ERC4626.");
    expect(draft.tag).toBe("Init");
    expect(record(lines.stepMoved({ spec: "VaultCore", step: 1 }).text)).toBe("Moved VaultCore to step 1.");
  });

  test("tidied: spec example", () => {
    const draft = lines.tidied({ facets: 14 });
    expect(record(draft.text)).toBe("Tidied 14 facets.");
    expect(draft.tag).toBe("Note");
  });

  test("undid: spec example, dim", () => {
    const draft = lines.undid({ label: "Placed ERC20" });
    expect(record(draft.text)).toBe("Undid: Placed ERC20.");
    expect(draft.tag).toBe("Note");
    expect(draft.dim).toBe(true);
  });

  test("mechanismChanged: spec example, and without a holder", () => {
    const draft = lines.mechanismChanged({ facet: "SafeDiamondCut", holder: "0x71C7…976F" });
    expect(record(draft.text)).toBe("Upgrade mechanism: SafeDiamondCut · Safe 0x71C7…976F.");
    expect(draft.tag).toBe("Note");
    expect(record(lines.mechanismChanged({ facet: "AccessControlDiamondCut" }).text)).toBe("Upgrade mechanism: AccessControlDiamondCut.");
  });

  test("reviewOpened: spec example, and the CreateX path", () => {
    const draft = lines.reviewOpened({ chain: "Sepolia", path: "factory", facets: 12 });
    expect(record(draft.text)).toBe("Review: Sepolia · LatticeFactory · the core and 12 facets.");
    expect(draft.tag).toBe("Deploy");
    expect(record(lines.reviewOpened({ chain: "Sepolia", path: "createx", facets: 1 }).text)).toBe("Review: Sepolia · CreateX · the core and 1 facet.");
  });

  test("simulated: spec example, block grouped", () => {
    const draft = lines.simulated({ block: 9_123_456, events: 7 });
    expect(record(draft.text)).toBe("Simulated at block 9,123,456: succeeded, 7 events.");
    expect(draft.tag).toBe("Deploy");
  });

  test("submitted: spec example", () => {
    const tx = "0x1234000000000000000000000000000000000000000000000000000000abcd" as const;
    const draft = lines.submitted({ tx, chain: "Sepolia" });
    expect(record(draft.text)).toBe(`Submitted ${tx.slice(0, 6)}…${tx.slice(-4)} on Sepolia.`);
    expect(draft.tag).toBe("Deploy");
  });

  test("proposed: spec example", () => {
    const safe = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" as const;
    const draft = lines.proposed({ safe, chain: "Sepolia" });
    expect(record(draft.text)).toBe("Proposed to Safe 0x71C7…976F on Sepolia. Waiting for the Safe to execute the batch.");
    expect(draft.tag).toBe("Deploy");
  });

  test("confirmed: spec example", () => {
    const address = addr(7);
    const draft = lines.confirmed({ address, block: 9_123_460 });
    expect(record(draft.text)).toBe(`Deployed at ${formatAddress(address)} in block 9,123,460. Matches the sheet.`);
    expect(draft.tag).toBe("Deploy");
  });

  test("mismatch: spec example", () => {
    const address = addr(6);
    const draft = lines.mismatch({ address, differing: 2 });
    expect(record(draft.text)).toBe(`Deployed at ${formatAddress(address)}, but \`facets()\` doesn't match the sheet: 2 selectors differ.`);
    expect(draft.tag).toBe("Deploy");
  });

  test("mismatch: the verb agrees with one selector", () => {
    const address = addr(6);
    expect(record(lines.mismatch({ address, differing: 1 }).text)).toBe(
      `Deployed at ${formatAddress(address)}, but \`facets()\` doesn't match the sheet: 1 selector differs.`,
    );
  });

  test("verified: spec example", () => {
    const draft = lines.verified({ status: "exact_match", forwardedTo: ["Etherscan", "Blockscout"] });
    expect(record(draft.text)).toBe("Verified on Sourcify (exact match); forwarded to Etherscan and Blockscout.");
    expect(draft.tag).toBe("Verify");
    expect(record(lines.verified({ status: "match", forwardedTo: [] }).text)).toBe("Verified on Sourcify (match).");
  });

  test("reverted: spec example", () => {
    const draft = lines.reverted({
      module: "LatticeRegistry",
      error: "LatticeRegistry__RecordNotFound",
      args: "lattice.ERC20, 0.4.0",
      note: "Sepolia's registry doesn't list that version.",
    });
    expect(record(draft.text)).toBe(
      "Deploy reverted in LatticeRegistry: `LatticeRegistry__RecordNotFound(lattice.ERC20, 0.4.0)`. Sepolia's registry doesn't list that version.",
    );
    expect(draft.tag).toBe("Error");
    expect(record(lines.reverted({ module: null, error: "Panic", args: "0x11" }).text)).toBe("Deploy reverted: `Panic(0x11)`.");
  });

  test("diverged: spec example", () => {
    const draft = lines.diverged({ chain: "Sepolia", revision: 1 });
    expect(record(draft.text)).toBe("The sheet now differs from what's live on Sepolia (r1).");
    expect(draft.tag).toBe("Note");
  });

  test("exported: spec example, no trailing period", () => {
    const draft = lines.exported({ filename: "DeployGovernedVault.s.sol", recipeHash: hex(0x3f2a, 32) });
    expect(record(draft.text)).toBe(`Exported DeployGovernedVault.s.sol · recipe ${hex(0x3f2a, 32).slice(0, 6)}…${hex(0x3f2a, 32).slice(-4)}`);
    expect(draft.tag).toBe("Note");
  });
});

test("every line passes lintCopy", () => {
  expect(rendered.length).toBeGreaterThan(20);
  for (const text of rendered) expect(lintCopy(text)).toEqual([]);
});
