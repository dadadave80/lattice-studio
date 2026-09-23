import { describe, expect, test } from "bun:test";
import { diffJson, formatDrift, type JsonValue } from "./schema-drift-logic.ts";

describe("diffJson", () => {
  test("identical trees drift nowhere", () => {
    const a: JsonValue = { type: "object", properties: { name: { type: "string" } } };
    expect(diffJson(a, structuredClone(a))).toEqual([]);
  });

  test("a changed leaf reports its path", () => {
    const expected: JsonValue = { type: "object", properties: { name: { type: "string" } } };
    const actual: JsonValue = { type: "object", properties: { name: { type: "number" } } };
    expect(diffJson(expected, actual)).toEqual([{ path: "$.properties.name.type", expected: '"string"', actual: '"number"' }]);
  });

  test("a key only on one side reports as missing on the other", () => {
    const expected: JsonValue = { a: 1, b: 2 };
    const actual: JsonValue = { a: 1 };
    expect(diffJson(expected, actual)).toEqual([{ path: "$.b", expected: "2", actual: "(missing)" }]);
  });

  test("array length differences report once, not per element", () => {
    const expected: JsonValue = { required: ["a", "b"] };
    const actual: JsonValue = { required: ["a"] };
    expect(diffJson(expected, actual)).toEqual([{ path: "$.required.length", expected: "2", actual: "1" }]);
  });

  test("nested arrays of objects diff element by element", () => {
    const expected: JsonValue = { anyOf: [{ type: "string" }, { type: "number" }] };
    const actual: JsonValue = { anyOf: [{ type: "string" }, { type: "boolean" }] };
    expect(diffJson(expected, actual)).toEqual([{ path: "$.anyOf[1].type", expected: '"number"', actual: '"boolean"' }]);
  });
});

describe("formatDrift", () => {
  test("renders one indented line per drift", () => {
    const text = formatDrift([{ path: "$.a", expected: "1", actual: "2" }]);
    expect(text).toBe("  $.a: expected 1, got 2");
  });
});
