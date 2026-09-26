import { buildSalt, CREATEX, createxPredict, factoryPredict } from "../../address";
import { analyze } from "../../analysis";
import { normalizeRecipe } from "../../canonical";
import { buildDiamondDeploy } from "../../deploy";
import { plural } from "../../format";
import { encodeInit } from "../../init/encode";
import { planInit } from "../../init/plan";
import { buildPlan } from "../../plan";
import type { ExportSafeBatchFn } from "../../model/api";
import type { Catalog } from "../../model/catalog";
import type { DeployPath, Refs, Scope } from "../../model/chain";
import { isAddress, sameAddress, toChecksum, type Address, type Hex } from "../../model/hex";
import type { SafeBatchArgs } from "../../model/io";
import { err, ok, type Result } from "../../model/result";
import { withChecksum, type BatchFile } from "./checksum";

/** The batch file's MIME type. */
export const SAFE_BATCH_MIME = "application/json";

/** Longest recipe name the meta and the file name carry, in characters. */
export const SAFE_LABEL_MAX = 80;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** What `safeBatchTarget` reads: everything that decides the salt and the diamond's address. */
export type SafeBatchTargetArgs = Pick<SafeBatchArgs, "catalog" | "safe" | "chainId" | "entropy" | "scope" | "path">;

/**
 * The salt `safe ‖ scope ‖ entropy` and the address the batch deploys the diamond at: CreateX's prediction on
 * the CreateX path; on the factory path, LatticeFactory's prediction for the chain's own factory when
 * `catalog.chains` lists one, else the release factory (the rule C5c's `buildDiamondDeploy` sends by).
 * `exportSafeBatch` uses it, so S5e and S8b record the Proposed deployment (spec L580) at exactly the address
 * the batch deploys to. Errors for a Safe that isn't an address or is the zero address, a bad chain id, and
 * bad entropy; never throws.
 */
export function safeBatchTarget(args: SafeBatchTargetArgs): Result<{ salt: Hex; address: Address }, string> {
  const { catalog, safe, chainId, entropy, scope, path } = args;
  if (!isAddress(safe)) return err(`The Safe address ${String(safe)} isn't an address.`);
  if (sameAddress(safe, ZERO_ADDRESS)) return err("The Safe address is the zero address, which no Safe can have. Enter the Safe's address.");
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return err(`The chain id ${String(chainId)} isn't a positive integer.`);
  try {
    const salt = buildSalt(safe, scope, entropy);
    if (path === "createx") return ok({ salt, address: createxPredict({ from: safe, salt, chainId }) });
    const own = ownFactory(catalog, chainId);
    const address = factoryPredict({
      factory: toChecksum(own?.address ?? catalog.factory.address),
      proxyInitCodeHash: own?.proxyInitCodeHash ?? catalog.proxy.initCodeHash,
      from: safe,
      salt,
    });
    return ok({ salt, address });
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

/**
 * A Transaction Builder 1.0 batch a Safe imports to deploy the diamond itself (spec L517, L580): one call from
 * the Safe to LatticeFactory, or to CreateX when the project chose that path, built by C5c's
 * `buildDiamondDeploy` with the salt and address from `safeBatchTarget`, and "This diamond" and "Deploying
 * account" resolved for this Safe and chain.
 *
 * The Builder checks neither the chain nor the Safe on import, and a checksum mismatch is only a warning, so
 * `meta.name` and `meta.description` name the Safe, the chain and the predicted address. The file follows the
 * Builder's own model: `chainId` a string, `createdAt` the injected `now` in milliseconds, `value` a string, and
 * `meta.checksum` computed as the Builder computes it. The description is headed with the Studio version, the
 * recipe hash and the catalog tag like every export (spec L508). The same inputs give the same bytes.
 *
 * Blockers: it analyzes the recipe in the Safe's own deploy context plus `args.context` (the project's known
 * addresses and argument sources), so AUTH-02 and LINK-01 refuse the export too (spec L517, L565). This is a
 * backstop: S5e (Export → Safe batch) and S8b (Download Transaction Builder batch) still gate on the project's
 * own analysis and keep the control disabled with its reason while blockers remain.
 *
 * Errors (never throws for these): `safeBatchTarget`'s, a bad `now`, blockers, an init C4b can't encode (its
 * errors pass through, including `UNSUPPORTED_IN_V1`), and whatever `buildDiamondDeploy` refuses (a stale plan,
 * missing or wrong `Lattice` creation code on the CreateX path). Missing shared contracts aren't in the batch:
 * any account deploys them through Arachnid's proxy (spec L566), and the description says so.
 */
export const exportSafeBatch: ExportSafeBatchFn = (args) => {
  const { catalog, safe, chainId, scope, path, now } = args;
  const target = safeBatchTarget(args);
  if (!target.ok) return target;
  if (!Number.isSafeInteger(now) || now < 0) return err(`The creation time ${String(now)} isn't a time in milliseconds.`);
  const { salt, address: self } = target.value;

  const recipe = normalizeRecipe(args.recipe, catalog);
  // A probe of another chain (a stale one after a chain switch) must never decide anything for this batch.
  const chain = args.chain?.chainId === chainId ? args.chain : undefined;
  const refs: Refs = { self, deployer: toChecksum(safe) };
  const context = args.context;

  const analysis = analyze(recipe, catalog, {
    known: context?.known ?? [],
    unconfirmed: context?.unconfirmed ?? [],
    ...(context?.knownFrom === undefined ? {} : { knownFrom: context.knownFrom }),
    ...(context?.unconfirmedFrom === undefined ? {} : { unconfirmedFrom: context.unconfirmedFrom }),
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
  const chainName = chain === undefined ? "" : plainText(chain.name, "");
  const own = ownFactory(catalog, chainId);
  const text = describe({
    label: plainText(recipe.name ?? "", "the diamond", SAFE_LABEL_MAX),
    safe: toChecksum(safe),
    chainId,
    chainName: chainName === "" ? undefined : chainName,
    scope,
    path,
    to: toChecksum(tx.to),
    chainFactory: path === "factory" && own !== undefined && !sameAddress(own.address, catalog.factory.address),
    self,
    omitted: buildPlan(recipe, catalog, analysis.routing).omitted,
    recipeHash: analysis.recipeHash,
    tag: plainText(catalog.lattice.tag, "unknown"),
    studioVersion: plainText(args.studioVersion, "unknown"),
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

/** The chain's own LatticeFactory, when the catalog lists one for `chainId`. */
function ownFactory(catalog: Catalog, chainId: number) {
  return catalog.chains.find((release) => release.chainId === chainId)?.factory;
}

type Described = {
  label: string;
  safe: Address;
  chainId: number;
  /** The probed chain's display name; undefined without a probe of this chain. */
  chainName: string | undefined;
  scope: Scope;
  path: DeployPath;
  to: Address;
  /** The call goes to a chain-specific LatticeFactory rather than the release one. */
  chainFactory: boolean;
  self: Address;
  /** Placed facets that route no selector, so the call cuts no Add for them (spec L509, PA bug 2). */
  omitted: readonly string[];
  recipeHash: Hex;
  tag: string;
  studioVersion: string;
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
  const lines = [
    `Lattice Studio ${d.studioVersion} · recipe ${d.recipeHash} · Lattice ${d.tag}`,
    `Deploys ${d.label} to ${d.self} on ${chain}, from Safe ${d.safe}, through ${via}.`,
    `The salt starts with this Safe's address and "This diamond" resolves to ${d.self}.`,
    `Import it only into Safe ${d.safe} on ${chainShort}: the Transaction Builder checks neither the Safe nor the chain, and ${elsewhere}.`,
  ];
  if (d.chainFactory && d.scope === "every-chain") {
    lines.push(`${d.to} is ${chainShort}'s own LatticeFactory: on another chain that address may have no code, and the call would do nothing.`);
  }
  // The agent brief's words for the same facets (export/docs/brief.ts).
  if (d.omitted.length > 0) lines.push(`Placed but routes nothing, so no Add is cut for it: ${d.omitted.join(", ")}.`);
  lines.push(`Leaves out deploying missing shared contracts: use Deploy missing contracts… in Studio, or Lattice's DeployRelease at ${d.tag}, which any account may run.`);
  return { name, description: lines.join("\n") };
}

/**
 * Text that came from a person or a file (the recipe's name, the chain's name, the catalog tag, the Studio
 * version) as one plain line: control, format and line-separator characters (newlines, tabs, bidi overrides,
 * zero-width marks) can't reorder or break the meta the signers read. JSON.stringify escapes the rest. With
 * `max`, text longer than `max` characters is cut to `max - 1` and ends with "…".
 */
export function plainText(value: string, fallback: string, max?: number): string {
  const text = value
    .replace(/[\p{Cf}]/gu, "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return fallback;
  const chars = [...text];
  return max === undefined || chars.length <= max ? text : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/**
 * The recipe's name as a file name: letters, digits, dots, dashes and underscores, at most `SAFE_LABEL_MAX`
 * characters; "diamond" when nothing is left.
 */
function fileStem(name: string | undefined): string {
  const clean = (value: string) => value.replace(/^[-.]+|[-.]+$/g, "");
  const stem = clean(clean((name ?? "").normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-")).slice(0, SAFE_LABEL_MAX));
  return stem === "" ? "diamond" : stem;
}
