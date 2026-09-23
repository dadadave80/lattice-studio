import { authorityEntries, isPowerRow, type AuthorityEntry } from "../authority/table";
import { isAddressLike, refOf } from "../authority/semantics";
import type { AnalysisContext, Check } from "../model/analysis";
import { codeAtFor } from "../model/chain";
import { toChecksum, type Address } from "../model/hex";
import { problem, problemId, type Anchor, type Problem } from "../model/problems";

/** EIP-7702 delegation designator: an account whose code is `0xef0100 ‖ address` is still one key. */
const DELEGATED = "0xef0100";

/**
 * AUTH-01 and AUTH-02 (spec L332-L333). Owner: WP-C4c.
 * AUTH-01: upgrade or admin power rests with an account the chain says has no code, or only an EIP-7702
 * delegation. Silent until `ctx.chain` has the holder's code. Never for "This diamond" or any address this
 * diamond was predicted at: it has no code before it's deployed (GovernedVaultInit.sol:45-48, 73-77).
 * AUTH-02: a literal authority address that `ctx.known` holds (an earlier prediction or a recorded deployment).
 */
export const checkAuth: Check = ({ recipe, catalog, ctx }) => {
  const entries = authorityEntries(recipe, catalog, ctx);
  return [...singleKey(entries, ctx), ...staleAddresses(entries, ctx)];
};

function singleKey(entries: readonly AuthorityEntry[], ctx: AnalysisContext): Problem[] {
  const chain = ctx.chain;
  if (!chain) return [];
  const known = new Set(ctx.known.map((a) => a.toLowerCase()));
  const self = ctx.refs?.self?.toLowerCase();
  const byHolder = new Map<string, { holder: Address; delegated: boolean; roles: string[]; paths: string[] }>();
  for (const entry of entries) {
    const { row } = entry;
    if (!isPowerRow(entry) || row.anyone || row.holder === null) continue;
    const ref = refOf(row.holder);
    if (ref === "self") continue;
    const address = ref === "deployer" ? ctx.refs?.deployer : isAddressLike(row.holder) ? row.holder : undefined;
    if (address === undefined || !isAddressLike(address)) continue;
    const key = address.toLowerCase();
    if (key === self || known.has(key)) continue;
    const code = codeAtFor(chain, key);
    if (code === undefined) continue;
    const delegated = code.toLowerCase().startsWith(DELEGATED);
    if (code !== "0x" && !delegated) continue;
    const group = byHolder.get(key) ?? { holder: toChecksum(address), delegated, roles: [], paths: [] };
    const role = row.upgrade ? (entry.cutFn ?? row.role) : row.role;
    if (!group.roles.includes(role)) group.roles.push(role);
    if (row.path !== undefined && !group.paths.includes(row.path)) group.paths.push(row.path);
    byHolder.set(key, group);
  }
  return [...byHolder.entries()].map(([key, g]) => {
    const id = problemId("AUTH-01", key);
    // The spec's order: what cuts first, then the roles ("`diamondCut` and `DEFAULT_ADMIN_ROLE` rest with …").
    const roles = [...g.roles].sort((a, b) => cutRank(a) - cutRank(b));
    const where: Anchor[] = g.paths.length > 0 ? g.paths.map((path) => ({ kind: "init", path })) : [{ kind: "diamond" }];
    return problem(
      "AUTH-01",
      where,
      { holder: g.holder, roles, paths: g.paths, delegated: g.delegated, chain: chain.name },
      [
        { id: "authority.chooseMechanism", args: { preset: "safe" } },
        { id: "authority.chooseMechanism", args: { preset: "governance" } },
        { id: "ack.set", args: { problemId: id } },
      ],
      { id },
    );
  });
}

function cutRank(role: string): number {
  return role === "diamondCut" || role === "scheduleCut" ? 0 : 1;
}

function staleAddresses(entries: readonly AuthorityEntry[], ctx: AnalysisContext): Problem[] {
  if (ctx.known.length === 0) return [];
  const known = new Set(ctx.known.map((a) => a.toLowerCase()));
  // The current prediction is where this diamond will be, not a leftover (spec L333: "under another salt,
  // account or chain"), even though recordPrediction puts it in `known` too.
  const self = ctx.refs?.self?.toLowerCase();
  const out: Problem[] = [];
  for (const { path, role, address } of literalAuthority(entries)) {
    const key = address.toLowerCase();
    if (!known.has(key) || key === self) continue;
    const from = ctx.knownFrom?.[key];
    const params: { path: string; role: string; address: Address; source?: "prediction" | "deployment"; chainId?: number; chain?: string } = {
      path,
      role,
      address: toChecksum(address),
    };
    if (from) {
      params.source = from.source;
      params.chainId = from.chainId;
      if (from.chain !== undefined) params.chain = from.chain;
    }
    out.push(
      problem("AUTH-02", [{ kind: "init", path }], params, [
        { id: "init.setArg", args: { path, value: { $ref: "self" } } },
        { id: "init.focusField", args: { path } },
      ]),
    );
  }
  return out;
}

/**
 * Each authority argument that holds a literal address, once per path, with the role its param receives.
 * Shared with LINK-01. `anyone` rows and references never qualify.
 */
export function literalAuthority(entries: readonly AuthorityEntry[]): { path: string; role: string; address: string }[] {
  const seen = new Set<string>();
  const out: { path: string; role: string; address: string }[] = [];
  for (const { row, paramRole } of entries) {
    if (row.path === undefined || row.anyone || seen.has(row.path) || !isAddressLike(row.holder)) continue;
    seen.add(row.path);
    out.push({ path: row.path, role: paramRole ?? row.role, address: row.holder });
  }
  return out;
}
