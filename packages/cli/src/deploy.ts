/**
 * Deploy settings from the command line: the salt's entropy and scope (from `--project`, from `--entropy` and
 * `--scope`, or drawn fresh and printed, spec L921), the path, the chain id, addresses, and the analysis context
 * built from them the way the app builds it (S1's `buildContext`).
 */
import {
  type Address,
  type AnalysisContext,
  buildSalt,
  type Catalog,
  type ChainState,
  createxPredict,
  type Deployment,
  type DeployPath,
  err,
  factoryPredict,
  type Hex,
  isAddress,
  newEntropy,
  ok,
  type Project,
  type Random,
  type Result,
  sameAddress,
  type Scope,
  toChecksum,
} from "@lattice-studio/core";
import { errorMessage, type Failure, invalid } from "./failure";

export type SaltSource = "project" | "flags" | "fresh";

export type DeploySettings = { path: DeployPath; scope: Scope; entropy: Hex; source: SaltSource };

const PATHS: readonly DeployPath[] = ["factory", "createx"];
const SCOPES: readonly Scope[] = ["every-chain", "this-chain"];

export function parsePath(value: string | undefined): Result<DeployPath | undefined, Failure> {
  if (value === undefined) return ok(undefined);
  return (PATHS as readonly string[]).includes(value) ? ok(value as DeployPath) : err(invalid(`--path is factory or createx, not ${value}.`));
}

export function parseChainId(value: string | undefined, flag = "--chain"): Result<number, Failure> {
  if (value === undefined) return err(invalid(`${flag} needs a chain id, for example ${flag} 11155111.`));
  const id = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) return err(invalid(`${flag} ${value} isn't a chain id. Use a positive whole number, for example 11155111.`));
  return ok(id);
}

/** Any letter case; a mixed-case address must carry a valid EIP-55 checksum. Returns it checksummed. */
export function parseAddress(value: string | undefined, flag: string): Result<Address, Failure> {
  if (value === undefined) return err(invalid(`${flag} needs an address.`));
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return err(invalid(`${flag} ${value} isn't an address.`));
  if (!isAddress(value)) return err(invalid(`${flag} ${value}: its checksum doesn't match, so it may have a typo.`));
  return ok(toChecksum(value));
}

/**
 * The salt settings. `project` is the deploy block of the project file named with `--project` (or given as the
 * input file); flags override its path. Entropy comes from exactly one place: the project, `--entropy`, or fresh.
 */
export function resolveDeploy(
  flags: { path?: string; entropy?: string; scope?: string },
  project: Project["deploy"] | undefined,
  random: Random,
): Result<DeploySettings, Failure> {
  const path = parsePath(flags.path);
  if (!path.ok) return path;
  if (flags.scope !== undefined && !(SCOPES as readonly string[]).includes(flags.scope)) {
    return err(invalid(`--scope is every-chain or this-chain, not ${flags.scope}.`));
  }
  if (project !== undefined) {
    if (flags.entropy !== undefined || flags.scope !== undefined) {
      return err(invalid("The salt comes from the project file. Pass --project, or --entropy and --scope, not both."));
    }
    return ok({ path: path.value ?? project.path, scope: project.scope, entropy: project.entropy.toLowerCase() as Hex, source: "project" });
  }
  const scope = (flags.scope as Scope | undefined) ?? "every-chain";
  if (flags.entropy !== undefined) {
    if (!/^0x[0-9a-fA-F]{22}$/.test(flags.entropy)) {
      return err(invalid(`--entropy ${flags.entropy} isn't 11 bytes of hex. Use 0x and 22 hex digits.`));
    }
    return ok({ path: path.value ?? "factory", scope, entropy: flags.entropy.toLowerCase() as Hex, source: "flags" });
  }
  try {
    return ok({ path: path.value ?? "factory", scope, entropy: newEntropy(random), source: "fresh" });
  } catch (error) {
    return err(invalid(`Couldn't draw salt entropy: ${errorMessage(error)}`));
  }
}

/** The line printed when entropy was drawn fresh, so the same address can be predicted again. */
export function freshEntropyNote(settings: DeploySettings): string | null {
  if (settings.source !== "fresh") return null;
  return `Drew new salt entropy ${settings.entropy} (scope ${settings.scope}). Pass --entropy ${settings.entropy} --scope ${settings.scope} to use it again.`;
}

export type Prediction = { chainId: number; path: DeployPath; scope: Scope; entropy: Hex; from: Address; salt: Hex; address: Address };

/**
 * The diamond's address (spec L286, L858): CreateX's derivation on that path; on the factory path the chain's
 * own factory when the catalog lists one, else the release factory. The same rule as the app's prediction,
 * C5c's `buildDiamondDeploy` and C7c's `safeBatchTarget`.
 */
export function predictDiamond(catalog: Catalog, from: Address, chainId: number, settings: DeploySettings): Result<Prediction, Failure> {
  try {
    const salt = buildSalt(from, settings.scope, settings.entropy);
    let address: Address;
    if (settings.path === "createx") {
      address = createxPredict({ from, salt, chainId });
    } else {
      const own = catalog.chains.find((entry) => entry.chainId === chainId)?.factory;
      address = factoryPredict({
        factory: toChecksum(own?.address ?? catalog.factory.address),
        proxyInitCodeHash: own?.proxyInitCodeHash ?? catalog.proxy.initCodeHash,
        from,
        salt,
      });
    }
    return ok({ chainId, path: settings.path, scope: settings.scope, entropy: settings.entropy, from, salt, address: toChecksum(address) });
  } catch (error) {
    return err(invalid(errorMessage(error)));
  }
}

export type ContextInput = {
  project?: Pick<Project, "predicted">;
  deployments: readonly Deployment[];
  /** Authority paths from the file, minus the ones confirmed with `--confirm`. */
  unconfirmed: readonly string[];
  prediction?: Prediction;
  chain?: ChainState;
  chainName: (chainId: number) => string;
};

/** The analysis context, as S1 builds it for the open document (spec L268-L272). */
export function buildContext(input: ContextInput): AnalysisContext {
  const { project, deployments, unconfirmed, prediction, chain, chainName } = input;
  const ctx: AnalysisContext = { known: [], unconfirmed: [] };
  if (prediction !== undefined) {
    ctx.deploy = { chainId: prediction.chainId, path: prediction.path, from: prediction.from, salt: prediction.salt };
    ctx.refs = { self: prediction.address, deployer: prediction.from };
  }
  type KnownFrom = NonNullable<AnalysisContext["knownFrom"]>;
  const known: Address[] = [];
  const knownFrom: KnownFrom = {};
  const add = (address: Address, from: KnownFrom[string]): void => {
    const key = address.toLowerCase();
    if (!knownFrom[key]) known.push(toChecksum(address));
    if (!knownFrom[key] || from.source === "deployment") knownFrom[key] = from;
  };
  for (const p of project?.predicted ?? []) {
    // AUTH-02 is about addresses this diamond had before, so the current prediction isn't one of them.
    if (prediction !== undefined && sameAddress(p.address, prediction.address)) continue;
    add(p.address, { source: "prediction", chainId: p.chainId, chain: chainName(p.chainId) });
  }
  for (const d of deployments) add(d.address, { source: "deployment", chainId: d.chainId, chain: chainName(d.chainId) });
  if (known.length > 0) {
    ctx.known = known;
    ctx.knownFrom = knownFrom;
  }
  const paths = [...new Set(unconfirmed)].sort();
  if (paths.length > 0) {
    ctx.unconfirmed = paths;
    ctx.unconfirmedFrom = Object.fromEntries(paths.map((path) => [path, "file" as const]));
  }
  if (chain !== undefined) ctx.chain = chain;
  return ctx;
}
