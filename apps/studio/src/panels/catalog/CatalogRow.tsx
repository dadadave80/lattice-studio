import type { Facet } from "@lattice-studio/core";
import { plural } from "@lattice-studio/core";
import { Icon } from "@/ui/icons/Icon";
import { cx } from "@/ui/shared/cx";
import type { FacetAvailability } from "./catalog-tree";
import styles from "./CatalogPanel.module.css";

export type AreaRowProps = {
  label: string;
  onSheet: number;
};

/** An area folder's two-line content: its name, and how many of its facets are on the sheet (IR L84). */
export function AreaRow({ label, onSheet }: AreaRowProps) {
  return (
    <span className={styles.rowContent}>
      <span className={styles.line}>
        <span className={styles.name}>{label}</span>
        <span className={styles.muted}>{onSheet} on sheet</span>
      </span>
    </span>
  );
}

export type FacetRowProps = {
  facet: Facet;
  placed: boolean;
  availability?: FacetAvailability | undefined;
  chainName?: string | null | undefined;
};

/**
 * A facet row's two-line content (IR L82, current-catalog-row.png): name and selector count (or "On sheet"
 * once placed); namespace, unavailability on the selected chain, and the verified mark, each shown only when
 * known (spec L832: chain-dependent marks are unknown, never a false negative, until a chain is checked).
 */
export function FacetRow({ facet, placed, availability, chainName }: FacetRowProps) {
  const namespace = facet.storage ? `erc7201:${facet.storage.id}` : null;
  return (
    <span className={cx(styles.rowContent, placed && styles.ghost)}>
      <span className={styles.line}>
        <span className={styles.name}>{facet.name}</span>
        {placed ? (
          <span className={styles.badge}>On sheet</span>
        ) : (
          <span className={styles.muted}>{plural(facet.selectors.length, "selector")}</span>
        )}
      </span>
      {namespace || availability ? (
        <span className={cx(styles.line, styles.meta)}>
          {namespace ? <span className={styles.namespace}>{namespace}</span> : null}
          {availability && !availability.available ? (
            <span className={styles.chip}>{`Not on ${chainName ?? "chain"}`}</span>
          ) : null}
          {availability?.verified ? <Icon name="verified" label="Verified" size="small" className={styles.verified} /> : null}
        </span>
      ) : null}
    </span>
  );
}
