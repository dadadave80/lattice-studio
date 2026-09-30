/**
 * The core's words as the panels show them: the pinned diamond (the proxy's fallback, DiamondLoupeFacet and
 * ERC165Facet) is never a card, so the catalog, the inspector, the structure tree and the console all say the
 * same thing about it. Plain strings, so the entry chunk and the lazy views share one source.
 */

/** Why a core facet can't be placed, dragged or activated in the catalog (its rows' disabled reason). */
export const CORE_FACET_REASON = "Part of every diamond's core.";
/** The Facet view's line for a core facet. */
export const CORE_FACET_LINE = "Part of every diamond's core. It's cut first and stays.";
/** The Diamond view's title while the core is selected. */
export const CORE_TITLE = "Core · the diamond's fixed part";
/** A sheet with no cards: the structure tree's empty line, the starting points and the console summary. */
export const CORE_ONLY = "Core only";
/** The cut plan footer's aside: the core's entries lead the plan. */
export const CORE_FIRST = "core first";
