import {
  canonicalJson, err, fieldModel, findProtoKey, isHexAnyCase, ok, validateArg,
  type Hex, type InitSpec, type Json, type Result,
} from "@lattice-studio/core";
import {
  decodeAbiParameters, decodeErrorResult, encodeFunctionData, toFunctionSelector, toFunctionSignature,
  type Abi, type AbiFunction, type AbiParameter,
} from "viem";

export type RoutedFunction = { abi: AbiFunction; signature: string; selector: Hex; readOnly: boolean };
export type CallArgumentError = { index: number | null; message: string };
export type EncodedCall = { data: Hex; args: readonly unknown[] };
export type CallOutput = { name: string; type: string; value: Json };
export type CallRevert = { raw: Hex; errorName: string | null; args: CallOutput[] };

/** The ABI, not its name, identifies an overload; only functions actually routed by the diamond are listed. */
export function routedFunctions(abi: Abi, selectors: readonly Hex[]): RoutedFunction[] {
  const routed = new Set(selectors.map((selector) => selector.toLowerCase()));
  const seen = new Set<string>();
  const rows: RoutedFunction[] = [];
  for (const item of abi) {
    if (item.type !== "function") continue;
    const signature = toFunctionSignature(item);
    const selector = toFunctionSelector(item);
    if (!routed.has(selector) || seen.has(signature)) continue;
    seen.add(signature);
    rows.push({ abi: item, signature, selector, readOnly: item.stateMutability === "view" || item.stateMutability === "pure" });
  }
  return rows;
}

const ARRAY = /^(.*)\[(\d*)\]$/;
const INTEGER = /^u?int(\d*)$/;
const BYTES = /^bytes(\d*)$/;
// fieldModel's spec argument supplies no call state; reuse its scalar ABI bounds without editing a recipe.
const CALL_FIELDS: InitSpec = {
  name: "Call", contract: "", fn: "", kind: "step", params: [], initializes: [], after: [], sameCall: [],
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** After grammar validation, inspect source tokens before JSON.parse's rounded numbers can pass as integers. */
function exactJsonNumbers(text: string): boolean {
  for (const [token] of text.matchAll(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
    if (token.startsWith('"')) continue;
    if (!/^-?\d+$/.test(token) || !Number.isSafeInteger(Number(token))) return false;
  }
  return true;
}

function parameterValue(param: AbiParameter, value: unknown, path: string): Result<unknown, string> {
  const array = ARRAY.exec(param.type);
  if (array) {
    if (!Array.isArray(value)) return err(`${path} must be a JSON array.`);
    const size = array[2];
    if (size !== undefined && size !== "" && value.length !== Number(size)) return err(`${path} needs exactly ${size} items.`);
    const element = { ...param, type: array[1] ?? "" } as AbiParameter;
    const values: unknown[] = [];
    for (const [index, item] of value.entries()) {
      const parsed = parameterValue(element, item, `${path}[${index}]`);
      if (!parsed.ok) return parsed;
      values.push(parsed.value);
    }
    return ok(values);
  }
  if (param.type === "tuple") {
    const components = "components" in param ? param.components : [];
    let items: unknown[];
    if (Array.isArray(value)) {
      if (value.length !== components.length) return err(`${path} needs exactly ${components.length} tuple items.`);
      items = value;
    } else if (record(value)) {
      const tuple = value;
      const names = components.map((component) => component.name ?? "");
      if (names.some((name) => name === "") || new Set(names).size !== names.length) return err(`${path} has unnamed or repeated fields. Enter its tuple as a JSON array.`);
      const extra = Object.keys(tuple).find((key) => !names.includes(key));
      if (extra !== undefined) return err(`${path}.${extra} isn't a tuple field.`);
      const missing = names.find((name) => !Object.hasOwn(tuple, name));
      if (missing !== undefined) return err(`${path}.${missing} is required.`);
      items = names.map((name) => tuple[name]);
    } else return err(`${path} must be a JSON tuple object or array.`);
    const values: unknown[] = [];
    for (const [index, component] of components.entries()) {
      const nested = component.name ? `${path}.${component.name}` : `${path}[${index}]`;
      const parsed = parameterValue(component, items[index], nested);
      if (!parsed.ok) return parsed;
      values.push(parsed.value);
    }
    return ok(values);
  }
  const integer = INTEGER.exec(param.type);
  const bytes = BYTES.exec(param.type);
  if (integer) {
    const bits = integer[1] === "" ? 256 : Number(integer[1]);
    if (bits < 8 || bits > 256 || bits % 8 !== 0) return err(`${path} has an unsupported integer type: ${param.type}.`);
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) return err(`${path} needs an exact integer. Quote large JSON integers as decimal strings.`);
      value = String(value);
    }
  } else if (bytes) {
    if (bytes[1] !== "" && (Number(bytes[1]) < 1 || Number(bytes[1]) > 32)) return err(`${path} has an unsupported byte type: ${param.type}.`);
  } else if (!["address", "bool", "string"].includes(param.type)) return err(`${path} has an unsupported ABI type: ${param.type}.`);
  if (param.type === "string") {
    if (typeof value !== "string") return err(`${path} must be text.`);
    try {
      canonicalJson(value);
      return ok(value);
    } catch {
      return err(`${path} contains invalid Unicode text. Enter valid text.`);
    }
  }
  if (param.type === "address" && typeof value === "string" && !value.startsWith("0x") && value.includes(".")) {
    return err(`${path}: Resolve the ENS name to an address before encoding.`);
  }
  if (typeof value !== "string" && typeof value !== "boolean") return err(`${path} has the wrong value type for ${param.type}.`);
  if (value === "") return err(`${path} is required.`);
  const field = { ...fieldModel(CALL_FIELDS, { name: path, type: param.type }, ""), label: path };
  const parsed = validateArg(field, value, {});
  if (!parsed.ok) return parsed;
  return ok(integer ? BigInt(parsed.value as string) : parsed.value);
}

/** Scalar text stays literal; tuples and arrays are JSON with quoted decimal strings for large integers. */
export function encodeCall(fn: AbiFunction, texts: readonly string[]): Result<EncodedCall, CallArgumentError[]> {
  if (texts.length !== fn.inputs.length) return err([{ index: null, message: `${toFunctionSignature(fn)} needs ${fn.inputs.length} arguments.` }]);
  const args: unknown[] = [];
  const errors: CallArgumentError[] = [];
  for (const [index, param] of fn.inputs.entries()) {
    const text = texts[index] ?? "";
    const path = param.name || `Argument ${index + 1}`;
    let value: unknown = param.type === "string" ? text : text.trim();
    if (ARRAY.test(param.type) || param.type === "tuple") {
      try {
        value = JSON.parse(text) as unknown;
      } catch {
        errors.push({ index, message: `${path} must be valid JSON.` });
        continue;
      }
      if (!exactJsonNumbers(text)) {
        errors.push({ index, message: `${path}: Use plain decimal integers in JSON. Quote large integers as decimal strings.` });
        continue;
      }
      const reserved = findProtoKey(value);
      if (reserved !== null) {
        errors.push({ index, message: `${path} contains a reserved field name.` });
        continue;
      }
    } else if (param.type === "bool") value = value === "true" ? true : value === "false" ? false : value;
    const parsed = parameterValue(param, value, path);
    if (!parsed.ok) errors.push({ index, message: parsed.error });
    else args.push(parsed.value);
  }
  if (errors.length > 0) return err(errors);
  try {
    return ok({ data: encodeFunctionData({ abi: [fn], functionName: fn.name, args }), args });
  } catch (error) {
    return err([{ index: null, message: `Couldn't encode ${toFunctionSignature(fn)}: ${reason(error)}` }]);
  }
}

/** Native value is raw integer wei; nonpayable/read functions can carry only zero. */
export function callValue(fn: AbiFunction, text: string): Result<bigint, string> {
  const parsed = parameterValue({ name: "Value", type: "uint256" }, text.trim() || "0", "Value");
  if (!parsed.ok) return parsed;
  const value = parsed.value as bigint;
  if (fn.stateMutability !== "payable" && value !== 0n) return err(`${toFunctionSignature(fn)} isn't payable. Value must be 0 wei.`);
  return ok(value);
}

function reason(error: unknown): string {
  return error instanceof Error ? (error.message.split("\n")[0] ?? "Couldn't decode ABI data.") : String(error);
}

function jsonValue(value: unknown): Json {
  if (typeof value === "bigint" || typeof value === "number") return String(value);
  if (typeof value === "string" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  throw new Error("The ABI result contains an unreadable value.");
}

function outputs(params: readonly AbiParameter[], values: readonly unknown[], fallback: string): CallOutput[] {
  return params.map((param, index) => ({ name: param.name || `${fallback} ${index + 1}`, type: param.type, value: jsonValue(values[index]) }));
}

/** Object decoding can overwrite repeated tuple names or swallow prototype keys. */
function positionalTuples(param: AbiParameter): AbiParameter {
  if (!("components" in param)) return param;
  const components = param.components.map(positionalTuples);
  const names = components.map((component) => component.name ?? "");
  const positional = new Set(names).size !== names.length || names.includes("__proto__");
  return {
    ...param,
    components: positional ? components.map((component) => ({ ...component, name: "" })) : components,
  };
}

/** Results are JSON-safe: ABI integers remain exact decimal strings, including nested values. */
export function decodeCallInputs(fn: AbiFunction, data: Hex): Result<CallOutput[], string> {
  if (!isHexAnyCase(data) || data.slice(0, 10).toLowerCase() !== toFunctionSelector(fn)) return err("The calldata doesn't match this function.");
  try { return ok(outputs(fn.inputs, decodeAbiParameters(fn.inputs.map(positionalTuples), `0x${data.slice(10)}`), "Argument")); }
  catch { return err("The calldata arguments couldn't be decoded with this ABI."); }
}

/** Results are JSON-safe: ABI integers remain exact decimal strings, including nested values. */
export function decodeCallOutputs(fn: AbiFunction, data: Hex): Result<CallOutput[], string> {
  if (!isHexAnyCase(data)) return err("The function result isn't hex bytes.");
  try {
    return ok(outputs(fn.outputs, decodeAbiParameters(fn.outputs.map(positionalTuples), data), "Output"));
  } catch (error) {
    return err(`Couldn't decode ${toFunctionSignature(fn)}'s result: ${reason(error)}`);
  }
}

/** Custom, Error and Panic revert data decodes against the actual ABI; unknown bytes remain opaque. */
export function decodeCallRevert(abi: Abi, data: Hex): CallRevert {
  try {
    if (!isHexAnyCase(data)) return { raw: data, errorName: null, args: [] };
    const safeAbi = abi.map((item) => item.type === "error" ? { ...item, inputs: item.inputs.map(positionalTuples) } : item);
    const decoded = decodeErrorResult({ abi: safeAbi, data });
    if (decoded.abiItem.type !== "error") return { raw: data, errorName: null, args: [] };
    return { raw: data, errorName: decoded.errorName, args: outputs(decoded.abiItem.inputs, decoded.args ?? [], "Argument") };
  } catch {
    return { raw: data, errorName: null, args: [] };
  }
}
