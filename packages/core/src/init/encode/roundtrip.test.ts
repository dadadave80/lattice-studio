import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { bytesToHex, toFunctionSignature } from "viem";
import type { InitParam, InitSpec } from "../../model/catalog";
import { toChecksum } from "../../model/hex";
import type { InitPlan, InitStepView } from "../../model/init";
import type { Arg } from "../../model/recipe";
import { loadFixtureCatalog, makeCatalog, makeInit } from "../../testing";
import { specAbi } from "./abi";
import { decodeInit, encodeInit } from "./index";

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
