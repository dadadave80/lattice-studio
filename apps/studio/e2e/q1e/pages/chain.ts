/**
 * What a flow needs on the chain before or while it runs, on the test's own Anvil node:
 * - a real diamond deployed through LatticeFactory with the calldata core builds (the same `buildDiamondDeploy`
 *   Studio signs), and the deployment record Studio keeps for it, so a flow can start from Live;
 * - the same transaction sent but not yet mined (automine off), so a flow can start from Pending, as after a reload;
 * - shared contracts taken off the chain, so NET-03's missing contracts are really missing;
 * - a Safe's Transaction Builder batch executed as the Safe (Anvil impersonation).
 */
import type { Address, Hex } from "viem";
import {
  analyze, buildDiamondDeploy, buildSalt, encodeInit, factoryPredict, planInit, recipeHash, type Deployment, type Project,
} from "@lattice-studio/core";
import { ALICE, ANVIL_CHAIN_ID, type AnvilNode } from "../../_support/anvil.ts";
import { catalog, sharedContracts } from "../../_support/catalog.ts";
import { SEEDED_AT } from "../../_support/projects.ts";

/** The address core predicts for `project` on the factory path, sent by `from`. */
export function predictedAddress(project: Project, from: Address = ALICE): Address {
  const salt = buildSalt(from, project.deploy.scope, project.deploy.entropy);
  return factoryPredict({ factory: catalog().factory.address, proxyInitCodeHash: catalog().proxy.initCodeHash, from, salt });
}

/** The one deploy transaction core builds for `project` sent by `from` through LatticeFactory. */
export function factoryDeploy(project: Project, from: Address = ALICE): { to: Address; data: Hex; address: Address; salt: Hex } {
  if (project.deploy.path !== "factory") throw new Error("factoryDeploy builds the LatticeFactory path only.");
  const built = catalog();
  const salt = buildSalt(from, project.deploy.scope, project.deploy.entropy);
  const address = predictedAddress(project, from);
  const init = encodeInit(planInit(project.recipe, built), built, { self: address, deployer: from });
  if (!init.ok) throw new Error(`encodeInit: ${JSON.stringify(init.error)}`);
  const deploy = buildDiamondDeploy({
    recipe: project.recipe,
    catalog: built,
    plan: analyze(project.recipe, built).plan,
    init: init.value,
    path: "factory",
    from,
    salt,
    chainId: ANVIL_CHAIN_ID,
  });
  if (!deploy.ok) throw new Error(`buildDiamondDeploy: ${JSON.stringify(deploy.error)}`);
  if (deploy.value.address !== address) throw new Error(`core predicts ${address} but builds for ${deploy.value.address}`);
  return { to: deploy.value.tx.to, data: deploy.value.tx.data, address, salt };
}

/** The record Studio keeps for `project` deployed at `address` (confirmed unless `status` says otherwise). */
export function recordFor(project: Project, fields: Partial<Deployment> & { address: Address; salt: Hex }): Deployment {
  return {
    projectId: project.id,
    chainId: ANVIL_CHAIN_ID,
    path: "factory",
    deployer: ALICE,
    status: "confirmed",
    recipeHash: recipeHash(project.recipe, catalog()),
    catalogHash: catalog().hash,
    at: new Date(SEEDED_AT).toISOString(),
    verification: "failed",
    revision: 1,
    ...fields,
  };
}

/**
 * Deploys `project` on `node` through LatticeFactory from `from` (Anvil signs for its default accounts, and for an
 * impersonated one), and returns the confirmed record Studio keeps for it.
 */
export async function deployOnAnvil(node: AnvilNode, project: Project, from: Address = ALICE): Promise<Deployment> {
  const deploy = factoryDeploy(project, from);
  const tx: Hex = await node.send({ from, to: deploy.to, data: deploy.data });
  const receipt = await node.client.getTransactionReceipt({ hash: tx });
  return recordFor(project, { address: deploy.address, salt: deploy.salt, deployer: from, tx, block: Number(receipt.blockNumber) });
}

/** A gas limit that covers any v1 deploy on Anvil (its block limit is 30M). */
const GAS = `0x${(29_000_000).toString(16)}`;

/**
 * Turns automine off and sends `tx` from `from` without mining it: the node holds it in its pool until
 * `mine(node)`. Returns its hash.
 */
export async function sendUnmined(node: AnvilNode, tx: { to: Address; data: Hex }, from: Address = ALICE): Promise<Hex> {
  await node.rpc<null>("evm_setAutomine", [false]);
  return node.rpc<Hex>("eth_sendTransaction", [{ from, to: tx.to, data: tx.data, gas: GAS }]);
}

/** Mines one block with whatever the pool holds, and turns automine back on. */
export async function mine(node: AnvilNode): Promise<void> {
  await node.rpc<null>("evm_mine", []);
  await node.rpc<null>("evm_setAutomine", [true]);
}

/**
 * A pending record for `project`, as Studio writes it when the wallet returns the hash (Flow 12 step 6): the
 * transaction is sent from `from` and left unmined. `onChain` is the recipe the transaction really deploys (default
 * `project` itself); a different one lands a diamond that doesn't match the sheet (Flow 14, Mismatch).
 */
export async function pendingDeploy(
  node: AnvilNode,
  project: Project,
  options: { onChain?: Project; from?: Address } = {},
): Promise<Deployment> {
  const from = options.from ?? ALICE;
  const onChain = options.onChain ? { ...options.onChain, deploy: project.deploy } : project;
  const deploy = factoryDeploy(onChain, from);
  const tx = await sendUnmined(node, deploy, from);
  return recordFor(project, { address: deploy.address, salt: deploy.salt, deployer: from, status: "pending", tx, verification: "pending", at: new Date().toISOString() });
}

/** A shared contract's release address, by its catalog name. */
export function releaseAddress(name: string): Address {
  const item = sharedContracts().find((entry) => entry.name === name);
  if (!item) throw new Error(`${name} isn't a shared contract in the catalog.`);
  return item.release.address;
}

/**
 * Takes shared contracts off the chain: no code and, unless `stuck`, nonce 0, so Arachnid's proxy can create them
 * again at their release addresses. A `stuck` one keeps nonce 1: its CREATE2 collides and reverts without a reason,
 * as a contract that can't be created does (spec L572).
 */
export async function removeShared(node: AnvilNode, names: readonly string[], stuck: readonly string[] = []): Promise<void> {
  for (const name of names) {
    const address = releaseAddress(name);
    await node.client.setCode({ address, bytecode: "0x" });
    await node.rpc<null>("anvil_setNonce", [address, stuck.includes(name) ? "0x1" : "0x0"]);
  }
}

/** Lets `name` be created again (nonce 0), as fixing whatever made it fail would. */
export async function unstick(node: AnvilNode, name: string): Promise<void> {
  await node.rpc<null>("anvil_setNonce", [releaseAddress(name), "0x0"]);
}

/** Executes a Transaction Builder batch as `safe`: Anvil impersonates it and sends each transaction. */
export async function executeAsSafe(node: AnvilNode, safe: Address, batch: { transactions: { to: Address; data: Hex }[] }): Promise<void> {
  await node.rpc<null>("anvil_impersonateAccount", [safe]);
  await node.rpc<null>("anvil_setBalance", [safe, "0x56BC75E2D63100000"]);
  for (const tx of batch.transactions) await node.send({ from: safe, to: tx.to, data: tx.data });
  await node.rpc<null>("anvil_stopImpersonatingAccount", [safe]);
}
