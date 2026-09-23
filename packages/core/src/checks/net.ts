import { createxPredict, factoryPredict } from "../address/diamond";
import type { Check, CheckInput } from "../model/analysis";
import type { Catalog, InitSpec, SharedContract } from "../model/catalog";
import type { ChainState, DeployContext } from "../model/chain";
import type { Address, Hex } from "../model/hex";
import { problem, problemId, type Anchor, type Problem } from "../model/problems";
import type { Recipe } from "../model/recipe";
import { planInit } from "../init/plan/plan";
import { buildPlan } from "../plan/build";

/**
 * CreateX's runtime codehash, the same on every chain where the canonical CreateX is deployed
 * (github.com/pcaversaccio/createx, "keccak256 of the runtime bytecode"). The spec shows it as 0xbd8a7ea8…b53f
 * (NET-01, spec L335).
 */
export const CREATEX_CODEHASH: Hex = "0xbd8a7ea8cfca7b4e5f5041d7d4b17bc317c5ce42cfbc42066a00cf26b43eb53f";

/** NET-06 warns from this share of the chain's per-transaction cap (spec L340). */
const WARN_NUMERATOR = 4n;
const WARN_DENOMINATOR = 5n;

/** A shared contract the deploy needs on the chain, under the name `ChainState.shared` keys it by. */
type Needed = { name: string; address: Address; codehash: Hex; version: string; facet?: string };

function sameHex(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function fromRelease(name: string, release: SharedContract, facet?: string): Needed {
  return { name, address: release.address, codehash: release.codehash, version: release.version, ...(facet ? { facet } : {}) };
}

/** LatticeRegistry and the factory this chain uses: its own (`ChainRelease.factory`) or the canonical one. */
function coreContracts(catalog: Catalog, chainId: number): Needed[] {
  const own = catalog.chains.find((entry) => entry.chainId === chainId)?.factory;
  const factory = own
    ? { name: "LatticeFactory", address: own.address, codehash: own.codehash, version: catalog.factory.version }
    : fromRelease("LatticeFactory", catalog.factory);
  return [fromRelease("LatticeRegistry", catalog.registry), factory];
}

function findInit(catalog: Catalog, name: string): InitSpec | undefined {
  return catalog.inits.find((init) => init.name === name);
}

/**
 * The init contracts the recipe calls, from C4a's plan (the automatic ERC-165 step added or skipped, spec R11):
 * a bundle's contract; the steps' contracts, plus MultiInit only when two or more calls remain (one call is
 * encoded as a direct call, contracts §3.1 init encoding ruling). Inits with constructor arguments are deployed
 * per use, not shared, so they have no release to check.
 */
function initContracts(recipe: Recipe, catalog: Catalog): InitSpec[] {
  const plan = planInit(recipe, catalog);
  const specs = plan.steps.map((step) => findInit(catalog, step.spec)).filter((spec) => spec !== undefined);
  const multiInit = plan.kind === "steps" && plan.steps.length >= 2 ? catalog.inits.find((spec) => spec.contract === "MultiInit") : undefined;
  return [multiInit, ...specs].filter((spec) => spec !== undefined);
}

/** A shared contract by name, for `dependsOn`: libraries first, then any other shared contract. */
function sharedByName(catalog: Catalog, name: string): SharedContract | undefined {
  return (
    catalog.libraries?.find((library) => library.name === name)?.release ??
    catalog.facets.find((facet) => facet.name === name)?.release ??
    catalog.inits.find((init) => init.contract === name)?.release
  );
}

/**
 * Every shared contract the deploy needs besides LatticeRegistry and LatticeFactory: the libraries they link,
 * the facets the plan cuts (one Add per facet that routes a selector) and the init contracts, once each.
 */
function neededContracts(input: CheckInput): Needed[] {
  const { recipe, catalog, routing } = input;
  const own: { need: Needed; release: SharedContract }[] = [];
  for (const entry of buildPlan(recipe, catalog, routing).entries) {
    const facet = catalog.facets.find((candidate) => candidate.name === entry.facet);
    if (facet) own.push({ need: fromRelease(facet.name, facet.release, facet.name), release: facet.release });
  }
  for (const spec of initContracts(recipe, catalog)) {
    if (spec.release) own.push({ need: fromRelease(spec.contract, spec.release), release: spec.release });
  }
  const libraries: Needed[] = [];
  for (const { release } of own) {
    for (const name of release.dependsOn ?? []) {
      const dependency = sharedByName(catalog, name);
      if (dependency) libraries.push(fromRelease(name, dependency));
    }
  }
  const seen = new Set<string>();
  return [...libraries, ...own.map((entry) => entry.need)].filter((need) => (seen.has(need.name) ? false : (seen.add(need.name), true)));
}

/** `present: false` is missing; no entry means the chain module didn't probe it, so nothing is claimed. */
function probeOf(chain: ChainState, name: string): ChainState["shared"][string] | undefined {
  return Object.hasOwn(chain.shared, name) ? chain.shared[name] : undefined;
}

function predictedAddress(catalog: Catalog, deploy: DeployContext): Address | undefined {
  try {
    if (deploy.path === "createx") return createxPredict({ from: deploy.from, salt: deploy.salt, chainId: deploy.chainId });
    const own = catalog.chains.find((entry) => entry.chainId === deploy.chainId)?.factory;
    return factoryPredict({
      factory: own?.address ?? catalog.factory.address,
      proxyInitCodeHash: own?.proxyInitCodeHash ?? catalog.proxy.initCodeHash,
      from: deploy.from,
      salt: deploy.salt,
    });
  } catch {
    return undefined;
  }
}

function parseGas(value: string | undefined): bigint | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  return BigInt(value);
}

/**
 * NET-01 to NET-08 (spec L335-L342, Flow 14): chain readiness from the selected chain's probes (`ctx.chain`) and
 * the deploy context (`ctx.deploy`). They run only when both are present, the chain is online and the probes are
 * for the deploy's chain (spec L302). Every problem's id is its chain id (`NET-03:11155111`); params carry the
 * chain's display name. A probe the chain module didn't make raises nothing.
 */
export const checkNet: Check = (input) => {
  const { catalog, ctx } = input;
  const chain = ctx.chain;
  const deploy = ctx.deploy;
  if (!chain || !deploy || !chain.online || chain.chainId !== deploy.chainId) return [];

  const anchor: Anchor = { kind: "chain", chainId: chain.chainId };
  const where: Anchor[] = [anchor];
  const idOf = (code: Problem["code"]): string => problemId(code, anchor);
  const problems: Problem[] = [];
  const name = chain.name;

  // NET-01: CreateX, on the CreateX path only.
  if (deploy.path === "createx" && chain.createx) {
    const { present, codehash } = chain.createx;
    if (!present) {
      problems.push(problem("NET-01", where, { chain: name, case: "missing", expected: CREATEX_CODEHASH }, fixesNet01()));
    } else if (codehash !== undefined && !sameHex(codehash, CREATEX_CODEHASH)) {
      problems.push(problem("NET-01", where, { chain: name, case: "codehash", expected: CREATEX_CODEHASH, actual: codehash }, fixesNet01()));
    }
  }

  // NET-03 and NET-04: every shared contract the deploy needs, against its probe.
  const core = deploy.path === "factory" ? coreContracts(catalog, chain.chainId) : [];
  const others = neededContracts(input);
  const missingCore = core.filter((need) => probeOf(chain, need.name)?.present === false).map((need) => need.name);
  const missing = others.filter((need) => probeOf(chain, need.name)?.present === false).map((need) => need.name);
  const drifted = [...core, ...others].find((need) => {
    const probe = probeOf(chain, need.name);
    return probe?.present === true && probe.codehash !== undefined && !sameHex(probe.codehash, need.codehash);
  });

  // NET-02: Arachnid's proxy, only when something needs deploying through it.
  if (missingCore.length + missing.length > 0) {
    const expected = catalog.deployer.codehash;
    const { present, codehash } = chain.deployer;
    if (!present) {
      problems.push(problem("NET-02", where, { chain: name, case: "missing", expected }, [{ id: "chain.focusPicker" }]));
    } else if (codehash !== undefined && !sameHex(codehash, expected)) {
      problems.push(problem("NET-02", where, { chain: name, case: "codehash", expected, actual: codehash }, [{ id: "chain.focusPicker" }]));
    }
    problems.push(
      problem("NET-03", where, { chain: name, core: missingCore, missing, total: others.length }, [
        { id: "deploy.missingContracts", args: { names: [...missingCore, ...missing] } },
      ]),
    );
  }

  if (drifted) {
    const actual = probeOf(chain, drifted.name)?.codehash ?? "0x";
    problems.push(
      problem(
        "NET-04",
        drifted.facet ? [anchor, { kind: "facet", facet: drifted.facet }] : where,
        { chain: name, name: drifted.name, version: drifted.version, address: drifted.address, expected: drifted.codehash, actual },
        [{ id: "chain.focusPicker" }],
        { id: idOf("NET-04") },
      ),
    );
  }

  // NET-05: the predicted address already has code (spec R8), worded per path by narrate.
  if (chain.predictedHasCode === true) {
    const address = predictedAddress(catalog, deploy);
    if (address) problems.push(problem("NET-05", where, { chain: name, path: deploy.path, address }, [{ id: "deploy.newSalt" }]));
  }

  // NET-06: the estimate against the chain's per-transaction cap (spec R16): a blocker over it, a warning from 80%.
  const gas = parseGas(chain.gasEstimate);
  const cap = parseGas(chain.gasCap);
  if (gas !== undefined && cap !== undefined && cap > 0n) {
    const over = gas > cap;
    if (over || gas * WARN_DENOMINATOR >= cap * WARN_NUMERATOR) {
      const share = Math.round((Number(gas) / Number(cap)) * 10_000) / 10_000;
      problems.push(
        problem("NET-06", where, { chain: name, gas: gas.toString(), cap: cap.toString(), share }, [{ id: "deploy.removeFacets" }], {
          severity: over ? "blocker" : "warning",
        }),
      );
    }
  }

  // NET-07: no eth_simulateV1.
  if (!chain.simulate) problems.push(problem("NET-07", where, { chain: name }, [{ id: "chain.useAnotherRpc" }]));

  // NET-08: whole facets the factory would check against LatticeRegistry, whose pinned version it doesn't list.
  const records = chain.registry?.records;
  if (deploy.path === "factory" && records) {
    const unlisted: string[] = [];
    for (const entry of buildPlan(input.recipe, catalog, input.routing).entries) {
      const facet = catalog.facets.find((candidate) => candidate.name === entry.facet);
      if (!facet || entry.selectors.length !== facet.selectors.length) continue;
      const key = `${facet.name}@${facet.release.version}`;
      if (!Object.hasOwn(records, key)) continue;
      const record = records[key];
      const listed = record !== null && record !== undefined && sameHex(record.facet, facet.release.address) && sameHex(record.codehash, facet.release.codehash);
      if (!listed) unlisted.push(facet.name);
    }
    if (unlisted.length > 0) {
      const id = idOf("NET-08");
      problems.push(
        problem(
          "NET-08",
          [anchor, ...unlisted.map((facet): Anchor => ({ kind: "facet", facet }))],
          { chain: name, facets: unlisted, count: unlisted.length },
          [{ id: "ack.set", args: { problemId: id } }, { id: "chain.focusPicker" }],
          { id },
        ),
      );
    }
  }

  return problems;
};

function fixesNet01(): Problem["fixes"] {
  return [{ id: "deploy.usePath", args: { path: "factory" } }, { id: "chain.focusPicker" }];
}
