/**
 * The init call as Solidity (spec L519: "This diamond" refs resolved when the script runs). References are only
 * known at run time, so the script encodes each step itself with `abi.encodeWithSelector`, one function per
 * step, instead of embedding bytes: `diamond` is the predicted address and `deployer` the broadcaster. The
 * shape follows C4b's `encodeInit` (contracts §3.1): a bundle or a single step is a direct call to that init,
 * two or more steps go through MultiInit's `multiInit(address[],bytes[])`, none is `address(0)` with no data.
 * Tuples become file-level structs built by helper functions, and arrays helper functions, so every argument
 * of an encode call is one token.
 */
import { specSelector, MULTI_INIT_FN, MULTI_INIT_SELECTOR, MULTI_INIT_SPEC } from "../../init/encode/abi";
import type { Catalog, InitParam, InitSpec } from "../../model/catalog";
import type { InitPlan } from "../../model/init";
import type { Arg } from "../../model/recipe";
import { commentText, pascalIdentifier, sanitizeIdentifier } from "../escape";
import {
  addressLiteral,
  assignLines,
  callLines,
  fixedBytesLiteral,
  hexStringLiteral,
  indent,
  integerLiteral,
  stringLiteral,
} from "./solidity";

/** A reference as the script names it: `diamond` is "This diamond", `deployer` the deploying account. */
export type RefParam = "diamond" | "deployer";

const REF_PARAM: Record<"self" | "deployer", RefParam> = { self: "diamond", deployer: "deployer" };
const REF_ORDER: readonly RefParam[] = ["diamond", "deployer"];

/** What `renderInit` produces for the script. */
export type InitRender = {
  /** File-level struct declarations for tuple parameters, each as lines. */
  structs: string[][];
  /** `_init` and the functions it calls, each as lines. */
  functions: string[][];
  /** `_init`'s parameters, in order. */
  params: RefParam[];
  /** One line per call for the header: "ERC20Init.init(string,string)". */
  calls: string[];
  /** "one direct call", "2 calls through MultiInit", "none". */
  shape: string;
};

/** Registers a shared contract the init calls and returns the name of its address constant. */
export type ConstantFor = (spec: InitSpec) => string;

class InitWriter {
  readonly structs: string[][] = [];
  private readonly structNames = new Map<string, string>();
  private readonly taken: Set<string>;
  private helperCount = 0;

  constructor(reserved: Iterable<string>) {
    this.taken = new Set(reserved);
  }

  private unique(base: string): string {
    let name = base;
    for (let n = 2; this.taken.has(name); n += 1) name = `${base}${n}`;
    this.taken.add(name);
    return name;
  }

  /** The struct for a tuple parameter, declared once per spec and path. */
  private structFor(key: string, label: string, components: readonly InitParam[]): string {
    const known = this.structNames.get(key);
    if (known !== undefined) return known;
    const name = this.unique(pascalIdentifier(label, "InitArgs").slice(0, 24));
    this.structNames.set(key, name);
    const fields = new Set<string>();
    const body = components.map((component, i) => {
      let field = sanitizeIdentifier(component.name, `field${i}`);
      while (fields.has(field)) field = `${field}_`;
      fields.add(field);
      return `${indent(1)}${this.typeOf(component, `${key}.${component.name}`, `${label} ${component.name}`)} ${field};`;
    });
    this.structs.push([`// ${commentText(`${label}: ${components.map((c) => `${c.type} ${c.name}`).join(", ")}`)}`, `struct ${name} {`, ...body, "}"]);
    return name;
  }

  /** The Solidity type for an ABI parameter; tuples become structs. */
  typeOf(param: InitParam, key: string, label: string): string {
    const array = /^(.*)(\[\d*\])$/.exec(param.type);
    if (array) return `${this.typeOf({ ...param, type: array[1] ?? "" }, key, label)}${array[2] ?? ""}`;
    if (param.type === "tuple") return this.structFor(key, label, param.components ?? []);
    if (param.type === "uint") return "uint256";
    if (param.type === "int") return "int256";
    return param.type;
  }

  /** Field names in declaration order, as `structFor` wrote them. */
  private fieldNames(components: readonly InitParam[]): string[] {
    const fields = new Set<string>();
    return components.map((component, i) => {
      let field = sanitizeIdentifier(component.name, `field${i}`);
      while (fields.has(field)) field = `${field}_`;
      fields.add(field);
      return field;
    });
  }

  /**
   * One argument as a single token: a literal, a reference, or a call to a helper that builds a tuple or an
   * array. `refs` collects the references the token needs; `helpers` collects the functions it created.
   */
  value(param: InitParam, value: Arg, key: string, label: string, path: string, refs: Set<RefParam>, helpers: string[][]): string {
    if (typeof value === "object" && value !== null && !Array.isArray(value) && "$ref" in value) {
      const ref = REF_PARAM[(value as { $ref: "self" | "deployer" }).$ref];
      if (param.type !== "address" || ref === undefined) throw new TypeError(`${path} holds a reference but isn't an address.`);
      refs.add(ref);
      return ref;
    }
    const array = /^(.*)\[(\d*)\]$/.exec(param.type);
    if (array || param.type === "tuple") return this.helper(param, value, key, label, path, refs, helpers);
    if (typeof value === "boolean") {
      if (param.type !== "bool") throw new TypeError(`${path} is a boolean but has type ${param.type}.`);
      return value ? "true" : "false";
    }
    if (typeof value !== "string") throw new TypeError(`${path} isn't a value of type ${param.type}.`);
    if (param.type === "address") return addressLiteral(value);
    if (param.type === "string") return stringLiteral(value);
    if (param.type === "bytes") return hexStringLiteral(value as `0x${string}`);
    const fixed = /^bytes(\d+)$/.exec(param.type);
    if (fixed) return `${param.type}(${fixedBytesLiteral(value, Number(fixed[1]))})`;
    const integer = /^(u?int)(\d*)$/.exec(param.type);
    if (integer) return integerLiteral(`${integer[1]}${integer[2] === "" ? "256" : integer[2]}`, BigInt(value));
    throw new TypeError(`${path} has type ${param.type}, which the script can't write.`);
  }

  /** A helper function that builds a tuple or array argument and returns it. */
  private helper(param: InitParam, value: Arg, key: string, label: string, path: string, refs: Set<RefParam>, helpers: string[][]): string {
    const type = this.typeOf(param, key, label);
    const own = new Set<RefParam>();
    const nested: string[][] = [];
    const body: string[] = [];
    const array = /^(.*)\[(\d*)\]$/.exec(param.type);
    if (array) {
      if (!Array.isArray(value)) throw new TypeError(`${path} must be a list.`);
      const element: InitParam = { ...param, type: array[1] ?? "" };
      if (array[2] === "") body.push(`${indent(2)}v = new ${type.slice(0, type.lastIndexOf("["))}[](${value.length});`);
      value.forEach((item, i) => {
        const token = this.value(element, item, key, label, `${path}[${i}]`, own, nested);
        body.push(...assignLines(2, `v[${i}]`, token));
      });
    } else {
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be a tuple.`);
      const components = param.components ?? [];
      const fields = this.fieldNames(components);
      components.forEach((component, i) => {
        const item = (value as Record<string, Arg>)[component.name];
        if (item === undefined) throw new TypeError(`${path}.${component.name} is missing.`);
        const token = this.value(component, item, `${key}.${component.name}`, `${label} ${component.name}`, `${path}.${component.name}`, own, nested);
        body.push(...assignLines(2, `v.${fields[i] ?? ""}`, token));
      });
    }
    this.helperCount += 1;
    const name = `_arg${this.helperCount}`;
    const params = REF_ORDER.filter((ref) => own.has(ref));
    for (const ref of params) refs.add(ref);
    helpers.push(
      [
        `${indent(1)}// ${commentText(path)}`,
        `${indent(1)}function ${name}(${params.map((p) => `address ${p}`).join(", ")}) internal pure returns (${type} memory v) {`,
        ...body,
        `${indent(1)}}`,
      ],
      ...nested,
    );
    return `${name}(${params.join(", ")})`;
  }
}

function header(name: string, params: readonly RefParam[], returns: string): string {
  return `${indent(1)}function ${name}(${params.map((p) => `address ${p}`).join(", ")}) internal pure returns (${returns}) {`;
}

/**
 * The init as Solidity functions: `_init(...)` returns `(address target, bytes memory data)` for the diamond's
 * `initialize`. Call `encodeInit` first: this trusts that every argument is present and valid, and throws
 * (a programmer error) when one isn't.
 */
export function renderInit(plan: InitPlan, catalog: Catalog, constantFor: ConstantFor, reserved: Iterable<string>): InitRender {
  const writer = new InitWriter(reserved);
  const steps = [...plan.steps].sort((a, b) => a.index - b.index);
  const functions: string[][] = [];
  const calls: { constant: string; fn: string; params: RefParam[] }[] = [];
  const signatures: string[] = [];
  for (const [i, step] of steps.entries()) {
    const spec = catalog.inits.find((candidate) => candidate.name === step.spec);
    if (spec === undefined) throw new TypeError(`${step.path} runs ${step.spec}, which the catalog doesn't have.`);
    const selector = specSelector(spec);
    if (!selector.ok) throw new TypeError(selector.error);
    const refs = new Set<RefParam>();
    const helpers: string[][] = [];
    const tokens = spec.params.map((param) => {
      const value = step.args[param.name];
      if (value === undefined) throw new TypeError(`${step.path}.${param.name} is missing.`);
      return writer.value(param, value, `${spec.name}.${param.name}`, `${spec.contract} ${param.name}`, `${step.path}.${param.name}`, refs, helpers);
    });
    const params = REF_ORDER.filter((ref) => refs.has(ref));
    const fn = `_initStep${i}`;
    const signature = `${spec.contract}.${spec.fn}`;
    signatures.push(signature);
    functions.push([
      `${indent(1)}// ${commentText(`${step.path}: ${signature}`)}`,
      header(fn, params, "bytes memory data"),
      ...callLines(2, "data = ", "abi.encodeWithSelector", [`bytes4(${selector.value})`, ...tokens]),
      `${indent(1)}}`,
    ]);
    functions.push(...helpers);
    calls.push({ constant: constantFor(spec), fn, params });
  }

  const params = REF_ORDER.filter((ref) => calls.some((call) => call.params.includes(ref)));
  const returns = "address target, bytes memory data";
  const invoke = (call: (typeof calls)[number]): string => `${call.fn}(${call.params.join(", ")})`;
  const [only, ...rest] = calls;
  let body: string[];
  let shape: string;
  if (only === undefined) {
    body = [`${indent(2)}return (address(0), "");`];
    shape = "none";
  } else if (rest.length === 0) {
    body = [`${indent(2)}target = ${only.constant};`, ...assignLines(2, "data", invoke(only))];
    shape = "one direct call";
  } else {
    const multi = catalog.inits.find((spec) => spec.name === MULTI_INIT_SPEC);
    if (multi === undefined) throw new TypeError("The catalog has no MultiInit.");
    body = [
      `${indent(2)}address[] memory targets = new address[](${calls.length});`,
      `${indent(2)}bytes[] memory calls = new bytes[](${calls.length});`,
    ];
    calls.forEach((call, i) => {
      body.push(`${indent(2)}targets[${i}] = ${call.constant};`, ...assignLines(2, `calls[${i}]`, invoke(call)));
    });
    body.push(
      `${indent(2)}target = ${constantFor(multi)};`,
      `${indent(2)}// ${MULTI_INIT_FN.name}(address[],bytes[])`,
      `${indent(2)}data = abi.encodeWithSelector(bytes4(${MULTI_INIT_SELECTOR}), targets, calls);`,
    );
    shape = `${calls.length} calls through MultiInit`;
  }
  functions.unshift([header("_init", params, returns), ...body, `${indent(1)}}`]);
  return { structs: writer.structs, functions, params, calls: signatures, shape };
}
