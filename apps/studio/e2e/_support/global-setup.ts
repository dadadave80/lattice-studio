/**
 * K2's stand-in for Q0's global setup: serves the dev app on `PLAYWRIGHT_PORT` and stops it after the run.
 * Q0 replaces it with a `VITE_STUDIO_E2E=1` build in `dist-e2e-<PLAYWRIGHT_PORT>`, served on the same port.
 */
import { join } from "node:path";
import { createServer } from "vite";
import { appDir, localPort } from "../../local-env.ts";

// Playwright loads global setup through its default export.
// oxlint-disable-next-line import/no-default-export
export default async function globalSetup(): Promise<() => Promise<void>> {
  const port = localPort("PLAYWRIGHT_PORT");
  const server = await createServer({
    configFile: join(appDir, "vite.config.ts"),
    server: { port, strictPort: true },
  });
  await server.listen();
  return async () => {
    await server.close();
  };
}
