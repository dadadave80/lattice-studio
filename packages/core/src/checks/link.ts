import { authorityEntries } from "../authority/table";
import type { Check } from "../model/analysis";
import { toChecksum, type Address } from "../model/hex";
import { problem, type Problem } from "../model/problems";
import { literalAuthority } from "./auth";

/**
 * LINK-01 (spec L334, L858). Owner: WP-C4c. An address that receives authority came from a shared link or an
 * opened file (`ctx.unconfirmed`) and hasn't been confirmed. References are never poisoned, so only literal
 * addresses count.
 */
export const checkLink: Check = ({ recipe, catalog, ctx }) => {
  if (ctx.unconfirmed.length === 0) return [];
  const unconfirmed = new Set(ctx.unconfirmed);
  const out: Problem[] = [];
  for (const { path, role, address } of literalAuthority(authorityEntries(recipe, catalog, ctx))) {
    if (!unconfirmed.has(path)) continue;
    const params: { path: string; role: string; address: Address; source?: "link" | "file" } = { path, role, address: toChecksum(address) };
    const source = ctx.unconfirmedFrom?.[path];
    if (source !== undefined) params.source = source;
    out.push(
      problem("LINK-01", [{ kind: "init", path }], params, [
        { id: "init.confirmAddress", args: { path } },
        { id: "init.focusField", args: { path } },
      ]),
    );
  }
  return out;
};
