import { useState } from "react";
import { commandRef, runCommand, type InspectorViewProps } from "@/contracts";
import { Tree, type TreeNode } from "@/ui";
import type { InspectionEngine } from "./engine";
import { facetMetadata, facetTitle } from "./facet-metadata";
import { useInspection } from "./use-inspection";
import { useInspectionCatalogs } from "./use-inspection-catalogs";
import styles from "./DeployedView.module.css";

/** The loupe's actual routing, with no composition selection or editing actions. */
export function DeployedStructure({ view, engine }: InspectorViewProps<"deployed"> & { engine?: InspectionEngine }) {
  const state = useInspection(view, engine);
  const catalogs = useInspectionCatalogs();
  const [expanded, setExpanded] = useState<string[]>(["diamond"]);
  const facets = state.status === "ready" ? state.value.facets : [];
  const byId = new Map(facets.map((facet) => [facet.address.toLowerCase(), facet]));
  const nodes: TreeNode[] = [{ id: "diamond", label: "Deployed diamond", children: facets.map((facet) => {
    const metadata = facetMetadata(facet, catalogs);
    return { id: facet.address.toLowerCase(), label: `${facetTitle(facet)} · ${facet.selectors.length} selectors`, children: facet.selectors.map((selector) => ({
      id: `${facet.address.toLowerCase()}:${selector}`,
      label: [selector, metadata?.selectors.find((item) => item.hex.toLowerCase() === selector)?.signature].filter(Boolean).join(" · "),
    })) };
  }) }];
  const select = (id: string, focus = true) => {
    const facet = byId.get(id.split(":")[0]!);
    if (id !== "diamond" && !facet) return;
    void runCommand(commandRef("inspect.selectFacet", {
      chainId: view.chainId, address: view.address, focus, ...(facet ? { facetAddress: facet.address } : {}),
    }), "keys");
  };
  const status = state.status === "error" ? state.reason : state.status === "no-code" ? "No contract code at this address." : state.status === "not-diamond" ? "This contract doesn't expose a diamond loupe." : "Inspecting diamond…";
  return <div className={styles.structure}>
    {state.status !== "ready" ? <output className={styles.status}>{status}</output> : <Tree
      label="On-chain structure" className={styles.tree} nodes={nodes}
      expanded={expanded} onExpandedChange={setExpanded}
      selected={[view.facetAddress?.toLowerCase() ?? "diamond"]}
      onSelectedChange={(ids) => { const id = ids.at(-1); if (id) select(id, false); }}
      onActivate={(node) => {
        select(node.id);
        if (node.children?.length) setExpanded((current) => current.includes(node.id) ? current.filter((id) => id !== node.id) : [...current, node.id]);
      }}
      itemProps={(node) => ({ title: byId.get(node.id)?.address ?? node.label })}
    />}
  </div>;
}
