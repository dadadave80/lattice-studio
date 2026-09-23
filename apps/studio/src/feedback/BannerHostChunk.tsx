import { lazy, Suspense } from "react";

const LazyBannerHost = lazy(() => import("./BannerHost").then((m) => ({ default: m.BannerHost })));

/**
 * The banner host, mounted eagerly wherever it's placed but loaded in its own chunk (spec L822):
 * `BannerHost.tsx` pulls in `@/ui`'s `Banner` (and, through the barrel, every other primitive it
 * re-exports), so nothing there should load before there's a banner to show. `BannerHost.tsx` itself
 * renders nothing while there's nothing to show; this stays a plain, unconditional `Suspense`+`lazy`
 * boundary (matching `DialogHost`'s and `ToastRegion`'s in `App.tsx`) rather than a store-gated one, since a
 * conditional in front of the `Suspense` confuses the build's codeSplitting group (FX17): it then folds the
 * lazy chunk into the entry instead of excluding it.
 */
export function BannerHostChunk() {
  return (
    <Suspense fallback={null}>
      <LazyBannerHost />
    </Suspense>
  );
}
