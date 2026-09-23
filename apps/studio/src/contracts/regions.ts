/**
 * Landmark regions, in F6 order (contracts §5.2 "regions", spec L743). `toasts` joins the cycle only while
 * a toast shows.
 */
export const REGION_IDS = ["titlebar", "left", "sheet", "inspector", "console", "toasts"] as const;

export type RegionId = (typeof REGION_IDS)[number];

/** Each region's accessible name. */
export const REGION_LABELS: Readonly<Record<RegionId, string>> = {
  titlebar: "Title bar",
  left: "Left pane",
  sheet: "Sheet",
  inspector: "Inspector",
  console: "Console",
  toasts: "Notifications",
};
