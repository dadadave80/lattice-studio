/**
 * Test stand-in for S4b's sheet (browser tests only; never imported by the app): React Flow with the
 * registered node types and layers, nodes built from the document's layout the way S4b builds them
 * (`FACET_NODE_TYPE`, `facetNodeA11y`), and a fixed viewport.
 */
import "@xyflow/react/dist/base.css";
import { ReactFlow, ReactFlowProvider, type ReactFlowInstance } from "@xyflow/react";
import { useMemo } from "react";
import { sheetLayers, sheetNodeTypes, useDocument } from "@/contracts";
import { FACET_NODE_TYPE, facetNodeA11y, type FacetNode } from "../node";

const nodeTypes = sheetNodeTypes();

export type CardSheetProps = {
  zoom?: number;
  width?: number;
  height?: number;
  onInit?: (instance: ReactFlowInstance<FacetNode>) => void;
};

export function CardSheet({ zoom = 1, width = 1400, height = 860, onInit }: CardSheetProps) {
  const layout = useDocument((s) => s.project.layout);
  const nodes = useMemo<FacetNode[]>(
    () =>
      Object.entries(layout).map(([facet, entry]) => ({
        id: facet,
        type: FACET_NODE_TYPE,
        position: { x: entry.x, y: entry.y },
        data: {},
        ...facetNodeA11y(facet),
      })),
    [layout],
  );
  return (
    <div style={{ width, height }} data-region="sheet">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          nodeTypes={nodeTypes}
          defaultViewport={{ x: 0, y: 0, zoom }}
          minZoom={0.1}
          maxZoom={2}
          disableKeyboardA11y
          deleteKeyCode={null}
          zoomOnDoubleClick={false}
          nodesDraggable={false}
          proOptions={{ hideAttribution: true }}
          aria-label="Diamond sheet"
          {...(onInit ? { onInit } : {})}
        >
          {sheetLayers().map(({ id, Component }) => (
            <Component key={id} />
          ))}
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
