import { useEffect } from "react";
import { REGION_LABELS, type RegionId, type RegionProps } from "@/contracts";
import { regionRef, retainA11y } from "./regions";

/**
 * `useRegion(id)` (contracts §5.2): props for a region container. Each is a labelled `region` landmark
 * ("Inspector"), a stop in F6 cycling that takes focus without joining the Tab order, and registered through
 * its `ref`. The first mounted region installs F6, the live regions and focus following; the last one to
 * unmount removes them.
 *
 * The toasts region (S10's viewport) is a stop only while it holds a visible element.
 */
export function useRegionImpl(id: RegionId): RegionProps {
  useEffect(() => retainA11y(), []);
  return {
    role: "region",
    "aria-label": REGION_LABELS[id],
    "data-region": id,
    tabIndex: -1,
    ref: regionRef(id),
  };
}
