/**
 * Accessibility infrastructure (WP-S9): regions and F6, the skip link, announcements, focus movement, and
 * motion and contrast preferences. `useRegion` and `announce` are reached through `@/contracts`; the rest is
 * imported from here.
 */
export { SkipLink } from "./SkipLink";
export { flushAnnouncements, MAX_WAIT_MS, QUIET_MS, spoken } from "./announcer";
export {
  captureInvoker, cardElement, focusAfterDelete, focusAfterHistory, focusCard, focusSheet, provideCardFocus,
} from "./focus";
export type { CardFocuser } from "./focus";
export { describeMove, nextAfterDelete, positionInWords, readingOrder, restoredCard, ROW_TOLERANCE } from "./positions";
export {
  mediaMatches, reducedMotion, useForcedColors, useMediaQuery, useMoreContrast, useReducedMotion,
  FORCED_COLORS_QUERY, MORE_CONTRAST_QUERY, REDUCED_MOTION_QUERY,
} from "./preferences";
export { availableRegions, currentRegion, cycleRegion, focusRegion, regionAvailable, toastsShowing } from "./regions";
