import { lazy, Suspense } from "react";

const LazyTour = lazy(() => import("./Tour").then((m) => ({ default: m.Tour })));

/**
 * The tour, mounted eagerly by `App.tsx` but loaded in its own chunk (spec L822): `Tour.tsx` pulls in `@/ui`'s
 * `Button` (and, through the barrel, every other primitive it re-exports), so nothing there should load
 * before the tour actually runs. `Tour.tsx` itself renders nothing while the tour isn't running; this stays a
 * plain, unconditional `Suspense`+`lazy` boundary (matching `DialogHost`'s and `ToastRegion`'s in `App.tsx`)
 * rather than a store-gated one, since a conditional in front of the `Suspense` confuses the build's
 * codeSplitting group (FX17): it then folds the lazy chunk into the entry instead of excluding it.
 */
export function TourChunk() {
  return (
    <Suspense fallback={null}>
      <LazyTour />
    </Suspense>
  );
}
