import type { AnalysisContext } from "../model/analysis";
import type { AuthorityTableFn } from "../model/api";
import type { Catalog } from "../model/catalog";
import { toChecksum } from "../model/hex";
import type { AuthorityRow } from "../model/init";
import type { Arg, Recipe } from "../model/recipe";
import {
  ADMIN_ROLE,
  authorityArgs,
  GUARDIAN,
  isAddressLike,
  mechanismByFacet,
  OWNER_CUT,
  OWNER_ROLE,
  refOf,
  SELF_HELD,
  specNamed,
  upgradeMembers,
  type AuthorityArg,
} from "./semantics";

/** A table row plus what the AUTH and LINK checks need to word their problems. */
export type AuthorityEntry = {
  row: AuthorityRow;
  /** Upgrade rows: the function that cuts ("diamondCut", "scheduleCut"). */
  cutFn?: string;
  /** The overlay role of the argument at `row.path` ("DEFAULT_ADMIN_ROLE", "diamondCut"). */
  paramRole?: string;
};

function self(): Arg {
  return { $ref: "self" };
}

/**
 * Who holds admin, upgrade, guardian, proposer and executor power after init (spec L469, L568), with the
 * details the checks use. Order: role rows in call order, then Upgrade, Guardian, Proposer, Executor.
 */
export function authorityEntries(recipe: Recipe, catalog: Catalog, ctx?: AnalysisContext): AuthorityEntry[] {
  const args = authorityArgs(recipe, catalog);
  const members = upgradeMembers(recipe, catalog);
  const cutRoles = new Set<string>(["diamondCut", "scheduleCut"]);
  const roleRows: AuthorityEntry[] = [];
  const upgradeRows: AuthorityEntry[] = [];
  const tail: AuthorityEntry[] = [];

  const selfHeld = recipe.init.kind === "bundle" ? selfHeldOf(recipe.init.spec, catalog) : [];
  for (const held of selfHeld) {
    const entry: AuthorityEntry = {
      row: held.holder === "anyone" ? { role: held.role, holder: null, anyone: true, via: held.via } : { role: held.role, holder: self(), via: held.via },
    };
    (held.role === ADMIN_ROLE ? roleRows : tail).push(entry);
  }

  // Safe params (role diamondCut or scheduleCut) show as the Upgrade row when their mechanism is placed.
  const consumed = new Set<string>();
  for (const member of members) {
    const def = mechanismByFacet(member.name);
    if (member.name === OWNER_CUT.facet) {
      upgradeRows.push(...holdersOf(args, (a) => a.param.role === OWNER_ROLE, OWNER_CUT.via, OWNER_CUT.cutFn));
      continue;
    }
    if (!def?.via || !def.cutFn) continue;
    if (def.id === "admin") {
      const hasArg = args.some((a) => a.param.role === ADMIN_ROLE);
      if (!hasArg && selfHeld.some((h) => h.role === ADMIN_ROLE)) {
        upgradeRows.push({ row: { role: "Upgrade", holder: self(), via: def.via, upgrade: true }, cutFn: def.cutFn });
      } else {
        upgradeRows.push(...holdersOf(args, (a) => a.param.role === ADMIN_ROLE, def.via, def.cutFn));
      }
    } else if (def.id === "governance") {
      upgradeRows.push({ row: { role: "Upgrade", holder: self(), via: def.via, upgrade: true }, cutFn: def.cutFn });
    } else {
      const cutFn = def.cutFn;
      const safes = args.filter((a) => a.param.role === cutFn && a.spec.name === member.init);
      for (const a of safes) consumed.add(a.path);
      upgradeRows.push(...holdersOf(safes, () => true, def.via, cutFn));
    }
  }
  if (members.length === 0) {
    upgradeRows.push({
      row: { role: "Upgrade", holder: null, via: recipe.immutable ? "Immutable: no upgrade mechanism" : "No upgrade mechanism", upgrade: true },
    });
  }

  for (const a of args) {
    if (consumed.has(a.path)) continue;
    const row: AuthorityRow = { role: a.param.role ?? a.param.name, holder: a.value ?? null, via: `${a.spec.contract}(${a.param.name})`, path: a.path };
    const entry: AuthorityEntry = { row };
    if (a.param.role) entry.paramRole = a.param.role;
    // A Safe param whose mechanism isn't placed still receives what its init grants.
    (cutRoles.has(a.param.role ?? "") ? tail : roleRows).push(entry);
  }
  const guardian: AuthorityEntry[] = recipe.facets.includes(GUARDIAN.facet)
    ? [{ row: { role: GUARDIAN.role, holder: null, via: GUARDIAN.via } }]
    : [];

  const entries = [...roleRows, ...upgradeRows, ...guardian, ...sortTail(tail)];
  for (const entry of entries) resolve(entry.row, ctx);
  return entries;
}

/** C4c `authorityTable` (spec L469, L568). */
export const authorityTable: AuthorityTableFn = (recipe, catalog, ctx) => authorityEntries(recipe, catalog, ctx).map((e) => e.row);

function selfHeldOf(specName: string, catalog: Catalog) {
  const spec = specNamed(catalog, specName);
  return spec ? (SELF_HELD[spec.contract] ?? []) : [];
}

function holdersOf(
  args: readonly AuthorityArg[],
  match: (a: AuthorityArg) => boolean,
  via: string,
  cutFn: string,
): AuthorityEntry[] {
  const found = args.filter(match);
  if (found.length === 0) return [{ row: { role: "Upgrade", holder: null, via, upgrade: true }, cutFn }];
  return found.map((a) => {
    const entry: AuthorityEntry = { row: { role: "Upgrade", holder: a.value ?? null, via, path: a.path, upgrade: true }, cutFn };
    if (a.param.role) entry.paramRole = a.param.role;
    return entry;
  });
}

const TAIL_ORDER = ["Proposer", "Executor"];

function sortTail(tail: AuthorityEntry[]): AuthorityEntry[] {
  const rank = (e: AuthorityEntry) => {
    const i = TAIL_ORDER.indexOf(e.row.role);
    return i === -1 ? TAIL_ORDER.length : i;
  };
  return tail.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map((x) => x.e);
}

function resolve(row: AuthorityRow, ctx: AnalysisContext | undefined): void {
  const ref = refOf(row.holder);
  if (ref) {
    const address = ctx?.refs?.[ref];
    if (address !== undefined && isAddressLike(address)) row.resolved = toChecksum(address);
    return;
  }
  if (isAddressLike(row.holder)) row.resolved = toChecksum(row.holder);
}

/** Whether a row carries upgrade or admin power (AUTH-01's scope). */
export function isPowerRow(entry: AuthorityEntry): boolean {
  return entry.row.upgrade === true || entry.row.role === ADMIN_ROLE || entry.row.role === OWNER_ROLE;
}

