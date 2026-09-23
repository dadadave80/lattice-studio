import { lazy } from "react";
import { LazyPart } from "@/shell/LazyPart";
import { Button } from "@/ui/buttons/Button";
import { Menu } from "@/ui/overlays/Menu";
import { loadConsoleBody } from "./load-body";

/** The items, with the exports they run: the console body's chunk. */
const ExportItems = lazy(() => loadConsoleBody().then((m) => ({ default: m.ExportItems })));

/** Pointer or focus on the trigger fetches the items before the menu opens. */
function warmItems(): void {
  // A chunk that fails here fails again when the menu renders its items; the PWA reports it there (spec L831).
  loadConsoleBody().catch(() => undefined);
}

/**
 * The Export menu in the console header (spec L509-L518, IR L132). The trigger and the popup are the drawer's
 * frame, so the header is the same before and after the body loads; the items (`ExportItems`) arrive with the
 * body's chunk, already loaded while the drawer is open and fetched when the trigger is pointed at or focused.
 */
export function ExportMenu() {
  return (
    <Menu
      label="Export"
      align="end"
      trigger={
        <Button size="small" icon="export" onPointerEnter={warmItems} onFocus={warmItems}>
          Export
        </Button>
      }
    >
      <LazyPart>
        <ExportItems />
      </LazyPart>
    </Menu>
  );
}
