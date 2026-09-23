import type { AuthorityRow } from "@lattice-studio/core";
import { authorityTable } from "@lattice-studio/core";
import { useMemo } from "react";
import { commandRef, useCatalog, useDocument } from "@/contracts";
import { CommandButton } from "@/ui";
import { Section } from "../../shared/Section";
import sheet from "../../shared/sheet.module.css";
import { holderText } from "./diamond-words";
import styles from "./diamond.module.css";

const NO_ROWS: readonly AuthorityRow[] = [];
const IMMUTABLE = "Immutable (acknowledged)";

/** Who holds each role after init (IR L119, spec L469), with Change who can upgrade… on the upgrade row. */
export function AuthoritySection() {
  const recipe = useDocument((s) => s.project.recipe);
  const catalog = useCatalog();
  const rows = useMemo(() => (catalog ? authorityTable(recipe, catalog) : NO_ROWS), [recipe, catalog]);
  const immutable = recipe.immutable === true;
  const acknowledged = immutable && !rows.some((row) => row.upgrade);
  // An acknowledged-immutable recipe (CORE-02's Keep immutable): its holderless upgrade row says so.
  const holderOf = (row: AuthorityRow): string =>
    immutable && row.upgrade && row.holder === null && !row.anyone ? IMMUTABLE : holderText(row);

  return (
    <Section label="Authority" focusTarget={{ kind: "section", section: "authority" }}>
      {rows.length === 0 && !acknowledged ? <p className={sheet.muted}>No roles.</p> : null}
      <ul className={sheet.list}>
        {rows.map((row) => (
          <li key={`${row.role}:${row.path ?? row.via}`} className={sheet.item}>
            <div className={sheet.itemLine}>
              <span className={sheet.mono}>{row.role}</span>
              <span className={`${sheet.text} ${styles.holder}`}>{holderOf(row)}</span>
            </div>
            <span className={styles.quiet}>{row.via}</span>
            {row.upgrade ? (
              <div className={sheet.actions}>
                <CommandButton command={commandRef("authority.chooseMechanism")} size="small">
                  Change who can upgrade…
                </CommandButton>
              </div>
            ) : null}
          </li>
        ))}
        {acknowledged ? (
          <li className={sheet.item}>
            <div className={sheet.itemLine}>
              <span className={sheet.mono}>Upgrade</span>
              <span className={`${sheet.text} ${styles.holder}`}>{IMMUTABLE}</span>
            </div>
          </li>
        ) : null}
      </ul>
    </Section>
  );
}
