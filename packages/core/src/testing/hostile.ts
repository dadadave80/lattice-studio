/**
 * Hostile text for the injection properties (spec L21, L857, L859, L936): quotes, backslashes, line breaks of
 * every kind, comment openers and closers, right-to-left and other bidi controls, zero-width characters, NUL,
 * emoji (astral and joined), lone surrogates and the Markdown and HTML that could open a structure.
 */
import fc from "fast-check";

/** Pieces a name is built from; each one has broken a generator somewhere. */
export const HOSTILE_PIECES: readonly string[] = [
  '"', "'", "`", "\\", '\\"', "\n", "\r", "\r\n", "\t", "\u0000", "\u0007", "\u007f", "\u0085", " ", " ",
  "*/", "/*", "//", "/**", "-->", "<!--",
  "‮", "‭", "‏", "‎", "⁦", "⁧", "⁨", "⁩", "؜", "​", "‍", "﻿",
  "🦊", "👩‍👩‍👧", "🏳️‍🌈", "é", "é", "ﬁ", "Ａ", "中文",
  "\ud800", "\udfff",
  "```", "~~~", "|", "#", "## ", "- ", "1. ", "> ", "[x](javascript:alert(1))", "<script>", "</script>", "&amp;", "***",
  '"; selfdestruct(payable(msg.sender)); "', "unicode\"", "hex\"00\"", "} contract X {", "${x}", "%s", "0x",
  " ", "  ", "a", "Vault", "0",
];

/** Whole names that are known attacks, tried before random ones. */
export const HOSTILE_NAMES: readonly string[] = [
  '"; } contract Evil { function f() public { selfdestruct(payable(msg.sender)); } } /*',
  "*/ contract X {} /*",
  "a\nb\r\nc d e",
  "‮txt.exe⁦",
  "Vault\n## Injected heading\n\n| a | b |\n| --- | --- |\n```\nfenced\n```",
  '{"$ref":"self"}',
  "__proto__",
  "<img src=x onerror=alert(1)>",
  "🦊👩‍👩‍👧",
  "\\u0022 \\x22 \\\" \\",
  "",
  " ",
];

/** Hostile text: a known attack, pieces glued together, or random UTF-16 (lone surrogates included). */
export function hostileString(maxPieces = 8): fc.Arbitrary<string> {
  return fc.oneof(
    { weight: 1, arbitrary: fc.constantFrom(...HOSTILE_NAMES) },
    { weight: 4, arbitrary: fc.array(fc.constantFrom(...HOSTILE_PIECES), { minLength: 1, maxLength: maxPieces }).map((parts) => parts.join("")) },
    { weight: 2, arbitrary: fc.string({ unit: "binary", maxLength: 24 }) },
    { weight: 1, arbitrary: fc.string({ unit: "grapheme", maxLength: 12 }) },
  );
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** `text` with every lone surrogate replaced by U+FFFD, as `String.prototype.toWellFormed` does. */
export function wellFormed(text: string): string {
  return text.replace(LONE_SURROGATE, "�");
}

/** Hostile text that is well-formed UTF-16 (no lone surrogate), for round trips through UTF-8. */
export function hostileWellFormedString(maxPieces = 8): fc.Arbitrary<string> {
  return hostileString(maxPieces).map(wellFormed);
}

/** Hostile text with at least one character, for arguments a rule may require. */
export function hostileNonEmptyString(maxPieces = 8): fc.Arbitrary<string> {
  return hostileWellFormedString(maxPieces).map((text) => (text === "" ? "‮" : text));
}
