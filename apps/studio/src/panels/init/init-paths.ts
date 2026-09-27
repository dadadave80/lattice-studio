/**
 * Argument paths ("steps[0].safe", "bundle.p.asset") read against a recipe's init, with no runtime imports: the
 * label store on the first load and the pure ops both use it.
 */
import type { Address, Arg, RecipeInit } from "@lattice-studio/core";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const STEP = /^steps\[(0|[1-9][0-9]*)\]$/;

/** The literal address the recipe holds at an argument path, or null (a reference, anything else, nothing). */
export function addressAt(init: RecipeInit, path: string): Address | null {
  const [head, ...keys] = path.split(".");
  let current: Arg | undefined;
  if (head === "bundle" && init.kind === "bundle") current = init.args;
  const step = STEP.exec(head ?? "");
  if (step && init.kind === "steps") current = init.steps[Number(step[1])]?.args;
  for (const key of keys) {
    if (typeof current !== "object" || current === null || Array.isArray(current) || "$ref" in current) return null;
    current = (current as Record<string, Arg>)[key];
  }
  return typeof current === "string" && ADDRESS.test(current) ? (current as Address) : null;
}

/** Two addresses in any case, the same account. */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
}
