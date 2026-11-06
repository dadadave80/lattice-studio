import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { analyze, planUpgrade, removeFacets, type Address, type Deployment, type Project } from "@lattice-studio/core";
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import { getCode } from "viem/actions";
import { builtCatalog } from "../../../../../e2e-chain/harness/catalog";
import type { Node } from "../../../../../e2e-chain/harness/node";
import { BLANK, coreDeploy, entropyFor, fixture, predict } from "../../../../../e2e-chain/harness/recipes";
import { localEnv } from "../../../local-env";
import { createViemPort } from "../deploy/viem-port";
import { readOnchainCall } from "./call";
import { createInspectionEngine } from "./engine";
import { readDiamondSnapshot } from "./reads";
import { createTransactionController } from "./transaction";
import { createUpgradeTransaction, type UpgradeExecutionPorts } from "./upgrade-controller";
import { createUpgradePlan } from "./upgrade-plan";
import { prepareUpgrade, type UpgradePreflightPorts } from "./upgrade-preflight";
import { createUpgradeObserver } from "./upgrade-tracking";
import { readUpgradeReceipt, readUpgradeTransaction } from "./upgrade-transport";

const base = Number(localEnv("ANVIL_PORT_BASE") ?? "");
const port = base + 9;
const runnable = Number.isInteger(base) && base > 0 && port <= 65535 && Bun.which("anvil") !== null;
const ALICE: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BOB: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ABI = parseAbi(["function approve(address spender,uint256 amount) returns(bool)", "function allowance(address owner,address spender) view returns(uint256)"]);
const clock = { now: () => Date.now(), setTimeout: (run: () => void, ms: number) => setTimeout(run, ms), clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
async function confirmed(controller: ReturnType<typeof createTransactionController>) {
  const deadline = Date.now() + 15_000;
  while (controller.get().phase !== "confirmed" || controller.get().verificationPending) {
    if (Date.now() >= deadline || controller.get().phase === "failed") throw new Error(controller.get().error ?? "The local transaction didn't confirm.");
    await Bun.sleep(25);
  }
}

describe.skipIf(!runnable)("upgrade orchestration on local Anvil", () => {
  const { catalog } = builtCatalog();
  let node: Node | undefined, diamond: Address, record: Deployment;
  const original = fixture(catalog, BLANK, "factory", entropyFor("upgrade-runtime-anvil-erc20"));
  const recipe = { ...original.recipe, facets: [...original.recipe.facets, "ERC20"], init: { kind: "steps" as const, steps: [
    ...(original.recipe.init.kind === "steps" ? original.recipe.init.steps : []), { spec: "ERC20Init", args: { name_: "Upgrade token", symbol_: "UPG" } },
  ] } };
  const deployedFixture = { ...original, recipe, analysis: analyze(recipe, catalog), project: { ...original.project, recipe } };
  beforeAll(async () => {
    const { send, startNode } = await import("../../../../../e2e-chain/harness/node");
    const { prepareChain } = await import("../../../../../e2e-chain/harness/prepare");
    node = await startNode({ port }); await prepareChain(node, catalog, { etch: true });
    const deployed = coreDeploy(deployedFixture, ALICE, node.chainId);
    const receipt = await send(node, { to: deployed.tx.to, data: deployed.tx.data, gas: 16_777_216n }); diamond = deployed.address;
    record = { projectId: original.project.id, chainId: node.chainId, address: diamond, path: "factory", salt: predict(deployedFixture, ALICE, node.chainId).salt, deployer: ALICE,
      status: "confirmed", tx: receipt.transactionHash, block: Number(receipt.blockNumber), at: "2026-11-06T00:00:00Z", recipeHash: deployedFixture.analysis.recipeHash, catalogHash: catalog.hash, revision: 1, verification: "exact_match" };
  }, 120_000);
  afterAll(async () => { await node?.stop(); });

  test("inspect → pinned read → non-owner write → separate plan → authorized cut → receipt/reread and reload recovery", async () => {
    if (!node) throw new Error("The local Anvil node wasn't started.");
    const local = node, target = { chainId: local.chainId, address: diamond };
    const { chainState } = await import("../../../../../e2e-chain/harness/shared");
    let account = BOB, sends = 0;
    const chain = createViemPort({ service: {
      chains: () => [{ id: local.chainId, name: "Anvil", testnet: true }], account: () => ({ address: account, chainId: local.chainId, connector: "anvil" }),
      probe: async () => ({ ok: true, value: await chainState(local, catalog) }), codeAt: async () => ({ ok: false, error: "Unused" }), readFacets: async () => ({ ok: false, error: "Unused" }),
    }, client: () => local.client, wallet: {
      send: async (_id, request) => { sends++; return { kind: "sent", value: await local.client.sendTransaction({ account: request.from, ...request.tx, ...(request.gas === undefined ? {} : { gas: request.gas }), chain: null }) }; },
      atomicBatch: async () => false, sendCalls: async () => ({ kind: "rejected" }), waitCalls: async () => ({ kind: "aborted" }),
    }, noteEstimate: () => {}, pollInterval: 25 });
    const ports: UpgradePreflightPorts = {
      inspect: (target, signal) => readDiamondSnapshot(local.client, target.address, signal), catalogs: async () => ({ ok: true, value: [catalog] }), chainName: () => "Anvil",
      call: (target, data, options) => readOnchainCall(local.client, target.address, data, options),
      codeAt: async (_id, address, blockHash) => ({ ok: true, value: await getCode(local.client, { address, blockHash, requireCanonical: true }) ?? "0x" }),
    };
    const engine = createInspectionEngine({ chains: [{ id: local.chainId, name: "Anvil", testnet: true }], read: ports.inspect, catalogs: ports.catalogs });
    const write = createTransactionController({ chains: [{ id: local.chainId, testnet: true }], chain: async () => chain,
      inspect: (_id, address, signal) => readDiamondSnapshot(local.client, address, signal), context: () => ({ key: "original", online: true, readOnly: null }), subscribe: () => () => {}, clock, receiptTimeout: () => 10 });
    let cut: ReturnType<typeof createUpgradeTransaction> | undefined;
    let observer: ReturnType<typeof createUpgradeObserver> | undefined;
    try {
      await engine.ensure(target); const inspection = engine.get(target); if (inspection.status !== "ready") throw new Error("The real diamond wasn't ready.");
      expect(inspection.value.facets.some((facet) => facet.kind === "known" && facet.name === "ERC20")).toBe(true);
      const allowanceData = encodeFunctionData({ abi: ABI, functionName: "allowance", args: [BOB, ALICE] });
      const before = await ports.call(target, allowanceData, { blockHash: inspection.value.snapshot.blockHash }); if (!before.ok) throw new Error(before.error.reason);
      expect(decodeFunctionResult({ abi: ABI, functionName: "allowance", data: before.value })).toBe(0n);
      await write.review({ chainId: local.chainId, snapshot: inspection.value.snapshot, tx: { to: diamond, data: encodeFunctionData({ abi: ABI, functionName: "approve", args: [ALICE, 37n] }), value: 0n } });
      expect(write.get().phase).toBe("ready"); expect(sends).toBe(0); await write.sign(); await confirmed(write); expect(sends).toBe(1);
      const read = await ports.inspect(target, new AbortController().signal); if (!read.ok) throw new Error(read.error.reason);
      const after = await ports.call(target, allowanceData, { blockHash: read.value.blockHash }); if (!after.ok) throw new Error(after.error.reason);
      expect(decodeFunctionResult({ abi: ABI, functionName: "allowance", data: after.value })).toBe(37n);
      const savedProjects: Project[] = [deployedFixture.project]; let activated = false;
      const created = await createUpgradePlan(target, { ...ports, chains: [{ id: local.chainId, testnet: true }], current: () => deployedFixture.project, layout: () => ({}),
        create: async (recipe, name, options) => { const project = { ...deployedFixture.project, ...options, id: "separate-upgrade-plan", name, recipe }; savedProjects.push(project); return { ok: true, value: project }; },
        activate: () => { expect(savedProjects).toHaveLength(2); activated = true; },
      });
      if (!created.ok) throw new Error(created.error); expect(activated).toBe(true); expect(savedProjects[0]).toEqual(deployedFixture.project); expect(created.value.recipe.init.kind).toBe("none");
      // ERC165 removal is an explicit interface-coverage warning, acknowledged for this exact desired plan.
      const erc165 = Object.entries(created.value.recipe.facetInstances ?? {}).find(([, instance]) => instance.kind === "known" && instance.catalogFacet === "ERC165Facet")?.[0];
      if (!erc165) throw new Error("The observed ERC165 instance wasn't reconstructed.");
      const project = removeFacets(created.value, catalog, [erc165]).project;
      const plan = planUpgrade(project.recipe, catalog, project.upgrade!); if (!plan.ok) throw new Error(plan.error);
      expect(plan.value.cuts.some((cut) => cut.action === 2)).toBe(true);
      const acks = plan.value.analysis.problems.filter((problem) => problem.severity === "warning" && problem.ack).map((problem) => problem.id);
      account = ALICE;
      const prepared = await prepareUpgrade({ project, catalog, from: ALICE, acks }, ports); if (!prepared.ok) throw new Error(prepared.error);
      expect(prepared.value.authority.kind).toBe("role"); expect(prepared.value.authority.canSign).toBe(true);
      let current: Deployment = structuredClone(record), resumable: Deployment | null = null; let serial = 0, tail = Promise.resolve();
      const update: UpgradeExecutionPorts["records"]["update"] = (_id, _address, change) => {
        const result = tail.then(() => { const next = change(structuredClone(current)); if (next.ok) { current = structuredClone(next.value); if (current.pendingUpgrade?.tx) resumable = structuredClone(current); } return next; }); tail = result.then(() => undefined); return result;
      };
      cut = createUpgradeTransaction(prepared.value, record, { ...ports, chains: [{ id: local.chainId, testnet: true }], chain: async () => chain,
        context: () => ({ key: "upgrade-plan", online: true, readOnly: null }), subscribe: () => () => {}, clock, receiptTimeout: () => 10,
        receipt: (_id, hash) => readUpgradeReceipt(local.client, local.chainId, hash),
        records: { update, now: () => Date.now(), reviewId: () => `anvil-review-${++serial}` },
      });
      await cut.controller.review(cut.intent); expect(cut.controller.get().phase).toBe("ready"); expect(current).toEqual(record); expect(sends).toBe(1);
      await cut.controller.sign(); await confirmed(cut.controller); expect(sends).toBe(2);
      expect(current.revision).toBe(2); expect(current.recipeHash).toBe(plan.value.analysis.recipeHash); expect(current.projectId).toBe(original.project.id); expect(current.tx).toBe(record.tx); expect(current).not.toHaveProperty("pendingUpgrade");
      const cutHash = cut.controller.get().hash; if (!cutHash) throw new Error("The cut has no transaction hash.");
      const [tx, receipt] = await Promise.all([readUpgradeTransaction(local.client, local.chainId, cutHash), readUpgradeReceipt(local.client, local.chainId, cutHash)]);
      expect(tx.ok).toBe(true); expect(receipt.ok).toBe(true);
      const recovered = resumable as Deployment | null;
      if (!recovered) throw new Error("The sent reservation wasn't persisted for reload recovery.");
      current = recovered;
      observer = createUpgradeObserver({ ...ports, get: async () => current, update, chain: async () => chain,
        transaction: (_id, hash) => readUpgradeTransaction(local.client, local.chainId, hash), receipt: (_id, hash) => readUpgradeReceipt(local.client, local.chainId, hash) });
      expect((await observer.resume(target)).ok).toBe(true);
      const deadline = Date.now() + 10_000; while (observer.get(target).status === "watching") { if (Date.now() >= deadline) throw new Error("Reload observation didn't finish."); await Bun.sleep(25); }
      expect(observer.get(target).status).toBe("verified"); expect(current.revision).toBe(2); expect(sends).toBe(2);
      await engine.refresh(target); const final = engine.get(target); if (final.status !== "ready") throw new Error("Post-cut inspection failed.");
      expect(final.value.snapshot.facets?.flatMap((row) => row.functionSelectors)).not.toContain("0x01ffc9a7");
      const held = await ports.call(target, allowanceData, { blockHash: final.value.snapshot.blockHash }); if (!held.ok) throw new Error(held.error.reason);
      expect(decodeFunctionResult({ abi: ABI, functionName: "allowance", data: held.value })).toBe(37n);
    } finally { observer?.dispose(); cut?.controller.dispose(); write.dispose(); engine.dispose(); }
  }, 60_000);
});
