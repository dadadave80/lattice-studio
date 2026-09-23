/** Registers the inspector's "doc" view (contracts/inspector.ts). Discovered eagerly; the component itself is lazy. */
import { lazy } from "react";
import { registerInspectorView } from "@/contracts";

registerInspectorView(
  "doc",
  lazy(() => import("./DocView").then((m) => ({ default: m.DocView }))),
);
