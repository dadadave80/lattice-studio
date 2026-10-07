import type { InitSpec } from "@lattice-studio/core";
import { useMemo } from "react";
import { useAnalysis } from "@/contracts";
import sheet from "../../shared/sheet.module.css";
import styles from "./facet.module.css";
import { breakIdentifier } from "@/ui/text/Identifier";

export type InitFieldsProps = {
  spec: InitSpec;
  /** Where the spec sits in the recipe ("steps[1]", "bundle"); null when it isn't in the plan yet. */
  path: string | null;
};

/**
 * The init's fields, read-only (IR L118 "Init (its fields and position)"): name, ABI type and unit, marked
 * "missing" while INIT-01 reports the argument (or one inside it) empty or invalid. Editing is the Init plan's.
 */
export function InitFields({ spec, path }: InitFieldsProps) {
  const missingKey = useAnalysis((a) =>
    a.problems
      .filter((p) => p.code === "INIT-01")
      .flatMap((p) => p.where.flatMap((anchor) => (anchor.kind === "init" ? [anchor.path] : [])))
      .join("\n"),
  );
  const missing = useMemo(() => (missingKey === "" ? [] : missingKey.split("\n")), [missingKey]);
  if (spec.params.length === 0) return <p className={sheet.muted}>{`${spec.name} takes no arguments.`}</p>;
  return (
    <ul className={sheet.list} aria-label={`${spec.name} fields`}>
      {spec.params.map((param) => {
        const at = path === null ? null : `${path}.${param.name}`;
        const isMissing = at !== null && missing.some((m) => m === at || m.startsWith(`${at}.`) || m.startsWith(`${at}[`));
        return (
          <li key={param.name} className={sheet.item} data-field={param.name}>
            <div className={sheet.itemLine}>
              <span className={sheet.mono}>{breakIdentifier(param.name)}</span>
              <span className={sheet.muted}>{param.unit ? `${param.type} · ${param.unit}` : param.type}</span>
            </div>
            {isMissing ? <span className={styles.missing}>missing</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
