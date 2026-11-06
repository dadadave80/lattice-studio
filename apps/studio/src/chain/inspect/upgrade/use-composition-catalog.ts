import { useMemo } from "react";
import { doc, getCatalog, useCatalog, useDocument } from "@/contracts";
import { compositionCatalog } from "./catalog";

export function useCompositionCatalog() {
  const catalog = useCatalog();
  const recipe = useDocument((state) => state.project.recipe.mode === "upgrade" ? state.project.recipe : null);
  return useMemo(() => recipe ? compositionCatalog(recipe, catalog) : catalog, [recipe, catalog]);
}
export function getCompositionCatalog() { return compositionCatalog(doc.get().recipe, getCatalog()); }
