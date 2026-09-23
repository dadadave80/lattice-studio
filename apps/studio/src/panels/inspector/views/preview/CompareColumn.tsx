import type { Facet } from "@lattice-studio/core";
import { plural } from "@lattice-studio/core";
import { useId } from "react";
import { commandRef } from "@/contracts";
import { CommandButton } from "@/ui";
import sheet from "../../shared/sheet.module.css";
import styles from "./preview.module.css";

/** One option of Compare options… (Flow 5): name, summary, selectors, namespace, requires, init, Place {name}. */
export function CompareColumn({ facet }: { facet: Facet }) {
  const nameId = useId();
  const facts: [string, string][] = [
    ["Selectors", plural(facet.selectors.length, "selector")],
    ["Namespace", facet.storage?.id ?? "none"],
    ["Requires", facet.requires.length === 0 ? "none" : facet.requires.map((r) => r.anyOf.join(" or ")).join(" · ")],
    ["Init", facet.init ?? "none"],
  ];
  return (
    <section className={styles.column} aria-labelledby={nameId} data-option={facet.name}>
      <h3 id={nameId} className={styles.name}>
        {facet.name}
      </h3>
      <p className={sheet.text}>{facet.summary}</p>
      <dl className={styles.facts}>
        {facts.map(([label, value]) => (
          <div key={label} className={styles.fact}>
            <dt className={styles.factLabel}>{label}</dt>
            <dd className={styles.factValue}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.place}>
        <CommandButton command={commandRef("facet.place", { facet: facet.name })} size="small" />
      </div>
    </section>
  );
}
