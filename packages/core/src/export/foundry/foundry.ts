/**
 * `exportFoundry` (spec L507-L528 Flow 11): the standalone `Deploy{Name}.s.sol`. Deterministic: the same project,
 * catalog, analysis, Studio version and chains give the same bytes. It refuses while the recipe has blockers
 * (decision 5, spec L514), when the analysis isn't this recipe's, and on the CreateX path without the Lattice
 * proxy's creation code (or with code whose keccak256 isn't `catalog.proxy.initCodeHash`).
 */
import { keccak256 } from "viem";
import { normalizeRecipe, recipeHash } from "../../canonical";
import { encodeInit } from "../../init/encode/encode";
import { planInit } from "../../init/plan/plan";
import type { ExportFoundryFn } from "../../model/api";
import { isHexAnyCase, toChecksum, toLowerHex, type Address, type Hex } from "../../model/hex";
import { err, ok } from "../../model/result";
import { pascalIdentifier } from "../escape";
import { renderScript, type ChainConstants } from "./render";

/** Stand-ins for the two references while `encodeInit` validates the init; the script resolves the real ones. */
const PLACEHOLDER_SELF: Address = "0x00000000000000000000000000000000000000A1";
const PLACEHOLDER_DEPLOYER: Address = "0x00000000000000000000000000000000000000A2";

/** The longest contract name the file name gets (`Deploy` plus up to 64 characters). */
const MAX_NAME = 64;

/** `Deploy{Name}` from the project name, sanitized to `[A-Za-z0-9_]` (spec L859). */
export function scriptContractName(projectName: string): string {
  return `Deploy${pascalIdentifier(projectName, "Diamond").slice(0, MAX_NAME)}`;
}

export const exportFoundry: ExportFoundryFn = ({ project, catalog, analysis, studioVersion, chainIds, proxyCreationCode }) => {
  const recipe = normalizeRecipe(project.recipe, catalog);
  const hash = recipeHash(recipe, catalog);
  if (analysis.recipeHash.toLowerCase() !== hash.toLowerCase()) {
    return err("The analysis is for another version of this recipe. Check the recipe again, then export.");
  }
  const blockers = analysis.problems.filter((problem) => problem.severity === "blocker").length;
  if (blockers > 0) return err(`Resolve ${blockers} ${blockers === 1 ? "blocker" : "blockers"} to export.`);
  if (analysis.plan.length === 0) return err("The plan cuts no facets. Place facets, then export.");

  const ids = [...new Set(chainIds)].sort((a, b) => a - b);
  const badId = ids.find((id) => !Number.isSafeInteger(id) || id <= 0);
  if (badId !== undefined) return err(`Chain ${badId} isn't a chain id. Export for chains with positive whole-number ids.`);
  if (ids.length === 0) return err("No chains to export for. Choose at least one chain.");

  const { path, scope, entropy } = project.deploy;
  if (!isHexAnyCase(entropy) || entropy.length !== 24) {
    return err(`The salt entropy ${entropy} isn't 11 bytes. Use a new salt, then export.`);
  }
  let creationCode: Hex | undefined;
  if (path === "createx") {
    if (proxyCreationCode === undefined) return err("The CreateX script needs the Lattice proxy's creation code. Load the catalog's code, then export.");
    if (!isHexAnyCase(proxyCreationCode) || proxyCreationCode.length % 2 !== 0) {
      return err("The Lattice proxy's creation code isn't hex bytes. Load the catalog's code again.");
    }
    if (keccak256(proxyCreationCode).toLowerCase() !== catalog.proxy.initCodeHash.toLowerCase()) {
      return err(`The Lattice proxy's creation code doesn't hash to ${catalog.proxy.initCodeHash}, the catalog's. Load the catalog's code again.`);
    }
    creationCode = toLowerHex(proxyCreationCode);
  }

  const init = planInit(recipe, catalog);
  const encoded = encodeInit(init, catalog, { self: PLACEHOLDER_SELF, deployer: PLACEHOLDER_DEPLOYER });
  if (!encoded.ok) return encoded;

  const chains: ChainConstants[] = ids.map((chainId) => {
    const own = catalog.chains.find((chain) => chain.chainId === chainId)?.factory;
    return own === undefined
      ? {
          chainId,
          factory: toChecksum(catalog.factory.address),
          factoryCodehash: catalog.factory.codehash,
          proxyInitCodeHash: catalog.proxy.initCodeHash,
          proxyCommit: catalog.lattice.commit,
          chainSpecific: false,
        }
      : {
          chainId,
          factory: toChecksum(own.address),
          factoryCodehash: own.codehash,
          proxyInitCodeHash: own.proxyInitCodeHash,
          proxyCommit: path === "factory" ? own.buildCommit : catalog.lattice.commit,
          chainSpecific: path === "factory",
        };
  });

  const planned = new Set(analysis.plan.map((entry) => entry.facet));
  const contractName = scriptContractName(project.name);
  const filename = `${contractName}.s.sol`;
  try {
    const text = renderScript({
      contractName,
      filename,
      projectName: project.name,
      studioVersion,
      recipeHash: toLowerHex(hash),
      catalog,
      plan: analysis.plan,
      omitted: recipe.facets.filter((facet) => !planned.has(facet)),
      excluded: recipe.exclude.map(toLowerHex),
      init,
      path,
      scope,
      entropy: toLowerHex(entropy),
      chains,
      ...(creationCode === undefined ? {} : { proxyCreationCode: creationCode }),
    });
    return ok({ filename, mime: "text/plain", text });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return err(`The script couldn't be written: ${reason}`);
  }
};
