import { describe, expect, test } from "bun:test";
import type { FieldModel } from "@lattice-studio/core";
import { argAt, displayText, isEnsName, parseFieldText, refFromText, stepOf } from "./field-value";

const address: FieldModel = {
  path: "bundle.p.asset", name: "asset", label: "Asset", type: "address", kind: "address", doc: "", required: true,
  allowZero: false, authority: false,
};
const quorum: FieldModel = {
  path: "bundle.p.quorumNumerator", name: "quorumNumerator", label: "Governor quorum", type: "uint256", kind: "percent",
  doc: "", unit: "percent", min: "0", max: "100", required: true, allowZero: true, authority: false,
};

describe("what an init field stores (spec L462-L466)", () => {
  test("addresses are paste-friendly and stored checksummed", () => {
    expect(parseFieldText(address, "  0x71c7656ec7ab88b098defb751b7401b5f6d8976f ")).toEqual({
      ok: true,
      value: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    });
  });

  test("an address whose checksum doesn't match stays on the field, since saving would re-checksum it", () => {
    const parsed = parseFieldText(address, "0x71C7656EC7ab88b098defB751B7401B5f6d8976f");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("checksum doesn't match");
  });

  test("references by name", () => {
    expect(parseFieldText(address, "This diamond")).toEqual({ ok: true, value: { $ref: "self" } });
    expect(refFromText("deploying account")).toBe("deployer");
    expect(displayText({ $ref: "deployer" })).toBe("Deploying account");
  });

  test("a value that breaks its rule is stored as typed, so INIT-01 names it in Problems", () => {
    expect(parseFieldText(quorum, "140")).toEqual({ ok: true, value: "140" });
    expect(parseFieldText(quorum, "004")).toEqual({ ok: true, value: "4" });
  });

  test("reads nested arguments and names ENS names", () => {
    expect(argAt({ p: { asset: "0x1" } }, ["p", "asset"])).toBe("0x1");
    expect(argAt({ p: { $ref: "self" } }, ["p", "asset"])).toBeUndefined();
    expect(stepOf("steps[2].admin")).toBe("steps[2]");
    expect(isEnsName("vault.eth")).toBe(true);
    expect(isEnsName("0xabc.eth")).toBe(false);
    expect(isEnsName("vault")).toBe(false);
  });
});
