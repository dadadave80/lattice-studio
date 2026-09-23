/**
 * The app's entry (contracts §1: K2, then frozen). Order matters: styles, then every module's registrations
 * (`discover`), then the theme and the catalog manifest, then the first render.
 */
import "@/styles/global.css";
import "@/contracts/discover";
import { CSPProvider } from "@base-ui/react/csp-provider";
import type { CatalogManifest, Result } from "@lattice-studio/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app";
import { catalogBase, startCatalog, syncTheme } from "@/contracts";

async function fetchManifest(): Promise<Result<CatalogManifest, string>> {
  try {
    const response = await fetch(`${catalogBase()}manifest.json`);
    if (!response.ok) return { ok: false, error: `manifest.json answered ${response.status}.` };
    // Validation stays out of first load (CCR from FX15): the schema chunk arrives with the manifest fetch.
    const { validateCatalogManifest } = await import("@lattice-studio/core/schema");
    const parsed = validateCatalogManifest(await response.json());
    return parsed.ok ? parsed : { ok: false, error: "manifest.json doesn't match the manifest schema." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

syncTheme();
void fetchManifest().then(startCatalog);

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element.");

createRoot(root).render(
  <StrictMode>
    <CSPProvider disableStyleElements>
      <App />
    </CSPProvider>
  </StrictMode>,
);
