import { describe, expect, test } from "bun:test";
import { decodeFunctionData, encodeAbiParameters, encodeErrorResult, parseAbi, toFunctionSelector, type Abi, type AbiFunction } from "viem";
import { callValue, decodeCallOutputs, decodeCallRevert, encodeCall, routedFunctions } from "./abi";

function fn(signature: string): AbiFunction {
  const abi: Abi = parseAbi([signature]);
  const item = abi[0];
  if (!item || item.type !== "function") throw new Error("The fixture isn't a function.");
  return item;
}

const ADDRESS = "0x1234567890123456789012345678901234567890";

describe("routed ABI functions", () => {
  test("keeps actual selectors, full overload signatures and mutability", () => {
    const abi = parseAbi([
      "function choose(uint256 value) view returns (uint256)",
      "function choose(address value) pure returns (address)",
      "function set(uint256 value)",
      "event Changed(uint256 value)",
    ]);
    const selectors = [toFunctionSelector("choose(address)"), toFunctionSelector("set(uint256)")];
    const rows = routedFunctions(abi, selectors);
    expect(rows.map(({ signature, readOnly }) => [signature, readOnly])).toEqual([
      ["choose(address)", true], ["set(uint256)", false],
    ]);
    expect(rows[0]?.selector).toBe(selectors[0]);
    expect(rows[0]?.abi).toBe(abi[1]);
    expect(routedFunctions(abi, [])).toEqual([]);
  });

  test("deduplicates the same signature and accepts selector hex case", () => {
    const item = fn("function total() view returns (uint256)");
    const selector = toFunctionSelector(item);
    expect(routedFunctions([item, item], [`0x${selector.slice(2).toUpperCase()}`])).toHaveLength(1);
  });
});

describe("call input encoding", () => {
  test("uses the selected overload and keeps full-width integer precision", () => {
    const item = fn("function choose(uint256)");
    const amount = (2n ** 256n - 1n).toString();
    const result = encodeCall(item, [amount]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.args).toEqual([BigInt(amount)]);
    expect(decodeFunctionData({ abi: [item], data: result.value.data }).args).toEqual([BigInt(amount)]);
    expect(result.value.data.slice(0, 10)).toBe(toFunctionSelector(item));
  });

  test("handles zero arguments and rejects an argument-count mismatch", () => {
    const item = fn("function total() view returns (uint256)");
    expect(encodeCall(item, [])).toEqual({ ok: true, value: { data: toFunctionSelector(item), args: [] } });
    const result = encodeCall(item, ["1"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.index).toBeNull();
  });

  test("accepts empty strings, significant spaces, bools and zero addresses", () => {
    const item = fn("function values(string a,string b,bool c,address d)");
    const result = encodeCall(item, ["", "  text  ", "false", "0x0000000000000000000000000000000000000000"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.args).toEqual(["", "  text  ", false, "0x0000000000000000000000000000000000000000"]);
  });

  test.each(["\ud800", "\udfff"])("rejects lone UTF-16 surrogates in scalar and nested strings", (text) => {
    expect(encodeCall(fn("function set(string note)"), [text]).ok).toBe(false);
    expect(encodeCall(fn("function batch((string[] notes) row)"), [JSON.stringify({ notes: [text] })]).ok).toBe(false);
  });

  test("preserves valid emoji and explicit surrogate pairs", () => {
    const note = "A 😀 \ud83d\ude00 Z";
    const item = fn("function set(string note)");
    const result = encodeCall(item, [note]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(decodeFunctionData({ abi: [item], data: result.value.data }).args).toEqual([note]);
  });

  test.each(["-1", (2n ** 256n).toString(), "1.5", "1e3"])("rejects invalid uint256 %s", (value) => {
    expect(encodeCall(fn("function set(uint256)"), [value]).ok).toBe(false);
  });

  test("enforces signed bounds and reports unnamed arguments by position", () => {
    const item = fn("function set(int8)");
    const good = encodeCall(item, ["-128"]);
    expect(good.ok && good.value.args).toEqual([-128n]);
    const bad = encodeCall(item, ["-129"]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error[0]?.index).toBe(0);
      expect(bad.error[0]?.message).toContain("Argument 1");
    }
  });

  test.each(["yes", "1", "TRUE", ""])("rejects invalid bool %s", (value) => {
    expect(encodeCall(fn("function set(bool enabled)"), [value]).ok).toBe(false);
  });

  test("does not resolve names, accept references or repair a bad checksum", () => {
    const item = fn("function set(address recipient)");
    const unresolved = encodeCall(item, ["alice.eth"]);
    expect(unresolved.ok).toBe(false);
    if (!unresolved.ok) expect(unresolved.error[0]?.message).toContain("Resolve");
    expect(encodeCall(item, ['{"$ref":"self"}']).ok).toBe(false);
    expect(encodeCall(item, ["0x52908400098527886E0F7030069857D2E4169Ee7"]).ok).toBe(false);
    expect(encodeCall(item, [ADDRESS]).ok).toBe(true);
  });

  test("checks byte widths and rejects incomplete hex", () => {
    const item = fn("function set(bytes2 fixedData,bytes data)");
    const result = encodeCall(item, ["0xABCD", "0x"]);
    expect(result.ok && result.value.args).toEqual(["0xabcd", "0x"]);
    expect(encodeCall(item, ["0xab", "0x12"]).ok).toBe(false);
    expect(encodeCall(item, ["0xabcd", "0x1"]).ok).toBe(false);
  });

  test("encodes nested named tuples and fixed arrays from JSON", () => {
    const item = fn("function batch((uint256 amount,bool allowed,address recipient)[] rows,uint8[2] flags)");
    const result = encodeCall(item, [`[{"amount":"9007199254740993","allowed":true,"recipient":"${ADDRESS}"}]`, "[1,2]"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.args).toEqual([[[9007199254740993n, true, ADDRESS]], [1n, 2n]]);
  });

  test("supports positional unnamed nested tuples without dropping components", () => {
    const item = fn("function batch((uint256,bool)[])");
    const result = encodeCall(item, ['[["9007199254740993",true],[7,false]]']);
    expect(result.ok && result.value.args).toEqual([[[9007199254740993n, true], [7n, false]]]);
  });

  test.each([
    "[9007199254740993]", "[1.5]", "[null]", "[{}]", "not JSON",
  ])("rejects unsafe or invalid array input %s", (text) => {
    expect(encodeCall(fn("function batch(uint256[] values)"), [text]).ok).toBe(false);
  });

  test.each(["[1.0000000000000001]", "[9007199254740991.4]", "[1e-999]", "[1e3]"])("rejects noninteger source tokens before JSON can round %s", (text) => {
    const result = encodeCall(fn("function batch(uint256[] values)"), [text]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.message).toContain("decimal");
  });

  test("does not round fractional or exponent tokens in nested tuples or signed arrays", () => {
    expect(encodeCall(fn("function batch((uint256[][] values,bool enabled) row)"), ['{"values":[[1e-999]],"enabled":true}']).ok).toBe(false);
    expect(encodeCall(fn("function batch(int256[] values)"), ["[-1.0000000000000001,-9007199254740991.4]"]).ok).toBe(false);
  });

  test("keeps safe JSON integers and ignores numeric-looking strings, escaped quotes and keys", () => {
    const item = fn("function batch((uint256 n1e999,string note) row,uint256[] values)");
    const note = '1.0000000000000001 and "1e-999"';
    const result = encodeCall(item, [JSON.stringify({ n1e999: 1, note }), '[0,9007199254740991,"9007199254740993"]']);
    expect(result.ok && result.value.args).toEqual([[1n, note], [0n, 9007199254740991n, 9007199254740993n]]);
  });

  test("reports nested field errors and rejects extra tuple fields and prototype keys", () => {
    const item = fn("function batch((uint8 amount,bool allowed)[] rows)");
    const result = encodeCall(item, ['[{"amount":256,"allowed":true}]']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.message).toContain("rows[0].amount");
    expect(encodeCall(item, ['[{"amount":1,"allowed":true,"extra":2}]']).ok).toBe(false);
    expect(encodeCall(item, ['[{"amount":1,"allowed":true,"__proto__":{}}]']).ok).toBe(false);
    expect(encodeCall(item, ['[{"amount":1}]']).ok).toBe(false);
    expect(encodeCall(fn("function batch(uint8[2][] rows)"), ["[[1]]"]).ok).toBe(false);
  });
});

describe("call value", () => {
  const payable = fn("function pay() payable");
  const nonpayable = fn("function set()");

  test("defaults to zero and permits nonzero value only for payable functions", () => {
    expect(callValue(nonpayable, "")).toEqual({ ok: true, value: 0n });
    expect(callValue(nonpayable, "0")).toEqual({ ok: true, value: 0n });
    expect(callValue(nonpayable, "1").ok).toBe(false);
    expect(callValue(payable, "9007199254740993")).toEqual({ ok: true, value: 9007199254740993n });
  });

  test.each(["-1", "1.1", "1e3", (2n ** 256n).toString()])("rejects invalid wei %s", (text) => {
    expect(callValue(payable, text).ok).toBe(false);
  });
});

describe("call decoding", () => {
  test("returns labeled, JSON-safe values without losing large integers", () => {
    const item = fn("function get() view returns (uint256 balance,(uint8 tag,string note) row)");
    const data = encodeAbiParameters(item.outputs, [9007199254740993n, [7, "hello"]]);
    const result = decodeCallOutputs(item, data);
    expect(result).toEqual({ ok: true, value: [
      { name: "balance", type: "uint256", value: "9007199254740993" },
      { name: "row", type: "tuple", value: { tag: "7", note: "hello" } },
    ] });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  test("preserves unnamed outputs/tuple members and handles no output", () => {
    const item = fn("function get() view returns ((uint256,bool),uint256[])");
    const data = encodeAbiParameters(item.outputs, [[9n, false], [10n, 11n]]);
    const result = decodeCallOutputs(item, data);
    expect(result.ok && result.value.map((row) => row.value)).toEqual([["9", false], ["10", "11"]]);
    expect(decodeCallOutputs(fn("function set()"), "0x")).toEqual({ ok: true, value: [] });
    expect(decodeCallOutputs(item, "0x").ok).toBe(false);
    expect(decodeCallOutputs(item, "0x1").ok).toBe(false);
  });

  test("does not drop tuple values when ABI component names repeat", () => {
    const item = fn("function get() view returns ((uint256 same,uint256 same) row)");
    const data = encodeAbiParameters(item.outputs, [[9n, 10n]]);
    const result = decodeCallOutputs(item, data);
    expect(result.ok && result.value[0]?.value).toEqual(["9", "10"]);
  });

  test("keeps prototype-sensitive tuple output components by position", () => {
    const item = fn("function get() view returns ((uint256 __proto__,uint256 safe) pair)");
    const data = encodeAbiParameters(item.outputs, [[9n, 10n]]);
    const result = decodeCallOutputs(item, data);
    expect(result.ok && result.value[0]?.value).toEqual(["9", "10"]);
  });

  test("keeps prototype-sensitive tuple components in custom reverts", () => {
    const abi: Abi = parseAbi(["error Pairs((uint256 __proto__,uint256 safe)[] pairs)"]);
    const data = encodeErrorResult({ abi, errorName: "Pairs", args: [[[9n, 10n], [11n, 12n]]] });
    const result = decodeCallRevert(abi, data);
    expect(result.errorName).toBe("Pairs");
    expect(result.args[0]?.value).toEqual([["9", "10"], ["11", "12"]]);
    expect(result.raw).toBe(data);
  });

  test("decodes custom and standard reverts while retaining exact raw bytes", () => {
    const abi = parseAbi(["error NotAllowed(address caller,uint256 amount)"]);
    const data = encodeErrorResult({ abi, errorName: "NotAllowed", args: [ADDRESS, 9007199254740993n] });
    expect(decodeCallRevert(abi, data)).toEqual({ raw: data, errorName: "NotAllowed", args: [
      { name: "caller", type: "address", value: ADDRESS },
      { name: "amount", type: "uint256", value: "9007199254740993" },
    ] });
    const standard = encodeErrorResult({ abi: parseAbi(["error Error(string)"]), errorName: "Error", args: ["Denied"] });
    expect(decodeCallRevert([], standard).errorName).toBe("Error");
    const panic = encodeErrorResult({ abi: parseAbi(["error Panic(uint256)"]), errorName: "Panic", args: [17n] });
    expect(decodeCallRevert([], panic).args[0]?.value).toBe("17");
  });

  test("keeps unknown, empty and truncated revert data opaque", () => {
    expect(decodeCallRevert([], "0xdeadbeef")).toEqual({ raw: "0xdeadbeef", errorName: null, args: [] });
    expect(decodeCallRevert([], "0x")).toEqual({ raw: "0x", errorName: null, args: [] });
    expect(decodeCallRevert(parseAbi(["error Error(string)"]), "0x08c379a0").errorName).toBeNull();
  });
});
