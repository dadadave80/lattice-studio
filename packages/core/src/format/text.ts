/**
 * Internal text helpers for C10's problem messages, console lines and formats. Not part of the public API
 * (never re-exported from `format/index.ts`, so nothing here reaches the core barrel).
 */

/** "A", "A and B", "A, B and C". */
export function joinAnd(items: readonly string[]): string {
  return join(items, "and");
}

/** "A", "A or B", "A, B or C". */
export function joinOr(items: readonly string[]): string {
  return join(items, "or");
}

function join(items: readonly string[], word: string): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} ${word} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} ${word} ${items[items.length - 1]}`;
}

/** `value` shortened to `lead` leading characters, an ellipsis, and `tail` trailing characters. */
export function truncateMiddle(value: string, lead: number, tail: number): string {
  if (value.length <= lead + tail) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

/** Addresses, transaction hashes and recipe hashes: 6 + 4 (spec L679, `0x71C7…976F`). */
export function truncateHex6(value: string): string {
  return truncateMiddle(value, 6, 4);
}

/** Codehashes: 10 + 4 (NET-01, `0xbd8a7ea8…b53f`). */
export function truncateHex10(value: string): string {
  return truncateMiddle(value, 10, 4);
}

/** The function name before the first "(": `transfer(address,uint256)` → `transfer`. */
export function functionName(signature: string): string {
  const i = signature.indexOf("(");
  return i === -1 ? signature : signature.slice(0, i);
}

/** Thousands-grouped digits: `9123456` → `"9,123,456"`. Accepts a number, a bigint or a decimal digit string. */
export function groupDigits(value: number | bigint | string): string {
  const negative = typeof value === "string" ? value.trim().startsWith("-") : value < 0;
  const raw = typeof value === "string" ? value.trim().replace(/^-/, "") : (negative ? -value : value).toString();
  const grouped = raw.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${grouped}` : grouped;
}

function trimTrailingZero(text: string): string {
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}

/** "2.4M", "16.8M", "820K", "950": one decimal above 1,000, grouped digits below (spec L682, NET-06). */
export function formatMagnitude(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${trimTrailingZero((abs / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${sign}${trimTrailingZero((abs / 1_000).toFixed(1))}K`;
  return `${sign}${groupDigits(Math.round(abs))}`;
}

/**
 * `value` rounded to `sig` significant figures, as plain (non-exponential) decimal text with no thousands
 * grouping and no padded trailing zeros. Deterministic: built on `Number.prototype.toPrecision`, which the
 * spec defines exactly (no locale).
 */
export function toSignificant(value: number, sig: number): string {
  if (value === 0) return "0";
  const negative = value < 0;
  const abs = Math.abs(value);
  let text = abs.toPrecision(sig);
  if (text.includes("e")) {
    const asNumber = Number(text);
    const exponent = Math.floor(Math.log10(asNumber));
    text = exponent >= 0 ? asNumber.toFixed(0) : asNumber.toFixed(Math.max(0, sig - exponent - 1));
  }
  if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
  return negative ? `-${text}` : text;
}

/** Lowercases only the first letter, and only when the word's second letter is already lowercase (keeps "ENS"). */
export function lowerFirst(label: string): string {
  if (label.length < 2) return label.toLowerCase();
  return /[a-z]/.test(label.charAt(1)) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}
