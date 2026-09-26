import type { Hex4 } from "@lattice-studio/core";
import { formatSelector } from "@lattice-studio/core";
import { useEffect, useState } from "react";
import { commandRef, useAnalysis, useCatalog, useDocument, useSession } from "@/contracts";
import { pinView } from "@/sheet/card/card-model";
import { ContextMenu } from "@/ui/overlays/ContextMenu";
import { MenuCommandItem } from "@/ui/overlays/MenuCommandItem";
import { MenuItem } from "@/ui/overlays/MenuItem";
import { MenuSeparator } from "@/ui/overlays/MenuSeparator";
import { closeSheetMenu, useSheetMenu, type MenuRequest } from "./menu-state";
import styles from "./interact.module.css";

/**
 * The sheet's context menus (IR L190-L197): the card's, a pin's and the sheet's, with the same commands as the
 * palette (never the only way to reach one). Right click or long press opens one at the pointer; Shift+F10 or
 * the menu key below the focused card or pin, with focus on the first item. Esc closes it and focus goes back
 * to what had it.
 */
export function SheetMenu() {
  const request = useSheetMenu();
  // A menu belongs to the sheet it opened on: when the sheet goes (another project, a narrow pane), so does it.
  useEffect(() => closeSheetMenu, []);
  if (!request) return null;
  return <OpenMenu key={request.key} request={request} />;
}

/**
 * After the menu has let go of focus, focus goes back to what had it, unless the item moved it to another region
 * (the inspector, the palette). A card the menu removed is gone, and the delete rule places focus instead.
 */
function restoreFocus(invoker: HTMLElement | null): void {
  requestAnimationFrame(() => {
    if (!invoker?.isConnected) return;
    const active = document.activeElement;
    if (active === invoker) return;
    const region = invoker.closest("[data-region]");
    if (!active || active === document.body || (region !== null && region.contains(active))) invoker.focus({ preventScroll: true });
  });
}

function OpenMenu({ request }: { request: MenuRequest }) {
  const [point, setPoint] = useState<HTMLSpanElement | null>(null);
  const catalog = useCatalog();
  const pin =
    request.kind === "pin"
      ? catalog?.facets.find((f) => f.name === request.facet)?.selectors.find((s) => s.hex === request.selector)
      : undefined;
  const label =
    request.kind === "card"
      ? `${request.facet} actions`
      : request.kind === "pin"
        ? `${pin ? formatSelector(pin, "dense").replaceAll("`", "") : request.selector} actions`
        : "Sheet actions";
  return (
    <ContextMenu
      open={point !== null}
      anchor={point}
      label={label}
      onOpenChange={(open) => {
        if (open) return;
        closeSheetMenu();
        restoreFocus(request.invoker);
      }}
      items={request.kind === "card" ? <CardItems facet={request.facet} /> : request.kind === "pin" ? (
        <PinItems facet={request.facet} selector={request.selector} />
      ) : (
        <SheetItems at={request.at} />
      )}
    >
      <span ref={setPoint} className={styles.menuPoint} style={{ left: request.client.x, top: request.client.y }} data-menu-point="" />
    </ContextMenu>
  );
}

/** Card: Open in inspector, Locate, Move to…, Flip pins, Expand or Collapse, Route contested selectors here, Remove; with several selected: Tidy selection, Remove {n} (IR L194). */
function CardItems({ facet }: { facet: string }) {
  const expanded = useDocument((s) => s.project.layout[facet]?.expanded === true);
  // Cards on the sheet only: a selection can name a facet that has just gone.
  const layout = useDocument((s) => s.project.layout);
  const selection = useSession((s) => s.selection);
  const count = selection.filter((name) => Object.hasOwn(layout, name)).length;
  const several = count >= 2;
  return (
    <>
      <MenuCommandItem command={commandRef("inspector.show", { facet })} label="Open in inspector" />
      <MenuCommandItem command={commandRef("sheet.locate", { facet })} label="Locate" />
      <MenuCommandItem command={commandRef("sheet.moveTo")} label="Move to…" />
      <MenuCommandItem command={commandRef("layout.flipPins", { facets: [facet] })} label="Flip pins" />
      <MenuCommandItem command={commandRef("layout.toggleExpand", { facet })} label={expanded ? "Collapse" : "Expand"} />
      <MenuCommandItem command={commandRef("facet.routeContested", { facet })} label="Route contested selectors here" />
      <MenuSeparator />
      {several ? <MenuCommandItem command={commandRef("layout.tidySelection")} label="Tidy selection" /> : null}
      <MenuCommandItem command={commandRef("facet.removeSelected")} label={several ? `Remove ${count}` : "Remove"} />
    </>
  );
}

/**
 * Pin: Route here, Leave out of the diamond or Bring back, Copy selector, Copy signature, Show owner (IR L195),
 * each only where the pin's state allows it (S4a's card model, as the Structure tree's selector menu reads it):
 * Route here where another facet serves it or it's contested, Leave out where it routes here, Bring back where
 * it's out. A seam offers no route (spec L441), and a selector the analysis hasn't checked yet none of these.
 */
function PinItems({ facet, selector }: { facet: string; selector: Hex4 }) {
  const catalog = useCatalog();
  const excluded = useDocument((s) => s.project.recipe.exclude.some((x) => x.toLowerCase() === selector));
  const route = useAnalysis((a) => a.routing[selector]);
  const entry = catalog?.facets.find((f) => f.name === facet)?.selectors.find((s) => s.hex === selector);
  const state = catalog && entry ? pinView({ facet, selector: entry, route, excluded, catalog }).state : "unchecked";
  const routeHere = state === "elsewhere" || state === "contested";
  const leaveOut = state === "routed" || state === "default";
  const change = routeHere || leaveOut || state === "excluded";
  return (
    <>
      {routeHere ? <MenuCommandItem command={commandRef("selector.route", { selector, facet })} label="Route here" /> : null}
      {leaveOut ? <MenuCommandItem command={commandRef("selector.exclude", { selector })} label="Leave out of the diamond" /> : null}
      {state === "excluded" ? (
        <MenuCommandItem command={commandRef("selector.include", { selector, facet })} label="Bring back" />
      ) : null}
      {change ? <MenuSeparator /> : null}
      <MenuCommandItem command={commandRef("selector.copy", { selector, facet })} label="Copy selector" />
      <MenuCommandItem command={commandRef("selector.copySignature", { selector, facet })} label="Copy signature" />
      <MenuCommandItem command={commandRef("selector.showOwner", { selector })} label="Show owner" />
    </>
  );
}

/** Paste is v1.1 (IR L197): shown, disabled with why. */
export const PASTE_LATER = "Arrives in v1.1";

/** Sheet: Add facet here… (the palette, placing at the pointer), Tidy, Fit, Select all, and Paste (v1.1) (IR L197). */
function SheetItems({ at }: { at: { x: number; y: number } }) {
  return (
    <>
      <MenuCommandItem command={commandRef("sheet.addFacetHere", { at })} label="Add facet here…" />
      <MenuCommandItem command={commandRef("layout.tidy")} label="Tidy" />
      <MenuCommandItem command={commandRef("sheet.zoomFit")} label="Fit" />
      <MenuCommandItem command={commandRef("sheet.selectAll")} label="Select all" />
      <MenuItem label="Paste" onSelect={() => undefined} disabledReason={PASTE_LATER} />
    </>
  );
}
