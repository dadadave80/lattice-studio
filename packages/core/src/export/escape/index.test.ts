import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { commentText, escapeSolidityString, isSafeIdentifier, pascalIdentifier, sanitizeIdentifier, solidityString } from "./index";

/** Decodes a Solidity string literal the way solc does (escapes to UTF-8 bytes), or throws on anything solc rejects. */
function decodeLiteral(literal: string): Uint8Array {
  if (!literal.startsWith('"') || !literal.endsWith('"') || literal.length < 2) throw new Error("not a quoted literal");
  const body = literal.slice(1, -1);
  const out: number[] = [];
  for (let i = 0; i < body.length; i += 1) {
    const ch = body.charCodeAt(i);
    if (ch < 0x20 || ch > 0x7e) throw new Error(`raw non-printable 0x${ch.toString(16)} at ${i}`);
    if (body[i] === '"') throw new Error(`unescaped quote at ${i}`);
    if (body[i] !== "\\") {
      out.push(ch);
      continue;
    }
    const next = body[i + 1];
    i += 1;
    if (next === "\\" || next === '"' || next === "'") out.push(next.charCodeAt(0));
    else if (next === "n") out.push(0x0a);
    else if (next === "r") out.push(0x0d);
    else if (next === "t") out.push(0x09);
    else if (next === "x") {
      out.push(Number.parseInt(body.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (next === "u") {
      const cp = Number.parseInt(body.slice(i + 1, i + 5), 16);
      if (cp >= 0xd800 && cp <= 0xdfff) throw new Error("solc rejects a surrogate \\u escape");
      out.push(...new TextEncoder().encode(String.fromCodePoint(cp)));
      i += 4;
    } else throw new Error(`unknown escape \\${next}`);
  }
  return Uint8Array.from(out);
}

describe("solidityString", () => {
  test("escapes quotes, backslashes and line breaks", () => {
    expect(solidityString('a"b\\c\nd\re\tf')).toBe('"a\\"b\\\\c\\nd\\re\\tf"');
    expect(escapeSolidityString("plain text 123")).toBe("plain text 123");
  });

  test("writes controls as \\x, BMP characters (bidi controls included) as \\u and astral ones as UTF-8 bytes", () => {
    expect(solidityString("\u0000\u007f")).toBe('"\\x00\\x7f"');
    expect(solidityString("‮evil⁦")).toBe('"\\u202eevil\\u2066"');
    expect(solidityString("café")).toBe('"caf\\u00e9"');
    expect(solidityString("\u{1F600}")).toBe('"\\xf0\\x9f\\x98\\x80"');
    expect(solidityString("a\ud800b")).toBe('"a\\ufffdb"');
  });

  test("any string round-trips to its UTF-8 bytes, inside one printable-ASCII literal", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 64 }), (text) => {
        const literal = solidityString(text);
        expect(literal).toMatch(/^"[\x20-\x7e]*"$/);
        expect(decodeLiteral(literal)).toEqual(new TextEncoder().encode(text));
      }),
      { numRuns: 500 },
    );
  });
});

describe("commentText", () => {
  test("keeps plain text and folds line breaks and tabs into spaces", () => {
    expect(commentText("ERC20Init.init(string,string)")).toBe("ERC20Init.init(string,string)");
    expect(commentText("  a\n\tb\r\n c  ")).toBe("a b c");
  });

  test("breaks a star-slash and makes bidi and other hidden characters visible", () => {
    expect(commentText("x */ y")).toBe("x * / y");
    expect(commentText("**/")).toBe("** /");
    expect(commentText("‮abc")).toBe("\\u202eabc");
    expect(commentText(" \u0085")).toBe("\\u2028\\u0085");
    expect(commentText("\u{1F600}")).toBe("\\u{1f600}");
  });

  test("any text becomes one line of printable ASCII with no star-slash", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 64 }), (text) => {
        const safe = commentText(text);
        expect(safe).toMatch(/^[\x20-\x7e]*$/);
        expect(safe.includes("*/")).toBe(false);
        expect(safe).toBe(safe.trim());
      }),
      { numRuns: 500 },
    );
  });
});

describe("identifiers", () => {
  test("sanitizeIdentifier keeps valid names and repairs the rest", () => {
    expect(sanitizeIdentifier("ERC20")).toBe("ERC20");
    expect(sanitizeIdentifier("Governed Vault!")).toBe("GovernedVault");
    expect(sanitizeIdentifier("1st")).toBe("_1st");
    expect(sanitizeIdentifier("contract")).toBe("contract_");
    expect(sanitizeIdentifier("uint48")).toBe("uint48_");
    expect(sanitizeIdentifier("", "Diamond")).toBe("Diamond");
    expect(sanitizeIdentifier("éé", "")).toBe("Unnamed");
  });

  test("pascalIdentifier joins words", () => {
    expect(pascalIdentifier("GovernedVault (shared)")).toBe("GovernedVaultShared");
    expect(pascalIdentifier("my token v2")).toBe("MyTokenV2");
    expect(pascalIdentifier('"; drop */', "Diamond")).toBe("Drop");
    expect(pascalIdentifier("‮", "Diamond")).toBe("Diamond");
  });

  test("any text sanitizes to [A-Za-z0-9_], never a keyword or a leading digit", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 32 }), fc.string({ maxLength: 8 }), (text, fallback) => {
        for (const name of [sanitizeIdentifier(text, fallback), pascalIdentifier(text, fallback)]) {
          expect(name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
          expect(isSafeIdentifier(name)).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });
});
