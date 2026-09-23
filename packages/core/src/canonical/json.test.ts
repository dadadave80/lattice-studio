import { describe, expect, test } from "bun:test";
import { bytesToHex, stringToBytes } from "viem";
import { canonicalJson } from "./json";

/** A double from its IEEE 754 bits, as RFC 8785 Appendix B lists them. */
function fromBits(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

describe("RFC 8785 test vectors", () => {
  // Appendix B, Table 1: ECMAScript-compatible JSON number serialization samples.
  const numbers: [string, string][] = [
    ["0000000000000000", "0"],
    ["8000000000000000", "0"],
    ["0000000000000001", "5e-324"],
    ["8000000000000001", "-5e-324"],
    ["7fefffffffffffff", "1.7976931348623157e+308"],
    ["ffefffffffffffff", "-1.7976931348623157e+308"],
    ["4340000000000000", "9007199254740992"],
    ["c340000000000000", "-9007199254740992"],
    ["4430000000000000", "295147905179352830000"],
    ["44b52d02c7e14af5", "9.999999999999997e+22"],
    ["44b52d02c7e14af6", "1e+23"],
    ["44b52d02c7e14af7", "1.0000000000000001e+23"],
    ["444b1ae4d6e2ef4e", "999999999999999700000"],
    ["444b1ae4d6e2ef4f", "999999999999999900000"],
    ["444b1ae4d6e2ef50", "1e+21"],
    ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
    ["3eb0c6f7a0b5ed8d", "0.000001"],
    ["41b3de4355555553", "333333333.3333332"],
    ["41b3de4355555554", "333333333.33333325"],
    ["41b3de4355555555", "333333333.3333333"],
    ["41b3de4355555556", "333333333.3333334"],
    ["41b3de4355555557", "333333333.33333343"],
    ["becbf647612f3696", "-0.0000033333333333333333"],
    ["43143ff3c1cb0959", "1424953923781206.2"],
  ];

  test.each(numbers)("Appendix B: %s serializes as %s", (bits, expected) => {
    expect(canonicalJson(fromBits(bits))).toBe(expected);
  });

  test.each(["7fffffffffffffff", "7ff0000000000000"])("Appendix B: %s (NaN, Infinity) is an error", (bits) => {
    expect(() => canonicalJson(fromBits(bits))).toThrow(TypeError);
  });

  // The RFC's JSON texts are built from these, so no tool or transpiler can rewrite an escape on the way.
  const U = `${"\\"}u`;
  const ch = (...codes: number[]): string => String.fromCharCode(...codes);

  // §3.2.2: the input text, parsed, canonicalizes to the output text.
  const input = [
    "{",
    '  "numbers": [333333333.33333329, 1E30, 4.50,',
    "              2e-3, 0.000000000000000000000000001],",
    `  "string": "${U}20ac$${U}000F${U}000aA'${U}0042${U}0022${U}005c\\\\\\"\\/",`,
    '  "literals": [null, true, false]',
    "}",
  ].join("\n");
  const output =
    '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
    `"string":"${ch(0x20ac)}$${U}000f\\nA'B\\"\\\\\\\\\\"/"}`;

  test("§3.2.2: the sample object", () => {
    expect(canonicalJson(JSON.parse(input))).toBe(output);
  });

  test("§3.2.4: its UTF-8 bytes", () => {
    const bytes = `
      7b 22 6c 69 74 65 72 61 6c 73 22 3a 5b 6e 75 6c 6c 2c 74 72
      75 65 2c 66 61 6c 73 65 5d 2c 22 6e 75 6d 62 65 72 73 22 3a
      5b 33 33 33 33 33 33 33 33 33 2e 33 33 33 33 33 33 33 2c 31
      65 2b 33 30 2c 34 2e 35 2c 30 2e 30 30 32 2c 31 65 2d 32 37
      5d 2c 22 73 74 72 69 6e 67 22 3a 22 e2 82 ac 24 5c 75 30 30
      30 66 5c 6e 41 27 42 5c 22 5c 5c 5c 5c 5c 22 2f 22 7d`.replace(/\s+/g, "");
    expect(bytesToHex(stringToBytes(canonicalJson(JSON.parse(input))))).toBe(`0x${bytes}`);
  });

  test("§3.2.3: property names sort by UTF-16 code units", () => {
    const sample = JSON.parse(
      [
        "{",
        `  "${U}20ac": "Euro Sign",`,
        '  "\\r": "Carriage Return",',
        `  "${U}fb33": "Hebrew Letter Dalet With Dagesh",`,
        '  "1": "One",',
        `  "${U}d83d${U}de00": "Emoji: Grinning Face",`,
        `  "${U}0080": "Control",`,
        `  "${U}00f6": "Latin Small Letter O With Diaeresis"`,
        "}",
      ].join("\n"),
    ) as unknown;
    expect(canonicalJson(sample)).toBe(
      '{"\\r":"Carriage Return","1":"One",' +
        `"${ch(0x80)}":"Control","${ch(0xf6)}":"Latin Small Letter O With Diaeresis","${ch(0x20ac)}":"Euro Sign",` +
        `"${ch(0xd83d, 0xde00)}":"Emoji: Grinning Face","${ch(0xfb33)}":"Hebrew Letter Dalet With Dagesh"}`,
    );
  });

  // The reference implementation's test data (cyberphone/json-canonicalization, testdata/input and output).
  test("arrays and nested structures", () => {
    expect(canonicalJson(JSON.parse('[56, {"d": true, "10": null, "1": [ ]}]'))).toBe('[56,{"1":[],"10":null,"d":true}]');
    const structures = JSON.parse(`{
      "1": {"f": {"f": "hi","F": 5} ,"\\n": 56.0},
      "10": { },
      "": "empty",
      "a": { },
      "111": [ {"e": "yes","E": "no" } ],
      "A": { }
    }`) as unknown;
    expect(canonicalJson(structures)).toBe('{"":"empty","1":{"\\n":56,"f":{"F":5,"f":"hi"}},"10":{},"111":[{"E":"no","e":"yes"}],"A":{},"a":{}}');
  });

  test("Unicode is never normalized, and DEL and C1 controls pass through raw", () => {
    const unnormalized = `A${ch(0x30a)}`;
    expect(canonicalJson(JSON.parse(`{"Unnormalized Unicode":"A${U}030a"}`))).toBe(`{"Unnormalized Unicode":"${unnormalized}"}`);
    expect(canonicalJson(`${ch(0x7f, 0x80)}</script>`)).toBe(`"${ch(0x7f, 0x80)}</script>"`);
  });

  test("ASCII controls use the short escapes, else lowercase \\u00xx", () => {
    expect(canonicalJson(ch(8, 9, 10, 12, 13, 0, 0x1f, 0x0b))).toBe(`"\\b\\t\\n\\f\\r${U}0000${U}001f${U}000b"`);
  });
});

describe("canonicalJson on Studio's values", () => {
  test("no whitespace, sorted keys at every level, literals as JSON writes them", () => {
    expect(canonicalJson({ b: [1, { z: false, a: null }], a: "x" })).toBe('{"a":"x","b":[1,{"a":null,"z":false}]}');
    expect(canonicalJson(-0)).toBe("0");
    expect(canonicalJson([])).toBe("[]");
    expect(canonicalJson({})).toBe("{}");
  });

  test("accepts readonly structures such as a viem ABI, and objects without a prototype", () => {
    const abi = [
      { type: "function", name: "transfer", inputs: [{ name: "to", type: "address" }], outputs: [], stateMutability: "nonpayable" },
    ] as const;
    expect(canonicalJson(abi)).toBe(
      '[{"inputs":[{"name":"to","type":"address"}],"name":"transfer","outputs":[],"stateMutability":"nonpayable","type":"function"}]',
    );
    const bare = Object.create(null) as Record<string, number>;
    bare["b"] = 2;
    bare["a"] = 1;
    expect(canonicalJson(bare)).toBe('{"a":1,"b":2}');
  });

  test("a value shared by two branches is fine; only a cycle is refused", () => {
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow('canonicalJson: ["self"] is a reference to itself');
  });

  test("rejects every value JSON can't hold, naming where it is", () => {
    expect(() => canonicalJson(undefined)).toThrow("canonicalJson: the value is undefined, which JSON can't hold.");
    expect(() => canonicalJson({ a: undefined })).toThrow('canonicalJson: ["a"] is undefined');
    expect(() => canonicalJson([1n])).toThrow("canonicalJson: [0] is bigint");
    expect(() => canonicalJson({ f: () => 1 })).toThrow('["f"] is function');
    expect(() => canonicalJson(Symbol("s"))).toThrow("is symbol");
    expect(() => canonicalJson({ n: Number.NaN })).toThrow('["n"] is NaN');
    expect(() => canonicalJson([Number.NEGATIVE_INFINITY])).toThrow("[0] is -Infinity");
    expect(() => canonicalJson({ d: new Date(0) })).toThrow('["d"] is a Date object');
    expect(() => canonicalJson(new Map())).toThrow("is a Map object");
    // oxlint-disable-next-line no-sparse-arrays
    expect(() => canonicalJson([1, , 3])).toThrow("[1] is a hole in a list");
  });

  test("rejects lone surrogates in values and keys (RFC 8785 §3.2.2.2)", () => {
    expect(() => canonicalJson("\ud800")).toThrow("lone surrogate");
    expect(() => canonicalJson("a\udc00b")).toThrow("lone surrogate");
    expect(() => canonicalJson({ "\ud83d": 1 })).toThrow("lone surrogate");
    expect(canonicalJson("😀")).toBe('"😀"');
  });
});
