/**
 * Duration fields (spec L463): a number plus a unit (seconds, minutes, hours, days), stored in seconds and echoed
 * as "= 5 minutes". Pure: exact decimal arithmetic on strings and bigints, so a uint256 never loses a digit.
 */

export type DurationUnit = "seconds" | "minutes" | "hours" | "days";

export const DURATION_UNITS: readonly { value: DurationUnit; label: string; seconds: bigint; singular: string }[] = [
  { value: "seconds", label: "seconds", seconds: 1n, singular: "second" },
  { value: "minutes", label: "minutes", seconds: 60n, singular: "minute" },
  { value: "hours", label: "hours", seconds: 3600n, singular: "hour" },
  { value: "days", label: "days", seconds: 86400n, singular: "day" },
];

function unitSeconds(unit: DurationUnit): bigint {
  return DURATION_UNITS.find((u) => u.value === unit)?.seconds ?? 1n;
}

/** The largest unit that divides `seconds` evenly: 300 → 5 minutes; 0 and non-integers stay in seconds. */
export function bestUnit(seconds: string): { amount: string; unit: DurationUnit } {
  if (!/^\d+$/.test(seconds)) return { amount: seconds, unit: "seconds" };
  const n = BigInt(seconds);
  if (n === 0n) return { amount: "0", unit: "seconds" };
  for (const unit of [...DURATION_UNITS].reverse()) {
    if (n % unit.seconds === 0n) return { amount: (n / unit.seconds).toString(), unit: unit.value };
  }
  return { amount: n.toString(), unit: "seconds" };
}

/**
 * `amount` in `unit`, as whole seconds: "5" minutes → "300", "1.5" hours → "5400". Null when it isn't a plain
 * non-negative decimal or doesn't come to a whole number of seconds; the caller then stores the text as typed,
 * and INIT-01 says what's wrong with it.
 */
export function toSeconds(amount: string, unit: DurationUnit): string | null {
  const text = amount.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  const scale = 10n ** BigInt(fraction.length);
  const scaled = BigInt(whole + fraction) * unitSeconds(unit);
  if (scaled % scale !== 0n) return null;
  return (scaled / scale).toString();
}

/**
 * `seconds` in `unit`, as an exact decimal: 90 s in minutes is "1.5". Null when it doesn't come out in six
 * decimals (100 s in minutes) or isn't a whole number of seconds.
 */
export function fromSeconds(seconds: string, unit: DurationUnit): string | null {
  if (!/^\d+$/.test(seconds)) return null;
  const n = BigInt(seconds);
  const d = unitSeconds(unit);
  for (let places = 0; places <= 6; places++) {
    const scale = 10n ** BigInt(places);
    if ((n * scale) % d !== 0n) continue;
    const scaled = ((n * scale) / d).toString();
    if (places === 0) return scaled;
    const padded = scaled.padStart(places + 1, "0");
    return `${padded.slice(0, -places)}.${padded.slice(-places)}`;
  }
  return null;
}

/** "5 minutes", "1 day", "90 seconds". */
export function durationWords(seconds: string): string {
  const { amount, unit } = bestUnit(seconds);
  const entry = DURATION_UNITS.find((u) => u.value === unit);
  if (!entry) return `${seconds} seconds`;
  return `${amount} ${amount === "1" ? entry.singular : entry.label}`;
}

/**
 * The echo under a duration (spec L463): "= 5 minutes" for 300 typed in seconds. When the chosen unit already
 * reads that way ("5" minutes), the echo gives the stored seconds instead: "= 300 s". Null for text that isn't a
 * whole number of seconds.
 */
export function durationEcho(seconds: string | null, unit: DurationUnit): string | null {
  if (seconds === null || !/^\d+$/.test(seconds)) return null;
  const best = bestUnit(seconds);
  if (best.unit === unit || best.unit === "seconds") return unit === "seconds" ? `= ${durationWords(seconds)}` : `= ${seconds} s`;
  return `= ${durationWords(seconds)}`;
}
