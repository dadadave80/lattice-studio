/**
 * Offline and updates (spec L828-L837): the connection service, the update prompt, chunk-failure recovery and
 * shard warming. Other modules reach this through the contracts (`isOnline`, `useOnline`, the banners and
 * the `app.reload` / `app.saveAndReload` commands), not by importing it.
 */
export { BANNERS } from "./copy";
export { isChunkLoadError } from "./chunk-errors";
