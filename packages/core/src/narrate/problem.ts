import type { RenderProblemFn } from "../model/api";
import type { Json } from "../model/json";

function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item !== undefined) out[key] = sortKeys(item);
    }
    return out;
  }
  return value;
}

/**
 * Placeholder until WP-C10 replaces it with the checks table's templates (spec L311-L342): a deterministic
 * `<code> <JSON of params with sorted keys>`, so the checks and `runChecks` work before C10 lands.
 * Unlike the other stubs it doesn't throw.
 */
export const renderProblem: RenderProblemFn = (code, params) => `${code} ${JSON.stringify(sortKeys(params))}`;
