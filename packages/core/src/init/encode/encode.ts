/**
 * The init plan as the exact `(target, data)` the diamond's `initialize(cuts, init, data)` receives (R6):
 * a bundle is one call to its own contract; steps run through diamond-lib's MultiInit, one entry per step in
 * call order (the automatic ERC-165 step included, R11); none is the zero target with empty data.
 */
import { encodeFunctionData } from "viem";
import type { EncodeInitFn } from "../../model/api";
import type { Catalog, InitSpec } from "../../model/catalog";
import type { Refs } from "../../model/chain";
import { type Address, type Hex, sameAddress, toChecksum } from "../../model/hex";
import type { InitCall, InitStepView } from "../../model/init";
import type { Arg } from "../../model/recipe";
import { err, ok, type Result } from "../../model/result";
import { MULTI_INIT_FN, MULTI_INIT_SPEC, specAbi, specSelector, toAbiValue, ZERO_ADDRESS } from "./abi";
import { checkRefs, resolveArgsAt } from "./resolve";

/** Prefix of the error for an init that is deployed per use (`ctorArgs`): not in v1. */
export const UNSUPPORTED_IN_V1 = "Unsupported in v1";

/** Finds a plan step's spec by name; the automatic step falls back to `<contract>.<automatic>`. */
function stepSpec(step: InitStepView, catalog: Catalog): InitSpec | undefined {
  const byName = catalog.inits.find((spec) => spec.name === step.spec);
  if (byName !== undefined || step.automatic === undefined) return byName;
  return catalog.inits.find((spec) => spec.name === `${step.contract}.${step.automatic}`);
}

/** The init contract's release address, never zero (MultiInit.sol:23 stops at the first zero address). */
function releaseAddress(spec: InitSpec, path: string): Result<Address, string> {
  if (spec.ctorArgs !== undefined) {
    return err(`${UNSUPPORTED_IN_V1}: ${spec.name} (${path}) is deployed per diamond with constructor arguments.`);
  }
  if (spec.release === undefined) return err(`${spec.name} (${path}) has no release address in this catalog.`);
  if (sameAddress(spec.release.address, ZERO_ADDRESS)) {
    return err(`${spec.name} (${path}) has the zero address, which would end MultiInit before it runs.`);
  }
  return ok(toChecksum(spec.release.address));
}

/** One step's calldata: references resolved, every parameter present and valid for its ABI type. */
function encodeCall(spec: InitSpec, step: InitStepView, refs: Refs): Result<Hex, string> {
  const selector = specSelector(spec);
  if (!selector.ok) return selector;
  const resolved = resolveArgsAt(step.args, refs, step.path);
  if (!resolved.ok) return resolved;
  const abi = specAbi(spec);
  const known = new Set(spec.params.map((param) => param.name));
  const extra = Object.keys(resolved.value).find((key) => !known.has(key));
  if (extra !== undefined) return err(`${step.path}.${extra} isn't a parameter of ${spec.contract}.${spec.fn}.`);
  const values: unknown[] = [];
  for (const param of abi.inputs) {
    const name = param.name ?? "";
    const path = `${step.path}.${name}`;
    const value: Arg | undefined = resolved.value[name];
    if (value === undefined) return err(`${path} is missing.`);
    const converted = toAbiValue(param, value, path);
    if (!converted.ok) return converted;
    values.push(converted.value);
  }
  try {
    return ok(encodeFunctionData({ abi: [abi], functionName: abi.name, args: values }));
  } catch (error) {
    return err(`${step.path} couldn't be encoded: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

function encodeStep(step: InitStepView, catalog: Catalog, refs: Refs): Result<InitCall, string> {
  const spec = stepSpec(step, catalog);
  if (spec === undefined) return err(`${step.path} runs ${step.spec}, which this catalog doesn't have.`);
  const target = releaseAddress(spec, step.path);
  if (!target.ok) return target;
  const data = encodeCall(spec, step, refs);
  if (!data.ok) return data;
  return ok({ target: target.value, data: data.value });
}

/**
 * bundle → the bundle contract's init function; steps → `multiInit(address[],bytes[])` at MultiInit's release
 * address; none → the zero target and "0x". References resolve against `refs`; the result never holds one.
 */
export const encodeInit: EncodeInitFn = (plan, catalog, refs) => {
  if (plan.kind === "none") return ok({ target: ZERO_ADDRESS, data: "0x" });
  const checked = checkRefs(refs);
  if (!checked.ok) return checked;
  const steps = [...plan.steps].sort((a, b) => a.index - b.index);
  if (plan.kind === "bundle") {
    const [step, ...others] = steps;
    if (step === undefined || others.length > 0) return err(`A bundle init is one call; this plan has ${steps.length}.`);
    return encodeStep(step, catalog, refs);
  }
  if (steps.length === 0) return ok({ target: ZERO_ADDRESS, data: "0x" });
  const multi = catalog.inits.find((spec) => spec.name === MULTI_INIT_SPEC);
  if (multi === undefined) return err("This catalog has no MultiInit to run init steps through.");
  const target = releaseAddress(multi, MULTI_INIT_SPEC);
  if (!target.ok) return target;
  const targets: Address[] = [];
  const datas: Hex[] = [];
  for (const step of steps) {
    const call = encodeStep(step, catalog, refs);
    if (!call.ok) return call;
    targets.push(call.value.target);
    datas.push(call.value.data);
  }
  const data = encodeFunctionData({ abi: [MULTI_INIT_FN], functionName: "multiInit", args: [targets, datas] });
  return ok({ target: target.value, data });
};
