import type { Facet } from "@lattice-studio/core";
import { useDocument, useFacetDetail } from "@/contracts";
import { catalogFacetName } from "@/chain/inspect/upgrade/catalog";
import { retryFacetDetail } from "@/catalog/services";
import { Button } from "@/ui";
import sheet from "../../shared/sheet.module.css";
import { breakIdentifier } from "@/ui/text/Identifier";

/** The facet's source at the pinned tag, from its detail shard. */
export function SourceLink({ facet }: { facet: Facet }) {
  const name = useDocument((state) => catalogFacetName(state.project.recipe, facet.name));
  const detail = useFacetDetail(name);
  if (detail.status === "loading") return <span className={sheet.muted}>Loading the source link…</span>;
  if (detail.status === "error") return (
    <span>
      <span className={sheet.muted}>Couldn't load the source link. {detail.reason}</span>{" "}
      <Button size="small" onClick={() => retryFacetDetail(name)}>Retry</Button>
    </span>
  );
  return (
    <a className={sheet.link} href={detail.detail.source.url} target="_blank" rel="noreferrer">
      {breakIdentifier(facet.source)}
    </a>
  );
}
