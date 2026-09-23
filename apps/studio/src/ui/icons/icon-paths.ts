/**
 * The inline icon set (no icon library, spec decision 11 and design-system-rules.md "Iconography").
 * Provisional: the brand defines no icons, so each is drawn the way the small logomark is drawn: a 24-unit
 * grid, one stroke, mitred joins, no fills, one ink (`currentColor`). Each entry is a list of SVG path `d`
 * strings. Listed for David's design pass.
 */
export const ICON_PATHS = {
  // Arrows and chevrons
  "chevron-right": ["M9 5l7 7-7 7"],
  "chevron-left": ["M15 5l-7 7 7 7"],
  "chevron-down": ["M5 9l7 7 7-7"],
  "chevron-up": ["M5 15l7-7 7 7"],
  "arrow-up": ["M12 20V4", "M5 11l7-7 7 7"],
  "arrow-down": ["M12 4v16", "M5 13l7 7 7-7"],
  "arrow-left": ["M20 12H4", "M11 5l-7 7 7 7"],
  "arrow-right": ["M4 12h16", "M13 5l7 7-7 7"],
  // History
  undo: ["M9 14L4 9l5-5", "M4 9h11a5 5 0 0 1 0 10h-4"],
  redo: ["M15 14l5-5-5-5", "M20 9H9a5 5 0 0 0 0 10h4"],
  // Chrome
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  more: ["M5 12h2", "M11 12h2", "M17 12h2"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  check: ["M4 12l5 5L20 6"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  search: ["M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13z", "M15.5 15.5L20 20"],
  // Sheet tools
  select: ["M5 4l14 6-6 2-2 6z"],
  hand: ["M12 3v18", "M3 12h18", "M9 6l3-3 3 3", "M9 18l3 3 3-3", "M6 9l-3 3 3 3", "M18 9l3 3-3 3"],
  "zoom-in": ["M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13z", "M15.5 15.5L20 20", "M7.5 10.5h6", "M10.5 7.5v6"],
  "zoom-out": ["M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13z", "M15.5 15.5L20 20", "M7.5 10.5h6"],
  fit: ["M4 9V4h5", "M15 4h5v5", "M20 15v5h-5", "M9 20H4v-5"],
  "init-order": ["M4 6h2", "M10 6h10", "M4 12h2", "M10 12h10", "M4 18h2", "M10 18h10"],
  tidy: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h6v6h-6z"],
  minimap: ["M3 5h18v14H3z", "M13 12h6v5h-6z"],
  locate: ["M12 3v5", "M12 16v5", "M3 12h5", "M16 12h5", "M9 9h6v6H9z"],
  grip: ["M9 6h.01", "M15 6h.01", "M9 12h.01", "M15 12h.01", "M9 18h.01", "M15 18h.01"],
  // Things
  copy: ["M8 8h12v12H8z", "M16 8V4H4v12h4"],
  share: ["M12 15V3", "M7 8l5-5 5 5", "M5 12v8h14v-8"],
  download: ["M12 3v12", "M7 10l5 5 5-5", "M4 20h16"],
  upload: ["M12 15V3", "M7 8l5-5 5 5", "M4 20h16"],
  external: ["M14 4h6v6", "M20 4l-9 9", "M17 14v6H4V7h6"],
  link: ["M10 14l4-4", "M8 11l-3 3a3 3 0 0 0 4 4l3-3", "M16 13l3-3a3 3 0 0 0-4-4l-3 3"],
  trash: ["M4 6h16", "M9 6V4h6v2", "M6 6l1 14h10l1-14"],
  lock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"],
  settings: ["M4 7h10", "M18 7h2", "M14 5v4", "M4 17h2", "M10 17h10", "M10 15v4"],
  keyboard: ["M3 6h18v12H3z", "M7 10h.01", "M11 10h.01", "M15 10h.01", "M8 14h8"],
  wallet: ["M4 6h14v4", "M4 6v13h16v-9H4", "M16 14.5h.01"],
  chain: ["M4 9h10v6H4z", "M10 12h10"],
  deploy: ["M12 20V6", "M6 12l6-6 6 6", "M5 3h14"],
  export: ["M12 4v11", "M8 11l4 4 4-4", "M4 20h16"],
  // Status: severity is a shape and a word, never color alone (spec L674 rule 7)
  info: ["M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z", "M12 11v6", "M12 7.5h.01"],
  warning: ["M12 3l10 18H2z", "M12 10v5", "M12 18h.01"],
  error: ["M8 3h8l5 5v8l-5 5H8l-5-5V8z", "M9 9l6 6", "M15 9l-6 6"],
  help: ["M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z", "M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14", "M12 17.5h.01"],
  theme: ["M12 3a9 9 0 1 0 0 18z", "M12 3a9 9 0 1 1 0 18"],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICON_PATHS;

export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];
