/**
 * Vitest Browser Mode setup (vitest.config.ts `setupFiles`): the app's global styles and every module's
 * registrations, as `main.tsx` loads them, and a clean slate after each test: fakes and overrides undone,
 * recorded output cleared, K2's in-memory deployment records emptied, the deploy mirror back to idle with no
 * controller loaded, settings and session back to their defaults, and Etherscan's outcomes forgotten.
 */
import "@/styles/global.css";
import "@/contracts/discover";
import { afterEach } from "vitest";
import { DEFAULT_SETTINGS, initialSession, session, settings } from "@/contracts";
import { seedDeployState } from "@/contracts/deploy";
import { clearDeploymentCache, clearMemoryDeployments, clearServiceBuffers } from "@/contracts/services";
import { etherscanOutcomes } from "@/chain/verify/etherscan-outcomes";
import { runCleanups } from "./cleanup";

afterEach(async () => {
  await runCleanups();
  clearServiceBuffers();
  clearDeploymentCache();
  clearMemoryDeployments();
  seedDeployState();
  settings.set(structuredClone(DEFAULT_SETTINGS));
  session.set(initialSession());
  etherscanOutcomes.reset();
  delete document.documentElement.dataset.motion;
});
