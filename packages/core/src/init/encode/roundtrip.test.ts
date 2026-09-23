import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { bytesToHex, toFunctionSignature } from "viem";
import type { InitParam, InitSpec } from "../../model/catalog";
import { toChecksum } from "../../model/hex";
import type { InitPlan, InitStepView } from "../../model/init";
import type { Arg } from "../../model/recipe";
import { loadFixtureCatalog, makeCatalog, makeInit } from "../../testing";
import { specAbi } from "./abi";
import { decodeInit, encodeInit, resolveRefs } from "./index";

/** A canonical Arg for `param`: decimal strings, EIP-55 addresses, lowercase hex, tuples keyed by component. */
function valueOf(param: InitParam): fc.Arbitrary<Arg> {
  const array = /^(.*)\[(\d*)\]$/.exec(param.type);
  if (array) {
    const element = valueOf({ ...param, type: array[1] ?? "" });
    const length = array[2] === "" || array[2] === undefined ? undefined : Number(array[2]);
    return length === undefined ? fc.array(element, { maxLength: 3 }) : fc.array(element, { minLength: length, maxLength: length });
  }
  if (param.type === "tuple") {
    const fields: Record<string, fc.Arbitrary<Arg>> = {};
    for (const component of param.components ?? []) fields[component.name] = valueOf(component);
    return fc.record(fields);
  }
  const integer = /^(u?)int(\d*)$/.exec(param.type);
  if (integer) {
    const bits = BigInt(integer[2] || "256");
    const [min, max] = integer[1] === "u" ? [0n, (1n << bits) - 1n] : [-(1n << (bits - 1n)), (1n << (bits - 1n)) - 1n];
    return fc.bigInt({ min, max }).map((n) => n.toString());
  }
  if (param.type === "address") return fc.uint8Array({ minLength: 20, maxLength: 20 }).map((b) => toChecksum(bytesToHex(b)));
  if (param.type === "bool") return fc.boolean();
  if (param.type === "string") return fc.string({ unit: "grapheme", maxLength: 12 });
  if (param.type === "bytes") return fc.uint8Array({ maxLength: 70 }).map((b) => bytesToHex(b));
  const fixed = /^bytes(\d+)$/.exec(param.type);
  if (fixed) {
    const n = Number(fixed[1]);
    return fc.uint8Array({ minLength: n, maxLength: n }).map((b) => bytesToHex(b));
  }
  throw new Error(`no generator for ${param.type}`);
}

const leafType = fc.oneof(
  fc.constant("address"), fc.constant("bool"), fc.constant("string"), fc.constant("bytes"),
  fc.integer({ min: 1, max: 32 }).map((n) => `uint${n * 8}`),
  fc.integer({ min: 1, max: 32 }).map((n) => `int${n * 8}`),
  fc.integer({ min: 1, max: 32 }).map((n) => `bytes${n}`),
);

/** Parameter shapes: leaves, lists (dynamic or fixed) and tuples, nested up to a small depth. */
const shape: fc.Arbitrary<Omit<InitParam, "name">> = fc.letrec<{ shape: Omit<InitParam, "name"> }>((tie) => ({
  shape: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    leafType.map((type) => ({ type, doc: "" })),
    fc.tuple(tie("shape"), fc.constantFrom("[]", "[2]")).map(([inner, suffix]) => ({ ...inner, type: `${inner.type}${suffix}` })),
    fc.array(tie("shape"), { minLength: 1, maxLength: 3 }).map((components) => ({
      type: "tuple",
      doc: "",
      components: components.map((c, i) => ({ ...c, name: `c${i}` })),
    })),
  ),
})).shape;

const params = fc.array(shape, { maxLength: 4 }).map((list) => list.map((p, i) => ({ ...p, name: `a${i}` })));

const multi = makeInit({
  name: "MultiInit", fn: "multiInit(address[],bytes[])",
  params: [{ name: "_initAddresses", type: "address[]", doc: "" }, { name: "_initData", type: "bytes[]", doc: "" }],
});

function generated(list: InitParam[], kind: "step" | "bundle"): InitSpec {
  const base = makeInit({ name: "GenInit", kind, params: list });
  return { ...base, fn: toFunctionSignature(specAbi(base)) };
}

function view(spec: InitSpec, path: string, index: number, args: Record<string, Arg>): InitStepView {
  return { path, index, spec: spec.name, contract: spec.contract, fn: spec.fn, locked: false, args, fields: [], missing: [], examples: [] };
}

function argsOf(list: InitParam[]): fc.Arbitrary<Record<string, Arg>> {
  const fields: Record<string, fc.Arbitrary<Arg>> = {};
  for (const param of list) fields[param.name] = valueOf(param);
  return fc.record(fields);
}

describe("decode(encode(x)) = x", () => {
  test("for generated parameters and arguments, as a MultiInit step and as a bundle", () => {
    fc.assert(
      fc.property(params.chain((list) => fc.tuple(fc.constant(list), argsOf(list))), ([list, args]) => {
        for (const kind of ["step", "bundle"] as const) {
          const spec = generated(list, kind);
          const catalog = makeCatalog({ inits: [multi, spec] });
          const plan: InitPlan = kind === "step"
            ? { kind: "steps", steps: [view(spec, "steps[0]", 0, args)] }
            : { kind: "bundle", steps: [view(spec, "bundle", 0, args)] };
          const encoded = encodeInit(plan, catalog, {});
          if (!encoded.ok) throw new Error(encoded.error);
          const decoded = decodeInit(encoded.value.data, catalog);
          if (!decoded.ok) throw new Error(decoded.error);
          expect(decoded.value.steps.map((s) => [s.spec, s.args])).toEqual([["GenInit", args]]);
        }
      }),
      { numRuns: 300 },
    );
  });

  const fixture = loadFixtureCatalog();
  test.skipIf(!fixture.ok)("for every v1 fixture init with generated arguments, all in one MultiInit", () => {
    if (!fixture.ok) return;
    const catalog = fixture.value;
    const steps = catalog.inits.filter((s) => s.kind === "step" && s.ctorArgs === undefined && s.name !== "MultiInit");
    const bundles = catalog.inits.filter((s) => s.kind === "bundle");
    fc.assert(
      fc.property(fc.tuple(...steps.map((s) => argsOf(s.params))), fc.tuple(...bundles.map((s) => argsOf(s.params))), (stepArgs, bundleArgs) => {
        const plan: InitPlan = { kind: "steps", steps: steps.map((s, i) => view(s, `steps[${i}]`, i, stepArgs[i] ?? {})) };
        const encoded = encodeInit(plan, catalog, {});
        if (!encoded.ok) throw new Error(encoded.error);
        const decoded = decodeInit(encoded.value.data, catalog);
        if (!decoded.ok) throw new Error(decoded.error);
        expect(decoded.value.steps.map((s) => [s.target, s.spec, s.args])).toEqual(
          steps.map((s, i) => [s.release?.address, s.name, stepArgs[i]]),
        );
        for (const [i, bundle] of bundles.entries()) {
          const one = encodeInit({ kind: "bundle", steps: [view(bundle, "bundle", 0, bundleArgs[i] ?? {})] }, catalog, {});
          if (!one.ok) throw new Error(one.error);
          const back = decodeInit(one.value.data, catalog);
          expect(back.ok && back.value).toEqual({
            kind: "bundle", steps: [{ spec: bundle.name, fn: bundle.fn, args: bundleArgs[i] ?? {}, fromRef: {} }],
          });
        }
      }),
      { numRuns: 100 },
    );
  });
});

/** Values of the wrong JS type for anything but `keep`: numbers, null, lists, plain objects, booleans, text. */
function foreign(keep: "string" | "boolean" | "array" | "object"): fc.Arbitrary<unknown> {
  const all: [string, fc.Arbitrary<unknown>][] = [
    ["number", fc.oneof(fc.integer(), fc.double())],
    ["null", fc.constant(null)],
    ["array", fc.array(fc.integer(), { maxLength: 2 })],
    ["object", fc.record({ x: fc.integer() })],
    ["boolean", fc.boolean()],
    ["string", fc.string()],
    ["bigint", fc.bigInt()],
  ];
  return fc.oneof(...all.filter(([kind]) => kind !== keep).map(([, arb]) => arb));
}

/** A value that is wrong for `param`, whatever form the mistake takes. */
function wrongFor(param: InitParam): fc.Arbitrary<unknown> {
  const array = /^(.*)\[(\d*)\]$/.exec(param.type);
  if (array) {
    const length = array[2] === "" || array[2] === undefined ? undefined : Number(array[2]);
    const element = { ...param, type: array[1] ?? "" };
    const badItem = fc.tuple(wrongFor(element), fc.array(valueOf(element), { maxLength: 1 })).map(([bad, rest]) => [bad, ...rest]);
    const wrongLength = length === undefined ? [] : [fc.array(valueOf(element), { minLength: length + 1, maxLength: length + 2 })];
    return fc.oneof(foreign("array"), badItem, ...wrongLength);
  }
  if (param.type === "tuple") {
    const components = param.components ?? [];
    const first = components[0];
    const variants: fc.Arbitrary<unknown>[] = [foreign("object")];
    if (first !== undefined) {
      const rest = argsOf(components.slice(1));
      variants.push(rest);
      variants.push(fc.tuple(wrongFor(first), rest).map(([bad, others]) => ({ ...others, [first.name]: bad })));
    }
    return fc.oneof(...variants);
  }
  const integer = /^(u?)int(\d*)$/.exec(param.type);
  if (integer) {
    const bits = BigInt(integer[2] || "256");
    const [min, max] = integer[1] === "u" ? [0n, (1n << bits) - 1n] : [-(1n << (bits - 1n)), (1n << (bits - 1n)) - 1n];
    return fc.oneof(
      foreign("string"),
      fc.bigInt({ min: max + 1n, max: max * 4n + 4n }).map(String),
      fc.bigInt({ min: min * 4n - 4n, max: min - 1n }).map(String),
      fc.constantFrom("1.5", "0x10", " 1", "01", "", "1e3", "-0", "+1"),
    );
  }
  if (param.type === "address") {
    return fc.oneof(
      foreign("string"),
      fc.string().filter((s) => !/^0x[0-9a-fA-F]{40}$/.test(s)),
      fc.constantFrom("0x6b175474e89094C44Da98b954EedeAC495271d0F", "0x6B175474E89094C44DA98B954EEDEAC495271D0F0"),
    );
  }
  if (param.type === "bool") return fc.oneof(foreign("boolean"), fc.constantFrom("true", "false"));
  if (param.type === "string") return foreign("string");
  if (param.type === "bytes") return fc.oneof(foreign("string"), fc.constantFrom("0xabc", "0xzz", "abcd", "0x0"));
  const fixed = /^bytes(\d+)$/.exec(param.type);
  if (fixed) {
    const n = Number(fixed[1]);
    return fc.oneof(foreign("string"), fc.uint8Array({ minLength: n + 1, maxLength: n + 3 }).map((b) => bytesToHex(b)), fc.constant("0xabc"));
  }
  throw new Error(`no generator for ${param.type}`);
}

describe("mistyped arguments are refused, never thrown", () => {
  const unknownRef = fc.oneof(
    fc.string().filter((name) => name !== "self" && name !== "deployer").map(($ref) => ({ $ref })),
    fc.constant({ $ref: "self" }),
  );
  const DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  test("for generated parameters, one argument wrong at a time: wrong type, range, hex, length or reference", () => {
    const cases = params
      .filter((list) => list.length > 0)
      .chain((list) =>
        fc.tuple(
          fc.constant(list),
          argsOf(list),
          fc.nat({ max: list.length - 1 }).chain((i) => fc.tuple(fc.constant(i), fc.oneof(wrongFor(list[i] as InitParam), unknownRef))),
          fc.constantFrom<"step" | "bundle">("step", "bundle"),
        ),
      );
    fc.assert(
      fc.property(cases, ([list, args, [i, bad], kind]) => {
        const spec = generated(list, kind);
        const catalog = makeCatalog({ inits: [multi, spec] });
        const mistyped = { ...args, [(list[i] as InitParam).name]: bad as Arg };
        const plan: InitPlan = kind === "step"
          ? { kind: "steps", steps: [view(spec, "steps[0]", 0, mistyped)] }
          : { kind: "bundle", steps: [view(spec, "bundle", 0, mistyped)] };
        const result = encodeInit(plan, catalog, { deployer: DEPLOYER });
        expect(result.ok).toBe(false);
        // Every error says what's wrong, then what to do.
        if (!result.ok) expect(result.error).toMatch(/\. [A-Z][^]*\.$/);
      }),
      { numRuns: 500 },
    );
  });

  test("resolveRefs and decodeInit return a Result for anything", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.anything()), fc.uint8Array({ maxLength: 200 }), fc.boolean(), (args, bytes, viaMulti) => {
        const resolved = resolveRefs(args as Record<string, Arg>, { self: "0x5FbDB2315678afecb367f032d93F642f64180aa3" });
        expect(typeof resolved.ok).toBe("boolean");
        const data = `${viaMulti ? "0x6e02fa3c" : "0x"}${bytesToHex(bytes).slice(2)}` as `0x${string}`;
        const decoded = decodeInit(data, makeCatalog({ inits: [multi] }));
        expect(typeof decoded.ok).toBe("boolean");
      }),
      { numRuns: 300 },
    );
  });
});
