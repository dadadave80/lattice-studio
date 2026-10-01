import { commandRef } from "@/contracts";
import { MenuCommandItem } from "@/ui";

/**
 * A core row's menu: Open in inspector (a core facet's Facet view, or the pane on its current view for the
 * group and the fallback) and Select the core. No Locate, Move to… or Remove: the core is never a card.
 */
export function CoreMenu({ facet }: { facet?: string | undefined }) {
  return (
    <>
      <MenuCommandItem command={facet === undefined ? commandRef("inspector.show") : commandRef("inspector.show", { facet })} label="Open in inspector" />
      <MenuCommandItem command={commandRef("core.select")} />
    </>
  );
}
