/**
 * S1's registrations: the document, session and settings stores and the analysis provider (contracts §5.1),
 * installed at module evaluation. Nothing here reads IndexedDB or the network: deployment records and the chain
 * module are read later, when a project opens or a chain is selected. Under Vitest (`env.test`) settings stay in
 * memory, so one test file's settings never reach the next through localStorage. The document commands' bodies
 * are asked for here, so they load while the app paints.
 */
import { env } from "@/contracts";
import { loadRuns } from "./cmd/lazy";
import { createStudioState, installStudioState } from "./runtime";

installStudioState(createStudioState(env.test ? { storage: null } : {}));
// The document commands' bodies, so the first edit doesn't wait for them (`cmd/lazy.ts`).
void loadRuns().catch(() => undefined);
