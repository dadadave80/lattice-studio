import { buildSalt, CREATEX, createxPredict, factoryPredict } from "../../address";
import { analyze } from "../../analysis";
import { normalizeRecipe } from "../../canonical";
import { buildDiamondDeploy } from "../../deploy";
import { plural } from "../../format";
import { encodeInit } from "../../init/encode";
import { planInit } from "../../init/plan";
import type { ExportSafeBatchFn } from "../../model/api";
import type { Catalog } from "../../model/catalog";
import type { ChainState, DeployPath, Refs, Scope } from "../../model/chain";
import { isAddress, sameAddress, toChecksum, type Address, type Hex } from "../../model/hex";
import { err, ok } from "../../model/result";
import { withChecksum, type BatchFile } from "./checksum";

/** The batch file's MIME type. */
export const SAFE_BATCH_MIME = "application/json";

/**
 * A Transaction Builder 1.0 batch a Safe imports to deploy the diamond itself (spec L517, L580): one call from
 * the Safe to LatticeFactory, or to CreateX when the project chose that path, built by C5c's
 * `buildDiamondDeploy` with the salt `safe ‖ scope ‖ entropy` and "This diamond" and "Deploying account"
 * resolved for this Safe and chain.
 *
 * The Builder checks neither the chain nor the Safe on import, and a checksum mismatch is only a warning, so
 * `meta.name` and `meta.description` name the Safe, the chain and the predicted address. The file follows the
 * Builder's own model: `chainId` a string, `createdAt` the injected `now` in milliseconds, `value` a string, and
 * `meta.checksum` computed as the Builder computes it. The same inputs give the same bytes.
 *
 * Errors (never throws for these): a Safe that isn't an address, a bad chain id, `now` or entropy, blockers
 * the Safe's own context finds, an init C4b can't encode (its errors pass through, including
 * `UNSUPPORTED_IN_V1`), and whatever `buildDiamondDeploy` refuses (a stale plan, missing or wrong `Lattice`
 * creation code on the CreateX path). Missing shared contracts aren't in the batch: any account deploys them
 * through Arachnid's proxy (spec L566), and the description says so.
 */
export const exportSafeBatch: ExportSafeBatchFn = (args) => {
  const { catalog, safe, chainId, entropy, scope, path, now } = args;
  if (!isAddress(safe)) return err(`The Safe address ${String(safe)} isn't an address.`);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return err(`The chain id ${String(chainId)} isn't a positive integer.`);
  if (!Number.isSafeInteger(now) || now < 0) return err(`The creation time ${String(now)} isn't a time in milliseconds.`);

  const recipe = normalizeRecipe(args.recipe, catalog);
  // A probe of another chain (a stale one after a chain switch) must never decide anything for this batch.
  const chain = args.chain?.chainId === chainId ? args.chain : undefined;

  let salt: Hex;
  let self: Address;
  try {
    salt = buildSalt(safe, scope, entropy);
    self = predict(catalog, path, safe, salt, chainId);
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
  const refs: Refs = { self, deployer: toChecksum(safe) };

  const analysis = analyze(recipe, catalog, {
    known: [],
    unconfirmed: [],
    deploy: { chainId, path, from: safe, salt },
    refs,
    ...(chain === undefined ? {} : { chain }),
  });
  const blockers = analysis.problems.filter((problem) => problem.severity === "blocker");
  if (blockers.length > 0) {
    const codes = [...new Set(blockers.map((problem) => problem.code))].join(", ");
    return err(`Resolve ${plural(blockers.length, "blocker")} to export: ${codes}.`);
  }

  const init = encodeInit(planInit(recipe, catalog), catalog, refs);
  if (!init.ok) return init;
  const deploy = buildDiamondDeploy({
    recipe,
    catalog,
    plan: analysis.plan,
    init: { target: init.value.target, data: init.value.data },
    path,
    from: safe,
    salt,
    chainId,
    ...(chain === undefined ? {} : { chain }),
    ...(args.proxyCreationCode === undefined ? {} : { proxyCreationCode: args.proxyCreationCode }),
  });
  if (!deploy.ok) return deploy;
  if (!sameAddress(deploy.value.address, self)) {
    return err(`The deploy call targets ${toChecksum(deploy.value.address)}, but the references were built for ${self}. Rebuild the batch.`);
  }

  const { tx } = deploy.value;
  const text = describe({
    label: recipe.name?.trim() || "the diamond",
    safe: toChecksum(safe),
    chainId,
    chainName: chain?.name,
    scope,
    path,
    to: toChecksum(tx.to),
    self,
    recipeHash: analysis.recipeHash,
    tag: catalog.lattice.tag,
  });
  const file = withChecksum({
    version: "1.0",
    chainId: String(chainId),
    createdAt: now,
    meta: {
      name: text.name,
      description: text.description,
      createdFromSafeAddress: toChecksum(safe),
      createdFromOwnerAddress: "",
    },
    transactions: [{ to: toChecksum(tx.to), value: tx.value.toString(), data: tx.data }],
  } satisfies BatchFile);

  return ok({ filename: `${fileStem(recipe.name)}.safe.json`, mime: SAFE_BATCH_MIME, text: `${JSON.stringify(file, null, 2)}\n` });
};

/** The address the deploy call creates, predicted the way C5c's `buildDiamondDeploy` sends it. */
function predict(catalog: Catalog, path: DeployPath, from: Address, salt: Hex, chainId: number): Address {
  if (path === "createx") return createxPredict({ from, salt, chainId });
  const own = catalog.chains.find((release) => release.chainId === chainId)?.factory;
  return factoryPredict({
    factory: toChecksum(own?.address ?? catalog.factory.address),
    proxyInitCodeHash: own?.proxyInitCodeHash ?? catalog.proxy.initCodeHash,
    from,
    salt,
  });
}

type Described = {
  label: string;
  safe: Address;
  chainId: number;
  chainName: ChainState["name"] | undefined;
  scope: Scope;
  path: DeployPath;
  to: Address;
  self: Address;
  recipeHash: Hex;
  tag: string;
};

/**
 * `meta.name` and `meta.description`: the Safe, the chain and the predicted address, because the Builder
 * imports the batch into any Safe on any chain without a word (spec L517).
 */
function describe(d: Described): { name: string; description: string } {
  const chain = d.chainName === undefined ? `chain ${d.chainId}` : `${d.chainName} (chain ${d.chainId})`;
  const chainShort = d.chainName ?? `chain ${d.chainId}`;
  const via = d.path === "createx" ? `CreateX at ${CREATEX}` : `LatticeFactory at ${d.to}`;
  const elsewhere =
    d.scope === "this-chain"
      ? "from another Safe or on another chain it would deploy with references built for this Safe and chain"
      : "from another Safe it would deploy with references built for this Safe";
  const name = `Deploy ${d.label} to ${d.self} · Safe ${d.safe} · ${chainShort}`;
  const description = [
    `Deploys ${d.label} to ${d.self} on ${chain}, from Safe ${d.safe}, through ${via}.`,
    `The salt starts with this Safe's address and "This diamond" resolves to ${d.self}.`,
    `Import it only into Safe ${d.safe} on ${chainShort}: the Transaction Builder checks neither the Safe nor the chain, and ${elsewhere}.`,
    `Recipe ${d.recipeHash} · Lattice ${d.tag}.`,
    `Leaves out deploying missing shared contracts: use Deploy missing contracts… in Studio, or Lattice's DeployRelease at ${d.tag}, which any account may run.`,
  ].join("\n");
  return { name, description };
}

/** The recipe's name as a file name: letters, digits, dots, dashes and underscores; "diamond" when empty. */
function fileStem(name: string | undefined): string {
  const stem = (name ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return stem === "" ? "diamond" : stem;
}
