/** Reference walking and resolution, shared by `collectRefs`, `resolveRefs` and the encoder. */
import type { Refs } from "../../model/chain";
import { isAddress, sameAddress, toChecksum } from "../../model/hex";
import type { Arg, RefName } from "../../model/recipe";
import { err, ok, type Result } from "../../model/result";
import { ZERO_ADDRESS } from "./abi";

export const REF_LABEL: Record<RefName, string> = { self: "This diamond", deployer: "Deploying account" };

function refName(value: Arg): RefName | "invalid" | null {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("$ref" in value)) return null;
  const name = (value as { $ref: unknown }).$ref;
  return name === "self" || name === "deployer" ? name : "invalid";
}

export function walkRefs(value: Arg, visit: (name: RefName) => void): void {
  const name = refName(value);
  if (name === "self" || name === "deployer") {
    visit(name);
  } else if (Array.isArray(value)) {
    for (const item of value) walkRefs(item, visit);
  } else if (typeof value === "object" && value !== null && name === null) {
    for (const item of Object.values(value)) walkRefs(item, visit);
  }
}

function resolveValue(value: Arg, refs: Refs, path: string): Result<Arg, string> {
  const name = refName(value);
  if (name === "invalid") {
    return err(`${path} refers to ${JSON.stringify((value as { $ref: unknown }).$ref)}; references are "self" or "deployer".`);
  }
  if (name !== null) {
    const address = refs[name];
    if (address === undefined) return err(`${path} is ${REF_LABEL[name]}, whose address isn't known yet.`);
    return ok(toChecksum(address));
  }
  if (Array.isArray(value)) {
    const out: Arg[] = [];
    for (const [i, item] of value.entries()) {
      const resolved = resolveValue(item, refs, `${path}[${i}]`);
      if (!resolved.ok) return resolved;
      out.push(resolved.value);
    }
    return ok(out);
  }
  if (typeof value === "object" && value !== null) {
    return resolveArgsAt(value as Record<string, Arg>, refs, path);
  }
  return ok(value);
}

export function resolveArgsAt(args: Record<string, Arg>, refs: Refs, prefix: string): Result<Record<string, Arg>, string> {
  const out: Record<string, Arg> = {};
  for (const [key, value] of Object.entries(args)) {
    const resolved = resolveValue(value, refs, prefix === "" ? key : `${prefix}.${key}`);
    if (!resolved.ok) return resolved;
    out[key] = resolved.value;
  }
  return ok(out);
}

export function checkRefs(refs: Refs): Result<Refs, string> {
  for (const name of ["self", "deployer"] as const) {
    const address = refs[name];
    if (address === undefined) continue;
    if (!isAddress(address)) return err(`${REF_LABEL[name]} is ${address}, which isn't an address.`);
    if (sameAddress(address, ZERO_ADDRESS)) return err(`${REF_LABEL[name]} can't be the zero address.`);
  }
  return ok(refs);
}

