import type { AnalysisContext, AuthorityRow, Catalog, Recipe } from "@lattice-studio/core";
import { authorityTable, isNotImplemented } from "@lattice-studio/core";
import { useId } from "react";
import { commandRef } from "@/contracts";
import { CommandButton } from "@/ui/buttons/CommandButton";
import { CodeText } from "./CodeText";
import { REF_LABELS, refOf } from "./field-value";
import { resolvedRef, useRefAddresses, type RefAddresses } from "./hooks";
import styles from "./InitEditor.module.css";

function rowsOf(recipe: Recipe, catalog: Catalog, refs: RefAddresses): AuthorityRow[] | string {
  const ctx: AnalysisContext = { known: [], unconfirmed: [] };
  if (refs.self || refs.deployer) {
    ctx.refs = { ...(refs.self ? { self: refs.self } : {}), ...(refs.deployer ? { deployer: refs.deployer } : {}) };
  }
  try {
    return authorityTable(recipe, catalog, ctx);
  } catch (error) {
    if (isNotImplemented(error)) return error.message;
    throw error;
  }
}

/** Who holds it, in full (spec L469): a reference with what it resolves to, an address, "anyone" or "none". */
export function holderText(row: AuthorityRow, refs: RefAddresses): string {
  if (row.anyone) return "anyone";
  if (row.holder === null) return "none";
  const ref = refOf(row.holder);
  if (ref) {
    const address = row.resolved ?? resolvedRef(refs, ref);
    return address ? `${REF_LABELS[ref]} (${address})` : REF_LABELS[ref];
  }
  return typeof row.holder === "string" ? row.holder : JSON.stringify(row.holder);
}

/**
 * The Authority table under the plan (spec L469): who holds admin, upgrade, guardian, proposer and executor roles
 * after init, with full addresses and how each holder gets it. The Upgrade row opens Flow 17.
 */
export function AuthorityTable({ recipe, catalog }: { recipe: Recipe; catalog: Catalog }) {
  const headingId = useId();
  const refs = useRefAddresses();
  const rows = rowsOf(recipe, catalog, refs);
  return (
    <section className={styles.authority} aria-labelledby={headingId} data-init-section="authority">
      <h3 id={headingId} className={styles.eyebrow} tabIndex={-1}>
        Authority
      </h3>
      {typeof rows === "string" ? (
        <p className={styles.empty}>{rows}</p>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>No init argument grants a role.</p>
      ) : (
        <table className={styles.table} aria-labelledby={headingId}>
          <thead>
            <tr>
              <th scope="col" className={styles.roleCell}>
                Role
              </th>
              <th scope="col">Holder</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.role}|${row.path ?? row.via}|${i}`} data-authority-row={row.role}>
                <th scope="row" className={styles.roleCell}>
                  {row.role}
                </th>
                <td>
                  <span className={styles.holder}>{holderText(row, refs)}</span>
                  <span className={styles.via}>
                    <CodeText text={row.via} />
                  </span>
                  {row.upgrade ? (
                    <div className={styles.rowAction}>
                      <CommandButton size="small" command={commandRef("authority.chooseMechanism")}>
                        Change who can upgrade…
                      </CommandButton>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
