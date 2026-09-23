/**
 * S3: the shell. The frame at every width, the title bar, the left pane, the pane commands and the tiers.
 * Other modules read the tier (`useLayoutTier`, `currentTier`) and the pane bounds (`PANE_SIZES`) from here.
 */
export { Shell, PANE_IDS } from "./Shell";
export { TitleBar } from "./TitleBar";
export { LeftPane } from "./LeftPane";
export { setShellToastDrop, shellToasts } from "./toasts";
export {
  currentTier, isDrawerTier, subscribeWindowSize, TIER_MIN, tierForWidth, useLayoutTier, useWindowHeight, windowSize,
} from "./layout-tier";
export type { LayoutTier } from "./layout-tier";
export {
  consoleMax, hidePane, PANE_NAMES, PANE_SIZES, paneShowing, paneVisibility, showPane, togglePane, toggledShowing,
} from "./panes";
export type { Panes, PaneVisibility, ShownPane, ToggledPane } from "./panes";
export { setConsoleSize, setInspectorSize, setLeftSize, setPaneOpen } from "./sizes";
export { chipWords, toneFor, useProjectStatus, useStatusChip } from "./status";
export type { StatusChipWords } from "./status";
export { closeDrawer } from "./use-drawer-escape";
