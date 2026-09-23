/**
 * The exported Foundry scripts (C7a `exportFoundry`, spec L520-L528, L934 Exported scripts row) against a real EVM:
 * every v1 recipe's script, written for chains 31337 and Sepolia (contracts §5.5), passes `forge fmt --check`,
 * compiles, and `forge script … --broadcast` deploys it on a local Anvil node through LatticeFactory and through
 * CreateX's real code. The diamond lands at core's predicted address and its `facets()` equals the plan. A tampered
 * codehash, an occupied predicted address and a missing shared contract each stop the script before it broadcasts.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { keccak256, type Address, type Hex } from "viem";
import { CREATEX, exportFoundry, type Catalog } from "@lattice-studio/core";
import { builtCatalog, proxyCreationCode } from "./harness/catalog";
import { PORT, SKIP_REASON, anvilPort, announceSkip } from "./harness/env";
import { ForgeProject, type ForgeResult } from "./harness/forge";
import { compareLoupe, loupeSummary } from "./harness/loupe";
import { ALICE, BOB, startNode, type Node } from "./harness/node";
import { prepareChain } from "./harness/prepare";
import { PATHS, entropyFor, fixture, predict, v1Recipes, type DeployPath, type Fixture } from "./harness/recipes";
import { ResultTable } from "./harness/report";
import { CREATEX_CODEHASH } from "./harness/vendor";

announceSkip("exported scripts", SKIP_REASON);

/** The chains the scripts are written for: the local node's, plus Sepolia (contracts §5.5). */
const CHAIN_IDS = [31337, 11155111];

type Script = { f: Fixture; path: DeployPath; filename: string; contract: string; text: string };

function exportScript(catalog: Catalog, name: string, path: DeployPath, label: string): Script {
  const f = fixture(catalog, name, path, entropyFor(`script:${label}:${name}:${path}`));
  // One project holds every script, so each needs its own contract name.
  f.project.name = `${name} ${label} ${path === "factory" ? "Factory" : "CreateX"}`;
  const out = exportFoundry({
    project: f.project,
    catalog,
    analysis: f.analysis,
    studioVersion: "0.0.0-q5",
    chainIds: CHAIN_IDS,
    ...(path === "createx" ? { proxyCreationCode: proxyCreationCode() } : {}),
  });
  if (!out.ok) throw new Error(`${name} ${path}: ${out.error}`);
  return { f, path, filename: out.value.filename, contract: out.value.filename.replace(/\.s\.sol$/, ""), text: out.value.text };
}

/** Where the node stood before a run: a refusal must leave both unchanged. */
async function standing(node: Node, sender: Address): Promise<{ block: bigint; nonce: number }> {
  return { block: await node.client.getBlockNumber(), nonce: await node.client.getTransactionCount({ address: sender }) };
}

/** The revert forge printed, e.g. `AddressTaken(0x…)`, for the result table. */
function revertIn(result: ForgeResult, error: string): string {
  return new RegExp(`${error}\\(.*\\)`).exec(result.out)?.[0] ?? `no ${error} in forge's output`;
}

describe.skipIf(SKIP_REASON !== undefined)("exported Foundry scripts on Anvil", () => {
  const { catalog } = builtCatalog();
  const table = new ResultTable("Exported Foundry scripts on Anvil (forge script --broadcast)");
  const scripts: Script[] = [];
  let project: ForgeProject;
  let node: Node;
  let fmt: ForgeResult = { code: -1, out: "" };
  let build: ForgeResult = { code: -1, out: "" };
  const runScripts = (path: DeployPath): Script[] => scripts.filter((s) => s.path === path && s.f.project.name.includes(" Run "));

  beforeAll(async () => {
    project = new ForgeProject(catalog.toolchain.solc);
    for (const name of v1Recipes(catalog)) for (const path of PATHS) scripts.push(exportScript(catalog, name, path, "Run"));
    // Separate scripts (their own salts) for the refusals, so each starts from an empty predicted address.
    for (const path of PATHS) scripts.push(exportScript(catalog, "ERC20", path, "Refusal"));
    for (const script of scripts) project.write(script.filename, script.text);
    fmt = project.run(["fmt", "--check", "script"]);
    build = project.run(["build"]);
    node = await startNode({ port: anvilPort(PORT.scripts) });
    await prepareChain(node, catalog, { etch: true });
  }, 240_000);

  afterAll(async () => {
    table.print();
    await node?.stop();
    project?.dispose();
  });

  test("every script lists chain 31337 and is forge fmt clean", () => {
    expect(v1Recipes(catalog).length).toBeGreaterThan(0);
    expect(scripts.length).toBe(v1Recipes(catalog).length * 2 + 2);
    for (const script of scripts) expect([script.filename, script.text.includes("if (block.chainid == 31337)")]).toEqual([script.filename, true]);
    expect(fmt.out).toBe("");
    expect(fmt.code).toBe(0);
  });

  test("every script compiles with forge-std on the catalog's solc", () => {
    expect(build.code).toBe(0);
  });

  for (const path of PATHS) {
    describe(`through ${path === "factory" ? "LatticeFactory" : "CreateX"}`, () => {
      test("run() deploys every v1 recipe at the predicted address, and facets() matches the plan", async () => {
        if (path === "createx") {
          // Each CreateX script checks CreateX's codehash against core's CREATEX_CODEHASH before anything else, and
          // the node holds exactly that code, so a successful run is that check passing.
          expect(keccak256(await node.rpc<Hex>("eth_getCode", [CREATEX, "latest"]))).toBe(CREATEX_CODEHASH);
          for (const s of scripts.filter((x) => x.path === "createx")) {
            expect(s.text).toMatch(new RegExp(`bytes32 internal constant CREATEX_CODEHASH =\\s+${CREATEX_CODEHASH};`));
            expect(s.text).toContain('_expect("CreateX", CREATEX, CREATEX_CODEHASH);');
          }
        }
        const runs = runScripts(path);
        expect([runs.length > 0, runs.length]).toEqual([true, v1Recipes(catalog).length]);
        for (const script of runs) {
          const name = script.f.name;
          await table.run(name, path, async () => {
            const { address } = predict(script.f, ALICE, node.chainId);
            expect(await node.rpc<Hex>("eth_getCode", [address, "latest"])).toBe("0x");
            const result = project.broadcast(script.filename, script.contract, node.url, ALICE);
            if (result.code !== 0) throw new Error(`forge script failed: ${result.out.slice(-1500)}`);
            expect(result.out).toContain("ONCHAIN EXECUTION COMPLETE & SUCCESSFUL");
            expect(result.out).toContain(`at ${address}`);
            expect(await node.rpc<Hex>("eth_getCode", [address, "latest"])).not.toBe("0x");
            expect(await compareLoupe(node, address, script.f.analysis.plan)).toEqual({ matches: true, missing: [], extra: [], moved: [] });
            return address;
          }, () => `pass: ${loupeSummary(script.f.analysis.plan)}`);
        }
      }, 240_000);

      test("an occupied predicted address stops it before broadcast (AddressTaken)", async () => {
        const runs = runScripts(path);
        expect([runs.length > 0, runs.length]).toEqual([true, v1Recipes(catalog).length]);
        for (const script of runs) {
          const { address } = predict(script.f, ALICE, node.chainId);
          const before = await standing(node, ALICE);
          const result = project.broadcast(script.filename, script.contract, node.url, ALICE);
          expect([script.f.name, result.code]).not.toEqual([script.f.name, 0]);
          expect(result.out).toContain(`AddressTaken(${address})`);
          expect(result.out).not.toContain("ONCHAIN EXECUTION COMPLETE");
          expect(await standing(node, ALICE)).toEqual(before);
          table.record(`${script.f.name} again`, path, `refused: ${revertIn(result, "AddressTaken")}`);
        }
      }, 240_000);

      test("a tampered codehash stops it before broadcast (UnexpectedCode)", async () => {
        const script = scripts.find((s) => s.path === path && s.f.project.name.includes(" Refusal "));
        if (script === undefined) throw new Error("no refusal script");
        const facet = script.f.analysis.plan.find((entry) => entry.facet === "ERC20");
        if (facet === undefined) throw new Error("ERC20 isn't planned");
        const snapshot = await node.client.snapshot();
        try {
          await node.client.setCode({ address: facet.address, bytecode: "0x00" });
          const before = await standing(node, ALICE);
          const result = project.broadcast(script.filename, script.contract, node.url, ALICE);
          expect(result.code).not.toBe(0);
          expect(result.out).toContain(`UnexpectedCode("ERC20 at ${facet.address}")`);
          expect(result.out).not.toContain("ONCHAIN EXECUTION COMPLETE");
          expect(await standing(node, ALICE)).toEqual(before);
          expect(await node.rpc<Hex>("eth_getCode", [predict(script.f, ALICE, node.chainId).address, "latest"])).toBe("0x");
          table.record("ERC20 (ERC20 facet's code tampered)", path, `refused: ${revertIn(result, "UnexpectedCode")}`);
        } finally {
          await node.client.revert({ id: snapshot });
        }
      }, 120_000);

      test("a missing shared contract stops it before broadcast (MissingSharedContracts, with where to deploy it)", async () => {
        const script = scripts.find((s) => s.path === path && s.f.project.name.includes(" Refusal "));
        if (script === undefined) throw new Error("no refusal script");
        const init = catalog.inits.find((spec) => spec.name === "ERC20Init")?.release;
        if (init === undefined) throw new Error("ERC20Init has no release");
        const snapshot = await node.client.snapshot();
        try {
          await node.client.setCode({ address: init.address, bytecode: "0x" });
          const before = await standing(node, BOB);
          const result = project.broadcast(script.filename, script.contract, node.url, BOB);
          expect(result.code).not.toBe(0);
          expect(result.out).toContain('MissingSharedContracts("ERC20Init", "Deploy them first with Deploy missing contracts… in Lattice Studio or with the lattice-studio CLI.")');
          expect(result.out).not.toContain("ONCHAIN EXECUTION COMPLETE");
          expect(await standing(node, BOB)).toEqual(before);
          table.record("ERC20 (ERC20Init missing)", path, `refused: ${revertIn(result, "MissingSharedContracts")}`);
        } finally {
          await node.client.revert({ id: snapshot });
        }
      }, 120_000);
    });
  }
});
