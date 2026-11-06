import { err, planUpgrade } from "@lattice-studio/core";
import { useMemo } from "react";
import { useCatalog, useDocument } from "@/contracts";

/** Local preview of the exact diff; live code, authority and baseline checks still run before review/sign. */
export function useUpgradePlan() {
  const recipe = useDocument((state) => state.project.recipe);
  const origin = useDocument((state) => state.project.upgrade);
  const catalog = useCatalog();
  const plan = useMemo(() => !origin ? err("This upgrade plan has no stored target.") : !catalog ? err("The pinned catalog hasn't loaded.") : planUpgrade(recipe, catalog, origin), [recipe, catalog, origin]);
  return { recipe, origin, catalog, plan };
}
