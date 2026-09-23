import { createContext } from "react";

export type ToolbarOrientation = "horizontal" | "vertical";

/** The enclosing toolbar's orientation, so a button can put its tooltip beside a vertical strip. */
export const ToolbarOrientationContext = createContext<ToolbarOrientation>("horizontal");
