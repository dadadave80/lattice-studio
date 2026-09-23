/**
 * S5a's command registrations (contracts §5.3): `catalog.focusSearch` (IR L82, "/") and `catalog.preview`
 * (IR L104, opened by a catalog row's click and its context menu's Preview item).
 */
import { command, defineCommands, session, type CommandArgsOf, type Enablement } from "@/contracts";
import { focusCatalogSearch, hasSearchFocus } from "./search-focus";

const OK: Enablement = { ok: true };

export const focusSearchCommand = command<CommandArgsOf<"catalog.focusSearch">>({
  id: "catalog.focusSearch",
  title: () => "Search the catalog",
  category: "Build",
  keys: ["/"],
  keyContext: ["global"],
  enabled: () => (hasSearchFocus() ? OK : { ok: false, reason: "Show the catalog to search it." }),
  run: () => {
    focusCatalogSearch();
  },
});

export const previewCommand = command<CommandArgsOf<"catalog.preview">>({
  id: "catalog.preview",
  title: ({ facet }) => `Preview ${facet}`,
  category: "Build",
  enabled(ctx, args) {
    if (typeof args.facet !== "string" || args.facet === "") return { ok: false, reason: "Name a facet to preview" };
    if (ctx.catalog && !ctx.catalog.facets.some((f) => f.name === args.facet)) {
      return { ok: false, reason: `‘${args.facet}’ isn't a facet in this catalog.` };
    }
    return OK;
  },
  run(_ctx, { facet }) {
    session.set((s) => ({ panes: { ...s.panes, inspector: { ...s.panes.inspector, open: true, view: { kind: "preview", facet } } } }));
  },
});

defineCommands([focusSearchCommand, previewCommand]);
