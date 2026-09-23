/**
 * What an init field shows and what it stores (spec L461-L466). Pure: text in the input ↔ the recipe's `Arg`.
 */
import type { Arg, FieldModel, Json } from "@lattice-studio/core";
import { canonicalJson, validateArg } from "@lattice-studio/core";

export type Ref = "self" | "deployer";

export const REF_LABELS: Readonly<Record<Ref, string>> = { self: "This diamond", deployer: "Deploying account" };

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function refOf(value: Arg | undefined): Ref | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const ref = (value as { $ref?: unknown }).$ref;
  return ref === "self" || ref === "deployer" ? ref : null;
}

/** The argument at `path` ("bundle.p.asset", "steps[2].admin") inside a step's args. */
export function argAt(args: Record<string, Arg>, fieldPath: readonly string[]): Arg | undefined {
  let current: Arg | undefined = args;
  for (const key of fieldPath) {
    if (typeof current !== "object" || current === null || Array.isArray(current) || refOf(current) !== null) return undefined;
    current = (current as Record<string, Arg>)[key];
  }
  return current;
}

/** The field names under a step: "bundle.p.asset" → ["p", "asset"]. */
export function fieldKeys(path: string): string[] {
  return path.split(".").slice(1);
}

/** The step part of a field path: "bundle", "steps[2]". */
export function stepOf(path: string): string {
  return path.split(".")[0] ?? path;
}

/** What the input holds for a stored value: text as stored, references by name, anything else as JSON. */
export function displayText(value: Arg | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  const ref = refOf(value);
  if (ref) return REF_LABELS[ref];
  return JSON.stringify(value);
}

/** Text typed into an address field that names a reference ("This diamond", "self"). */
export function refFromText(text: string): Ref | null {
  const lower = text.trim().toLowerCase();
  if (lower === "self" || lower === "this diamond") return "self";
  if (lower === "deployer" || lower === "deploying account") return "deployer";
  return null;
}

/** An ENS name: dotted labels, not an address. */
export function isEnsName(text: string): boolean {
  const t = text.trim();
  return !t.startsWith("0x") && /^[^\s.]+(\.[^\s.]+)+$/.test(t);
}

export type Parsed = { ok: true; value: Arg } | { ok: false; error: string };

/**
 * What to store for text typed into `field`. Valid values are stored in their normal form (addresses
 * checksummed, integers canonical). A value that breaks its rule is stored as typed, so INIT-01 names it in
 * Problems as well as inline (spec L466), except where storing would hide the mistake: an address whose checksum
 * doesn't match would be re-checksummed on save, so it's refused here and the error stays on the field.
 */
export function parseFieldText(field: FieldModel, text: string): Parsed {
  if (field.kind === "address") {
    const ref = refFromText(text);
    if (ref) return { ok: true, value: { $ref: ref } };
  }
  if (field.kind === "array" || field.kind === "tuple") {
    const trimmed = text.trim();
    if (trimmed === "") return { ok: true, value: field.kind === "array" ? [] : "" };
    try {
      return { ok: true, value: JSON.parse(trimmed) as Arg };
    } catch {
      return { ok: true, value: trimmed };
    }
  }
  const typed = field.kind === "string" ? text : text.trim();
  const checked = validateArg(field, typed, {});
  if (checked.ok) return { ok: true, value: checked.value };
  if (field.kind === "address" && /checksum/.test(checked.error)) return { ok: false, error: checked.error };
  return { ok: true, value: typed };
}

/** Plain value equality, as C4a decides "still the example" (canonical JSON). */
export function sameArg(a: Arg | Json | undefined, b: Arg | Json | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return canonicalJson(a) === canonicalJson(b);
}
