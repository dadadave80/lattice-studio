import type {
  FormatAddressFn, FormatCountFn, FormatDurationFn, FormatFeeFn, FormatGasFn, FormatKeysFn, FormatSelectorFn,
  FormatTimeFn, PluralFn,
} from "../model/api";
import type { Platform, RelativeTime } from "../model/console";
import { toChecksum } from "../model/hex";
import type { DiamondState } from "../model/project";
import { formatMagnitude, functionName, groupDigits, toSignificant, truncateHex6 } from "./text";

/**
 * `transfer(address,uint256)` 0xa9059cbb (full: the signature backticked, hex bare) or `transfer · 0xa9059cbb`
 * (dense: the whole span backticked, function name only) (spec L679).
 */
export const formatSelector: FormatSelectorFn = (selector, style = "full") => {
  if (style === "dense") return `\`${functionName(selector.signature)} · ${selector.hex}\``;
  return `\`${selector.signature}\` ${selector.hex}`;
};

/**
 * ENS name first when known (`full` shows both, "name (0x…)"); otherwise checksummed `0x1234…abcd` (6 + 4),
 * full and checksummed on `full` (spec L679).
 */
export const formatAddress: FormatAddressFn = (address, opts = {}) => {
  const checksummed = toChecksum(address);
  if (opts.full) return opts.ens ? `${opts.ens} (${checksummed})` : checksummed;
  if (opts.ens) return opts.ens;
  return truncateHex6(checksummed);
};

/** "12/17 selectors" (spec L680): plural agrees with `exported`. */
export const formatCount: FormatCountFn = (routed, exported) => `${routed}/${exported} ${exported === 1 ? "selector" : "selectors"}`;

/** "about 2.4M gas" (spec L682). */
export const formatGas: FormatGasFn = (gas) => `about ${formatMagnitude(Number(gas))} gas`;

/** Native token, 4 significant figures, no fiat (spec L682). */
export const formatFee: FormatFeeFn = (wei, symbol, decimals = 18) => {
  const value = Number(wei) / 10 ** decimals;
  return `${toSignificant(value, 4)} ${symbol}`;
};

const DURATION_UNITS: readonly { seconds: bigint; singular: string; plural: string }[] = [
  { seconds: 86_400n, singular: "day", plural: "days" },
  { seconds: 3_600n, singular: "hour", plural: "hours" },
  { seconds: 60n, singular: "minute", plural: "minutes" },
];

/** "5 minutes (300 s)" (spec L680): the largest unit that divides the duration evenly, else plain seconds. */
export const formatDuration: FormatDurationFn = (input) => {
  const seconds = BigInt(input);
  for (const unit of DURATION_UNITS) {
    if (seconds >= unit.seconds && seconds % unit.seconds === 0n) {
      const count = seconds / unit.seconds;
      return `${count} ${count === 1n ? unit.singular : unit.plural} (${seconds} s)`;
    }
  }
  return `${seconds} ${seconds === 1n ? "second" : "seconds"} (${seconds} s)`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** A UTC tooltip string, built from `Date`'s UTC getters only, so it never depends on locale or the host's timezone. */
function absoluteTitle(at: string): string {
  const d = new Date(at);
  const month = MONTHS[d.getUTCMonth()] ?? "Jan";
  return `${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}, ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

function relativeText(diffSeconds: number): string {
  if (diffSeconds < 60) return "just now";
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

/** "2 min ago", with the absolute time for the tooltip (spec L681). Both times are ISO strings. */
export const formatTime: FormatTimeFn = (at, now) => {
  const diffSeconds = Math.max(0, Math.round((Date.parse(now) - Date.parse(at)) / 1000));
  const result: RelativeTime = { text: relativeText(diffSeconds), title: absoluteTitle(at) };
  return result;
};

type KeyLabel = { mac: string; other: string };

const KEY_LABELS: Record<string, KeyLabel> = {
  Mod: { mac: "⌘", other: "Ctrl" },
  Ctrl: { mac: "⌃", other: "Ctrl" },
  Shift: { mac: "⇧", other: "Shift" },
  Alt: { mac: "⌥", other: "Alt" },
  Enter: { mac: "⏎", other: "Enter" },
  Esc: { mac: "Esc", other: "Esc" },
  Tab: { mac: "⇥", other: "Tab" },
  ArrowUp: { mac: "↑", other: "Up" },
  ArrowDown: { mac: "↓", other: "Down" },
  ArrowLeft: { mac: "←", other: "Left" },
  ArrowRight: { mac: "→", other: "Right" },
};

/** Fixed order on macOS (⌃⌥⇧⌘), regardless of the order `keys` names them. */
const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Mod"] as const;

function keyLabel(token: string, platform: Platform): string {
  return KEY_LABELS[token]?.[platform] ?? token;
}

/** "Mod+C" → "⌘C" on macOS, "Ctrl+C" elsewhere (spec L682, IR L11). */
export const formatKeys: FormatKeysFn = (keys, platform) => {
  const tokens = keys.split("+");
  const modifiers = tokens.filter((t) => (MODIFIER_ORDER as readonly string[]).includes(t));
  const rest = tokens.filter((t) => !(MODIFIER_ORDER as readonly string[]).includes(t));
  if (platform === "mac") {
    const ordered = [...MODIFIER_ORDER.filter((m) => modifiers.includes(m)), ...rest];
    return ordered.map((t) => keyLabel(t, platform)).join("");
  }
  return [...modifiers, ...rest].map((t) => keyLabel(t, platform)).join("+");
};

/** "1 selector", "2 selectors": `count`, grouped, then `one` or `many` (default `one` + "s"). */
export const plural: PluralFn = (count, one, many) => {
  const isOne = typeof count === "bigint" ? count === 1n : count === 1;
  const word = isOne ? one : (many ?? `${one}s`);
  return `${groupDigits(count)} ${word}`;
};

/**
 * "[03]": two digits everywhere (spec L679), zero-based (IR L125 "[00] ADD"), growing past 99 ("[100]").
 * Has no `model/api.ts` type (WP-C10's brief): local to this module.
 */
export function formatCutIndex(index: number): string {
  return `[${String(index).padStart(2, "0")}]`;
}

/**
 * The diamond-state stamp (spec L681, `ProjectStatus.stamp`): "Not deployed", "Proposed · {chain} (Safe)",
 * "Live · {chain} · r{n}", "Modified since r{n}", "Mismatch · {chain}". `state` is `model/project.ts`'s
 * `DiamondState`, so C5a's `projectStatus` can build its `stamp` field straight from this. The spec's table
 * covers five of the eight states; "pending", "failed" and "from-file" aren't in it, so this module gives them
 * a stamp in the same voice (interpretation, C10's report).
 * Has no `model/api.ts` type (WP-C10's brief): local to this module.
 */
export function formatStamp(args: { state: DiamondState; chain?: string; revision?: number }): string {
  const { state, chain, revision } = args;
  switch (state) {
    case "not-deployed":
      return "Not deployed";
    case "pending":
      return `Pending · ${chain}`;
    case "proposed":
      return `Proposed · ${chain} (Safe)`;
    case "live":
      return `Live · ${chain} · r${revision}`;
    case "modified":
      return `Modified since r${revision}`;
    case "mismatch":
      return `Mismatch · ${chain}`;
    case "failed":
      return `Failed · ${chain}`;
    case "from-file":
      return "From file";
  }
}

/**
 * The problems chip (spec L681): "No problems", "2 blockers", "2 blockers · 1 warning". The spec's examples
 * carry no info count, so this omits it too (interpretation, C10's report).
 * Has no `model/api.ts` type (WP-C10's brief): local to this module.
 */
export function formatProblemSummary(counts: { blockers: number; warnings: number }): string {
  if (counts.blockers === 0 && counts.warnings === 0) return "No problems";
  const parts: string[] = [];
  if (counts.blockers > 0) parts.push(plural(counts.blockers, "blocker"));
  if (counts.warnings > 0) parts.push(plural(counts.warnings, "warning"));
  return parts.join(" · ");
}
