/**
 * The overlay's `rule` grammar (contracts §4): `range(a,b)`, `gt(n)`, `gte(n)`, `nonzero`, `maxlen(n)`,
 * `code(safe|token|contract)`, `enum(a|b|c)`, joined with `&`. CG5 lints the overlay, so an unknown or malformed
 * term is skipped here rather than reported.
 */
export type ParsedRule = {
  range?: { min: bigint; max: bigint };
  gt?: bigint;
  gte?: bigint;
  nonzero?: true;
  maxlen?: number;
  code?: "safe" | "token" | "contract";
  options?: string[];
};

const INTEGER = /^-?\d+$/;
const TERM = /^([a-z]+)(?:\((.*)\))?$/;

function integer(text: string | undefined): bigint | undefined {
  const trimmed = text?.trim() ?? "";
  return INTEGER.test(trimmed) ? BigInt(trimmed) : undefined;
}

/** Parses a rule; `undefined` or "" is no rule. */
export function parseRule(rule: string | undefined): ParsedRule {
  const out: ParsedRule = {};
  if (!rule) return out;
  for (const raw of rule.split("&")) {
    const match = TERM.exec(raw.trim());
    if (!match) continue;
    const [, name, arg] = match;
    switch (name) {
      case "range": {
        const [a, b] = (arg ?? "").split(",");
        const min = integer(a);
        const max = integer(b);
        if (min !== undefined && max !== undefined) out.range = { min, max };
        break;
      }
      case "gt": {
        const n = integer(arg);
        if (n !== undefined) out.gt = n;
        break;
      }
      case "gte": {
        const n = integer(arg);
        if (n !== undefined) out.gte = n;
        break;
      }
      case "nonzero":
        out.nonzero = true;
        break;
      case "maxlen": {
        const n = integer(arg);
        if (n !== undefined && n >= 0n) out.maxlen = Number(n);
        break;
      }
      case "code":
        if (arg === "safe" || arg === "token" || arg === "contract") out.code = arg;
        break;
      case "enum": {
        const options = (arg ?? "").split("|").map((o) => o.trim()).filter((o) => o !== "");
        if (options.length > 0) out.options = options;
        break;
      }
    }
  }
  return out;
}
