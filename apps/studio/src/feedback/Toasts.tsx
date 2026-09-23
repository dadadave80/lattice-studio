import { BannerHost } from "./BannerHost";

/**
 * @deprecated Compatibility alias for `App.tsx`'s current `<Toasts />` mount, which belongs in the overlays
 * div beside the palette and the tour (its own doc comment already says "banner host" there). `app/App.tsx`
 * is FX15's to change; once it imports `BannerHost` directly instead, delete this file. Until then this is
 * exactly `BannerHost` under the old name, so nothing floats twice and nothing is silently missing.
 */
export function Toasts() {
  return <BannerHost />;
}
