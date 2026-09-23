import { decodeAbiParameters, toFunctionSelector } from "viem";
import type { DecodeRevertFn } from "../model/api";
import type { Catalog, InitSpec } from "../model/catalog";
import type { DecodedRevert, RevertContext } from "../model/chain";
import { isAddress, sameAddress, toChecksum, toLowerHex, type Address, type Hex, type Hex4 } from "../model/hex";
import { canonicalType, formatValue, knowledgeOf, type Knowledge, type Param } from "./args";
import { BUILTIN_ERRORS, KNOWN_ERRORS, PANIC_REASONS, SELECTORS } from "./known";

/** One error as some module declares it. */
type Declared = { module: string; name: string; inputs: readonly Param[]; signature: string };

type Kind = "facet" | "init" | "infra";

/** Where the modules come from: which names are facets, which init contracts. */
type Scope = {
  catalog: Catalog;
  context: RevertContext;
  knowledge: Knowledge;
  /** Selector → every module that declares it, in module order, one entry per module. */
  index: Map<Hex4, Declared[]>;
  kind: (module: string) => Kind;
};

/** Unwrapping stops here; nested CreateX-in-CreateX data this deep is malformed. */
const MAX_DEPTH = 6;

/** Infrastructure first, then facets and init contracts in catalog order, then any other shard, then Initializable. */
function moduleOrder(catalog: Catalog, details: RevertContext["details"]): string[] {
  const order = ["Lattice", "LatticeRegistry", "LatticeFactory", "CreateX", "MultiInit"];
  for (const facet of catalog.facets) order.push(facet.name);
  for (const init of catalog.inits) order.push(init.contract, init.name);
  for (const library of catalog.libraries ?? []) order.push(library.name);
  order.push(...Object.keys(details).sort());
  order.push("Initializable");
  return [...new Set(order)];
}

function signatureOf(name: string, inputs: readonly Param[]): string {
  return `${name}(${inputs.map(canonicalType).join(",")})`;
}

function buildScope(catalog: Catalog, context: RevertContext): Scope {
  const facets = new Set(catalog.facets.map((facet) => facet.name));
  const inits = new Set(catalog.inits.flatMap((init) => [init.contract, init.name]));
  const index = new Map<Hex4, Declared[]>();
  for (const module of moduleOrder(catalog, context.details)) {
    const items = [...(KNOWN_ERRORS[module] ?? []), ...(context.details[module]?.abi ?? [])];
    for (const item of items) {
      if (item.type !== "error") continue;
      const inputs = item.inputs as readonly Param[];
      const signature = signatureOf(item.name, inputs);
      const selector = toFunctionSelector(signature);
      const list = index.get(selector) ?? [];
      if (!list.some((entry) => entry.module === module)) list.push({ module, name: item.name, inputs, signature });
      index.set(selector, list);
    }
  }
  return {
    catalog,
    context,
    knowledge: knowledgeOf(catalog),
    index,
    kind: (module) => (facets.has(module) ? "facet" : inits.has(module) ? "init" : "infra"),
  };
}

/**
 * The modules a revert is attributed to (spec L75): placed facets are preferred when several declare the error
 * (with the infrastructure that can raise it during a deploy), and a module's own error wins over an init
 * contract that merely raises it through the module's library. What's left is every plausible module, never a
 * guess among them.
 */
function attribute(scope: Scope, declared: readonly Declared[]): string[] {
  let modules = declared.map((entry) => entry.module);
  if (modules.length > 1 && scope.context.placed) {
    const placed = new Set(scope.context.placed);
    const narrowed = modules.filter((module) => scope.kind(module) === "infra" || placed.has(module));
    if (narrowed.some((module) => placed.has(module))) modules = narrowed;
  }
  if (modules.length > 1 && modules.some((module) => scope.kind(module) === "facet")) {
    modules = modules.filter((module) => scope.kind(module) !== "init");
  }
  return modules;
}

function initSpec(catalog: Catalog, name: string | undefined): InitSpec | undefined {
  return name === undefined ? undefined : catalog.inits.find((init) => init.name === name || init.contract === name);
}

/**
 * The init step a module's error came from (MultiInit bubbles a step's revert up raw, with no index): the one
 * step whose init contract declares the error or initializes one of the declaring modules. Several matching
 * steps, or none, give no target. An init of one call (a bundle, or a single step encoded as a direct call) is
 * that call.
 */
function stepTarget(scope: Scope, modules: readonly string[]): Address | undefined {
  const steps = scope.context.init?.steps ?? [];
  // One call (a bundle, or a single step encoded as a direct call): whatever the init raised, it raised there.
  const [single] = steps;
  if (steps.length === 1 && single?.target !== undefined && isAddress(single.target.toLowerCase())) return toChecksum(single.target);
  const wanted = new Set(modules);
  const targets = new Set<string>();
  for (const step of steps) {
    if (step.target === undefined) continue;
    const spec = initSpec(scope.catalog, step.spec);
    const declares = spec !== undefined && (wanted.has(spec.contract) || wanted.has(spec.name));
    const initializes = spec?.initializes.some((entry) => wanted.has(entry.module)) ?? false;
    if (declares || initializes) targets.add(step.target.toLowerCase());
  }
  const [only] = targets;
  return targets.size === 1 && only !== undefined && isAddress(only) ? toChecksum(only) : undefined;
}

/** The init contract (or other shared contract) deployed at `address`, by the decoded init first, then the catalog. */
function contractAt(scope: Scope, address: string): string | undefined {
  const step = scope.context.init?.steps.find((entry) => entry.target !== undefined && sameAddress(entry.target, address));
  const fromStep = initSpec(scope.catalog, step?.spec);
  if (fromStep) return fromStep.contract;
  const init = scope.catalog.inits.find((entry) => entry.release && sameAddress(entry.release.address, address));
  if (init) return init.contract;
  const facet = scope.catalog.facets.find((entry) => sameAddress(entry.release.address, address));
  if (facet) return facet.name;
  if (sameAddress(scope.catalog.registry.address, address)) return "LatticeRegistry";
  if (sameAddress(scope.catalog.factory.address, address)) return "LatticeFactory";
  return undefined;
}

/** The init function `calldata` calls, as "ERC20Init.init(string,string)", when the catalog knows its selector. */
function callName(scope: Scope, contract: string | undefined, calldata: string): string | undefined {
  if (calldata.length < 10) return undefined;
  const selector = calldata.slice(0, 10).toLowerCase();
  const matches = scope.catalog.inits.filter((init) => toFunctionSelector(init.fn) === selector);
  const spec = matches.find((init) => init.contract === contract) ?? (matches.length === 1 ? matches[0] : undefined);
  return spec ? `${spec.contract}.${spec.fn}` : undefined;
}

type Decoded = Omit<DecodedRevert, "raw" | "wrappers">;

function unknownError(data: Hex): Decoded {
  return { module: null, shared: [], error: data.length >= 10 ? data.slice(0, 10) : data, args: [] };
}

function emptyRevert(hint: string, extra: Pick<Decoded, "module" | "target"> = { module: null }): Decoded {
  return { shared: [], error: "", args: [], hint, ...extra };
}

function decodeArgs(scope: Scope, declared: Declared, data: Hex): { values: readonly unknown[]; args: Decoded["args"] } | null {
  try {
    const values = decodeAbiParameters(declared.inputs as never, `0x${data.slice(10)}`) as readonly unknown[];
    const args = declared.inputs.map((param, index) => ({
      name: param.name ?? "",
      type: canonicalType(param),
      value: formatValue(param, values[index], scope.knowledge),
    }));
    return { values, args };
  } catch {
    return null;
  }
}

function decodeBuiltin(scope: Scope, data: Hex, selector: string): Decoded | null {
  const item = BUILTIN_ERRORS.find((entry) => entry.type === "error" && toFunctionSelector(signatureOf(entry.name, entry.inputs)) === selector);
  if (!item || item.type !== "error") return null;
  const declared: Declared = { module: "", name: item.name, inputs: item.inputs, signature: signatureOf(item.name, item.inputs) };
  const decoded = decodeArgs(scope, declared, data);
  if (!decoded) return { module: null, shared: [], error: item.name, signature: declared.signature, args: [] };
  const args = decoded.args.map((arg) => {
    if (selector !== SELECTORS.panic) return arg;
    const code = `0x${BigInt(arg.value).toString(16).padStart(2, "0")}`;
    const reason = PANIC_REASONS[code];
    return { ...arg, value: reason ? `${code} (${reason})` : code };
  });
  return { module: null, shared: [], error: item.name, signature: declared.signature, args };
}

function addressArg(values: readonly unknown[], index: number): Address | undefined {
  const value = values[index];
  return typeof value === "string" && isAddress(value.toLowerCase()) ? toChecksum(value) : undefined;
}

/** Which of Lattice (cut, init target) or MultiInit (a step) found no code at `address`. */
function noCodeModule(scope: Scope, address: string): string | undefined {
  const init = scope.context.init;
  const steps = init?.steps ?? [];
  if (init?.kind === "steps" && steps.some((step) => step.target !== undefined && sameAddress(step.target, address))) return "MultiInit";
  const multiInit = scope.catalog.inits.find((entry) => entry.contract === "MultiInit")?.release?.address;
  if (multiInit !== undefined && sameAddress(multiInit, address)) return "Lattice";
  if (init?.kind === "bundle" && steps.some((step) => step.target !== undefined && sameAddress(step.target, address))) return "Lattice";
  if (scope.catalog.facets.some((facet) => sameAddress(facet.release.address, address))) return "Lattice";
  return undefined;
}

function decodeData(scope: Scope, data: Hex, wrappers: string[], depth: number): Decoded {
  if (data.length <= 2) {
    return emptyRevert("The revert carries no reason: check the target address for code, then replay the call with `eth_call` to see where it failed.");
  }
  if (data.length < 10 || depth > MAX_DEPTH) return unknownError(data);
  const selector = data.slice(0, 10) as Hex4;
  const builtin = decodeBuiltin(scope, data, selector);
  if (builtin) return builtin;
  const declared = scope.index.get(selector);
  const first = declared?.[0];
  if (!declared || !first) return unknownError(data);
  const decoded = decodeArgs(scope, first, data);
  if (!decoded) {
    const modules = attribute(scope, declared);
    return { module: modules[0] ?? null, shared: modules.length > 1 ? modules : [], error: first.name, signature: first.signature, args: [] };
  }
  const { values, args } = decoded;

  switch (selector) {
    case SELECTORS.failedContractInitialisation: {
      // CreateX wraps the diamond's own revert: decode the inner bytes.
      wrappers.push(first.name);
      const inner = typeof values[1] === "string" ? toLowerHex(values[1] as Hex) : "0x";
      if (inner.length <= 2) {
        return emptyRevert("The diamond's initialize reverted without a reason: replay the deploy with `eth_call` to see where it failed.", { module: null });
      }
      return decodeData(scope, inner, wrappers, depth + 1);
    }
    case SELECTORS.failedContractCreation: {
      const emitter = addressArg(values, 0);
      return {
        module: "CreateX", shared: [], error: first.name, signature: first.signature, args,
        ...(emitter ? { target: emitter } : {}),
        hint: "CreateX gives no reason when creation fails: check the salt's addresses for code, then replay the creation with `eth_call`.",
      };
    }
    case SELECTORS.initializeDiamondCutReverted:
    case SELECTORS.initializeReverted: {
      // The init (DiamondLib) or a MultiInit step reverted with no data; the bytes are its calldata, not a reason.
      wrappers.push(first.name);
      const target = addressArg(values, 0);
      const contract = target ? contractAt(scope, target) : undefined;
      const calldata = typeof values[1] === "string" ? values[1] : "0x";
      const call = callName(scope, contract, calldata);
      const who = call ? `\`${call}\`` : (contract ?? "The init call");
      return emptyRevert(`${who} reverted without a reason: replay it with \`eth_call\` to see where it failed.`, {
        module: contract ?? null,
        ...(target ? { target } : {}),
      });
    }
    case SELECTORS.noBytecodeAtAddress: {
      const address = addressArg(values, 0);
      const module = address ? noCodeModule(scope, address) : undefined;
      const modules = module ? [module] : attribute(scope, declared);
      const name = address ? contractAt(scope, address) : undefined;
      return {
        module: modules[0] ?? null, shared: modules.length > 1 ? modules : [], error: first.name, signature: first.signature, args,
        ...(address ? { target: address } : {}),
        hint: `${name ?? "The contract at this address"} has no code on this chain: deploy the missing contracts first.`,
      };
    }
    default:
      break;
  }

  const modules = attribute(scope, declared);
  const target = modules.some((module) => scope.kind(module) !== "infra") ? stepTarget(scope, declared.map((entry) => entry.module)) : undefined;
  const hint =
    selector === SELECTORS.invalidInitialization
      ? "Initialization was refused: this diamond is already initialized, or an init ran twice."
      : selector === SELECTORS.notInitializing
        ? "A module's init ran outside the diamond's `initialize` call."
        : undefined;
  return {
    module: modules[0] ?? null,
    shared: modules.length > 1 ? modules : [],
    error: first.name,
    signature: first.signature,
    args,
    ...(target ? { target } : {}),
    ...(hint ? { hint } : {}),
  };
}

/**
 * Decodes revert data to the module and error a person can act on (spec L75, L727, Flow 14).
 *
 * - Errors are looked up in Studio's own list (CreateX, MultiInit, DiamondLib's under "Lattice", Initializable's
 *   `InvalidInitialization()` and `NotInitializing()`), then in every shard in `context.details`, plus Solidity's
 *   `Error(string)` and `Panic(uint256)`.
 * - CreateX's `FailedContractInitialisation(address,bytes)` is unwrapped and its inner bytes decoded;
 *   `FailedContractCreation(address)` carries no reason, so it comes back with a `hint`.
 * - DiamondLib's `InitializeDiamondCutReverted` and MultiInit's `InitializeReverted` mean the init (or a step)
 *   reverted with no data: they're recorded as wrappers, `error` is "" and `hint` names the call and what to do.
 * - A revert inside a bundle or MultiInit names the module whose error it is. When several modules declare it,
 *   `shared` lists them all rather than guessing; `target` is the init step only when exactly one step could have
 *   raised it (`context.init`).
 * - Arguments read with catalog knowledge: name hashes as `lattice.<Name>`, packed versions as "0.4.0".
 *
 * `error` is "" when the revert carried no data, and the 4-byte selector when no known ABI declares it (`module`
 * null). Never throws.
 */
export const decodeRevert: DecodeRevertFn = (data, catalog, context) => {
  const raw = toLowerHex(data);
  const wrappers: string[] = [];
  const decoded = decodeData(buildScope(catalog, context), raw, wrappers, 0);
  return { ...decoded, wrappers, raw };
};
