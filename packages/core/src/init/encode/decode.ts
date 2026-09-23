/**
 * Init calldata back into named arguments for the deploy review (spec L567). MultiInit bubbles a failed
 * step's revert data raw, with no step index, so every MultiInit step keeps its target for C6 to attribute
 * a revert. A bundle's calldata carries no target: the diamond's `initialize` holds it.
 */
import { type AbiFunction, type AbiParameter, decodeFunctionData } from "viem";
import type { DecodeInitFn } from "../../model/api";
import type { Catalog, InitSpec } from "../../model/catalog";
import type { Refs } from "../../model/chain";
import { type Address, type Hex, isHexAnyCase, sameAddress, toChecksum } from "../../model/hex";
import type { DecodedInitStep } from "../../model/init";
import type { Arg, RefName } from "../../model/recipe";
import { err, ok, type Result } from "../../model/result";
import { fromAbiValue, MULTI_INIT_FN, MULTI_INIT_SELECTOR, specAbi, specSelector } from "./abi";

type Match = { spec: InitSpec; abi: AbiFunction };

function matches(catalog: Catalog, selector: Hex, keep: (spec: InitSpec) => boolean): Match[] {
  const found: Match[] = [];
  for (const spec of catalog.inits) {
    if (!keep(spec)) continue;
    const own = specSelector(spec);
    if (own.ok && own.value === selector) found.push({ spec, abi: specAbi(spec) });
  }
  return found;
}

/** Marks address arguments that equal a resolved reference; text that happens to spell the address isn't one. */
function markRefs(param: AbiParameter, value: Arg, path: string, refs: Refs, out: Record<string, RefName>): void {
  const array = /^(.*)\[\d*\]$/.exec(param.type);
  if (array && Array.isArray(value)) {
    const element = { ...param, type: array[1] ?? "" } as AbiParameter;
    for (const [i, item] of value.entries()) markRefs(element, item, `${path}[${i}]`, refs, out);
  } else if (param.type === "tuple" && "components" in param && typeof value === "object" && !Array.isArray(value)) {
    for (const component of param.components) {
      const name = component.name ?? "";
      const item = (value as Record<string, Arg>)[name];
      if (item !== undefined) markRefs(component, item, `${path}.${name}`, refs, out);
    }
  } else if (param.type === "address" && typeof value === "string") {
    if (refs.self !== undefined && sameAddress(value, refs.self)) out[path] = "self";
    else if (refs.deployer !== undefined && sameAddress(value, refs.deployer)) out[path] = "deployer";
  }
}

/** Decodes one call against `match` (or leaves it opaque with no match); `target` is kept when known. */
function decodeCall(data: Hex, match: Match | undefined, refs: Refs, target?: Address): Result<DecodedInitStep, string> {
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  const base = target === undefined ? {} : { target: toChecksum(target) };
  if (match === undefined) return ok({ ...base, fn: selector, args: {}, fromRef: {} });
  let values: readonly unknown[];
  try {
    values = decodeFunctionData({ abi: [match.abi], data }).args ?? [];
  } catch (error) {
    return err(`${match.spec.name}'s data doesn't decode: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
  const args: Record<string, Arg> = {};
  const fromRef: Record<string, RefName> = {};
  for (const [i, param] of match.abi.inputs.entries()) {
    const name = param.name ?? String(i);
    const value = fromAbiValue(param, values[i]);
    args[name] = value;
    markRefs(param, value, name, refs, fromRef);
  }
  return ok({ ...base, spec: match.spec.name, fn: match.spec.fn, args, fromRef });
}

/**
 * "0x" → none. MultiInit's `multiInit(address[],bytes[])` → one step per entry, each matched to its spec by
 * target address and selector (DiamondIntrospectionInit's two entry points share an address; OwnableInit and
 * AccessControlInit share `init(address)`). Anything else → a bundle, matched by selector among bundle specs.
 * Steps the catalog doesn't know keep their target and selector with no arguments. `fromRef` keys are
 * argument paths within the step ("admin", "p.asset").
 */
export const decodeInit: DecodeInitFn = (data, catalog, refs = {}) => {
  if (!isHexAnyCase(data)) return err("Init data isn't hex bytes.");
  const hex = data.toLowerCase() as Hex;
  if (hex === "0x") return ok({ kind: "none", steps: [] });
  if (hex.length < 10) return err("Init data is shorter than a function selector.");
  const selector = hex.slice(0, 10) as Hex;

  if (selector === MULTI_INIT_SELECTOR) {
    let targets: readonly Address[];
    let datas: readonly Hex[];
    try {
      const decoded = decodeFunctionData({ abi: [MULTI_INIT_FN], data: hex }).args ?? [];
      targets = decoded[0] as readonly Address[];
      datas = decoded[1] as readonly Hex[];
    } catch (error) {
      return err(`MultiInit data doesn't decode: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
    if (targets.length !== datas.length) {
      return err(`MultiInit has ${targets.length} targets and ${datas.length} calls; they must match.`);
    }
    const steps: DecodedInitStep[] = [];
    for (const [i, target] of targets.entries()) {
      const call = (datas[i] ?? "0x").toLowerCase() as Hex;
      const inner = call.slice(0, 10) as Hex;
      const [match] = matches(catalog, inner, (spec) => spec.release !== undefined && sameAddress(spec.release.address, target));
      const step = decodeCall(call, match, refs, target);
      if (!step.ok) return err(`Step ${i + 1}: ${step.error}`);
      steps.push(step.value);
    }
    return ok({ kind: "steps", steps });
  }

  const bundles = matches(catalog, selector, (spec) => spec.kind === "bundle");
  const [match] = bundles;
  if (match === undefined) return err(`Init data calls ${selector}, which matches no bundle init in this catalog.`);
  const step = decodeCall(hex, match, refs);
  if (!step.ok) return step;
  return ok({ kind: "bundle", steps: [step.value] });
};
