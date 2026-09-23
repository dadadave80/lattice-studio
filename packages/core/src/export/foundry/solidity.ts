/**
 * Emitting Solidity that is already `forge fmt`-clean on the default settings (line length 120, four-space
 * indent). Generated code only uses shapes whose formatting is pinned by compile.test.ts's fmt probe: calls as
 * statements or assigned, single-token assignments and state-variable declarations. It never returns or reverts
 * with a long call, whose breaking forge fmt decides differently. Every literal comes from a typed emitter below,
 * so nothing interpolated can leave its token.
 */
import { solidityString } from "../escape";
import { isAddress, isHexAnyCase, toChecksum, type Hex } from "../../model/hex";

/** `forge fmt`'s default line length. */
export const LINE_LENGTH = 120;

/** `depth` levels of four-space indentation. */
export function indent(depth: number): string {
  return "    ".repeat(depth);
}

/** forge fmt measures a statement without its trailing `;`. */
function fits(line: string, suffix: string): boolean {
  return line.length - suffix.length <= LINE_LENGTH;
}

/**
 * `prefix` + `fn(args)` + `suffix` at `depth`, formatted as forge fmt formats a call statement or an assignment
 * of a call: one line; else, for an assignment, the call alone on the next line; else the arguments on one line
 * of their own; else one argument per line. `prefix` is "" or `lhs = `.
 */
export function callLines(depth: number, prefix: string, fn: string, args: readonly string[], suffix = ";"): string[] {
  if (prefix !== "" && !prefix.endsWith(" = ")) throw new TypeError(`callLines takes "" or an assignment, not ${JSON.stringify(prefix)}`);
  const pad = indent(depth);
  const flat = `${pad}${prefix}${fn}(${args.join(", ")})${suffix}`;
  if (fits(flat, suffix) || args.length === 0) return [flat];
  const inner = indent(depth + 1);
  if (prefix !== "") {
    // On its own line the call's `;` counts.
    const call = `${inner}${fn}(${args.join(", ")})${suffix}`;
    if (call.length <= LINE_LENGTH) return [`${pad}${prefix.trimEnd()}`, call];
  }
  const joined = `${inner}${args.join(", ")}`;
  if (joined.length <= LINE_LENGTH) return [`${pad}${prefix}${fn}(`, joined, `${pad})${suffix}`];
  return [
    `${pad}${prefix}${fn}(`,
    ...args.map((arg, i) => `${inner}${arg}${i < args.length - 1 ? "," : ""}`),
    `${pad})${suffix}`,
  ];
}

/** The statement `lhs = value;` at `depth`, broken after `=` when it doesn't fit. `value` is one token. */
export function assignLines(depth: number, lhs: string, value: string): string[] {
  const flat = `${indent(depth)}${lhs} = ${value};`;
  if (fits(flat, ";")) return [flat];
  return [`${indent(depth)}${lhs} =`, `${indent(depth + 1)}${value};`];
}

/**
 * The state-variable declaration `decl = value;` at `depth`, broken after `=` when it doesn't fit. forge fmt
 * counts the `;` of a declaration, unlike a statement's.
 */
export function declarationLines(depth: number, decl: string, value: string): string[] {
  const flat = `${indent(depth)}${decl} = ${value};`;
  if (flat.length <= LINE_LENGTH) return [flat];
  return [`${indent(depth)}${decl} =`, `${indent(depth + 1)}${value};`];
}

/** An EIP-55 address literal; solc rejects a literal with a wrong checksum. */
export function addressLiteral(address: string): string {
  if (!isAddress(address)) throw new TypeError(`Not an address: ${JSON.stringify(address)}`);
  return toChecksum(address);
}

/** A `bytesN` hex number literal: `0x` and exactly 2·N lowercase hex digits. */
export function fixedBytesLiteral(value: string, bytes: number): string {
  if (!isHexAnyCase(value) || value.length !== 2 + bytes * 2) {
    throw new TypeError(`Not ${bytes} bytes of hex: ${JSON.stringify(value)}`);
  }
  return value.toLowerCase();
}

/** A `hex"…"` literal for dynamic bytes. */
export function hexStringLiteral(value: Hex): string {
  if (!isHexAnyCase(value) || value.length % 2 !== 0) throw new TypeError(`Not hex bytes: ${JSON.stringify(value)}`);
  return `hex"${value.slice(2).toLowerCase()}"`;
}

/** A string literal, escaped by the Solidity string-literal encoder. */
export function stringLiteral(text: string): string {
  return solidityString(text);
}

/** A decimal integer literal cast to its type: `uint48(600)`, `int256(-5)`. */
export function integerLiteral(type: string, value: bigint): string {
  if (!/^u?int\d+$/.test(type)) throw new TypeError(`Not an integer type: ${type}`);
  return `${type}(${value.toString(10)})`;
}
