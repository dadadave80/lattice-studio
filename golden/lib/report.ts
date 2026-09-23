// Pure parts of the golden routing harness: parse the harness's STUDIO_GOLDEN log lines, apply each recipe's
// Add/Replace/Remove sequence to an empty selector map the way DiamondLib does, and build the routing file.

export const TAG = "STUDIO_GOLDEN";

export type CutAction = "Add" | "Replace" | "Remove";
export type InitKind = "direct" | "MultiInit" | "none";

/** A contract the harness saw, named by matching its runtime codehash. `name` is "?" when nothing matched. */
export type Contract = { address: string; codehash: string; name: string; artifact: string };

export type Cut = { index: number; action: CutAction; facet: Contract; selectors: string[] };
export type InitStep = { index: number; contract: Contract; selector: string };

/** What one recipe's `buildCuts(...)` returned, as the harness reported it. */
export type RecipeReport = {
  recipe: string;
  script: string;
  buildCuts: string;
  cuts: Cut[];
  init: { kind: InitKind; contract: Contract | null; steps: InitStep[] };
};

/** `golden/expected/<Recipe>.routing.json`. GT1b compares Studio's plan with these; README.md documents it. */
export type RoutingFile = {
  recipe: string;
  script: string;
  buildCuts: string;
  /** Facets that serve at least one selector after the whole sequence, in the order the script first cuts them. */
  facets: string[];
  /** Selector (lowercase 0x + 8 hex) to the facet that serves it, sorted by selector. */
  routing: Record<string, string>;
  /** Selector to its function signature, from the serving facet's ABI; 0x00000000 is Receive's `receive()`. */
  signatures: Record<string, string>;
  /** The init the diamond runs: one direct call, MultiInit's steps in call order, or none. */
  init: { kind: InitKind; steps: { init: string; selector: string; signature: string }[] };
};

/** Looks up a function signature in a contract artifact's ABI; undefined when the ABI has no such selector. */
export type SignatureLookup = (artifact: string, selector: string) => string | undefined;

export class HarnessError extends Error {
  override name = "HarnessError";
}

const SELECTOR = /^0x[0-9a-f]{8}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO = "0x0000000000000000000000000000000000000000";

/** Groups every STUDIO_GOLDEN line into one report per recipe. Other log lines are ignored. */
export function parseReports(lines: readonly string[]): RecipeReport[] {
  const reports: RecipeReport[] = [];
  let current: RecipeReport | undefined;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith(`${TAG} `)) continue;
    const [, kind, ...rest] = line.split(/\s+/);
    if (kind === "recipe") {
      const [recipe, script, buildCuts] = need(rest, 3, line);
      current = { recipe, script, buildCuts, cuts: [], init: { kind: "none", contract: null, steps: [] } };
      reports.push(current);
      continue;
    }
    if (!current) throw new HarnessError(`"${line}" came before any recipe line.`);
    if (kind === "cut") {
      const [index, action, address, codehash, name, artifact, sels] = need(rest, 7, line);
      if (action !== "Add" && action !== "Replace" && action !== "Remove") {
        throw new HarnessError(`Unknown cut action "${action}" in "${line}".`);
      }
      const selectors = sels === "-" ? [] : sels.split(",");
      for (const s of selectors) {
        if (!SELECTOR.test(s)) throw new HarnessError(`"${s}" isn't a 4-byte selector in "${line}".`);
      }
      current.cuts.push({ index: toIndex(index, line), action, facet: contract(address, codehash, name, artifact, line), selectors });
    } else if (kind === "init") {
      const [via, address, codehash, name, artifact] = need(rest, 5, line);
      if (via !== "direct" && via !== "MultiInit" && via !== "none") {
        throw new HarnessError(`Unknown init kind "${via}" in "${line}".`);
      }
      current.init = { kind: via, contract: via === "none" ? null : contract(address, codehash, name, artifact, line), steps: [] };
    } else if (kind === "step") {
      const [index, address, codehash, name, artifact, selector] = need(rest, 6, line);
      if (!SELECTOR.test(selector)) throw new HarnessError(`Init step without a function selector in "${line}".`);
      current.init.steps.push({ index: toIndex(index, line), contract: contract(address, codehash, name, artifact, line), selector });
    } else {
      throw new HarnessError(`Unknown record "${kind ?? ""}" in "${line}".`);
    }
  }
  return reports;
}

/**
 * Applies a cut sequence to an empty selector map with DiamondLib's rules and returns each selector's facet,
 * plus the facets in the order they were first cut. Throws HarnessError where the diamond would revert.
 */
export function applyCuts(cuts: readonly Cut[]): { routing: Map<string, Contract>; order: string[] } {
  const routing = new Map<string, Contract>();
  const order: string[] = [];
  for (const cut of cuts) {
    const where = `cut ${cut.index} (${cut.action} ${cut.facet.name})`;
    if (cut.selectors.length === 0) throw new HarnessError(`${where} has no selectors.`);
    const zero = cut.facet.address.toLowerCase() === ZERO;
    if (cut.action === "Remove") {
      if (!zero) throw new HarnessError(`${where}: a Remove cut must use the zero address.`);
    } else {
      if (zero) throw new HarnessError(`${where}: an ${cut.action} cut needs a facet address.`);
      if (cut.facet.name === "?") {
        throw new HarnessError(
          `${where}: no FacetInventory facet has codehash ${cut.facet.codehash} (at ${cut.facet.address}).`,
        );
      }
      if (!order.includes(cut.facet.name)) order.push(cut.facet.name);
    }
    for (const selector of cut.selectors) {
      const owner = routing.get(selector);
      if (cut.action === "Add") {
        if (owner) throw new HarnessError(`${where}: ${selector} is already served by ${owner.name}.`);
        routing.set(selector, cut.facet);
      } else if (cut.action === "Replace") {
        if (!owner) throw new HarnessError(`${where}: ${selector} isn't in the diamond yet.`);
        if (owner.address.toLowerCase() === cut.facet.address.toLowerCase()) {
          throw new HarnessError(`${where}: ${selector} is already served by that facet.`);
        }
        routing.set(selector, cut.facet);
      } else {
        if (!owner) throw new HarnessError(`${where}: ${selector} isn't in the diamond.`);
        routing.delete(selector);
      }
    }
  }
  return { routing, order };
}

/** Normalizes one report into the routing file that `--update` writes and a plain run compares. */
export function buildRoutingFile(report: RecipeReport, signatureOf: SignatureLookup): RoutingFile {
  const { routing, order } = applyCuts(report.cuts);
  const selectors = [...routing.keys()].sort();
  const owners: Record<string, string> = {};
  const signatures: Record<string, string> = {};
  for (const selector of selectors) {
    const facet = routing.get(selector)!;
    owners[selector] = facet.name;
    signatures[selector] = signature(signatureOf, facet, selector);
  }
  const serving = new Set(Object.values(owners));

  if (report.init.kind !== "none" && report.init.contract?.name === "?") {
    throw new HarnessError(
      `The init at ${report.init.contract.address} (codehash ${report.init.contract.codehash}) matches no known init: add its artifact to _initArtifacts() in golden/harness/StudioGoldenRouting.t.sol.`,
    );
  }
  if (report.init.kind !== "none" && report.init.steps.length === 0) {
    throw new HarnessError(`${report.recipe}'s ${report.init.kind} init has no steps.`);
  }
  const steps = report.init.steps.map((step) => {
    if (step.contract.name === "?") {
      throw new HarnessError(
        `Init step ${step.index} at ${step.contract.address} (codehash ${step.contract.codehash}) matches no known init: add its artifact to _initArtifacts() in golden/harness/StudioGoldenRouting.t.sol.`,
      );
    }
    return { init: step.contract.name, selector: step.selector, signature: signature(signatureOf, step.contract, step.selector) };
  });

  return {
    recipe: report.recipe,
    script: report.script,
    buildCuts: report.buildCuts,
    facets: order.filter((name) => serving.has(name)),
    routing: owners,
    signatures,
    init: { kind: report.init.kind, steps },
  };
}

/** The exact text `--update` writes: two-space JSON with a trailing newline. */
export function serialize(file: RoutingFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

function signature(lookup: SignatureLookup, c: Contract, selector: string): string {
  const found = lookup(c.artifact, selector);
  if (found) return found;
  // Receive exports the zero selector: the empty-calldata msg.sig that reaches its receive().
  if (selector === "0x00000000") return "receive()";
  throw new HarnessError(`${c.name} (${c.artifact}) has no function with selector ${selector} in its ABI.`);
}

function contract(address: string, codehash: string, name: string, artifact: string, line: string): Contract {
  if (!ADDRESS.test(address)) throw new HarnessError(`"${address}" isn't an address in "${line}".`);
  return { address, codehash, name, artifact };
}

function toIndex(value: string, line: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new HarnessError(`"${value}" isn't an index in "${line}".`);
  return n;
}

function need<const N extends number>(parts: string[], n: N, line: string): Tuple<N> {
  if (parts.length !== n) throw new HarnessError(`Expected ${n} fields after the record kind in "${line}".`);
  return parts as unknown as Tuple<N>;
}

type Tuple<N extends number, T extends string[] = []> = T["length"] extends N ? T : Tuple<N, [...T, string]>;
