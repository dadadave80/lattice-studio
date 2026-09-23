/**
 * Init calldata back into named arguments for the deploy review (spec L567). MultiInit bubbles a failed
 * step's revert data raw, with no step index, so every MultiInit step keeps its target for C6 to attribute
 * a revert. A bundle's or a single step's calldata carries no target: the diamond's `initialize` holds it.
 */
import { type AbiFunction, type AbiParameter, decodeFunctionData } from "viem";
import type { DecodeInitFn } from "../../model/api";
import type { Catalog, InitSpec } from "../../model/catalog";
import type { Refs } from "../../model/chain";
import { type Address, type Hex, isHexAnyCase, sameAddress, toChecksum } from "../../model/hex";
import type { DecodedInitStep } from "../../model/init";
import type { Arg, RefName } from "../../model/recipe";
import { err, ok, type Result } from "../../model/result";
import {
  fromAbiValue, MULTI_INIT_FN, MULTI_INIT_SELECTOR, MULTI_INIT_SPEC, specAbi, specSelector, ZERO_ADDRESS,
} from "./abi";

/** How to decode a call: the ABI, its signature, and the spec when exactly one is known. */
type Match = { spec?: InitSpec; abi: AbiFunction; fn: string };

function matches(catalog: Catalog, selector: Hex, keep: (spec: InitSpec) => boolean): Match[] {
  const found: Match[] = [];
  for (const spec of catalog.inits) {
    if (!keep(spec)) continue;
    const own = specSelector(spec);
    if (own.ok && own.value === selector) found.push({ spec, abi: specAbi(spec), fn: spec.fn });
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

function reason(error: unknown): string {
  return error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
}

/** Decodes one call against `match` (or leaves it opaque with no match); `target` is kept when known. */
function decodeCall(data: Hex, match: Match | undefined, refs: Refs, target?: Address): Result<DecodedInitStep, string> {
  const selector = data.slice(0, 10) as Hex;
  const base = target === undefined ? {} : { target: toChecksum(target) };
  if (match === undefined) return ok({ ...base, fn: selector, args: {}, fromRef: {} });
  let values: readonly unknown[];
  try {
    values = decodeFunctionData({ abi: [match.abi], data }).args ?? [];
  } catch (error) {
    return err(`${match.spec?.name ?? match.fn}'s data doesn't decode: ${reason(error)}. Check where the data came from.`);
  }
  const args: Record<string, Arg> = {};
  const fromRef: Record<string, RefName> = {};
  for (const [i, param] of match.abi.inputs.entries()) {
    const name = param.name ?? String(i);
    const value = fromAbiValue(param, values[i]);
    args[name] = value;
    markRefs(param, value, name, refs, fromRef);
  }
  return ok({ ...base, ...(match.spec === undefined ? {} : { spec: match.spec.name }), fn: match.fn, args, fromRef });
}

/**
 * A direct call to a step init carries no target, and step inits can share a selector (OwnableInit and
 * AccessControlInit are both `init(address)`). One candidate names the spec; several decode with their shared
 * parameter names, or by position when the names differ, and leave `spec` unset.
 */
function directStep(candidates: Match[]): Match | undefined {
  const [first, ...others] = candidates;
  if (first === undefined || others.length === 0) return first;
  const names = first.abi.inputs.map((input) => input.name);
  const shared = others.every((other) => other.abi.inputs.every((input, i) => input.name === names[i]));
  const inputs = shared ? first.abi.inputs : first.abi.inputs.map((input, i) => ({ ...input, name: String(i) }));
  return { abi: { ...first.abi, inputs }, fn: first.fn };
}

/**
 * "0x" → none. MultiInit's `multiInit(address[],bytes[])` → one step per entry, each matched to its spec by
 * target address and selector (DiamondIntrospectionInit's two entry points share an address; OwnableInit and
 * AccessControlInit share `init(address)`). MultiInit stops at the first zero address (MultiInit.sol:23), so
 * decoding stops there too: the steps after it never run. Any other call → a bundle when a bundle spec has
 * its selector, else one direct step (a single step encodes without MultiInit). Steps the catalog doesn't
 * know keep their target and selector with no arguments. `fromRef` keys are argument paths within the step
 * ("admin", "p.asset").
 */
export const decodeInit: DecodeInitFn = (data, catalog, refs = {}) => {
  if (!isHexAnyCase(data)) return err("Init data isn't hex bytes. Check where the data came from.");
  const hex = data.toLowerCase() as Hex;
  if (hex === "0x") return ok({ kind: "none", steps: [] });
  if (hex.length < 10) return err("Init data is shorter than a function selector. Check where the data came from.");
  const selector = hex.slice(0, 10) as Hex;

  if (selector === MULTI_INIT_SELECTOR) {
    let targets: readonly Address[];
    let datas: readonly Hex[];
    try {
      const decoded = decodeFunctionData({ abi: [MULTI_INIT_FN], data: hex }).args ?? [];
      targets = decoded[0] as readonly Address[];
      datas = decoded[1] as readonly Hex[];
    } catch (error) {
      return err(`MultiInit data doesn't decode: ${reason(error)}. Check where the data came from.`);
    }
    if (targets.length !== datas.length) {
      return err(`MultiInit has ${targets.length} targets and ${datas.length} calls, so it reverts. Encode the init again.`);
    }
    const steps: DecodedInitStep[] = [];
    for (const [i, target] of targets.entries()) {
      if (sameAddress(target, ZERO_ADDRESS)) break;
      const call = (datas[i] ?? "0x").toLowerCase() as Hex;
      const inner = call.slice(0, 10) as Hex;
      const [match] = matches(catalog, inner, (spec) => spec.release !== undefined && sameAddress(spec.release.address, target));
      const step = decodeCall(call, match, refs, target);
      if (!step.ok) return err(`Step ${i + 1}: ${step.error}`);
      steps.push(step.value);
    }
    return ok({ kind: "steps", steps });
  }

  const [bundle] = matches(catalog, selector, (spec) => spec.kind === "bundle");
  if (bundle !== undefined) {
    const step = decodeCall(hex, bundle, refs);
    return step.ok ? ok({ kind: "bundle", steps: [step.value] }) : step;
  }
  const direct = directStep(matches(catalog, selector, (spec) => spec.kind === "step" && spec.name !== MULTI_INIT_SPEC));
  if (direct === undefined) {
    return err(`Init data calls ${selector}, which matches no init in this catalog. Check the catalog version.`);
  }
  const step = decodeCall(hex, direct, refs);
  return step.ok ? ok({ kind: "steps", steps: [step.value] }) : step;
};
