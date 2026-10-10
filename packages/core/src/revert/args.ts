import { keccak256, stringToHex } from "viem";
import type { Catalog, InitParam } from "../model/catalog";
import { isAddress, toChecksum, type Hex } from "../model/hex";

/** A decoded ABI parameter as viem types it; only what formatting reads. */
export type Param = { name?: string | undefined; type: string; components?: readonly Param[] | undefined };

/** What the catalog lets the decoder read back from hashes. */
export type Knowledge = {
  /** keccak256("lattice.<Name>") → "lattice.<Name>" (LatticeRegistry's name hash, DeployRelease.s.sol L210). */
  names: ReadonlyMap<Hex, string>;
  /** Role hashes → role names, from init parameters' `role` (`DEFAULT_ADMIN_ROLE` is 0x00, AccessControlLib L24). */
  roles: ReadonlyMap<Hex, string>;
};

const ZERO32: Hex = `0x${"0".repeat(64)}`;
const cache = new WeakMap<Catalog, Knowledge>();

/** Every shared-contract name in the catalog: facets, init contracts, LatticeRegistry, LatticeFactory, libraries. */
export function sharedNames(catalog: Catalog): string[] {
  const names = new Set<string>(["LatticeRegistry", "LatticeFactory"]);
  for (const facet of catalog.facets) names.add(facet.name);
  for (const init of catalog.inits) names.add(init.contract);
  for (const library of catalog.libraries ?? []) names.add(library.name);
  return [...names];
}

function collectRoles(params: readonly InitParam[], into: Set<string>): void {
  for (const param of params) {
    if (param.role !== undefined && /^[A-Z][A-Z0-9_]*_ROLE$/.test(param.role)) into.add(param.role);
    if (param.components) collectRoles(param.components, into);
  }
}

/** The catalog's name hashes and role hashes, computed once per catalog object. */
export function knowledgeOf(catalog: Catalog): Knowledge {
  const hit = cache.get(catalog);
  if (hit) return hit;
  const names = new Map<Hex, string>();
  for (const name of sharedNames(catalog)) names.set(keccak256(stringToHex(`lattice.${name}`)), `lattice.${name}`);
  const roleNames = new Set<string>();
  for (const init of catalog.inits) collectRoles(init.params, roleNames);
  const roles = new Map<Hex, string>();
  for (const role of roleNames) roles.set(role === "DEFAULT_ADMIN_ROLE" ? ZERO32 : keccak256(stringToHex(role)), role);
  roles.set(ZERO32, "DEFAULT_ADMIN_ROLE");
  const knowledge = { names, roles };
  cache.set(catalog, knowledge);
  return knowledge;
}

/**
 * A semver-packed registry version, `major<<48 | minor<<24 | patch` (DeployRelease.s.sol `packVersion`,
 * L241-L274), as "0.4.0". Null when the value can't be one (0 is the registry's "latest unset" sentinel).
 */
export function unpackVersion(packed: bigint): string | null {
  if (packed <= 0n || packed >= 1n << 64n) return null;
  const major = packed >> 48n;
  const minor = (packed >> 24n) & 0xffffffn;
  const patch = packed & 0xffffffn;
  return `${major}.${minor}.${patch}`;
}

/** The canonical type of a parameter, tuples expanded: `(address,uint256)[]`. */
export function canonicalType(param: Param): string {
  if (!param.type.startsWith("tuple")) return param.type;
  const suffix = param.type.slice("tuple".length);
  return `(${(param.components ?? []).map(canonicalType).join(",")})${suffix}`;
}

function arrayElement(param: Param): Param | null {
  const match = /^(.*)\[\d*\]$/.exec(param.type);
  if (!match?.[1]) return null;
  return { ...param, type: match[1] };
}

/**
 * One decoded value as text, with catalog knowledge: a `lattice.<Name>` name hash reads as its name, a role hash
 * as its role, a `uint64` version as "0.4.0"; addresses are checksummed, integers decimal.
 */
export function formatValue(param: Param, value: unknown, knowledge: Knowledge): string {
  const element = arrayElement(param);
  if (element) {
    const items = Array.isArray(value) ? (value as unknown[]) : [];
    return `[${items.map((item) => formatValue(element, item, knowledge)).join(", ")}]`;
  }
  if (param.type === "tuple") {
    const components = param.components ?? [];
    const read = (component: Param, index: number): unknown =>
      Array.isArray(value)
        ? (value as unknown[])[index]
        : component.name !== undefined && value !== null && typeof value === "object"
          ? (value as Record<string, unknown>)[component.name]
          : undefined;
    return `(${components.map((component, index) => formatValue(component, read(component, index), knowledge)).join(", ")})`;
  }
  if (typeof value === "bigint") {
    if (param.type === "uint64" && /version/i.test(param.name ?? "")) return unpackVersion(value) ?? value.toString();
    return value.toString();
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return String(value);
  if (param.type === "address") return isAddress(value.toLowerCase()) ? toChecksum(value) : value;
  if (param.type === "bytes32") {
    const hex = value.toLowerCase() as Hex;
    const name = knowledge.names.get(hex);
    if (name !== undefined) return name;
    if (/role/i.test(param.name ?? "")) return knowledge.roles.get(hex) ?? hex;
    return hex;
  }
  if (param.type.startsWith("bytes")) return value.toLowerCase();
  return value;
}
