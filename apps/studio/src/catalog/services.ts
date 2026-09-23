/**
 * S14's registration (contracts §5.1, §5.2, discovered eagerly by `contracts/discover.ts`): the real catalog
 * loader, and the document subscription `stores.ts` reserves for "S14's catalog pin" — warming placed
 * facets' shards (spec L830) and switching to a project's own bundled catalog when it differs from the one
 * on screen (spec "Catalog pin", L290).
 */
import { doc, getCatalogStatus, provideCatalogLoader, subscribeCatalog } from "@/contracts";
import { createCatalogLoader } from "./loader";
import { resolveCatalogPin } from "./pin";
import { setCatalogPin } from "./pin-store";

const loader = createCatalogLoader();
provideCatalogLoader(loader);

function warmPlaced(): void {
  for (const name of doc.get().recipe.facets) loader.warm(name);
}

function syncPin(): void {
  const status = getCatalogStatus();
  const pin = resolveCatalogPin(doc.get().recipe.catalog, status);
  setCatalogPin(pin);
  if (pin.status === "bundled" && status.status === "ready" && status.manifest && status.id !== pin.entry.id) {
    void loader.switchTo(pin.entry, status.manifest);
  }
}

doc.subscribe(() => {
  warmPlaced();
  syncPin();
});
subscribeCatalog(() => {
  warmPlaced();
  syncPin();
});
