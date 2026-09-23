/**
 * Exact decimal stepping for `NumberField`. Values stay decimal strings end to end: a uint256 amount never
 * passes through a JS number, so `115792089237316195423570985008687907853269984665640564039457584007913129639935`
 * steps without losing a digit.
 */

/** A bound as a decimal string ("0", "-12.5") or a bigint. */
export type DecimalBound = string | bigint;

export type DecimalStepOptions = {
  /** Lowest allowed value. Defaults to 0 unless `signed`. */
  min?: DecimalBound | undefined;
  /** Highest allowed value. */
  max?: DecimalBound | undefined;
  /** Allow negative values (int types). Unsigned fields clamp at 0. */
  signed?: boolean | undefined;
};

type Scaled = { value: bigint; digits: number };

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Parses "12", "-3.50" into an integer scaled by 10^digits. Returns null for anything else. */
function parse(text: string): Scaled | null {
  const match = DECIMAL.exec(text.trim());
  if (!match) return null;
  const [, sign, whole = "0", fraction = ""] = match;
  const magnitude = BigInt(whole + fraction);
  return { value: sign ? -magnitude : magnitude, digits: fraction.length };
}

function parseBound(bound: DecimalBound | undefined): Scaled | null {
  if (bound === undefined) return null;
  return typeof bound === "bigint" ? { value: bound, digits: 0 } : parse(bound);
}

function rescale(n: Scaled, digits: number): bigint {
  return n.value * 10n ** BigInt(digits - n.digits);
}

/** Formats a scaled integer with `digits` fraction digits, dropping trailing zeros down to `keep`. */
function format(value: bigint, digits: number, keep: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const unit = 10n ** BigInt(digits);
  let fraction = digits > 0 ? (abs % unit).toString().padStart(digits, "0") : "";
  while (fraction.length > keep && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  const text = fraction ? `${abs / unit}.${fraction}` : `${abs / unit}`;
  return negative && abs !== 0n ? `-${text}` : text;
}

/** A step size as a bigint, or null when it isn't a safe integer (a step never goes through a float). */
export function toStep(step: bigint | number): bigint | null {
  if (typeof step === "bigint") return step;
  return Number.isSafeInteger(step) ? BigInt(step) : null;
}

/**
 * Adds `delta` to the decimal in `text`, keeps its fractional part, and clamps to the bounds. An empty field
 * counts as 0. Returns null when `text` isn't a plain decimal ("1e18", "0x10", "abc"): the caller leaves it
 * untouched.
 */
export function stepDecimal(text: string, delta: bigint, options: DecimalStepOptions = {}): string | null {
  const current = text.trim() === "" ? { value: 0n, digits: 0 } : parse(text);
  if (!current) return null;
  const min = parseBound(options.min ?? (options.signed ? undefined : 0n));
  const max = parseBound(options.max);
  const digits = Math.max(current.digits, min?.digits ?? 0, max?.digits ?? 0);
  let next = rescale(current, digits) + delta * 10n ** BigInt(digits);
  if (max && next > rescale(max, digits)) next = rescale(max, digits);
  if (min && next < rescale(min, digits)) next = rescale(min, digits);
  return format(next, digits, current.digits);
}
