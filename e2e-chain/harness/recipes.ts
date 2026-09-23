/**
 * The v1 recipes (templates that load on the plain Lattice proxy) from the real catalog, with the arguments the
 * templates leave for the person filled in, and the deploy core builds for them.
 */
import { keccak256, slice, stringToHex, type Address, type Hex } from "viem";
import {
  analyze, buildDiamondDeploy, buildSalt, createxPredict, encodeInit, factoryPredict, loadTemplate, planInit, templateList,
  type Analysis, type Arg, type Catalog, type DiamondDeploy, type Project, type Recipe,
} from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { proxyCreationCode } from "./catalog";
import type { Node } from "./node";

export type DeployPath = "factory" | "createx";
export const PATHS: readonly DeployPath[] = ["factory", "createx"];

/** GovernedVault's underlying asset: any address works, `__ERC4626_init` defaults decimals to 18 without code. */
export const ASSET: Address = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
/** Where SafeDiamondCut's Safe lives; `etchSafe` puts a minimal `getThreshold()` there. */
export const SAFE: Address = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

/**
 * A stand-in Safe: returns `threshold` as one word to any call, so `ISafe.getThreshold()` reads it
 * (SafeDiamondCutLib `_validateSafe`). PUSH1 t, PUSH1 0, MSTORE, PUSH1 32, PUSH1 0, RETURN.
 */
export function safeMockCode(threshold: number): Hex {
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) throw new RangeError(`threshold ${threshold} doesn't fit PUSH1`);
  return `0x60${threshold.toString(16).padStart(2, "0")}60005260206000f3`;
}

export async function etchSafe(node: Node, threshold = 2): Promise<void> {
  await node.client.setCode({ address: SAFE, bytecode: safeMockCode(threshold) });
}

/** The v1 recipes, in catalog order. */
export function v1Recipes(catalog: Catalog): string[] {
  return templateList(catalog)
    .filter((item) => item.loadable)
    .map((item) => item.name);
}

/** Fills what each v1 template leaves empty (INIT-01); a new v1 recipe that needs more fails `fixture`'s blocker check. */
function fill(name: string, recipe: Recipe, overrides: Record<string, Arg>): void {
  const init = recipe.init;
  if (init.kind === "bundle") {
    const p = init.args["p"];
    if (p !== undefined && typeof p === "object" && !Array.isArray(p) && !("$ref" in p)) {
      if (name === "GovernedVault") p["asset"] = ASSET;
      Object.assign(p, overrides);
    }
    return;
  }
  if (init.kind === "steps") {
    const step = init.steps[0];
    if (step === undefined) return;
    if (name === "SafeDiamondCut") step.args["safe"] = SAFE;
    Object.assign(step.args, overrides);
  }
}

export type Fixture = { name: string; catalog: Catalog; recipe: Recipe; analysis: Analysis; project: Project };

/**
 * Template `name`, filled in, analyzed with no chain. Throws if it still has a blocker, unless `allowBlockers`:
 * the forced-failure tests send arguments the checks would stop (INIT-01) to see what the chain says.
 */
export function fixture(
  catalog: Catalog,
  name: string,
  path: DeployPath,
  entropy: Hex,
  overrides: Record<string, Arg> = {},
  options: { allowBlockers?: boolean } = {},
): Fixture {
  const loaded = loadTemplate(catalog, name);
  if (!loaded.ok) throw new Error(loaded.error);
  const recipe = loaded.value;
  fill(name, recipe, overrides);
  const analysis = analyze(recipe, catalog, { known: [], unconfirmed: [] });
  const blockers = analysis.problems.filter((p) => p.severity === "blocker");
  if (blockers.length > 0 && options.allowBlockers !== true) throw new Error(`${name} still has blockers: ${blockers.map((p) => `${p.code} ${p.message}`).join("; ")}`);
  const base = makeProject({ name, recipe });
  const project: Project = {
    ...base,
    name,
    deploy: { ...base.deploy, path, entropy, scope: path === "factory" ? "every-chain" : "this-chain" },
  };
  return { name, catalog, recipe, analysis, project };
}

/** The address core predicts for this fixture sent by `from` on `chainId`. */
export function predict(f: Fixture, from: Address, chainId: number): { salt: Hex; address: Address } {
  const { path, scope, entropy } = f.project.deploy;
  const salt = buildSalt(from, scope, entropy);
  const address =
    path === "factory"
      ? factoryPredict({ factory: f.catalog.factory.address, proxyInitCodeHash: f.catalog.proxy.initCodeHash, from, salt })
      : createxPredict({ from, salt, chainId });
  return { salt, address };
}

/** The one transaction core builds for this fixture: init encoded with both references resolved, then C5c. */
export function coreDeploy(f: Fixture, from: Address, chainId: number): DiamondDeploy & { init: { target: Address; data: Hex } } {
  const { salt, address } = predict(f, from, chainId);
  const init = encodeInit(planInit(f.recipe, f.catalog), f.catalog, { self: address, deployer: from });
  if (!init.ok) throw new Error(init.error);
  const built = buildDiamondDeploy({
    recipe: f.recipe,
    catalog: f.catalog,
    plan: f.analysis.plan,
    init: init.value,
    path: f.project.deploy.path,
    from,
    salt,
    chainId,
    ...(f.project.deploy.path === "createx" ? { proxyCreationCode: proxyCreationCode() } : {}),
  });
  if (!built.ok) throw new Error(built.error);
  if (built.value.address !== address) throw new Error(`buildDiamondDeploy predicts ${built.value.address}, not ${address}`);
  return { ...built.value, init: init.value };
}

/** Fresh 11-byte entropy per case, derived from a label so runs are repeatable. */
export function entropyFor(label: string): Hex {
  return slice(keccak256(stringToHex(label)), 0, 11);
}
