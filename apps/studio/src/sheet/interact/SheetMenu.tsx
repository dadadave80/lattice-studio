import type { Hex4 } from "@lattice-studio/core";
import { formatSelector } from "@lattice-studio/core";
import { useState } from "react";
import { commandRef, useCatalog, useDocument, useSession } from "@/contracts";
import { ContextMenu } from "@/ui/overlays/ContextMenu";
import { MenuCommandItem } from "@/ui/overlays/MenuCommandItem";
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
  if (!request) return null;
  return <OpenMenu key={request.key} request={request} />;
}

function restoreFocus(invoker: HTMLElement | null): void {
  // After the menu has let go of focus; a card the menu removed is gone, and the delete rule places focus.
  requestAnimationFrame(() => {
    if (invoker?.isConnected && !invoker.contains(document.activeElement)) invoker.focus({ preventScroll: true });
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
        ? `${pin ? formatSelector(pin, "dense") : request.selector} actions`
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
  const count = useSession((s) => s.selection.length);
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

/** Pin: Route here, Leave out of the diamond or Bring back, Copy selector, Copy signature, Show owner (IR L195). */
function PinItems({ facet, selector }: { facet: string; selector: Hex4 }) {
  const excluded = useDocument((s) => s.project.recipe.exclude.some((x) => x.toLowerCase() === selector));
  return (
    <>
      <MenuCommandItem command={commandRef("selector.route", { selector, facet })} label="Route here" />
      {excluded ? (
        <MenuCommandItem command={commandRef("selector.include", { selector, facet })} label="Bring back" />
      ) : (
        <MenuCommandItem command={commandRef("selector.exclude", { selector })} label="Leave out of the diamond" />
      )}
      <MenuSeparator />
      <MenuCommandItem command={commandRef("selector.copy", { selector, facet })} label="Copy selector" />
      <MenuCommandItem command={commandRef("selector.copySignature", { selector, facet })} label="Copy signature" />
      <MenuCommandItem command={commandRef("selector.showOwner", { selector })} label="Show owner" />
    </>
  );
}

/** Sheet: Add facet here… (the palette, placing at the pointer), Tidy, Fit, Select all (IR L197). Paste arrives in v1.1. */
function SheetItems({ at }: { at: { x: number; y: number } }) {
  return (
    <>
      <MenuCommandItem command={commandRef("sheet.addFacetHere", { at })} label="Add facet here…" />
      <MenuCommandItem command={commandRef("layout.tidy")} label="Tidy" />
      <MenuCommandItem command={commandRef("sheet.zoomFit")} label="Fit" />
      <MenuCommandItem command={commandRef("sheet.selectAll")} label="Select all" />
    </>
  );
}
