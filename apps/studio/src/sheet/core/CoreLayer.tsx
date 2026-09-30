import type { Hex4, Route } from "@lattice-studio/core";
import { contestedSelectors, coreStatus, isCoreOnly, mechanismOptions } from "@lattice-studio/core";
import { useStore } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { layoutMetrics, useAnalysis, useCatalog, useDocument, useSession } from "@/contracts";
import { useLayoutTier } from "@/shell/layout-tier";
import { visibleRows } from "@/sheet/card/card-model";
import { CoreCell, type Pad, type PadTone } from "./CoreCell";
import { CoreTraces, shapeKey, shapeOf, type Tone, type TraceSpec } from "./CoreTraces";
import { stubOffsets } from "./geometry";
import type { Pads } from "./painter";
import { useFlashing } from "./use-flash";
import { useHoveredCard, useKeyboardFocusedCard } from "./use-hot-card";

/** Soft traces draw under live ones; a card asked for twice keeps the stronger tone. */
const TONE_ORDER: Record<Tone, number> = { flash: 0, soft: 1, live: 2 };

/** The selectors each facet owns in the routing. */
function ownersOf(routing: Record<Hex4, Route>): Map<string, Set<Hex4>> {
  const owners = new Map<string, Set<Hex4>>();
  for (const [selector, route] of Object.entries(routing) as [Hex4, Route][]) {
    if (route.owner === undefined) continue;
    const set = owners.get(route.owner) ?? new Set<Hex4>();
    set.add(selector);
    owners.set(route.owner, set);
  }
  return owners;
}

/**
 * The core on the sheet (layer order 32, after the title block): the core cell and the traces into it. Nothing
 * at the phone tier, where the inspector's Diamond view carries the readout and the glyphs stay on the cards.
 */
export function CoreLayer() {
  const tier = useLayoutTier();
  if (tier === "phone") return null;
  return <CoreLayerBody />;
}

/**
 * Decides what shows: the traces (hover or keyboard focus on a card draws its trace in ink; the selection draws
 * live traces with a stub per routed row; a just-placed card flashes; the CUT pad hot draws the cut card's), the
 * pads' tones, and whether every glyph lights (`data-core-lit` on the sheet while the core is selected or the
 * FALLBACK pad is hot; `data-core-cut-lit` while the CUT pad is). A card that routes nothing never draws a trace.
 */
function CoreLayerBody() {
  const root = useStore((s) => s.domNode);
  const compact = useStore((s) => s.transform[2] < layoutMetrics.compactZoom);
  const recipe = useDocument((s) => s.project.recipe);
  const shape = useDocument((s) => shapeKey(s.project.layout));
  const catalog = useCatalog();
  const analysis = useAnalysis();
  const selection = useSession((s) => s.selection);
  const selected = useSession((s) => s.coreSelected);
  const hovered = useHoveredCard(root);
  const focused = useKeyboardFocusedCard(root);
  const flashing = useFlashing();
  const [hot, setHot] = useState<Pad | null>(null);
  const [pads, setPads] = useState<Pads | null>(null);
  const onPads = useCallback((next: Pads | null) => setPads(next), []);

  useEffect(() => {
    if (!root) return undefined;
    if (selected || hot === "fallback") root.setAttribute("data-core-lit", "");
    else root.removeAttribute("data-core-lit");
    return () => root.removeAttribute("data-core-lit");
  }, [root, selected, hot]);

  useEffect(() => {
    if (!root) return undefined;
    if (hot === "cut") root.setAttribute("data-core-cut-lit", "");
    else root.removeAttribute("data-core-cut-lit");
    return () => root.removeAttribute("data-core-cut-lit");
  }, [root, hot]);

  const status = useMemo(() => (catalog ? coreStatus(recipe, catalog, analysis) : null), [recipe, catalog, analysis]);
  // The cut row names the mechanism as the inspector does ("Safe", "Admin role").
  const mode = useMemo(() => {
    if (!catalog) return undefined;
    const options = mechanismOptions(recipe, catalog);
    return options.options.find((option) => option.id === options.current)?.label;
  }, [recipe, catalog]);
  const owners = useMemo(() => ownersOf(analysis.routing), [analysis]);
  const cutFacets = useMemo(
    () => new Set(catalog?.facets.filter((facet) => facet.family === "upgrade").map((facet) => facet.name) ?? []),
    [catalog],
  );
  const cards = useMemo(() => shapeOf(shape), [shape]);
  const cutCards = useMemo(() => Object.keys(cards).filter((name) => cutFacets.has(name)), [cards, cutFacets]);

  const traces = useMemo<TraceSpec[]>(() => {
    const tones = new Map<string, Tone>();
    const add = (name: string, tone: Tone) => {
      if (!cards[name] || !owners.get(name)?.size) return;
      const have = tones.get(name);
      if (have === undefined || TONE_ORDER[tone] > TONE_ORDER[have]) tones.set(name, tone);
    };
    for (const name of flashing) add(name, "flash");
    if (hovered !== null) add(hovered, "soft");
    if (focused !== null) add(focused, "soft");
    if (hot === "cut") for (const name of cutCards) add(name, "soft");
    for (const name of selection) add(name, "live");
    return [...tones]
      .sort((a, b) => TONE_ORDER[a[1]] - TONE_ORDER[b[1]] || a[0].localeCompare(b[0]))
      .map(([name, tone]) => {
        const facet = catalog?.facets.find((f) => f.name === name);
        const routed = owners.get(name) ?? new Set<Hex4>();
        const stubs =
          tone === "live" && facet
            ? stubOffsets(visibleRows(facet, cards[name]?.expanded === true, contestedSelectors(analysis, name), layoutMetrics), routed, compact, layoutMetrics)
            : [];
        return { name, tone, to: cutFacets.has(name) ? "cut" : "fallback", stubs };
      });
  }, [cards, owners, flashing, hovered, focused, hot, cutCards, selection, catalog, analysis, compact, cutFacets]);

  const toneAt = (to: "fallback" | "cut"): PadTone => {
    const mine = traces.filter((trace) => trace.to === to);
    if (mine.some((trace) => trace.tone === "live")) return "live";
    if (mine.length > 0 || hot === to) return "soft";
    return null;
  };

  if (!status) return null;
  return (
    <>
      <CoreTraces traces={traces} pads={pads} />
      <CoreCell
        status={status}
        mode={mode}
        selected={selected}
        empty={isCoreOnly(recipe)}
        hot={hot}
        onHot={setHot}
        tones={{ fallback: toneAt("fallback"), cut: toneAt("cut") }}
        onPads={onPads}
      />
    </>
  );
}
