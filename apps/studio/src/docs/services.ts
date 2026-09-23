/**
 * Registers the inspector's "doc" view (contracts/inspector.ts). Discovered eagerly; the component itself
 * is lazy. `./navigation`'s interaction listeners attach here too, so they're live from app start, before
 * the doc view's own chunk ever loads (its first mount can be the very click that triggers the load).
 */
import { lazy } from "react";
import { registerInspectorView } from "@/contracts";
import "./navigation";

registerInspectorView(
  "doc",
  lazy(() => import("./DocView").then((m) => ({ default: m.DocView }))),
);
