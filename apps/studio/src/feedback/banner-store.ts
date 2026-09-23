/**
 * The `showBanner`/`hideBanner` implementation (contracts §5.2): a small store of banners currently up, by
 * id, that `BannerHost` renders. Owning modules (S11a's update and offline banners, S13's read-only and
 * shared-link banners, S5e's export blocker) call the contracts' `showBanner`/`hideBanner`; this store is
 * what actually holds and reacts to that state, wherever `BannerHost` is mounted.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import type { BannerProps } from "@/contracts";

export type BannerEntry = { id: string; props: BannerProps };

export type BannerState = { banners: BannerEntry[] };

export const bannerStore: StoreApi<BannerState> = createStore<BannerState>(() => ({ banners: [] }));

/** The real `showBanner`: adds it, or replaces it in place when its id is already up. */
export function putBanner(id: string, props: BannerProps): void {
  bannerStore.setState((state) => {
    const at = state.banners.findIndex((b) => b.id === id);
    if (at < 0) return { banners: [...state.banners, { id, props }] };
    const banners = state.banners.slice();
    banners[at] = { id, props };
    return { banners };
  });
}

/** The real `hideBanner`. */
export function dropBanner(id: string): void {
  bannerStore.setState((state) => ({ banners: state.banners.filter((b) => b.id !== id) }));
}

/** The banners currently up, in the order they were shown. */
export function useBanners(): readonly BannerEntry[] {
  return useStore(bannerStore, (s) => s.banners);
}

/** @internal Empties the store (tests). */
export function resetBanners(): void {
  bannerStore.setState({ banners: [] });
}
