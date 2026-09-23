import { describe, expect, test } from "bun:test";
import { decodeBase64url, encodeBase64url } from "./base64url";
import { inflateCapped } from "./inflate";
import { deflateSync } from "fflate";

function bytes(length: number, seed: number): Uint8Array {
  return Uint8Array.from({ length }, (_, at) => (at * 131 + seed * 17) % 256);
}

describe("base64url", () => {
  test("matches RFC 4648 §5 without padding, and round trips every length", () => {
    for (let length = 0; length < 40; length++) {
      const input = bytes(length, length);
      const encoded = encodeBase64url(input);
      expect(encoded).toBe(Buffer.from(input).toString("base64url"));
      const decoded = decodeBase64url(encoded);
      expect(decoded.ok && Array.from(decoded.value)).toEqual(Array.from(input));
    }
  });

  test("accepts padding", () => {
    const decoded = decodeBase64url("AQI=");
    expect(decoded.ok && Array.from(decoded.value)).toEqual([1, 2]);
  });

  test("names the first character outside the alphabet, counting from 1", () => {
    expect(decodeBase64url("AB+C")).toEqual({ ok: false, error: { kind: "character", char: "+", position: 3 } });
    expect(decodeBase64url("ABC😀")).toEqual({ ok: false, error: { kind: "character", char: "😀", position: 4 } });
  });

  test("refuses a length no encoder writes", () => {
    expect(decodeBase64url("ABCDE")).toEqual({ ok: false, error: { kind: "length" } });
  });
});

describe("inflateCapped", () => {
  test("returns everything up to the cap and refuses one byte more", () => {
    const data = deflateSync(new Uint8Array(1000).fill(65));
    const exact = inflateCapped(data, 1000);
    expect(exact.ok && exact.value.length).toBe(1000);
    expect(inflateCapped(data, 999)).toEqual({ ok: false, error: "over" });
  });

  test("stops a bomb early: 64 MB of zeros is refused without inflating it all", () => {
    const bomb = deflateSync(new Uint8Array(64 * 1024 * 1024));
    const started = performance.now();
    expect(inflateCapped(bomb, 256 * 1024)).toEqual({ ok: false, error: "over" });
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
