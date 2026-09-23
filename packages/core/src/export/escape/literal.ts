/**
 * Solidity string literals for generated code (spec L859, decision 9): every interpolated string goes through
 * here, so a name can never end the literal or inject code (OpenZeppelin Wizard's GHSA-4x76-22x2-rx8v).
 *
 * The literal is plain printable ASCII between double quotes. `"` and `\` are escaped, `\n`, `\r` and `\t` use
 * their short escapes, every other control character and DEL is `\xNN`, a non-ASCII character in the Basic
 * Multilingual Plane (bidi controls included) is `\uXXXX`, and a character above it is its four UTF-8 bytes as
 * `\xNN`, because solc's `\u` takes four hex digits only. A lone surrogate, which has no UTF-8 form, becomes
 * U+FFFD, as `TextEncoder` (and so viem's string encoding) does. solc decodes the result to exactly the UTF-8
 * bytes of the input.
 */

const SHORT: Record<string, string> = { '"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t" };

function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}

function escapeCodePoint(cp: number): string {
  if (cp >= 0x20 && cp < 0x7f) return String.fromCodePoint(cp);
  if (cp < 0x80) return `\\x${hex2(cp)}`;
  if (cp >= 0xd800 && cp <= 0xdfff) return "\\ufffd";
  if (cp <= 0xffff) return `\\u${cp.toString(16).padStart(4, "0")}`;
  const bytes = new TextEncoder().encode(String.fromCodePoint(cp));
  return Array.from(bytes, (byte) => `\\x${hex2(byte)}`).join("");
}

/** The body of a Solidity string literal for `text`, without the quotes. */
export function escapeSolidityString(text: string): string {
  let out = "";
  for (const char of text) {
    const short = SHORT[char];
    out += short ?? escapeCodePoint(char.codePointAt(0) ?? 0xfffd);
  }
  return out;
}

/** A complete Solidity string literal for `text`: `"…"`. */
export function solidityString(text: string): string {
  return `"${escapeSolidityString(text)}"`;
}
