import { describe, expect, test } from "bun:test";
import { parseInspectionTarget } from "./target";
import { parseRoute } from "@/app/routes";

const ADDRESS = "0x00000000000000000000000000000000000000aa";

describe("inspection target input", () => {
  test("a diamond route supplies its chain and preserves the address", () => {
    expect(parseInspectionTarget(`#d=11155111:${ADDRESS}`)).toEqual({
      ok: true, value: { chainId: 11155111, target: ADDRESS },
    });
  });

  test("legacy links and already parsed route payloads keep working", () => {
    for (const input of [`#open=eip155:84532:${ADDRESS}`, `eip155:84532:${ADDRESS}`, `84532:${ADDRESS}`]) {
      expect(parseInspectionTarget(input)).toEqual({ ok: true, value: { chainId: 84532, target: ADDRESS } });
    }
  });

  test("pasted web links decode names without reading the linked server", () => {
    expect(parseInspectionTarget("https://studio.example/ipfs/app/#d=11155111%3Ab%C3%BCcher.eth")).toEqual({
      ok: true, value: { chainId: 11155111, target: "bücher.eth" },
    });
  });

  test("plain addresses and names use the chain chosen in the Open dialog", () => {
    for (const input of [ADDRESS, "  alice.eth  "]) {
      expect(parseInspectionTarget(input, 31337)).toEqual({ ok: true, value: { chainId: 31337, target: input.trim() } });
    }
  });

  test("an embedded chain wins over the dialog's previous selection", () => {
    expect(parseInspectionTarget("84532:alice.eth", 11155111)).toEqual({
      ok: true, value: { chainId: 84532, target: "alice.eth" },
    });
  });

  test("links must carry their own chain instead of borrowing a selected chain", () => {
    for (const input of ["#d=alice.eth", "#open=alice.eth", "https://studio.example/#d=alice.eth"]) {
      expect(parseInspectionTarget(input, 11155111).ok).toBe(false);
    }
    expect(parseInspectionTarget("alice.eth").ok).toBe(false);
  });

  test("router payloads are validated without a dialog's fallback chain", () => {
    for (const hash of ["#d=alice.eth", "#open=alice.eth"]) {
      const route = parseRoute({ hash, pathname: "/" }, { paths: false, base: "/" });
      if (route.kind !== "open") throw new Error("The diamond route wasn't recognized.");
      expect(parseInspectionTarget(route.target).ok).toBe(false);
    }
    const route = parseRoute({ hash: "#d=84532:alice.eth", pathname: "/" }, { paths: false, base: "/" });
    if (route.kind !== "open") throw new Error("The diamond route wasn't recognized.");
    expect(parseInspectionTarget(route.target)).toEqual({ ok: true, value: { chainId: 84532, target: "alice.eth" } });
  });

  test("rejects invalid chain ids and empty targets", () => {
    for (const input of ["0:alice.eth", "-1:alice.eth", "1.5:alice.eth", "1e3:alice.eth", "9007199254740992:alice.eth", "11155111:", ""]) {
      expect(parseInspectionTarget(input).ok).toBe(false);
    }
    expect(parseInspectionTarget("alice.eth", Number.NaN).ok).toBe(false);
  });

  test("malformed and unrelated links fail without echoing their contents", () => {
    for (const input of ["#d=11155111:%zz", "#s=secret", "#/settings", "https://studio.example/#s=secret", "https://studio.example/?key=secret", "ftp://studio.example/#d=1:alice.eth"]) {
      const result = parseInspectionTarget(input, 11155111);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).not.toContain("secret");
    }
  });
});
