/**
 * Vitest Browser Mode setup (vitest.config.ts `setupFiles`): the app's global styles and every module's
 * registrations, as `main.tsx` loads them, and a clean slate after each test: fakes and overrides undone,
 * recorded output cleared, the deploy mirror back to idle with no controller loaded.
 */
import "@/styles/global.css";
import "@/contracts/discover";
import { afterEach } from "vitest";
import { seedDeployState } from "@/contracts/deploy";
import { clearDeploymentCache, clearServiceBuffers } from "@/contracts/services";
import { runCleanups } from "./cleanup";

afterEach(async () => {
  await runCleanups();
  clearServiceBuffers();
  clearDeploymentCache();
  seedDeployState();
});
