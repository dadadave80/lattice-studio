import { sheetEdgeTypes, sheetNodeTypes } from "@/contracts";

/**
 * React Flow's node and edge types, read once at module scope from the sheet seam (contracts `sheet.ts`), so
 * they never change identity between renders (spec L825). S4a and S4c register into them.
 */
export const nodeTypes = sheetNodeTypes();
export const edgeTypes = sheetEdgeTypes();

/**
 * Placeholder until WP-S4b. The canvas: facet cards on an 8 px dot grid (spec L357). S4b renders
 * `sheetLayers()` inside `<ReactFlow>` and spreads `useSheetInteractions()` onto it.
 */
export function Sheet() {
  return (
    <div data-placeholder="Sheet">
      <p>Sheet</p>
      <p>Not built yet · WP-S4b</p>
    </div>
  );
}
