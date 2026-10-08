/**
 * Vitest Browser Mode setup (vitest.config.ts `setupFiles`): the app's global styles and every module's
 * registrations, as `main.tsx` loads them, plus what the app loads right after its first paint, up front: the
 * canvas's parts (so a test that renders React Flow on its own finds the facet card and the layers), core's
 * analysis and the document commands' bodies (so a test reads the analysis, and an edit's result, at once) and Base
 * UI's popups (so a menu or tooltip is the real one from its first render). After each test, a clean slate: fakes
 * and overrides undone, recorded output cleared, K2's in-memory deployment records emptied, the deploy mirror back
 * to idle with no controller loaded, settings and session back to their defaults, Etherscan's outcomes and the title block's expand or collapse
 * forgotten.
 */
import "@/styles/global.css";
import "@/contracts/discover";
import { afterEach } from "vitest";
import { DEFAULT_SETTINGS, initialSession, session, settings } from "@/contracts";
import { seedDeployState } from "@/contracts/deploy";
import { clearDeploymentCache, clearMemoryDeployments, clearServiceBuffers } from "@/contracts/services";
import { etherscanOutcomes } from "@/chain/verify/etherscan-outcomes";
import { loadSheetParts } from "@/sheet/canvas/parts";
import { resetTitleBlockCollapse } from "@/sheet/chrome/title-block-choice";
import { loadAnalyzer } from "@/state/analyzer";
import { loadRuns } from "@/state/cmd/lazy";
import { loadPopups } from "@/ui/popups/load";
import { runCleanups } from "./cleanup";

await Promise.all([loadSheetParts(), loadAnalyzer(), loadRuns(), loadPopups()]);

afterEach(async () => {
  await runCleanups();
  clearServiceBuffers();
  clearDeploymentCache();
  clearMemoryDeployments();
  seedDeployState();
  settings.set(structuredClone(DEFAULT_SETTINGS));
  session.set(initialSession());
  etherscanOutcomes.reset();
  resetTitleBlockCollapse();
  delete document.documentElement.dataset.motion;
});
