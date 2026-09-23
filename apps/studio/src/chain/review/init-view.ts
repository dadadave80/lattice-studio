/**
 * What the review's Init and Authority sections show (spec L285, L462, L567-L568), as plain functions: decoded
 * arguments flattened to dotted paths, references as "this diamond (0x…)", the recipe argument path of a decoded
 * value, the ENS names typed this session that still label a field, and what re-resolving each one found.
 * Imports core only, so `bun test` runs it.
 */
import type { Address, Arg, InitPlan, RefName, Refs } from "@lattice-studio/core";
import { isAddress, sameAddress, toChecksum } from "@lattice-studio/core";

/** Spec L285, L568: the review writes references in lowercase, with the address they resolve to. */
export const REF_WORDS: Readonly<Record<RefName, string>> = { self: "this diamond", deployer: "deploying account" };

/** "this diamond (0x…)", or "this diamond" while it doesn't resolve yet. */
export function refText(ref: RefName, address: string | undefined): string {
  return address !== undefined && isAddress(address) ? `${REF_WORDS[ref]} (${toChecksum(address)})` : REF_WORDS[ref];
}

/** The reference a stored value holds, or null. */
export function refIn(value: Arg | undefined): RefName | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const ref = (value as { $ref?: unknown }).$ref;
  return ref === "self" || ref === "deployer" ? ref : null;
}

/** One argument after flattening: its path within the step ("name_", "p.asset", "owners[1]") and its value. */
export type ArgLine = { key: string; value: Arg };

/** A step's arguments with tuples as dotted names and array items by index, in the order they're written. */
export function flattenArgs(args: Readonly<Record<string, Arg>>): ArgLine[] {
  const out: ArgLine[] = [];
  const walk = (key: string, value: Arg) => {
    if (Array.isArray(value)) {
      if (value.length === 0) out.push({ key, value });
      else value.forEach((item, i) => walk(`${key}[${i}]`, item));
    } else if (typeof value === "object" && refIn(value) === null) {
      const entries = Object.entries(value as Record<string, Arg>);
      if (entries.length === 0) out.push({ key, value });
      for (const [name, item] of entries) walk(`${key}.${name}`, item);
    } else {
      out.push({ key, value });
    }
  };
  for (const [name, value] of Object.entries(args)) walk(name, value);
  return out;
}

/**
 * The recipe argument path of a decoded value: decoded steps come in call order, as the plan lists them
 * (the automatic ERC-165 step included), so step `index` is the plan's step `index`. Null past the plan's end.
 */
export function argumentPath(plan: Pick<InitPlan, "steps"> | null, index: number, key: string): string | null {
  const step = plan?.steps[index];
  return step ? `${step.path}.${key}` : null;
}

/** "steps[0].owners[1]" → the step "steps[0]" and the keys ["owners", 1]. */
function splitPath(path: string): { step: string; keys: (string | number)[] } | null {
  const [step, ...rest] = path.split(".");
  if (step === undefined || rest.length === 0) return null;
  const keys: (string | number)[] = [];
  for (const segment of rest) {
    const match = /^([^[\]]+)((?:\[\d+\])*)$/.exec(segment);
    if (!match) return null;
    keys.push(match[1] ?? "");
    for (const index of (match[2] ?? "").matchAll(/\[(\d+)\]/g)) keys.push(Number(index[1]));
  }
  return { step, keys };
}

/** The value the recipe holds at an argument path ("steps[0].admin", "bundle.p.asset"), or undefined. */
export function plannedValue(plan: Pick<InitPlan, "steps"> | null, path: string): Arg | undefined {
  const parts = splitPath(path);
  const step = parts ? plan?.steps.find((s) => s.path === parts.step) : undefined;
  if (!parts || !step) return undefined;
  let current: Arg | undefined = step.args;
  for (const key of parts.keys) {
    if (current === undefined || refIn(current) !== null) return undefined;
    if (typeof key === "number") current = Array.isArray(current) ? current[key] : undefined;
    else current = typeof current === "object" && !Array.isArray(current) ? (current as Record<string, Arg>)[key] : undefined;
  }
  return current;
}

/** An ENS name typed into a field (init-ui-store's `EnsLabel`, restated so this file needs core only). */
export type TypedName = { name: string; address: Address; chainId: number };

/** A label that still names what its field holds. */
export type EnsEntry = { path: string; name: string; address: Address };

/**
 * The ENS names typed this session for this project and this chain (spec L462) whose field still holds the address
 * the name resolved to. A name typed for another chain says nothing about this one, and a field edited since no
 * longer carries its name.
 */
export function ensEntries(
  labels: Readonly<Record<string, TypedName>>,
  projectId: string,
  chainId: number | null,
  plan: Pick<InitPlan, "steps"> | null,
): EnsEntry[] {
  const prefix = `${projectId}|`;
  const out: EnsEntry[] = [];
  for (const [key, label] of Object.entries(labels)) {
    if (!key.startsWith(prefix) || label.chainId !== chainId) continue;
    const path = key.slice(prefix.length);
    const value = plannedValue(plan, path);
    if (typeof value !== "string" || !sameAddress(value, label.address)) continue;
    out.push({ path, name: label.name, address: toChecksum(label.address) });
  }
  return out;
}

/** "vault.eth (0x…)" when the address carries a typed name, else the address in full. */
export function addressText(address: string, ens: readonly EnsEntry[], path: string | null): string {
  const checksummed = toChecksum(address as Address);
  const entry = path === null ? undefined : ens.find((e) => e.path === path && sameAddress(e.address, address));
  return entry ? `${entry.name} (${checksummed})` : checksummed;
}

/**
 * One value as the review writes it: a reference with what it resolves to, an address in full (with its typed ENS
 * name), text as it is, anything else as JSON. `fromRef` is decodeInit's mark for an address that equals a reference.
 */
export function valueText(value: Arg, options: { fromRef?: RefName | undefined; refs: Refs; ens: readonly EnsEntry[]; path: string | null }): string {
  const { fromRef, refs, ens, path } = options;
  if (fromRef !== undefined) return refText(fromRef, typeof value === "string" ? value : refs[fromRef]);
  const ref = refIn(value);
  if (ref !== null) return refText(ref, refs[ref]);
  if (typeof value === "string") {
    if (isAddress(value)) return addressText(value, ens, path);
    return value === "" ? '""' : value;
  }
  if (typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** What re-resolving a typed name found. */
export type Recheck =
  | { status: "pending" }
  | { status: "offline" }
  | { status: "resolved"; address: Address | null }
  | { status: "failed"; reason: string };

/** One recheck's line, and whether it flags a change the person should act on. */
export function recheckLine(entry: EnsEntry, recheck: Recheck): { text: string; changed: boolean } {
  const { name, address } = entry;
  switch (recheck.status) {
    case "pending":
      return { text: `Resolving ${name} again…`, changed: false };
    case "offline":
      return { text: `${name} is resolved again once you're online.`, changed: false };
    case "failed":
      return { text: `Couldn't resolve ${name} again: ${recheck.reason}`, changed: false };
    case "resolved":
      if (recheck.address === null) {
        return { text: `${name} no longer resolves to an address; it was ${address} when it was typed. Edit the field to use another address.`, changed: true };
      }
      if (sameAddress(recheck.address, address)) return { text: `${name} still resolves to ${address}.`, changed: false };
      return {
        text: `${name} now resolves to ${toChecksum(recheck.address)}, not ${address} as when it was typed. Edit the field to use the new address.`,
        changed: true,
      };
  }
}
