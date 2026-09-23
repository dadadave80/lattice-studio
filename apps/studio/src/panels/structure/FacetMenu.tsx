import { layoutMetrics, useCatalog, useDocument, useSession } from "@/contracts";
import { MenuCommandItem, MenuSeparator } from "@/ui";

/**
 * A facet row's menu: the card's menu (IR L191), so everything the card offers is here, Move to… included
 * (spec L747). With several facets selected it acts on the selection, as the card's does.
 */
export function FacetMenu({ facet, contested }: { facet: string; contested: boolean }) {
  const selection = useSession((s) => s.selection);
  const expanded = useDocument((s) => s.project.layout[facet]?.expanded ?? false);
  const catalog = useCatalog();
  const selectors = catalog?.facets.find((f) => f.name === facet)?.selectors.length ?? 0;
  const several = selection.length > 1 && selection.includes(facet);
  return (
    <>
      <MenuCommandItem command={{ id: "inspector.show", args: { facet } }} label="Open in inspector" />
      <MenuCommandItem command={{ id: "sheet.locate", args: { facet } }} label="Locate" icon="locate" />
      <MenuCommandItem command={{ id: "sheet.moveTo" }} label="Move to…" />
      <MenuCommandItem
        command={{ id: "layout.flipPins", args: { facets: several ? selection : [facet] } }}
        label="Flip pins"
      />
      {selectors > layoutMetrics.expandThreshold ? (
        <MenuCommandItem command={{ id: "layout.toggleExpand", args: { facet } }} label={expanded ? "Collapse" : "Expand"} />
      ) : null}
      {contested ? (
        <MenuCommandItem command={{ id: "facet.routeContested", args: { facet } }} label="Route contested selectors here" />
      ) : null}
      <MenuSeparator />
      {several ? (
        <>
          <MenuCommandItem command={{ id: "layout.tidySelection" }} label="Tidy selection" />
          <MenuCommandItem
            command={{ id: "facet.remove", args: { facets: selection } }}
            label={`Remove ${selection.length}`}
            icon="trash"
          />
        </>
      ) : (
        <MenuCommandItem command={{ id: "facet.remove", args: { facets: [facet] } }} label="Remove" icon="trash" />
      )}
    </>
  );
}
