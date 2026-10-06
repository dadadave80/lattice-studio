/**
 * The opt-in Sepolia fork suite (spec L934-L935 Fork row; decisions D8 and Q7): a local Anvil node forking Sepolia
 * at a recent finalized block, where CreateX, Multicall3 and Arachnid's proxy are the chain's own. Runs when
 * SEPOLIA_FORK=1 (fork.yml sets it). The block comes from the first public Sepolia RPC that serves it
 * (harness/sepolia.ts), with SEPOLIA_RPC_URL as the fallback only when they all fail; the log names the block and
 * the endpoint's host, never the secret. Every transaction goes to the local fork, never to Sepolia.
 *
 * Nothing here depends on the block: the deployer account is reset to a funded account with no code (on Sepolia
 * it carries an EIP-7702 delegation), shared contracts are deployed only where missing, and every salt mixes in
 * the fork block, so no diamond lands on an address something already holds.
 *
 * On the fork: the missing shared contracts deploy through Arachnid's proxy (batched through Sepolia's Multicall3),
 * the deploy calldata core builds lands through LatticeFactory and through CreateX with a loupe that matches the
 * plan, every v1 recipe's exported script broadcasts on both paths, and a CreateX-wrapped init revert decodes.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { keccak256, type Hex } from "viem";
import { ARACHNID_PROXY, ARACHNID_PROXY_CODEHASH, CREATEX, MULTICALL3, decodeRevert, exportFoundry } from "@lattice-studio/core";
import { builtCatalog, proxyCreationCode, revertDetails } from "./harness/catalog";
import { PORT, SKIP_REASON, anvilPort } from "./harness/env";
import { ForgeProject } from "./harness/forge";
import { compareLoupe, loupeSummary } from "./harness/loupe";
import { ALICE, send, type Node } from "./harness/node";
import { neededByV1, prepareChain } from "./harness/prepare";
import { PATHS, coreDeploy, entropyFor, fixture, predict, v1Recipes } from "./harness/recipes";
import { ResultTable } from "./harness/report";
import { SEPOLIA, forkSources, startSepoliaFork } from "./harness/sepolia";
import { GAS_CAP, chainState } from "./harness/shared";
import { CREATEX_CODEHASH, MULTICALL3_CODEHASH } from "./harness/vendor";

/** What the deployer account holds on the fork, whatever it holds on Sepolia: 10,000 ether and no code. */
const DEPLOYER_BALANCE = `0x${(10_000n * 10n ** 18n).toString(16)}`;

// From the environment only (never a file): it may carry a provider key.
const SECRET_URL = process.env["SEPOLIA_RPC_URL"] || undefined;
const FORK_SKIP = SKIP_REASON ?? (process.env["SEPOLIA_FORK"] !== "1" ? "SEPOLIA_FORK isn't 1 (decision D8: the fork suite is opt-in; fork.yml sets it)" : undefined);
if (FORK_SKIP !== undefined) console.log(`Sepolia fork: skipped, ${FORK_SKIP}.`);

describe.skipIf(FORK_SKIP !== undefined)("Sepolia fork at a recent finalized block", () => {
  const { catalog } = builtCatalog();
  let table = new ResultTable("Sepolia fork");
  let node: Node;
  let block = 0n;
  let project: ForgeProject;

  beforeAll(async () => {
    const fork = await startSepoliaFork(anvilPort(PORT.fork), forkSources(SECRET_URL));
    node = fork.node;
    block = fork.block;
    table = new ResultTable(`Sepolia fork at block ${fork.block} from ${fork.label}`);
    await node.rpc("anvil_setCode", [ALICE, "0x"]);
    await node.rpc("anvil_setBalance", [ALICE, DEPLOYER_BALANCE]);
    project = new ForgeProject(catalog.toolchain.solc);
  }, 300_000);

  afterAll(async () => {
    table.print();
    await node?.stop();
    project?.dispose();
  });

  test("the fork is Sepolia, with Arachnid's proxy, CreateX and Multicall3 at their canonical codehashes", async () => {
    expect(node.chainId).toBe(SEPOLIA);
    const code = async (address: string) => keccak256(await node.rpc<Hex>("eth_getCode", [address, "latest"]));
    expect(await code(ARACHNID_PROXY)).toBe(ARACHNID_PROXY_CODEHASH);
    expect(await code(CREATEX)).toBe(CREATEX_CODEHASH);
    expect(await code(MULTICALL3)).toBe(MULTICALL3_CODEHASH);
  });

  test("the missing shared contracts deploy through Arachnid's proxy at their release addresses", async () => {
    await prepareChain(node, catalog, { etch: false });
    const state = await chainState(node, catalog, "Sepolia");
    for (const name of neededByV1(catalog)) expect([name, state.shared[name]?.present]).toEqual([name, true]);
  }, 240_000);

  test("the catalog has v1 recipes to run", () => {
    expect(v1Recipes(catalog).length).toBeGreaterThan(0);
  });

  for (const name of v1Recipes(catalog)) {
    for (const path of PATHS) {
      test(`${name} through ${path}: core's calldata and the exported script both land, loupe matches the plan`, async () => {
        await table.run(name, path, async () => {
          const viemCase = fixture(catalog, name, path, entropyFor(`fork:${block}:viem:${name}:${path}`));
          const deploy = coreDeploy(viemCase, ALICE, SEPOLIA);
          await send(node, { from: ALICE, to: deploy.tx.to, data: deploy.tx.data, gas: GAS_CAP });
          expect((await compareLoupe(node, deploy.address, viemCase.analysis.plan)).matches).toBe(true);

          const scriptCase = fixture(catalog, name, path, entropyFor(`fork:${block}:script:${name}:${path}`));
          scriptCase.project.name = `${name} Fork ${path === "factory" ? "Factory" : "CreateX"}`;
          const out = exportFoundry({
            project: scriptCase.project,
            catalog,
            analysis: scriptCase.analysis,
            studioVersion: "0.0.0-q5",
            chainIds: [31337, SEPOLIA],
            ...(path === "createx" ? { proxyCreationCode: proxyCreationCode() } : {}),
          });
          if (!out.ok) throw new Error(out.error);
          project.write(out.value.filename, out.value.text);
          const result = project.broadcast(out.value.filename, out.value.filename.replace(/\.s\.sol$/, ""), node.url, ALICE);
          if (result.code !== 0) throw new Error(`forge script failed: ${result.out.slice(-1500)}`);
          const { address } = predict(scriptCase, ALICE, SEPOLIA);
          expect((await compareLoupe(node, address, scriptCase.analysis.plan)).matches).toBe(true);
          return viemCase;
        }, (f) => `pass (viem and script): ${loupeSummary(f.analysis.plan)}`);
      }, 240_000);
    }
  }

  test("a CreateX-wrapped init revert decodes to the module and error", async () => {
    const f = fixture(catalog, "SafeDiamondCut", "createx", entropyFor(`fork:${block}:threshold`), { minThreshold: "3" }, { allowBlockers: true });
    const deploy = coreDeploy(f, ALICE, SEPOLIA);
    const preview = await node.call({ from: ALICE, to: deploy.tx.to, data: deploy.tx.data, gas: GAS_CAP });
    expect(preview.ok).toBe(false);
    const decoded = decodeRevert(preview.data, catalog, { details: revertDetails(), placed: f.recipe.facets, path: "createx" });
    expect([decoded.wrappers, decoded.module, decoded.error]).toEqual([["FailedContractInitialisation"], "SafeDiamondCut", "SafeDiamondCutThresholdTooLow"]);
    table.record("SafeDiamondCut (min threshold 3)", "createx", `reverts as expected: ${decoded.module}.${decoded.error}`);
  }, 60_000);
});
