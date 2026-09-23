/**
 * What the console's browser tests share: fixture projects, a captured downloader, and a clean console per test.
 * Test-only; no app code imports it.
 */
import type { Catalog, ExportFile, Hex4, Project } from "@lattice-studio/core";
import { blankDiamond, loadTemplate } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { command, type Command } from "@/contracts";
import { fixtureCatalog, onCleanup, overrideCommands } from "../../../test/harness";
import { clearCommandHistory } from "./command-line";
import { setDownloader } from "./download";
import { resetConsoleLog } from "./log-store";

/** The fixture catalog (K3), as `renderWithStudio` loads it. */
export function catalog(): Catalog {
  return fixtureCatalog();
}

/** The ERC20 recipe: 4 facets, no blockers, one warning (INIT-05). */
export function erc20Project(name = "ERC20"): Project {
  const recipe = loadTemplate(catalog(), "ERC20");
  if (!recipe.ok) throw new Error(recipe.error);
  return makeProject({ id: "p-erc20", name, recipe: recipe.value });
}

/** The blank diamond plus two gateway adapters: two SEL-01 blockers. */
export function collisionProject(): Project {
  const blank = blankDiamond(catalog());
  return makeProject({
    id: "p-collide",
    name: "Gateways",
    recipe: { ...blank, facets: [...blank.facets, "AxelarGatewayAdapter", "HyperlaneGatewayAdapter"] },
  });
}

/** An empty sheet. */
export function emptyProject(): Project {
  const blank = blankDiamond(catalog());
  return makeProject({ id: "p-empty", name: "Untitled", recipe: { ...blank, facets: [] } });
}

/** Every file the console would have saved in this test. */
export function captureDownloads(): ExportFile[] {
  const files: ExportFile[] = [];
  onCleanup(setDownloader((file) => void files.push(file)));
  return files;
}

/** An empty log and history before each test. */
export function resetConsole(): void {
  resetConsoleLog();
  clearCommandHistory();
}

/** Replaces `sheet.locate` (S4b's) with a recorder, enabled. */
export function recordLocate(): { facet: string; selector?: Hex4 }[] {
  const calls: { facet: string; selector?: Hex4 }[] = [];
  const locate: Command = command<{ facet: string; selector?: Hex4 }>({
    id: "sheet.locate",
    title: (a) => `Locate ${a.facet}`,
    category: "Sheet",
    enabled: () => ({ ok: true }),
    run: (_ctx, args) => void calls.push(args.selector ? { facet: args.facet, selector: args.selector } : { facet: args.facet }),
  });
  overrideCommands([locate]);
  return calls;
}
