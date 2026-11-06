import type { Facet } from "@lattice-studio/core";
import { useDocument, useFacetDetail } from "@/contracts";
import { catalogFacetName } from "@/chain/inspect/upgrade/catalog";
import sheet from "../../shared/sheet.module.css";

/** The catalog's summary, then the contract's NatSpec notice once its shard loads (when it says more). */
export function FacetSummary({ facet }: { facet: Facet }) {
  const name = useDocument((state) => catalogFacetName(state.project.recipe, facet.name));
  const detail = useFacetDetail(name);
  const notice = detail.status === "ready" ? detail.detail.natspec.notice?.trim() : undefined;
  return (
    <div className={sheet.section}>
      <p className={sheet.text}>{facet.summary}</p>
      {notice && notice !== facet.summary.trim() ? (
        <p className={sheet.muted} data-natspec="">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
