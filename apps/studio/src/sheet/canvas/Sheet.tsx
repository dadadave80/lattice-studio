import type { EdgeTypes, NodeTypes } from "@xyflow/react";

/**
 * React Flow's node and edge types, declared at module scope so they never change identity between
 * renders (spec L825). S4a's facet card and S4b's traces fill them in.
 */
export const nodeTypes: NodeTypes = {};
export const edgeTypes: EdgeTypes = {};

/** Placeholder until WP-S4b. The canvas: facet cards on an 8 px dot grid (spec L357). */
export function Sheet() {
  return (
    <div data-placeholder="Sheet">
      <p>Sheet</p>
      <p>Not built yet · WP-S4b</p>
    </div>
  );
}
