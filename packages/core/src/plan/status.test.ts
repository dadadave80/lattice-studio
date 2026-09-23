import { describe, expect, test } from "bun:test";
import { recipeHash } from "../canonical";
import type { Analysis } from "../model/analysis";
import type { Hex, Hex4 } from "../model/hex";
import type { Deployment } from "../model/project";
import { addr, hex, makeCatalog, makeFacet, makeProject, makeRecipe } from "../testing";
import { projectStatus, recipeStats } from "./status";

const SEPOLIA = 11155111;
const BASE_SEPOLIA = 84532;
const names: Record<number, string> = { [SEPOLIA]: "Sepolia", [BASE_SEPOLIA]: "Base Sepolia" };
const chainName = (id: number): string => names[id] ?? `Chain ${id}`;

const project = makeProject({ id: "p1" });
const HASH_A = hex(0xa);
const HASH_B = hex(0xb);

function deployment(input: Partial<Deployment> = {}): Deployment {
  return {
    projectId: "p1",
    chainId: SEPOLIA,
    address: addr(0xd1),
    path: "factory",
    deployer: addr(0xde),
    salt: hex(1),
    status: "confirmed",
    recipeHash: HASH_A,
    catalogHash: hex(0xc),
    at: "2026-09-20T10:00:00.000Z",
    verification: "exact_match",
    revision: 1,
    ...input,
  };
}

describe("projectStatus: every stamp state", () => {
  test("Not deployed: no records", () => {
    const status = projectStatus(project, [], SEPOLIA, HASH_A, chainName);
    expect(status).toEqual({ state: "not-deployed", stamp: "Not deployed", chainId: SEPOLIA, live: [], deployAgain: false });
  });

  test("Live · Sepolia · r1: a confirmed record with the current recipe hash", () => {
    const record = deployment();
    const status = projectStatus(project, [record], SEPOLIA, HASH_A, chainName);
    expect(status).toEqual({
      state: "live",
      stamp: "Live · Sepolia · r1",
      chainId: SEPOLIA,
      deployment: record,
      live: [{ chainId: SEPOLIA, address: record.address, revision: 1 }],
      deployAgain: false,
    });
  });

  test("Modified since r1: the sheet differs from what's live, so Deploy again applies", () => {
    const record = deployment();
    const status = projectStatus(project, [record], SEPOLIA, HASH_B, chainName);
    expect(status).toEqual({
      state: "modified",
      stamp: "Modified since r1",
      chainId: SEPOLIA,
      deployment: record,
      live: [],
      modifiedSince: 1,
      deployAgain: true,
    });
  });

  test("Proposed · Sepolia (Safe): a Safe batch waiting to execute", () => {
    const status = projectStatus(project, [deployment({ status: "proposed", safeTxHash: hex(5) })], SEPOLIA, HASH_A, chainName);
    expect(status.state).toBe("proposed");
    expect(status.stamp).toBe("Proposed · Sepolia (Safe)");
    expect(status.live).toEqual([]);
    expect(status.deployAgain).toBe(false);
  });

  test("Pending · Sepolia: a transaction in flight", () => {
    const status = projectStatus(project, [deployment({ status: "pending", tx: hex(6) })], SEPOLIA, HASH_A, chainName);
    expect(status.state).toBe("pending");
    expect(status.stamp).toBe("Pending · Sepolia");
    expect(status.live).toEqual([]);
  });

  test("Mismatch · Sepolia: facets() differ from the plan, never live even with the current hash", () => {
    const status = projectStatus(project, [deployment({ status: "mismatch" })], SEPOLIA, HASH_A, chainName);
    expect(status.state).toBe("mismatch");
    expect(status.stamp).toBe("Mismatch · Sepolia");
    expect(status.live).toEqual([]);
    expect(status.deployAgain).toBe(false);
  });

  test("Failed · Sepolia: only a failed attempt", () => {
    const status = projectStatus(project, [deployment({ status: "failed" })], SEPOLIA, HASH_A, chainName);
    expect(status.state).toBe("failed");
    expect(status.stamp).toBe("Failed · Sepolia");
    expect(status.live).toEqual([]);
  });

  test("From file: an imported confirmed record with the current hash is never Live until re-read on-chain", () => {
    const imported = deployment({ fromFile: true });
    const status = projectStatus(project, [imported], SEPOLIA, HASH_A, chainName);
    expect(status).toEqual({
      state: "from-file",
      stamp: "From file",
      chainId: SEPOLIA,
      deployment: imported,
      live: [],
      deployAgain: false,
    });
    // It never numbers a revision or makes Deploy again apply either, whatever hash the sheet has.
    const modified = projectStatus(project, [imported], SEPOLIA, HASH_B, chainName);
    expect(modified.state).toBe("from-file");
    expect(modified.modifiedSince).toBeUndefined();
    expect(modified.deployAgain).toBe(false);
    // Once S8c re-reads it and clears the flag, it's live.
    const reread: Deployment = { ...imported };
    delete reread.fromFile;
    expect(projectStatus(project, [reread], SEPOLIA, HASH_A, chainName).stamp).toBe("Live · Sepolia · r1");
  });

  test("an imported record beside a real one: the real one decides", () => {
    const real = deployment({ at: "2026-09-19T10:00:00.000Z", recipeHash: HASH_B });
    const imported = deployment({ fromFile: true, address: addr(0xf1) });
    const status = projectStatus(project, [imported, real], SEPOLIA, HASH_A, chainName);
    expect(status.state).toBe("modified");
    expect(status.deployment).toBe(real);
    expect(status.live).toEqual([]);
  });
});

describe("projectStatus: recomputed from the hash", () => {
  test("undoing to an earlier recipe flips Live back on", () => {
    const catalog = makeCatalog({ facets: [makeFacet({ name: "Token", selectors: ["transfer(address,uint256)"] }), makeFacet({ name: "Loupe", selectors: ["facets()"] })] });
    const deployed = makeRecipe({ facets: ["Loupe"] }, catalog);
    const edited = makeRecipe({ facets: ["Loupe", "Token"] }, catalog);
    const hashOf = (recipe: typeof deployed): Hex => recipeHash(recipe, catalog);
    const record = deployment({ recipeHash: hashOf(deployed) });

    const before = projectStatus(project, [record], SEPOLIA, hashOf(deployed), chainName);
    const afterEdit = projectStatus(project, [record], SEPOLIA, hashOf(edited), chainName);
    const afterUndo = projectStatus(project, [record], SEPOLIA, hashOf(makeRecipe({ facets: ["Loupe"] }, catalog)), chainName);
    expect([before.stamp, afterEdit.stamp, afterUndo.stamp]).toEqual(["Live · Sepolia · r1", "Modified since r1", "Live · Sepolia · r1"]);
    expect(afterEdit.deployAgain).toBe(true);
    expect(afterUndo).toEqual(before);
  });

  test("hashes compare case-insensitively", () => {
    const status = projectStatus(project, [deployment({ recipeHash: HASH_A.toUpperCase().replace("0X", "0x") as Hex })], SEPOLIA, HASH_A);
    expect(status.state).toBe("live");
  });
});

describe("projectStatus: chains, order and revisions", () => {
  test("live lists every chain with a live record; the stamp follows the selected chain", () => {
    const sepolia = deployment();
    const base = deployment({ chainId: BASE_SEPOLIA, address: addr(0xb5), revision: 2 });
    const status = projectStatus(project, [base, sepolia], BASE_SEPOLIA, HASH_A, chainName);
    expect(status.stamp).toBe("Live · Base Sepolia · r2");
    expect(status.live).toEqual([
      { chainId: BASE_SEPOLIA, address: base.address, revision: 2 },
      { chainId: SEPOLIA, address: sepolia.address, revision: 1 },
    ].sort((a, b) => a.chainId - b.chainId));
  });

  test("a chain with no records reads Not deployed while another is live", () => {
    const status = projectStatus(project, [deployment()], 1, HASH_A, chainName);
    expect(status.stamp).toBe("Not deployed");
    expect(status.live).toHaveLength(1);
  });

  test("no chain selected: Not deployed, live still listed", () => {
    const status = projectStatus(project, [deployment()], null, HASH_A, chainName);
    expect(status).toEqual({
      state: "not-deployed",
      stamp: "Not deployed",
      chainId: null,
      live: [{ chainId: SEPOLIA, address: addr(0xd1), revision: 1 }],
      deployAgain: false,
    });
  });

  test("without chainName the chain reads Chain <id>", () => {
    expect(projectStatus(project, [deployment()], SEPOLIA, HASH_A).stamp).toBe(`Live · Chain ${SEPOLIA} · r1`);
  });

  test("a new deploy in flight after a modified sheet shows Pending, and Deploy again still applies", () => {
    const old = deployment({ at: "2026-09-19T10:00:00.000Z" });
    const pending = deployment({ status: "pending", recipeHash: HASH_B, address: addr(0xd2) });
    const status = projectStatus(project, [old, pending], SEPOLIA, HASH_B, chainName);
    expect(status.state).toBe("pending");
    expect(status.deployment).toBe(pending);
    expect(status.modifiedSince).toBe(1);
    expect(status.deployAgain).toBe(true);
  });

  test("a failed retry doesn't hide what's deployed", () => {
    const old = deployment({ at: "2026-09-19T10:00:00.000Z" });
    const failed = deployment({ status: "failed", recipeHash: HASH_B, address: addr(0xd2) });
    expect(projectStatus(project, [failed, old], SEPOLIA, HASH_B, chainName).stamp).toBe("Modified since r1");
  });

  test("a newer mismatch after a live deploy: Live wins while the sheet matches the live one", () => {
    const live = deployment({ at: "2026-09-19T10:00:00.000Z" });
    const mismatch = deployment({ status: "mismatch", address: addr(0xd2) });
    expect(projectStatus(project, [mismatch, live], SEPOLIA, HASH_A, chainName).stamp).toBe("Live · Sepolia · r1");
    expect(projectStatus(project, [mismatch, live], SEPOLIA, HASH_B, chainName).stamp).toBe("Mismatch · Sepolia");
  });

  test("several live records on one chain: the newest is shown", () => {
    const first = deployment({ at: "2026-09-19T10:00:00.000Z" });
    const second = deployment({ address: addr(0xd2), at: "2026-09-21T10:00:00.000Z" });
    const status = projectStatus(project, [first, second], SEPOLIA, HASH_A, chainName);
    expect(status.deployment).toBe(second);
    expect(status.live).toEqual([{ chainId: SEPOLIA, address: second.address, revision: 1 }]);
  });

  test("records of other projects are ignored; input order doesn't matter", () => {
    const other = deployment({ projectId: "p2" });
    expect(projectStatus(project, [other], SEPOLIA, HASH_A, chainName).state).toBe("not-deployed");
    const records = [deployment({ at: "2026-09-19T10:00:00.000Z" }), deployment({ status: "pending", recipeHash: HASH_B, address: addr(0xd2) })];
    expect(projectStatus(project, records, SEPOLIA, HASH_B, chainName)).toEqual(
      projectStatus(project, [...records].reverse(), SEPOLIA, HASH_B, chainName),
    );
  });
});

describe("recipeStats", () => {
  const token = makeFacet({ name: "Token", selectors: ["transfer(address,uint256)", "approve(address,uint256)", "totalSupply()"] });
  const vault = makeFacet({ name: "Vault", selectors: ["transfer(address,uint256)", "deposit(uint256)"] });
  const shadow = makeFacet({ name: "Shadow", selectors: ["totalSupply()"] });
  const catalog = makeCatalog({ facets: [token, vault, shadow] });
  const [transfer, approve, totalSupply] = token.selectors.map((s) => s.hex) as [Hex4, Hex4, Hex4];
  const deposit = (vault.selectors[1] as { hex: Hex4 }).hex;

  function analysis(routing: Analysis["routing"], plan: Analysis["plan"] = []): Analysis {
    return {
      recipeHash: hex(1),
      routing,
      problems: [],
      plan,
      init: null,
      stats: { facets: 0, routed: 0, exported: 0, excluded: 0, namespaces: 0 },
    };
  }

  test("\"3 facets · 4 selectors\" and per facet \"routed/exported selectors\", in catalog order", () => {
    const stats = recipeStats(
      analysis({
        [transfer]: { owner: "Vault", contenders: ["Token", "Vault"], via: "chosen" },
        [approve]: { owner: "Token", contenders: ["Token"], via: "only" },
        [totalSupply]: { owner: "Token", contenders: ["Token", "Shadow"], via: "default" },
        [deposit]: { owner: "Vault", contenders: ["Vault"], via: "only" },
      }),
      catalog,
    );
    expect(stats).toEqual({
      facets: 3,
      selectors: 4,
      text: "3 facets · 4 selectors",
      perFacet: {
        Token: { routed: 2, exported: 3, text: "2/3 selectors" },
        Vault: { routed: 2, exported: 2, text: "2/2 selectors" },
        Shadow: { routed: 0, exported: 1, text: "0/1 selector" },
      },
    });
    expect(Object.keys(stats.perFacet)).toEqual(["Token", "Vault", "Shadow"]);
  });

  test("singular counts and an empty sheet", () => {
    expect(recipeStats(analysis({ [deposit]: { owner: "Vault", contenders: ["Vault"], via: "only" } }), makeCatalog({ facets: [makeFacet({ name: "Vault", selectors: ["deposit(uint256)"] })] })).text).toBe(
      "1 facet · 1 selector",
    );
    expect(recipeStats(analysis({}), catalog)).toEqual({ facets: 0, selectors: 0, text: "0 facets · 0 selectors", perFacet: {} });
  });

  test("unresolved selectors count as exported, not routed", () => {
    const stats = recipeStats(analysis({ [transfer]: { contenders: ["Token", "Vault"], via: "only" } }), catalog);
    expect(stats.selectors).toBe(0);
    expect(stats.perFacet.Token).toEqual({ routed: 0, exported: 3, text: "0/3 selectors" });
    expect(stats.perFacet.Vault).toEqual({ routed: 0, exported: 2, text: "0/2 selectors" });
  });
});
