import { lazy, Suspense } from "react";
import { useTourState } from "./tour-state";

const LazyTour = lazy(() => import("./Tour").then((m) => ({ default: m.Tour })));

/**
 * The tour, mounted eagerly by `App.tsx` but loaded in its own chunk (spec L822): `Tour.tsx` pulls in `@/ui`'s
 * `Button` (and, through the barrel, every other primitive it re-exports), so nothing there should load before
 * the tour actually runs. `useTourState` alone (a tiny store, no `@/ui`) decides whether to render at all; the
 * `import()` only fires once `tour.start` flips it, matching the "starts on tour.start" boundary.
 */
export function TourChunk() {
  const running = useTourState((s) => s.running);
  if (!running) return null;
  return (
    <Suspense fallback={null}>
      <LazyTour />
    </Suspense>
  );
}
