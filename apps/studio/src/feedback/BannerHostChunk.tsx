import { lazy, Suspense } from "react";
import { useBanners } from "./banner-store";

const LazyBannerHost = lazy(() => import("./BannerHost").then((m) => ({ default: m.BannerHost })));

/**
 * The banner host, mounted eagerly wherever it's placed but loaded in its own chunk (spec L822):
 * `BannerHost.tsx` pulls in `@/ui`'s `Banner` (and, through the barrel, every other primitive it
 * re-exports). `useBanners` alone (the tiny store `showBanner`/`hideBanner` write to) decides whether
 * there's anything to render; the `import()` only fires once a banner actually shows.
 */
export function BannerHostChunk() {
  const banners = useBanners();
  if (banners.length === 0) return null;
  return (
    <Suspense fallback={null}>
      <LazyBannerHost />
    </Suspense>
  );
}
