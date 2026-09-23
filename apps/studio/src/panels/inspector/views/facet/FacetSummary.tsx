import type { Facet } from "@lattice-studio/core";
import { useFacetDetail } from "@/contracts";
import sheet from "../../shared/sheet.module.css";

/** The catalog's summary, then the contract's NatSpec notice once its shard loads (when it says more). */
export function FacetSummary({ facet }: { facet: Facet }) {
  const detail = useFacetDetail(facet.name);
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
