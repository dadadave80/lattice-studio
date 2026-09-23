import type { Hex4 } from "@lattice-studio/core";
import { layoutMetrics, useAnalysis, useCatalog, useDocument, useSession } from "@/contracts";
import { cx } from "@/ui";
import { useStore, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { memo, useEffect, useMemo } from "react";
import { cardAnalysis, cardView, describeCard, sameCardAnalysis, wordNeighbours, type CardAnalysis } from "./card-model";
import { CardHandles } from "./CardHandles";
import { CardMarks } from "./CardMarks";
import styles from "./FacetCard.module.css";
import { useInitMark } from "./init-mark";
import { MoreButton } from "./MoreButton";
import { cardDescriptionId, cardNameId, type FacetNode } from "./node";
import { PinRow } from "./PinRow";
import { TickStrip } from "./TickStrip";

const NO_SLICE: CardAnalysis = { routes: {}, problems: [], contested: [], key: "" };

/**
 * A placed facet on the sheet (IR L103-L105, spec L745, L824-L825): header (name, source path, init badge,
 * chips), pin rows with "+ n more" or Collapse, footer (its storage), a border for its state, and handles for
 * traces and ties. Below 40% zoom it draws compact: the header plus a tick strip.
 *
 * Props are React Flow's: only `id` (the facet name) is read. Everything else comes from the stores through
 * narrow selectors, so an edit re-renders only the cards it touches. The focusable wrapper, its role, name and
 * description are React Flow's node wrapper, wired by `facetNodeA11y` (node.ts) to the hidden text here.
 */
export const FacetCard = memo(function FacetCard({ id }: NodeProps<FacetNode>) {
  const name = id;
  const catalog = useCatalog();
  const facet = useMemo(() => catalog?.facets.find((f) => f.name === name), [catalog, name]);
  const own = useMemo(() => new Set<string>(facet?.selectors.map((s) => s.hex) ?? []), [facet]);
  const near = useMemo(() => wordNeighbours(facet, catalog?.facets ?? []), [facet, catalog]);

  const pins = useDocument((s) => s.project.layout[name]?.pins ?? "left");
  const expanded = useDocument((s) => s.project.layout[name]?.expanded === true);
  const excludedKey = useDocument((s) => s.project.recipe.exclude.filter((x) => own.has(x.toLowerCase())).join(","));
  const placedKey = useDocument((s) => s.project.recipe.facets.filter((f) => near.has(f)).join(","));
  const slice = useAnalysis((a) => (facet ? cardAnalysis(a, facet) : NO_SLICE), sameCardAnalysis);
  const selected = useSession((s) => s.selection.includes(name));
  const readOnly = useSession((s) => s.readOnly);
  const compact = useStore((s) => s.transform[2] < layoutMetrics.compactZoom);
  const mark = useInitMark(name);

  const view = useMemo(() => {
    if (!facet || !catalog) return null;
    return cardView({
      facet,
      catalog,
      slice,
      excluded: new Set((excludedKey ? excludedKey.split(",") : []).map((x) => x.toLowerCase() as Hex4)),
      placed: placedKey ? placedKey.split(",") : [],
      pins,
      expanded,
      compact,
      metrics: layoutMetrics,
    });
  }, [facet, catalog, slice, excludedKey, placedKey, pins, expanded, compact]);

  const rowKey = view ? view.rows.map((p) => p.selector).join(",") : "";
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    // Handles moved or changed: React Flow re-reads their bounds (spec L825).
    updateNodeInternals(name);
  }, [updateNodeInternals, name, rowKey, pins, compact]);

  if (!view) {
    const size = { width: layoutMetrics.cardWidth, height: layoutMetrics.headerHeight + layoutMetrics.footerHeight };
    return (
      <div className={styles.card} data-facet={name} style={size}>
        <span id={cardNameId(name)} hidden>{name}</span>
        <span id={cardDescriptionId(name)} hidden>
          {catalog ? "Not in this catalog." : "The catalog is loading."}
        </span>
        <div className={styles.paint}>
          <div className={styles.header}>
            <span className={styles.title}>{name}</span>
          </div>
          <div className={styles.footer}>{catalog ? "Not in this catalog" : "Loading"}</div>
        </div>
      </div>
    );
  }

  const { width, height } = view.size;
  const showMore = !compact && view.collapsible && (view.hidden > 0 || view.expanded);
  return (
    <div
      className={cx(
        styles.card, styles[view.border], selected && styles.selected, compact && styles.compact, mark.dimmed && styles.dimmed,
      )}
      data-facet={name}
      data-border={view.border}
      data-selected={selected ? "" : undefined}
      data-compact={compact ? "" : undefined}
      data-pins={view.pins}
      style={{ width, height }}
    >
      <span id={cardNameId(name)} hidden>{view.name}</span>
      <span id={cardDescriptionId(name)} hidden>{describeCard(view, selected)}</span>
      <div className={styles.paint} style={{ containIntrinsicSize: `${width}px ${height}px` }}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.title}>{view.facet}</span>
            {mark.badge}
            {view.chips.map((chip) => (
              <span key={chip} className={styles.chip}>{chip}</span>
            ))}
          </div>
          <div className={styles.path}>{compact ? view.count : view.source}</div>
        </div>
        {compact ? (
          <TickStrip pins={view.all} side={view.pins} />
        ) : (
          <>
            <div className={styles.rows} data-keyctx="card-rows">
              {view.rows.map((pin) => (
                <PinRow key={pin.selector} pin={pin} readOnly={readOnly} side={view.pins} />
              ))}
              {showMore ? (
                <MoreButton facet={name} expanded={view.expanded} hidden={view.hidden} readOnly={readOnly} side={view.pins} />
              ) : null}
            </div>
            <div className={styles.footer}>{view.footer}</div>
          </>
        )}
      </div>
      <CardMarks selected={selected} />
      <CardHandles rows={view.rows.map((p) => p.selector)} side={view.pins} compact={compact} metrics={layoutMetrics} />
    </div>
  );
});
