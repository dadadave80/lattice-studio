/**
 * Structure readers for generated files, so a property can say "this hostile name changed nothing but text":
 * a small Solidity lexer, a Markdown outline and rectangle overlap. None of them pins another WP's copy.
 */
import type { Rect } from "../model/layout";

/** A Solidity token: a string literal (escapes included), a comment, or anything else. */
export type SolidityToken = { kind: "string" | "comment" | "code"; text: string };

/**
 * Lexes Solidity into string literals, `//` and block comments, and code tokens (identifiers, numbers,
 * punctuation). Throws on an unterminated block comment or a line break inside a string literal: either means
 * something escaped its literal.
 */
export function lexSolidity(source: string): SolidityToken[] {
  const tokens: SolidityToken[] = [];
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      tokens.push({ kind: "comment", text: source.slice(i, stop) });
      i = stop;
    } else if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) throw new Error(`unterminated block comment at ${i}`);
      tokens.push({ kind: "comment", text: source.slice(i, end + 2) });
      i = end + 2;
    } else if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      let j = i + 1;
      while (j < source.length && source[j] !== quote) {
        if (source[j] === "\n" || source[j] === "\r") throw new Error(`line break inside a string literal at ${j}`);
        j += source[j] === "\\" ? 2 : 1;
      }
      if (j >= source.length) throw new Error(`unterminated string literal at ${i}`);
      tokens.push({ kind: "string", text: source.slice(i, j + 1) });
      i = j + 1;
    } else {
      const match = /^(?:[A-Za-z0-9_$]+|\s+|.)/su.exec(source.slice(i));
      const text = match?.[0] ?? source.charAt(i);
      if (text.trim() !== "") tokens.push({ kind: "code", text });
      i += text.length;
    }
  }
  return tokens;
}

/**
 * The code tokens of `source`, with string literals and comments reduced to their kind and each name in
 * `rename` replaced by its placeholder. Two scripts with the same shape run the same code.
 */
export function solidityShape(source: string, rename: Record<string, string> = {}): string[] {
  return lexSolidity(source).map((token) => (token.kind === "code" ? (rename[token.text] ?? token.text) : `<${token.kind}>`));
}

const SIMPLE_ESCAPES: Record<string, number> = { n: 0x0a, r: 0x0d, t: 0x09, '"': 0x22, "'": 0x27, "\\": 0x5c };

/**
 * The bytes solc stores for a string literal token (`"…"` or `'…'`): `\xNN` is one byte, `\uXXXX` the code
 * unit's UTF-8, `\n \r \t \" \' \\` their characters, everything else its own UTF-8. Undefined for an escape
 * solc rejects.
 */
export function solidityStringBytes(literal: string): Uint8Array | undefined {
  const body = literal.slice(1, -1);
  const out: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < body.length; i++) {
    const char = body[i] ?? "";
    if (char !== "\\") {
      const cp = body.codePointAt(i) ?? 0xfffd;
      const text = String.fromCodePoint(cp);
      out.push(...encoder.encode(text));
      i += text.length - 1;
      continue;
    }
    const next = body[i + 1] ?? "";
    if (next in SIMPLE_ESCAPES) {
      out.push(SIMPLE_ESCAPES[next] ?? 0);
      i += 1;
    } else if (next === "x" && /^[0-9a-fA-F]{2}$/.test(body.slice(i + 2, i + 4))) {
      out.push(Number.parseInt(body.slice(i + 2, i + 4), 16));
      i += 3;
    } else if (next === "u" && /^[0-9a-fA-F]{4}$/.test(body.slice(i + 2, i + 6))) {
      out.push(...encoder.encode(String.fromCharCode(Number.parseInt(body.slice(i + 2, i + 6), 16))));
      i += 5;
    } else {
      return undefined;
    }
  }
  return Uint8Array.from(out);
}

/** True when `text` (a string literal's body or a comment) is printable ASCII on one line. */
export function isPrintableAscii(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text);
}

/** One Markdown table: its header's cell count and each body row's. */
export type MarkdownTable = { line: number; columns: number; rows: number[] };

/** A fenced code block: its info string and body. */
export type MarkdownCodeBlock = { line: number; info: string; body: string };

/** What a Markdown document is built from, outside its code blocks. */
export type MarkdownOutline = {
  /** `## Recipe` as `[2, "Recipe"]`, in order. */
  headings: [number, string][];
  tables: MarkdownTable[];
  codeBlocks: MarkdownCodeBlock[];
  /** False when a fence opens and never closes. */
  balanced: boolean;
};

/** Cells in a GFM table row: pipes not escaped with a backslash, minus the outer two. */
export function tableCells(line: string): number {
  let pipes = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "|") pipes++;
  }
  return Math.max(0, pipes - 1);
}

/**
 * The outline of a Markdown document: ATX headings, GFM tables (a header, a `---` rule, body rows) and fenced
 * code blocks (a fence closes only with the same character, at least as long, CommonMark §4.5). Lines split
 * on `\n`, `\r\n` and `\r`, CommonMark's line endings.
 */
export function markdownOutline(text: string): MarkdownOutline {
  const lines = text.split(/\r\n|\r|\n/);
  const outline: MarkdownOutline = { headings: [], tables: [], codeBlocks: [], balanced: true };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/s.exec(line);
    if (fence !== null) {
      const marker = fence[1] ?? "```";
      const body: string[] = [];
      let j = i + 1;
      const closes = (candidate: string): boolean => {
        const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(candidate);
        return close !== null && (close[1] ?? "").startsWith(marker[0] ?? "`") && (close[1] ?? "").length >= marker.length && [...(close[1] ?? "")].every((c) => c === marker[0]);
      };
      while (j < lines.length && !closes(lines[j] ?? "")) body.push(lines[j++] ?? "");
      if (j >= lines.length) outline.balanced = false;
      outline.codeBlocks.push({ line: i + 1, info: (fence[2] ?? "").trim(), body: body.join("\n") });
      i = j + 1;
      continue;
    }
    const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/s.exec(line);
    if (heading !== null) {
      outline.headings.push([(heading[1] ?? "#").length, heading[2] ?? ""]);
      i++;
      continue;
    }
    const rule = lines[i + 1] ?? "";
    if (line.trimStart().startsWith("|") && /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(rule)) {
      const table: MarkdownTable = { line: i + 1, columns: tableCells(line), rows: [] };
      let j = i + 2;
      while (j < lines.length && (lines[j] ?? "").trimStart().startsWith("|")) table.rows.push(tableCells(lines[j++] ?? ""));
      outline.tables.push(table);
      i = j;
      continue;
    }
    i++;
  }
  return outline;
}

/** True when two rectangles share any area (touching edges don't count). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Every pair of rectangles that overlaps, as "a/b" with the names sorted. */
export function overlappingPairs(rects: Record<string, Rect>): string[] {
  const names = Object.keys(rects).sort();
  const out: string[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = rects[names[i] ?? ""];
      const b = rects[names[j] ?? ""];
      if (a !== undefined && b !== undefined && rectsOverlap(a, b)) out.push(`${names[i]}/${names[j]}`);
    }
  }
  return out;
}
