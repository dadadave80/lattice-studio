/**
 * Registers persistence with the contracts (§5.2): the projects and deployments services, and the boot that
 * follows the document and reopens the last project. Evaluated in the entry chunk (`contracts/discover.ts`):
 * the implementation loads lazily, and nothing opens IndexedDB until the boot runs after evaluation.
 *
 * Browser tests (`env.test`) keep K2's in-memory defaults, which the harness clears between tests; a test
 * that needs real storage provides its own database (`persist/testing.ts`).
 */
import { env, provideServices } from "@/contracts";
import { bootPersistence, deploymentsService, projectsService } from "./current";

if (!env.test) {
  provideServices({ projects: projectsService, deployments: deploymentsService });
  queueMicrotask(() => void bootPersistence());
}
