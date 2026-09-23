/**
 * Vitest Browser Mode setup (vitest.config.ts `setupFiles`): the app's global styles and every module's
 * registrations, as `main.tsx` loads them, and a clean slate after each test.
 */
import "@/styles/global.css";
import "@/contracts/discover";
import { afterEach } from "vitest";
import { clearServiceBuffers } from "@/contracts/services";
import { runCleanups } from "./cleanup";

afterEach(async () => {
  await runCleanups();
  clearServiceBuffers();
});
