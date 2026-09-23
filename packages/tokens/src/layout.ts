// Layout sizes core and the sheet share, in CSS pixels at 100% zoom. Values
// are the brief's own defaults, or (card width, header/footer height, note
// width) measured from design/prototype/Composer-Final.dc.html.

export interface LayoutSizes {
  /** The sheet's snap/background grid, in px. */
  readonly grid: number;
  /** Drag and nudge snap to this many px. */
  readonly snap: number;
  /** Pointer movement, in px, before a press-drag becomes a drag gesture. */
  readonly dragThreshold: number;
  /** Arrow-key nudge, in px. */
  readonly nudgeSmall: number;
  /** Shift + arrow-key nudge, in px. */
  readonly nudgeLarge: number;
  /** A placed facet card's width (Composer-Final.dc.html: `.mod{width:232px}`). */
  readonly cardWidth: number;
  /** A card's header block, name + address (Composer-Final.dc.html: 47px + 1px border). */
  readonly headerHeight: number;
  /** One pin row (Composer-Final.dc.html: `.pin{height:20px}`). */
  readonly rowHeight: number;
  /** A card's namespace footer (Composer-Final.dc.html: 27px + 1px border). */
  readonly footerHeight: number;
  /** Pin rows shown before a card offers "N more". */
  readonly collapsedRows: number;
  /** Selector count at which a card starts collapsed. */
  readonly expandThreshold: number;
  /** Zoom level at and below which cards render in their compact form. */
  readonly compactZoom: number;
  /** A sticky note's width. */
  readonly noteWidth: number;
  /** Zoom level at and below which trace labels hide. */
  readonly traceLabelZoom: number;
  /** Sheet edge band, in px, that triggers auto-pan while dragging. */
  readonly edgeZone: number;
}

export const layoutSizes: LayoutSizes = {
  grid: 8,
  snap: 8,
  dragThreshold: 4,
  nudgeSmall: 8,
  nudgeLarge: 32,
  cardWidth: 232,
  headerHeight: 48,
  rowHeight: 20,
  footerHeight: 28,
  collapsedRows: 6,
  expandThreshold: 9,
  compactZoom: 0.4,
  noteWidth: 200,
  traceLabelZoom: 0.75,
  edgeZone: 48,
};
