/**
 * ABI plumbing shared by the encoder and the decoder: an InitSpec as a viem `AbiFunction`, and the two-way
 * conversion between recipe `Arg`s (decimal strings, EIP-55 addresses, lowercase hex, tuples as objects
 * keyed by component name) and the values viem encodes.
 */
import { type AbiFunction, type AbiParameter, toFunctionSelector } from "viem";
import type { InitParam, InitSpec } from "../../model/catalog";
import { type Address, type Hex, type Hex4, isAddress, isHexAnyCase, toChecksum } from "../../model/hex";
import type { Arg } from "../../model/recipe";
import { err, ok, type Result } from "../../model/result";

/** The zero address: the diamond's "no init" target, and never a MultiInit entry (MultiInit.sol:23). */
export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

/** diamond-lib's MultiInit entry point. */
export const MULTI_INIT_FN: AbiFunction = {
  type: "function",
  name: "multiInit",
  stateMutability: "nonpayable",
  inputs: [
    { name: "_initAddresses", type: "address[]" },
    { name: "_initData", type: "bytes[]" },
  ],
  outputs: [],
};

/** `multiInit(address[],bytes[])`. */
export const MULTI_INIT_SELECTOR: Hex4 = "0x6e02fa3c";

/** The catalog name of MultiInit's InitSpec. */
export const MULTI_INIT_SPEC = "MultiInit";

function toAbiParameter(param: InitParam): AbiParameter {
  return param.components === undefined
    ? { name: param.name, type: param.type }
    : { name: param.name, type: param.type, components: param.components.map(toAbiParameter) };
}

/** The spec's function as viem takes it: name from `fn`, inputs from `params` (tuples through `components`). */
export function specAbi(spec: InitSpec): AbiFunction {
  const open = spec.fn.indexOf("(");
  return {
    type: "function",
    name: open === -1 ? spec.fn : spec.fn.slice(0, open),
    stateMutability: "nonpayable",
    inputs: spec.params.map(toAbiParameter),
    outputs: [],
  };
}

/** The spec's selector, computed from its params, and the `fn` it declares must agree. */
export function specSelector(spec: InitSpec): Result<Hex4, string> {
  const fromParams = toFunctionSelector(specAbi(spec));
  let declared: Hex4;
  try {
    declared = toFunctionSelector(`function ${spec.fn}`);
  } catch {
    return err(`${spec.name} declares ${spec.fn}, which isn't a valid function signature. Rebuild the catalog.`);
  }
  if (fromParams !== declared) {
    return err(`${spec.name} declares ${spec.fn}, but its parameters encode as a different function. Rebuild the catalog.`);
  }
  return ok(fromParams);
}

const ARRAY = /^(.*)\[(\d*)\]$/;
const INTEGER = /^(u?)int(\d*)$/;
const FIXED_BYTES = /^bytes(\d+)$/;
/** Canonical decimal: no sign on zero, no leading zeros, no plus sign. */
const DECIMAL = /^(?:0|-?[1-9]\d*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRef(value: unknown): boolean {
  return isRecord(value) && "$ref" in value;
}

/** A value for an error message; never throws, whatever a mistyped argument holds. */
function show(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return typeof value === "bigint" ? value.toString() : "an unreadable value";
  }
}

/**
 * One argument as viem encodes it, checked against its ABI type. `path` names it in errors
 * ("bundle.p.decimalsOffset"). A reference that is still symbolic is an error: resolve it first.
 */
export function toAbiValue(param: AbiParameter, value: Arg, path: string): Result<unknown, string> {
  if (isRef(value)) return err(`${path} is still a reference. Resolve references before encoding.`);
  const array = ARRAY.exec(param.type);
  if (array) {
    if (!Array.isArray(value)) return err(`${path} must be a list for ${param.type}. Enter a list.`);
    const length = array[2];
    if (length !== undefined && length !== "" && value.length !== Number(length)) {
      return err(`${path} must hold exactly ${length} items; it holds ${value.length}. Enter ${length} items.`);
    }
    const element = { ...param, type: array[1] ?? "" } as AbiParameter;
    const out: unknown[] = [];
    for (const [i, item] of value.entries()) {
      const converted = toAbiValue(element, item, `${path}[${i}]`);
      if (!converted.ok) return converted;
      out.push(converted.value);
    }
    return ok(out);
  }
  if (param.type === "tuple") {
    const components = "components" in param ? param.components : [];
    if (!isRecord(value)) return err(`${path} must be an object with ${components.map((c) => c.name).join(", ")}. Fill in each field.`);
    const known = new Set(components.map((c) => c.name));
    const extra = Object.keys(value).find((key) => !known.has(key));
    if (extra !== undefined) return err(`${path}.${extra} isn't a field of ${path}. Remove it.`);
    const out: Record<string, unknown> = {};
    for (const component of components) {
      const name = component.name ?? "";
      const item = (value as Record<string, Arg>)[name];
      if (item === undefined) return err(`${path}.${name} is missing. Fill it in.`);
      const converted = toAbiValue(component, item, `${path}.${name}`);
      if (!converted.ok) return converted;
      out[name] = converted.value;
    }
    return ok(out);
  }
  const integer = INTEGER.exec(param.type);
  if (integer) {
    if (typeof value !== "string" || !DECIMAL.test(value)) {
      return err(`${path} must be a whole number written in decimal; it is ${show(value)}. Enter digits only.`);
    }
    const bits = BigInt(integer[2] === "" ? "256" : (integer[2] ?? "256"));
    const n = BigInt(value);
    const signed = integer[1] === "";
    const min = signed ? -(1n << (bits - 1n)) : 0n;
    const max = signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n;
    if (n < min || n > max) return err(`${path} is ${value}, outside ${param.type}'s range ${min} to ${max}. Use ${min} to ${max}.`);
    return ok(n);
  }
  if (param.type === "address") {
    if (typeof value !== "string" || !isAddress(value)) return err(`${path} must be an address; it is ${show(value)}. Enter 0x and 40 hex digits.`);
    return ok(toChecksum(value));
  }
  if (param.type === "bool") {
    if (typeof value !== "boolean") return err(`${path} must be true or false; it is ${show(value)}. Choose true or false.`);
    return ok(value);
  }
  if (param.type === "string") {
    if (typeof value !== "string") return err(`${path} must be text; it is ${show(value)}. Enter text.`);
    return ok(value);
  }
  if (param.type === "bytes" || FIXED_BYTES.test(param.type)) {
    if (typeof value !== "string" || !isHexAnyCase(value)) return err(`${path} must be hex bytes; it is ${show(value)}. Enter 0x and pairs of hex digits.`);
    const size = FIXED_BYTES.exec(param.type)?.[1];
    if (size !== undefined && (value.length - 2) / 2 !== Number(size)) {
      return err(`${path} must be exactly ${size} bytes for ${param.type}. Enter ${Number(size) * 2} hex digits after 0x.`);
    }
    return ok(value.toLowerCase());
  }
  return err(`${path} has type ${param.type}, which Studio can't encode. Use another init.`);
}

/** A decoded ABI value back as a recipe `Arg`: bigints as decimal strings, addresses EIP-55, hex lowercase. */
export function fromAbiValue(param: AbiParameter, value: unknown): Arg {
  const array = ARRAY.exec(param.type);
  if (array) {
    const element = { ...param, type: array[1] ?? "" } as AbiParameter;
    return (value as readonly unknown[]).map((item) => fromAbiValue(element, item));
  }
  if (param.type === "tuple") {
    const components = "components" in param ? param.components : [];
    const out: Record<string, Arg> = {};
    for (const [i, component] of components.entries()) {
      const name = component.name ?? String(i);
      const item = Array.isArray(value) ? value[i] : (value as Record<string, unknown>)[name];
      out[name] = fromAbiValue(component, item);
    }
    return out;
  }
  // viem decodes integers of 48 bits or fewer as numbers, wider ones as bigints.
  if (typeof value === "bigint" || typeof value === "number") return value.toString();
  if (param.type === "address") return toChecksum(value as string);
  if (param.type === "bytes" || FIXED_BYTES.test(param.type)) return (value as Hex).toLowerCase();
  return value as string | boolean;
}
