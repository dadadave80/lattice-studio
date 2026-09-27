/**
 * Whether the catalog index is already cached (spec L399, L695): once a service worker controls the page,
 * it has precached the manifest and every catalog index (S11a), so the index comes from that cache and the
 * catalog's loading placeholders would only flash. Only a first visit, with no controller yet, shows them.
 */
let override: boolean | null = null;

export function hasCachedIndex(): boolean {
  if (override !== null) return override;
  try {
    return typeof navigator !== "undefined" && "serviceWorker" in navigator && navigator.serviceWorker.controller !== null;
  } catch {
    return false;
  }
}

/** @internal Tests: pretend the index is (true) or isn't (false) cached. Returns the undo. */
export function overrideCachedIndex(next: boolean): () => void {
  const previous = override;
  override = next;
  return () => {
    override = previous;
  };
}
