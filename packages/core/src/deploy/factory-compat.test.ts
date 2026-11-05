import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { decodeFunctionData, type Abi } from "viem";
import { buildSalt, factoryPredict } from "../address";
import { analyze } from "../analysis";
import { exportFoundry } from "../export/foundry/foundry";
import { exportSafeBatch } from "../export/safe";
import { encodeInit } from "../init/encode";
import { planInit } from "../init/plan";
import type { Catalog, FacetDetail, RecipesShard } from "../model/catalog";
import type { Address, Hex } from "../model/hex";
import { loadTemplate, withRecipes } from "../plan";
import { makeProject } from "../testing";
import { buildDiamondDeploy } from "./diamond";

const ROOT = new URL("../../../../catalog/", import.meta.url);
const ALICE: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ENTROPY: Hex = "0x0102030405060708090a0b";

describe("bundled factory ABI compatibility", () => {
  for (const id of ["dev-6c8db45", "dev-f4a32c8", "v0.5.0"]) {
    const dir = new URL(`${id}/`, ROOT);
    const index = JSON.parse(readFileSync(new URL("index.json", dir), "utf8")) as Catalog;
    const catalog = index.shards
      ? withRecipes(index, JSON.parse(readFileSync(new URL(index.shards.recipes.path, dir), "utf8")) as RecipesShard)
      : index;
    const shard = JSON.parse(readFileSync(new URL(catalog.factory.detail?.path ?? "shards/LatticeFactory.json", dir), "utf8")) as FacetDetail;
    const abi: Abi = shard.abi;
    const template = loadTemplate(catalog, "ERC20");
    if (!template.ok) throw new Error(template.error);
    const recipe = template.value;
    const analysis = analyze(recipe, catalog, { known: [], unconfirmed: [] });
    const salt = buildSalt(ALICE, "every-chain", ENTROPY);
    const address = factoryPredict({ factory: catalog.factory.address, proxyInitCodeHash: catalog.proxy.initCodeHash, from: ALICE, salt });
    const init = encodeInit(planInit(recipe, catalog), catalog, { self: address, deployer: ALICE });
    if (!init.ok) throw new Error(init.error);

    test.each([false, true])(`${id}: custom and registry cuts decode against its published factory ABI (listed=%s)`, (listed) => {
      const records = Object.fromEntries(analysis.plan.map((entry) => [`${entry.facet}@${entry.version}`, { facet: entry.address, codehash: entry.codehash }]));
      const result = buildDiamondDeploy({
        recipe, catalog, plan: analysis.plan, init: init.value, path: "factory", from: ALICE, salt, chainId: 31337,
        ...(listed ? { chain: { chainId: 31337, name: "Anvil", online: true, probedAt: "2026-11-05T00:00:00Z", deployer: { present: true }, shared: {}, simulate: true, codeAt: {}, registry: { records } } } : {}),
      });
      if (!result.ok) throw new Error(result.error);
      const decoded = decodeFunctionData({ abi, data: result.value.tx.data });
      expect(decoded.functionName).toBe("deploy");
      expect(decoded.args?.slice(2)).toEqual([init.value.target, init.value.data, salt]);
      expect(result.value.registryEntries.length > 0).toBe(listed);
    });

    test(`${id}: Foundry and Safe exports preserve its factory entry shape`, () => {
      const project = makeProject({ recipe });
      const foundry = exportFoundry({ project, analysis, catalog, studioVersion: "test", chainIds: [31337] });
      if (!foundry.ok) throw new Error(foundry.error);
      const entry = /struct RecipeEntry \{([\s\S]*?)\}/.exec(foundry.value.text)?.[1] ?? "";
      expect(entry.includes("bytes4[] exclude;")).toBe(id === "v0.5.0");
      const safe = exportSafeBatch({ recipe, catalog, safe: ALICE, chainId: 31337, entropy: ENTROPY, scope: "every-chain", path: "factory", now: 0, studioVersion: "test" });
      if (!safe.ok) throw new Error(safe.error);
      const batch = JSON.parse(safe.value.text) as { transactions: { data: Hex }[] };
      const data = batch.transactions[0]?.data;
      if (data === undefined) throw new Error("the Safe export has no transaction");
      expect(decodeFunctionData({ abi, data }).functionName).toBe("deploy");
    });
  }
});
