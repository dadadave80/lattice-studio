import { err, ok, type Result } from "../model/result";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Character code → 6-bit value; -1 for anything outside the base64url alphabet. */
const VALUES: readonly number[] = (() => {
  const table = Array.from({ length: 128 }, () => -1);
  for (let at = 0; at < ALPHABET.length; at++) table[ALPHABET.charCodeAt(at)] = at;
  return table;
})();

/** RFC 4648 §5 base64url without padding. */
export function encodeBase64url(bytes: Uint8Array): string {
  let out = "";
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at] ?? 0;
    const b = bytes[at + 1] ?? 0;
    const c = bytes[at + 2] ?? 0;
    const left = bytes.length - at;
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 3) << 4) | (b >> 4)];
    if (left > 1) out += ALPHABET[((b & 15) << 2) | (c >> 6)];
    if (left > 2) out += ALPHABET[c & 63];
  }
  return out;
}

/** Why a base64url string didn't decode. */
export type Base64urlError =
  | { kind: "character"; char: string; position: number }
  | { kind: "length" };

/**
 * Decodes base64url, with or without `=` padding. Fails on the first character outside the alphabet
 * (`position` counts from 1) and on a length no encoder produces (one character left over).
 */
export function decodeBase64url(text: string): Result<Uint8Array, Base64urlError> {
  const body = text.replace(/={1,2}$/, "");
  const values = new Uint8Array(body.length);
  for (let at = 0; at < body.length; at++) {
    const code = body.charCodeAt(at);
    const value = code < 128 ? (VALUES[code] ?? -1) : -1;
    if (value < 0) return err({ kind: "character", char: String.fromCodePoint(body.codePointAt(at) ?? code), position: at + 1 });
    values[at] = value;
  }
  if (body.length % 4 === 1) return err({ kind: "length" });
  const bytes = new Uint8Array(Math.floor((body.length * 3) / 4));
  let out = 0;
  for (let at = 0; at < body.length; at += 4) {
    const a = values[at] ?? 0;
    const b = values[at + 1] ?? 0;
    const c = values[at + 2] ?? 0;
    const d = values[at + 3] ?? 0;
    const left = body.length - at;
    bytes[out++] = (a << 2) | (b >> 4);
    if (left > 2) bytes[out++] = ((b & 15) << 4) | (c >> 2);
    if (left > 3) bytes[out++] = ((c & 3) << 6) | d;
  }
  return ok(bytes);
}
