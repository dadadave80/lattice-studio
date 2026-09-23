/**
 * The init field model and argument validation (spec L457-L466, R14, contracts §4 rule grammar).
 * `fieldModel` reads a param's ABI `type`, `unit` and `rule`; `validateArg` returns the value to store, or an error
 * in the spec's voice: "Governor quorum is 140; it must be 0-100 (percent of supply)."
 */
import type { FieldModelFn, ValidateArgFn } from "../../model/api";
import type { InitParam, InitSpec } from "../../model/catalog";
import { codeAtFor } from "../../model/chain";
import { isAddress, toChecksum } from "../../model/hex";
import type { ArgContext, FieldKind, FieldModel } from "../../model/init";
import type { Arg } from "../../model/recipe";
import { err, ok } from "../../model/result";
import { parseRule, type ParsedRule } from "./rules";

// ── labels ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Labels the name alone can't give. `quorumNumerator` is "Governor quorum", as INIT-01's message
 * (spec L327) and the console's "Set Governor quorum to 4%." (spec L716) name it.
 */
const LABELS: Readonly<Record<string, string>> = { quorumNumerator: "Governor quorum" };

const WORD = /[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g;

/** Acronyms a param name writes in lower or camel case ("ensName"), kept upper case in labels. */
const ACRONYMS: ReadonlySet<string> = new Set(["ens", "eip", "erc", "uri", "url", "id", "nft", "dao", "evm"]);

/** "votingPeriod" → "Voting period", "name_" → "Name", "_owner" → "Owner"; acronyms stay upper case. */
export function labelFor(name: string): string {
  const fixed = LABELS[name];
  if (fixed) return fixed;
  const words = name.match(WORD) ?? [name];
  return words
    .map((word, i) => {
      const acronym = word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word);
      if (acronym) return word;
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

// ── field model ────────────────────────────────────────────────────────────────────────────────────

const INT_TYPE = /^(u?)int(\d*)$/;
const BYTES_TYPE = /^bytes(\d*)$/;
const ARRAY_TYPE = /^(.*)\[(\d*)\]$/;

function intBounds(type: string): { min: bigint; max: bigint } | undefined {
  const match = INT_TYPE.exec(type);
  if (!match) return undefined;
  const bits = BigInt(match[2] === "" ? 256 : Number(match[2]));
  if (match[1] === "u") return { min: 0n, max: 2n ** bits - 1n };
  return { min: -(2n ** (bits - 1n)), max: 2n ** (bits - 1n) - 1n };
}

function maxOf(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function minOf(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function integerKind(param: InitParam): FieldKind {
  if (param.unit === "seconds") return "duration";
  if (param.unit === "percent") return "percent";
  if (param.unit === "wei") return "amount";
  return "integer";
}

function kindOf(param: InitParam, rule: ParsedRule): FieldKind {
  const type = param.type;
  if (ARRAY_TYPE.test(type)) return "array";
  if (type === "tuple") return "tuple";
  if (type === "address") return "address";
  if (type === "bool") return "bool";
  if (rule.options) return "enum";
  if (INT_TYPE.test(type)) return integerKind(param);
  if (BYTES_TYPE.test(type)) return "bytes";
  return "string";
}

/** Effective integer bounds: the type's, narrowed by the rule and by a percent's 0-100 (spec L464). */
function integerBounds(param: InitParam, rule: ParsedRule): { min?: bigint; max?: bigint; exclusiveMin?: true } {
  const type = intBounds(param.type);
  if (!type) return {};
  let min = type.min;
  let max = type.max;
  let exclusiveMin = false;
  if (param.unit === "percent") {
    min = maxOf(min, 0n);
    max = minOf(max, 100n);
  }
  if (rule.range) {
    min = maxOf(min, rule.range.min);
    max = minOf(max, rule.range.max);
  }
  if (rule.gte !== undefined && rule.gte > min) min = rule.gte;
  if (rule.gt !== undefined && rule.gt >= min) {
    min = rule.gt;
    exclusiveMin = true;
  }
  return exclusiveMin ? { min, max, exclusiveMin: true } : { min, max };
}

function zeroAllowed(kind: FieldKind, rule: ParsedRule, bounds: { min?: bigint; max?: bigint; exclusiveMin?: true }): boolean {
  if (rule.nonzero) return false;
  if (kind === "integer" || kind === "duration" || kind === "percent" || kind === "amount") {
    const { min, max, exclusiveMin } = bounds;
    if (min !== undefined && (exclusiveMin ? min >= 0n : min > 0n)) return false;
    if (max !== undefined && max < 0n) return false;
  }
  return true;
}

function build(param: InitParam, path: string): FieldModel {
  const rule = parseRule(param.rule);
  const kind = kindOf(param, rule);
  const bounds = integerBounds(param, rule);
  const field: FieldModel = {
    path,
    name: param.name,
    label: labelFor(param.name),
    type: param.type,
    kind,
    doc: param.doc,
    required: true,
    allowZero: zeroAllowed(kind, rule, bounds),
    authority: param.authority === true,
  };
  if (param.unit) field.unit = param.unit;
  if (param.rule) field.rule = param.rule;
  if (bounds.min !== undefined) field.min = bounds.min.toString();
  if (bounds.max !== undefined) field.max = bounds.max.toString();
  if (bounds.exclusiveMin) field.exclusiveMin = true;
  if (rule.maxlen !== undefined && (kind === "string" || kind === "bytes")) field.maxLength = rule.maxlen;
  if (rule.options) field.options = rule.options;
  if (rule.code) field.needsCode = rule.code;
  if (param.role !== undefined) field.role = param.role;
  if (param.example !== undefined) field.example = param.example;
  if (param.exampleSource !== undefined) field.exampleSource = param.exampleSource;
  if (kind === "tuple") {
    field.components = (param.components ?? []).map((c) => build(c, `${path}.${c.name}`));
  }
  if (kind === "array") {
    const element = ARRAY_TYPE.exec(param.type)?.[1] ?? "";
    const { example: _example, exampleSource: _source, ...rest } = param;
    field.element = build({ ...rest, type: element }, `${path}[]`);
  }
  return field;
}

/** One init parameter as a form field; `at` is the step's path ("bundle", "steps[2]"). */
export const fieldModel: FieldModelFn = (_spec, param, at) => build(param, at ? `${at}.${param.name}` : param.name);

/** Every field of a spec, at a step's path. */
export function fieldsOf(spec: InitSpec, at: string): FieldModel[] {
  return spec.params.map((param) => fieldModel(spec, param, at));
}

// ── validation ─────────────────────────────────────────────────────────────────────────────────────

/**
 * What's wrong with one argument. `missing` and `chain` carry a complete sentence; `invalid` carries the lowercase
 * clause that follows "{label} is {value};" (the INIT-01 copy ruling, contracts §3.1). `path` and `label` name the
 * field that failed, which for a tuple or an array is a component or an item.
 */
export type ArgFailure =
  | { kind: "missing"; path: string; label: string; detail: string }
  | { kind: "invalid"; path: string; label: string; detail: string; value: Arg }
  | { kind: "chain"; path: string; label: string; detail: string; chain: string };

export type ArgJudgement = { ok: true; value: Arg } | ({ ok: false } & ArgFailure);

const ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = /^0x0{40}$/i;
const HEX_BYTES = /^0x(?:[0-9a-fA-F]{2})*$/;

function isRef(value: Arg | undefined): value is { $ref: "self" | "deployer" } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "$ref" in value;
}

function isEmpty(value: Arg | undefined): boolean {
  return value === undefined || (typeof value === "string" && value.trim() === "");
}

/** What a percent is a percent of, by param name, for messages (spec L327); otherwise just "percent". */
const PERCENT_OF: Readonly<Record<string, string>> = { quorumNumerator: "percent of supply" };

function unitClause(field: FieldModel): string {
  if (field.unit === "percent") return ` (${PERCENT_OF[field.name] ?? "percent"})`;
  if (field.unit === "seconds") return " (seconds)";
  if (field.unit === "wei") return " (wei)";
  return "";
}

function joinOr(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items.at(-1) ?? ""}`;
}

type Fail = (detail: string) => ArgJudgement;

/** "a uint8" (you-int), "an int8". */
function article(type: string): string {
  return `${/^[aeio]/.test(type) ? "an" : "a"} ${type}`;
}

function judgeAddress(field: FieldModel, value: Arg, ctx: ArgContext, invalid: Fail): ArgJudgement {
  let address: string | undefined;
  let stored: Arg;
  if (isRef(value)) {
    if (value.$ref !== "self" && value.$ref !== "deployer") return invalid("it isn't a reference Studio knows");
    address = ctx.refs?.[value.$ref];
    stored = { $ref: value.$ref };
  } else {
    if (typeof value !== "string" || !ADDRESS_SHAPE.test(value.trim())) return invalid("it isn't an address");
    const text = value.trim();
    const digits = text.slice(2);
    const mixed = /[a-f]/.test(digits) && /[A-F]/.test(digits);
    if (mixed && !isAddress(text)) return invalid("its checksum doesn't match, so it may have a typo");
    if (!field.allowZero && ZERO_ADDRESS.test(text)) return invalid("it can't be the zero address");
    address = text;
    stored = toChecksum(text.toLowerCase());
  }
  if (field.needsCode && address !== undefined && ctx.chain && codeAtFor(ctx.chain, address) === "0x") {
    const chain = ctx.chainName ?? ctx.chain.name;
    const detail =
      field.needsCode === "safe"
        ? `No Safe at this address on ${chain} yet. Deploy the Safe first.`
        : field.needsCode === "token"
          ? `No token at this address on ${chain}. Use the token's address on ${chain}.`
          : `No contract at this address on ${chain}. Use an address that holds code on ${chain}.`;
    return { ok: false, kind: "chain", path: field.path, label: field.label, detail, chain };
  }
  return { ok: true, value: stored };
}

function judgeInteger(field: FieldModel, value: Arg, invalid: Fail): ArgJudgement {
  if (typeof value !== "string" || !/^-?\d+$/.test(value.trim())) return invalid("it must be a whole number");
  const n = BigInt(value.trim());
  const type = intBounds(field.type);
  if (type && n < type.min) return invalid(type.min === 0n ? "it can't be negative" : `it doesn't fit in ${article(field.type)} (at least ${type.min})`);
  if (type && n > type.max) return invalid(`it doesn't fit in ${article(field.type)} (at most ${type.max})`);
  const rule = parseRule(field.rule);
  const unit = unitClause(field);
  if (rule.nonzero && n === 0n) return invalid(`it can't be 0${unit}`);
  if (rule.options && !rule.options.includes(n.toString())) return invalid(`it must be one of ${joinOr(rule.options)}`);
  const min = field.min === undefined ? undefined : BigInt(field.min);
  const max = field.max === undefined ? undefined : BigInt(field.max);
  const below = min !== undefined && (field.exclusiveMin ? n <= min : n < min);
  const above = max !== undefined && n > max;
  if (below || above) {
    if (rule.range || (field.unit === "percent" && !rule.gt && !rule.gte)) {
      return invalid(`it must be ${field.min ?? ""}-${field.max ?? ""}${unit}`);
    }
    if (below && field.exclusiveMin) return invalid(`it must be greater than ${field.min ?? ""}${unit}`);
    if (below) return invalid(`it must be at least ${field.min ?? ""}${unit}`);
    return invalid(`it must be at most ${field.max ?? ""}${unit}`);
  }
  return { ok: true, value: n.toString() };
}

function judgeBytes(field: FieldModel, value: Arg, invalid: Fail): ArgJudgement {
  if (typeof value !== "string" || !HEX_BYTES.test(value.trim())) return invalid("it must be hex bytes, starting 0x");
  const text = value.trim().toLowerCase();
  const length = (text.length - 2) / 2;
  const fixed = BYTES_TYPE.exec(field.type)?.[1];
  if (fixed && length !== Number(fixed)) return invalid(`it must be exactly ${fixed} ${fixed === "1" ? "byte" : "bytes"}`);
  if (field.maxLength !== undefined && length > field.maxLength) return invalid(`it must be at most ${field.maxLength} bytes`);
  return { ok: true, value: text };
}

function judgeString(field: FieldModel, value: Arg, invalid: Fail): ArgJudgement {
  if (typeof value !== "string") return invalid("it must be text");
  if (field.options && !field.options.includes(value)) return invalid(`it must be one of ${joinOr(field.options)}`);
  if (field.maxLength !== undefined && [...value].length > field.maxLength) {
    return invalid(`it must be at most ${field.maxLength} ${field.maxLength === 1 ? "character" : "characters"}`);
  }
  return { ok: true, value };
}

function judgeTuple(field: FieldModel, value: Arg, ctx: ArgContext, invalid: Fail): ArgJudgement {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isRef(value)) {
    return invalid("it must be a group of fields");
  }
  const record = value as Record<string, Arg>;
  const out: Record<string, Arg> = {};
  for (const component of field.components ?? []) {
    const judged = judgeArg(component, Object.hasOwn(record, component.name) ? record[component.name] : undefined, ctx);
    if (!judged.ok) return judged;
    out[component.name] = judged.value;
  }
  return { ok: true, value: out };
}

function judgeArray(field: FieldModel, value: Arg, ctx: ArgContext, invalid: Fail): ArgJudgement {
  if (!Array.isArray(value)) return invalid("it must be a list");
  const fixed = ARRAY_TYPE.exec(field.type)?.[2];
  if (fixed && value.length !== Number(fixed)) return invalid(`it must have exactly ${fixed} ${fixed === "1" ? "item" : "items"}`);
  const element = field.element;
  if (!element) return { ok: true, value };
  const out: Arg[] = [];
  for (const [i, item] of value.entries()) {
    const at = { ...element, path: `${field.path}[${i}]`, label: `${field.label} item ${i + 1}` };
    const judged = judgeArg(at, item, ctx);
    if (!judged.ok) return judged;
    out.push(judged.value);
  }
  return { ok: true, value: out };
}

/** Validates one argument against its field: the stored form when it passes, what's wrong when it doesn't. */
export function judgeArg(field: FieldModel, value: Arg | undefined, ctx: ArgContext): ArgJudgement {
  if (value === undefined || (isEmpty(value) && field.kind !== "array")) {
    return { ok: false, kind: "missing", path: field.path, label: field.label, detail: `${field.label} is required. Fill it in before deploying.` };
  }
  const invalid: Fail = (detail) => ({ ok: false, kind: "invalid", path: field.path, label: field.label, detail, value });
  if (isRef(value) && field.kind !== "address") return invalid("only an address field can hold a reference");
  switch (field.kind) {
    case "address":
      return judgeAddress(field, value, ctx, invalid);
    case "integer":
    case "duration":
    case "percent":
    case "amount":
      return judgeInteger(field, value, invalid);
    case "enum":
      return INT_TYPE.test(field.type) ? judgeInteger(field, value, invalid) : judgeString(field, value, invalid);
    case "bool":
      return typeof value === "boolean" ? { ok: true, value } : invalid("it must be true or false");
    case "bytes":
      return judgeBytes(field, value, invalid);
    case "string":
      return judgeString(field, value, invalid);
    case "tuple":
      return judgeTuple(field, value, ctx, invalid);
    case "array":
      return judgeArray(field, value, ctx, invalid);
  }
}

/** Renders a value the way INIT-01 quotes it: text as written, anything else as JSON. */
export function valueText(value: Arg): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Ok with the value to store (addresses checksummed, integers as canonical decimal strings); otherwise the error
 * sentence: "Governor quorum is 140; it must be 0-100 (percent of supply)." Chain rules apply only when
 * `ctx.chain.codeAt` has the address.
 */
export const validateArg: ValidateArgFn = (field, value, ctx) => {
  const judged = judgeArg(field, value, ctx);
  if (judged.ok) return ok(judged.value);
  if (judged.kind === "invalid") return err(`${judged.label} is ${valueText(judged.value)}; ${judged.detail}.`);
  return err(judged.detail);
};
