import { formatAddress, type FacetInstance } from "@lattice-studio/core";
import { useUpdateNodeInternals } from "@xyflow/react";
import { useEffect, useRef } from "react";
import { layoutMetrics, useDocument, useSession } from "@/contracts";
import { CardHandles } from "@/sheet/card/CardHandles";
import { CardMarks } from "@/sheet/card/CardMarks";
import { MoreButton } from "@/sheet/card/MoreButton";
import { cardDescriptionId, cardNameId } from "@/sheet/card/node";
import card from "@/sheet/card/FacetCard.module.css";
import { cx } from "@/ui/shared/cx";
import { rawCardRows, rawCardSize } from "./raw-card";
import styles from "./RawFacetCard.module.css";

/** Raw selectors have no invented signatures, namespace, initializer or route/edit controls. */
export function RawFacetCard({ id, instance }: { id: string; instance: Exclude<FacetInstance, { kind: "known" }> }) {
  const expanded = useDocument((state) => state.project.layout[id]?.expanded === true);
  const selected = useSession((state) => state.selection.includes(id));
  const pins = useDocument((state) => state.project.layout[id]?.pins ?? "left");
  const rows = rawCardRows(instance, expanded);
  const size = rawCardSize(instance, expanded, layoutMetrics);
  const label = instance.kind === "self" ? "Diamond itself" : "Foreign facet";
  const handleKey = `${rows.join(",")}|${pins}`;
  const updateNodeInternals = useUpdateNodeInternals();
  const measured = useRef<string | null>(null);
  useEffect(() => {
    if (measured.current !== null && measured.current !== handleKey) updateNodeInternals(id);
    measured.current = handleKey;
  }, [updateNodeInternals, id, handleKey]);
  return <div className={cx(card.card, selected && card.selected)} data-facet={id} data-raw-kind={instance.kind} style={size}>
    <span id={cardNameId(id)} hidden>{`${label} at ${instance.address}, ${instance.selectors.length} raw selectors`}</span>
    <span id={cardDescriptionId(id)} hidden>{instance.kind === "self" ? "Built-in functions are immutable. Storage, initializer and authority compatibility are not checked." : "Foreign code has no trusted catalog metadata. Only the whole facet can be removed."}</span>
    <div className={card.paint}>
      <div className={card.header}><div className={card.titleRow}><span className={card.title}>{label}</span><span className={card.chip}>{instance.kind === "self" ? "Immutable" : "Raw"}</span></div><div className={card.path} title={instance.address}>{formatAddress(instance.address)}</div></div>
      <div className={styles.rows}>{rows.map((selector) => <div key={selector} className={styles.selector}>{selector}</div>)}
        {instance.selectors.length > 3 ? <MoreButton facet={id} expanded={expanded} hidden={instance.selectors.length - rows.length} side={pins} /> : null}
      </div>
      <div className={card.footer}><span className={card.footerText} title={instance.codehash}>{`Codehash ${instance.codehash.slice(0, 10)}…${instance.codehash.slice(-4)}`}</span></div>
    </div>
    <CardMarks selected={selected} />
    <CardHandles rows={rows} side={pins} compact={false} metrics={layoutMetrics} />
  </div>;
}
