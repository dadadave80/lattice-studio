/**
 * `renderWithStudio(ui, options)`: renders a component the way the app would, with the stores seeded from the
 * fixture catalog, Base UI's style injection off, and the theme on `<html>`. Whatever the modules registered
 * (their `commands.ts` and `services.ts`) stays registered; only state is reset.
 */
import { CSPProvider } from "@base-ui/react/csp-provider";
import type { Catalog, Project } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import type { ThemeId } from "@lattice-studio/tokens";
import type { ReactNode } from "react";
import { render, type RenderResult } from "vitest-browser-react";
import {
  applyMotion, DEFAULT_SETTINGS, doc, initialSession, provideServices, session, setCatalogStatus, settings, type ChainService,
  type SessionState, type SettingsState,
} from "@/contracts";
import { fixtureCatalog } from "./catalog";
import { fakeChainService, type FakeChain } from "./chain";
import { onCleanup } from "./cleanup";

export type StudioOptions = {
  /** The open document. Default: an empty project pinned to the catalog. */
  project?: Project;
  /** Default: the fixture catalog. Null leaves the catalog loading. */
  catalog?: Catalog | null;
  /** Default: Dark. */
  theme?: ThemeId;
  /** Merged over the default settings. */
  settings?: Partial<SettingsState>;
  /** Merged over a fresh session. */
  session?: Partial<SessionState>;
  /** Served by `chainService()` for this test; a `FakeChain` from `fakeChainService()`, or `true` for a default one. */
  chain?: ChainService | FakeChain | true;
};

/** Seeds the stores without rendering (for hooks and services). Returns the project and catalog it used. */
export function seedStudio(options: StudioOptions = {}): { project: Project; catalog: Catalog | null } {
  const catalog = options.catalog === undefined ? fixtureCatalog() : options.catalog;
  const theme: ThemeId = options.theme ?? "dark";

  settings.set({ ...structuredClone(DEFAULT_SETTINGS), ...options.settings, theme });
  session.set({ ...initialSession(), ...options.session });
  setCatalogStatus(
    catalog ? { status: "ready", id: catalog.lattice.tag, catalog, manifest: null } : { status: "loading" },
  );
  const project = options.project ?? makeProject({ recipe: makeRecipe({}, catalog ?? undefined) });
  doc.load(project);
  document.documentElement.dataset.theme = theme;
  applyMotion(settings.get().reduceMotion);

  if (options.chain) {
    const chain = options.chain === true ? fakeChainService() : options.chain;
    onCleanup(provideServices({ chain: async () => chain }));
  }
  return { project, catalog };
}

export async function renderWithStudio(ui: ReactNode, options: StudioOptions = {}): Promise<RenderResult> {
  seedStudio(options);
  return render(<CSPProvider disableStyleElements>{ui}</CSPProvider>);
}
