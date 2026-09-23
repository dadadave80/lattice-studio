/** The banners of spec L831 and IR L208-L210, and their ids for `showBanner`. */
export const BANNERS = {
  /** An update is waiting and the project is saved. */
  update: { id: "pwa.update", text: "A new version of Studio is ready." },
  /** A chunk failed to load. */
  updated: { id: "pwa.updated", text: "Studio was updated. Save and reload to continue." },
  /** No connection; it clears itself. */
  offline: { id: "pwa.offline", text: "Offline. Composing works; deploy needs a connection." },
} as const;

/** Why Reload waits (spec silent; see the S11a report). */
export const RELOAD_WAITS = "Reload waits until the project is saved";
