import type { LoupeFacet } from "../model/chain";
import { isAddress, isHex4AnyCase, sameAddress, toChecksum, type Address, type Hex4 } from "../model/hex";
import { err, ok, type Result } from "../model/result";

/** EIP-2535's Add (0), Replace (1) or Remove (2), in the existing ABI tuple shape. */
export type UpgradeCut = { facetAddress: Address; action: 0 | 1 | 2; functionSelectors: Hex4[] };

/** Raw selectors are retained verbatim or removed with their whole original instance. */
export type UpgradeSelectorLock = LoupeFacet & { kind: "foreign" | "extra" };

export type UpgradeCutsArgs = {
  diamond: Address;
  current: readonly LoupeFacet[];
  desired: readonly LoupeFacet[];
  /** All selectors for a foreign instance; only the raw extra selectors for a known instance. */
  locked: readonly UpgradeSelectorLock[];
};

const ZERO: Address = "0x0000000000000000000000000000000000000000";

type Routes = { owners: Map<Hex4, Address>; facets: Map<Address, Set<Hex4>> };

function routes(value: unknown, label: string): Result<Routes, string> {
  if (!Array.isArray(value)) return err(`The ${label} must be a list of facet rows.`);
  const owners = new Map<Hex4, Address>();
  const facets = new Map<Address, Set<Hex4>>();
  for (const [index, row] of (value as readonly unknown[]).entries()) {
    if (row === null || typeof row !== "object") return err(`The ${label} row ${index} isn't a facet row.`);
    const fields = row as Record<string, unknown>;
    if (!isAddress(fields.facetAddress) || sameAddress(fields.facetAddress, ZERO)) {
      return err(`The ${label} row ${index} must target a nonzero facet address.`);
    }
    const address = toChecksum(fields.facetAddress);
    if (facets.has(address)) return err(`The ${label} lists facet ${address} more than once.`);
    const values = fields.functionSelectors;
    if (!Array.isArray(values) || values.length === 0) return err(`The ${label} row ${index} must contain selectors; omit empty rows.`);
    const selectors = new Set<Hex4>();
    for (const value of values as readonly unknown[]) {
      if (!isHex4AnyCase(value)) return err(`The ${label} row ${index} contains a selector that isn't four hex bytes.`);
      const selector = value.toLowerCase() as Hex4;
      if (owners.has(selector)) return err(`The ${label} routes selector ${selector} more than once.`);
      owners.set(selector, address);
      selectors.add(selector);
    }
    facets.set(address, selectors);
  }
  return ok({ owners, facets });
}

function checkSelf(current: Routes, desired: Routes, diamond: Address): Result<null, string> {
  for (const [selector, owner] of current.owners) {
    if (owner === diamond && desired.owners.get(selector) !== diamond) {
      return err(`Selector ${selector} is immutable on diamond ${diamond}; it cannot be removed or replaced.`);
    }
  }
  for (const [selector, owner] of desired.owners) {
    if (owner === diamond && current.owners.get(selector) !== diamond) {
      return err(`An upgrade cannot add immutable selector ${selector} to diamond ${diamond}.`);
    }
  }
  return ok(null);
}

function checkLocked(current: Routes, desired: Routes, groups: readonly UpgradeSelectorLock[]): Result<null, string> {
  const parsed = routes(groups, "locked selector groups");
  if (!parsed.ok) return parsed;
  for (const group of groups) {
    if (group.kind !== "foreign" && group.kind !== "extra") return err("A locked selector group's kind must be foreign or extra.");
    const address = toChecksum(group.facetAddress);
    const selectors = parsed.value.facets.get(address)!;
    const baseline = current.facets.get(address);
    if (!baseline || [...selectors].some((selector) => current.owners.get(selector) !== address)) {
      return err(`Locked selectors at ${address} don't match their current facet instance.`);
    }
    if (group.kind === "foreign" && selectors.size !== baseline.size) {
      return err(`The foreign facet group at ${address} must name every selector of its current instance.`);
    }
    const retained = [...selectors].every((selector) => desired.owners.get(selector) === address);
    const removed = !desired.facets.has(address) && [...selectors].every((selector) => !desired.owners.has(selector));
    const unchanged = retained && (group.kind === "extra" || desired.facets.get(address)?.size === baseline.size);
    if (!unchanged && !removed) {
      return err(`Raw selectors at ${address} must stay unchanged or be removed with the whole facet instance.`);
    }
  }
  return ok(null);
}

/**
 * The exact routing delta, without catalog-address assumptions or fresh-deploy core repair. Addresses are
 * checksummed, selectors lowercase and sorted; cuts sort by action, then address. No input is changed.
 * Self selectors cannot change. Foreign groups cannot be partially edited, extended or reassigned; known
 * raw extras stay locked until their entire instance disappears. Authority, code and init checks are the caller's.
 */
export function buildUpgradeCuts(args: UpgradeCutsArgs): Result<UpgradeCut[], string> {
  if (!isAddress(args.diamond) || sameAddress(args.diamond, ZERO)) return err("The diamond must have a nonzero address.");
  const diamond = toChecksum(args.diamond);
  const current = routes(args.current, "current loupe");
  if (!current.ok) return current;
  const desired = routes(args.desired, "desired loupe");
  if (!desired.ok) return desired;
  const self = checkSelf(current.value, desired.value, diamond);
  if (!self.ok) return self;
  const locked = checkLocked(current.value, desired.value, args.locked);
  if (!locked.ok) return locked;

  const groups = new Map<string, UpgradeCut>();
  const add = (selector: Hex4, facetAddress: Address, action: UpgradeCut["action"]): void => {
    const key = `${action}:${facetAddress}`;
    const group = groups.get(key);
    if (group) group.functionSelectors.push(selector);
    else groups.set(key, { facetAddress, action, functionSelectors: [selector] });
  };
  const selectors = [...new Set([...current.value.owners.keys(), ...desired.value.owners.keys()])].sort();
  for (const selector of selectors) {
    const before = current.value.owners.get(selector);
    const after = desired.value.owners.get(selector);
    if (before === after) continue;
    if (after === undefined) add(selector, ZERO, 2);
    else add(selector, after, before === undefined ? 0 : 1);
  }
  return ok([...groups.values()].sort((a, b) => {
    if (a.action !== b.action) return a.action - b.action;
    const left = a.facetAddress.toLowerCase();
    const right = b.facetAddress.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
  }));
}
