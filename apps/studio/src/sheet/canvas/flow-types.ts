import { sheetEdgeTypes, sheetNodeTypes } from "@/contracts";

/**
 * React Flow's node and edge types, read once at module scope from the sheet seam (contracts `sheet.ts`), so
 * they never change identity between renders (spec L825). S4a and S4c register into them.
 */
export const nodeTypes = sheetNodeTypes();
export const edgeTypes = sheetEdgeTypes();
