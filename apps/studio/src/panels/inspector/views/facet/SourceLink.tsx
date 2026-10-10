import type { Facet } from "@lattice-studio/core";
import { useFacetDetail } from "@/contracts";
import sheet from "../../shared/sheet.module.css";
import { breakIdentifier } from "@/ui/text/Identifier";

/** The facet's source at the pinned tag, from its detail shard. */
export function SourceLink({ facet }: { facet: Facet }) {
  const detail = useFacetDetail(facet.name);
  if (detail.status === "loading") return <span className={sheet.muted}>Loading the source link…</span>;
  if (detail.status === "error") return <span className={sheet.muted}>Couldn't load the source link. {detail.reason}</span>;
  return (
    <a className={sheet.link} href={detail.detail.source.url} target="_blank" rel="noreferrer">
      {breakIdentifier(facet.source)}
    </a>
  );
}
