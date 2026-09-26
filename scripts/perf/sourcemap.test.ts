import { describe, expect, test } from "bun:test";
import { decodeMap, positionAt, sourceAt } from "./sourcemap.ts";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** VLQ-encodes one value, the way source maps do. */
function vlq(value: number): string {
  let v = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    out += BASE64[digit];
  } while (v > 0);
  return out;
}

/** Encodes absolute segments [genCol, source, line, col] per generated line into `mappings`. */
function encode(lines: number[][][]): string {
  let source = 0;
  let line = 0;
  let col = 0;
  return lines
    .map((segments) => {
      let gen = 0;
      return segments
        .map((s) => {
          const [g = 0, src, l, c] = s;
          let out = vlq(g - gen);
          gen = g;
          if (src !== undefined && l !== undefined && c !== undefined) {
            out += vlq(src - source) + vlq(l - line) + vlq(c - col);
            source = src;
            line = l;
            col = c;
          }
          return out;
        })
        .join(",");
    })
    .join(";");
}

describe("source maps", () => {
  const mappings = encode([
    [[0, 0, 0, 0], [10, 1, 4, 2], [20]],
    [[5, 0, 9, 0], [300, 1, 40, 0]],
  ]);
  const map = decodeMap({ sources: ["packages/core/src/a.ts", "node_modules/b/index.js"], mappings });

  test("finds the segment starting at or before a column", () => {
    expect(sourceAt(map, 0, 0)).toBe("packages/core/src/a.ts");
    expect(sourceAt(map, 0, 9)).toBe("packages/core/src/a.ts");
    expect(sourceAt(map, 0, 12)).toBe("node_modules/b/index.js");
    expect(positionAt(map, 0, 12)).toEqual({ source: "node_modules/b/index.js", line: 5 });
    expect(positionAt(map, 1, 299)).toEqual({ source: "packages/core/src/a.ts", line: 10 });
    expect(positionAt(map, 1, 5000)).toEqual({ source: "node_modules/b/index.js", line: 41 });
  });

  test("a segment without a source, a column before the first segment, or a line past the end map to nothing", () => {
    expect(sourceAt(map, 0, 25)).toBeNull();
    expect(sourceAt(map, 1, 2)).toBeNull();
    expect(sourceAt(map, 7, 0)).toBeNull();
  });

  test("lineOffset skips lines a plugin prepended after the map was made", () => {
    const shifted = decodeMap({ sources: ["x.ts", "y.ts"], mappings, lineOffset: 2 });
    expect(sourceAt(shifted, 0, 0)).toBeNull();
    expect(sourceAt(shifted, 2, 12)).toBe("y.ts");
  });

  test("rejects a character outside base64", () => {
    expect(() => decodeMap({ sources: [], mappings: "A!" })).toThrow('Invalid base64 VLQ character "!"');
  });
});
