/**
 * The analysis context: NET-05 and the project's own diamond (spec L339, L584). Once the diamond is Live, the
 * prediction for the same account and salt is that diamond's address, which has code. That isn't a collision:
 * Deploy again draws a new salt. Any other diamond at the predicted address still is.
 */
import { describe, expect, test } from "bun:test";
import type { Address, ChainState, Deployment, Hex } from "@lattice-studio/core";
import { analyze, sameAddress } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { buildContext } from "./context";
import { predict, type Prediction } from "./prediction";
import { fixture } from "./testing";

const catalog = fixture();
const ACCOUNT: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ANVIL = 31337;
const SEPOLIA = 11155111;
const ENTROPY: Hex = "0x0102030405060708090a0b";
const NEW_ENTROPY: Hex = "0x0b0a090807060504030201";

const recipe = makeRecipe({}, catalog);
const project = makeProject({ recipe, deploy: { path: "factory", entropy: ENTROPY, scope: "every-chain" } });

function predictionFor(entropy: Hex, chainId = ANVIL): Extract<Prediction, { status: "ready" }> {
  const got = predict({ deploy: { ...project.deploy, entropy }, catalog, chainId, account: { address: ACCOUNT } });
  if (got.status !== "ready") throw new Error(got.reason);
  return got;
}

/** The chain's probes: ready, nothing missing, and whether the predicted address has code. */
function chainState(predictedHasCode: boolean | undefined, chainId = ANVIL): ChainState {
  return {
    chainId,
    name: chainId === ANVIL ? "Anvil" : "Sepolia",
    online: true,
    probedAt: "2026-09-26T12:00:00.000Z",
    deployer: { present: true },
    shared: {},
    simulate: true,
    codeAt: {},
    ...(predictedHasCode === undefined ? {} : { predictedHasCode }),
  };
}

function record(address: Address, fields: Partial<Deployment> = {}): Deployment {
  return {
    projectId: project.id,
    chainId: ANVIL,
    address,
    path: "factory",
    deployer: ACCOUNT,
    salt: predictionFor(ENTROPY).salt,
    status: "confirmed",
    recipeHash: `0x${"11".repeat(32)}`,
    catalogHash: catalog.hash,
    at: "2026-09-26T11:00:00.000Z",
    verification: "exact_match",
    revision: 1,
    ...fields,
  };
}

function net05(prediction: Prediction, chain: ChainState, deployments: readonly Deployment[]): string[] {
  const ctx = buildContext({ project, prediction, account: { address: ACCOUNT }, deployments, chain });
  return analyze(recipe, catalog, ctx).problems.filter((p) => p.code === "NET-05").map((p) => p.id);
}

describe("NET-05 and this project's own diamond", () => {
  const live = predictionFor(ENTROPY);

  test("the predicted address is this project's confirmed (Live) diamond: no NET-05, so Deploy again isn't blocked", () => {
    expect(net05(live, chainState(true), [record(live.address)])).toEqual([]);
    const ctx = buildContext({ project, prediction: live, account: { address: ACCOUNT }, deployments: [record(live.address)], chain: chainState(true) });
    expect(ctx.chain).toBeDefined();
    expect(ctx.chain && "predictedHasCode" in ctx.chain).toBe(false);
  });

  test("any other code at the predicted address still blocks", () => {
    // No record: someone else's diamond (or an older transaction's).
    expect(net05(live, chainState(true), [])).toEqual([`NET-05:${ANVIL}`]);
    // A Mismatch record: the factory returned a diamond that doesn't match the sheet (spec L576), never Live.
    for (const status of ["mismatch", "pending", "proposed", "failed"] as const) {
      expect(net05(live, chainState(true), [record(live.address, { status })])).toEqual([`NET-05:${ANVIL}`]);
    }
    // The same address confirmed on another chain says nothing about this one.
    expect(net05(live, chainState(true), [record(live.address, { chainId: SEPOLIA })])).toEqual([`NET-05:${ANVIL}`]);
  });

  test("a free address stays free, and the rest of the chain state is untouched", () => {
    const ctx = buildContext({ project, prediction: live, account: { address: ACCOUNT }, deployments: [record(live.address)], chain: chainState(false) });
    expect(ctx.chain).toEqual(chainState(false));
    expect(net05(live, chainState(false), [record(live.address)])).toEqual([]);
  });

  test("after Live, Deploy again's new entropy predicts a new address, where NET-05 applies as usual", () => {
    const next = predictionFor(NEW_ENTROPY);
    expect(sameAddress(next.address, live.address)).toBe(false);
    expect(next.salt).not.toBe(live.salt);
    // The live diamond's record doesn't excuse code at the new address.
    expect(net05(next, chainState(true), [record(live.address)])).toEqual([`NET-05:${ANVIL}`]);
    expect(net05(next, chainState(false), [record(live.address)])).toEqual([]);
  });
});
